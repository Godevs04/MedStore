import type { INestApplication, PipeTransform } from '@nestjs/common';
import { METHOD_METADATA, PIPES_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants.js';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum.js';
import { ModulesContainer } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import type {
  OperationObject,
  ParameterObject,
  PathItemObject,
  ReferenceObject,
  ResponseObject,
  SchemaObject,
} from '@nestjs/swagger/dist/interfaces/open-api-spec.interface.js';
import type { ZodType, ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { paginationQuerySchema } from '@medicore/validation';
import { ERROR_CODES, SESSION_COOKIE_NAME } from '@medicore/shared-types';
import { IS_PUBLIC_KEY } from '../auth/public.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { MODULE_KEY, MODULE_LABELS, type PlanModule } from '../common/subscription-policy.js';
import { PERMISSIONS_KEY } from '../rbac/tenant-context.guard.js';
import { API_INTRO, OPERATION_DOCS, PARAMETER_DOCS, TAGS, TAG_GROUPS, type OperationDoc } from './operation-docs.js';

type HttpVerb = 'get' | 'post' | 'put' | 'patch' | 'delete';
const VERBS: HttpVerb[] = ['get', 'post', 'put', 'patch', 'delete'];

/** Metadata gathered from a controller handler; keyed by `Controller.method`. */
interface RouteFacts {
  bodySchema?: ZodTypeAny;
  querySchemas: ZodTypeAny[];
  permissions?: string[];
  module?: PlanModule;
  isPublic: boolean;
  paginated: boolean;
}

interface RouteArg {
  index: number;
  data?: unknown;
  pipes?: unknown[];
}

const operationIdFor = (controllerKey: string, methodKey: string): string =>
  `${controllerKey.replace(/Controller$/, '')}.${methodKey}`;

function toJsonSchema(schema: ZodTypeAny): SchemaObject {
  return zodToJsonSchema(schema as ZodType<unknown>, { target: 'openApi3', $refStrategy: 'none', effectStrategy: 'input' }) as SchemaObject;
}

const zodSchemasOf = (pipes: unknown[] | undefined): ZodTypeAny[] =>
  (pipes ?? []).filter((p): p is ZodValidationPipe => p instanceof ZodValidationPipe).map((p) => p.schema);

function readMetadata<T>(key: string, ...targets: object[]): T | undefined {
  for (const target of targets) {
    const value = Reflect.getMetadata(key, target) as T | undefined;
    if (value !== undefined) return value;
  }
  return undefined;
}

/** Walks every registered controller and reads the validation and access metadata of each route. */
function collectRouteFacts(app: INestApplication): Map<string, RouteFacts> {
  const facts = new Map<string, RouteFacts>();
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype as (new (...args: never[]) => object) | null;
      if (!controller) continue;
      const proto = controller.prototype as Record<string, unknown>;
      for (const methodKey of Object.getOwnPropertyNames(proto)) {
        const handler = proto[methodKey];
        if (methodKey === 'constructor' || typeof handler !== 'function') continue;
        if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;

        const args = Object.entries(
          (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, methodKey) as Record<string, RouteArg> | undefined) ?? {},
        );
        const methodPipes = zodSchemasOf(Reflect.getMetadata(PIPES_METADATA, handler) as PipeTransform[] | undefined);
        const argsOfType = (type: RouteParamtypes) =>
          args.filter(([key]) => Number(key.split(':')[0]) === Number(type)).map(([, arg]) => arg);

        const bodyArgs = argsOfType(RouteParamtypes.BODY);
        const queryArgs = argsOfType(RouteParamtypes.QUERY);
        const bodySchema = bodyArgs.flatMap((a) => zodSchemasOf(a.pipes))[0] ?? (bodyArgs.some((a) => a.data === undefined) ? methodPipes[0] : undefined);
        const querySchemas = [
          ...queryArgs.flatMap((a) => zodSchemasOf(a.pipes)),
          ...(queryArgs.some((a) => a.data === undefined) ? methodPipes : []),
        ];

        facts.set(operationIdFor(controller.name, methodKey), {
          bodySchema,
          querySchemas,
          permissions: readMetadata<string[]>(PERMISSIONS_KEY, handler, controller),
          module: readMetadata<PlanModule>(MODULE_KEY, handler, controller),
          isPublic: readMetadata<boolean>(IS_PUBLIC_KEY, handler, controller) === true,
          paginated: querySchemas.some((s) => {
            if (s === paginationQuerySchema) return true;
            const props = toJsonSchema(s).properties ?? {};
            return 'page' in props && 'pageSize' in props;
          }),
        });
      }
    }
  }
  return facts;
}

function queryParametersFrom(schemas: ZodTypeAny[]): ParameterObject[] {
  const params: ParameterObject[] = [];
  for (const schema of schemas) {
    const json = toJsonSchema(schema);
    const required = new Set(json.required ?? []);
    for (const [name, prop] of Object.entries(json.properties ?? {})) {
      const propSchema = prop as SchemaObject;
      params.push({
        name,
        in: 'query',
        required: required.has(name) && propSchema.default === undefined,
        description: propSchema.description ?? PARAMETER_DOCS[name],
        schema: propSchema,
      });
    }
  }
  return params;
}

const errorRef = (name: string): ReferenceObject => ({ $ref: `#/components/responses/${name}` });

function describeAccess(path: string, facts: RouteFacts): string[] {
  if (facts.isPublic) return ['**Access:** public — no session required.'];
  const lines = ['**Access:** signed-in session (cookie or bearer token).'];
  if (path.includes('/platform/')) lines.push('**Requires:** platform superadmin.');
  if (facts.permissions?.length) lines.push(`**Permissions:** ${facts.permissions.map((p) => `\`${p}\``).join(', ')}`);
  if (facts.module) lines.push(`**Plan module:** ${MODULE_LABELS[facts.module]} (\`${facts.module}\`) must be in the workspace plan.`);
  return lines;
}

function enrichOperation(path: string, verb: HttpVerb, op: OperationObject, doc: OperationDoc, facts: RouteFacts): void {
  const tenantScoped = !facts.isPublic && !/\/(auth|platform|health)(\/|$)/.test(path);
  const isWrite = verb !== 'get';

  op.summary = doc.summary;
  op.description = [
    doc.description,
    describeAccess(path, facts).join('  \n'),
    doc.errors?.length ? `**Business errors:** ${doc.errors.map((c) => `\`${c}\``).join(', ')}` : undefined,
  ]
    .filter(Boolean)
    .join('\n\n');
  if (facts.isPublic) op.security = [];

  const existing = new Map<string, ParameterObject>();
  for (const p of (op.parameters ?? []) as ParameterObject[]) {
    existing.set(`${p.in}:${p.name}`, {
      ...p,
      required: p.in === 'path' ? true : false,
      description: p.description || PARAMETER_DOCS[p.name],
      schema: p.in === 'path' && /Id$/.test(p.name) ? { type: 'string', format: 'uuid' } : (p.schema ?? { type: 'string' }),
    });
  }
  for (const p of queryParametersFrom(facts.querySchemas)) existing.set(`query:${p.name}`, p);
  const headers: ReferenceObject[] = tenantScoped
    ? [{ $ref: '#/components/parameters/OrganizationId' }, { $ref: '#/components/parameters/BranchId' }]
    : [];
  op.parameters = [...headers, ...existing.values()];

  if (facts.bodySchema) {
    op.requestBody = {
      required: true,
      content: { 'application/json': { schema: toJsonSchema(facts.bodySchema), ...(doc.example ? { example: doc.example } : {}) } },
    };
  } else if (doc.bodyDescription) {
    op.requestBody = {
      required: true,
      description: doc.bodyDescription,
      content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
    };
  }

  const successCode = Object.keys(op.responses ?? {}).find((c) => c.startsWith('2')) ?? (verb === 'post' ? '201' : '200');
  const success: ResponseObject = { description: doc.returns };
  if (doc.csv) success.content = { 'text/csv': { schema: { type: 'string', format: 'binary' } } };
  else if (facts.paginated) success.content = { 'application/json': { schema: { $ref: '#/components/schemas/Paginated' } } };
  const responses: Record<string, ResponseObject | ReferenceObject> = { [successCode]: success };

  if (facts.bodySchema || facts.querySchemas.length || existing.size) responses['400'] = errorRef('ValidationError');
  if (!facts.isPublic) responses['401'] = errorRef('Unauthenticated');
  if (tenantScoped && isWrite) responses['402'] = errorRef('SubscriptionInactive');
  if (!facts.isPublic && (tenantScoped || path.includes('/platform/'))) responses['403'] = errorRef('Forbidden');
  if (path.includes('{')) responses['404'] = errorRef('NotFound');
  if (isWrite && (doc.errors?.length || tenantScoped)) responses['409'] = errorRef('Conflict');
  if (doc.errors?.includes('ACCOUNT_LOCKED')) responses['423'] = errorRef('AccountLocked');
  op.responses = responses;
}

const errorResponse = (description: string, code: string, message: string): ResponseObject => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ErrorEnvelope' },
      example: { error: { code, message, correlationId: '6f1c2a8e-3b7d-4e0a-9a51-2f4b8c9d0e11' } },
    },
  },
});

function addComponents(document: OpenAPIObject): void {
  const components = (document.components ??= {});
  components.schemas = {
    ...components.schemas,
    ErrorEnvelope: {
      type: 'object',
      required: ['error'],
      properties: {
        error: {
          type: 'object',
          required: ['code', 'message'],
          properties: {
            code: { type: 'string', enum: [...ERROR_CODES], description: 'Stable machine-readable error code.' },
            message: { type: 'string', description: 'Human-readable explanation, safe to show to users.' },
            details: {
              type: 'array',
              description: 'Field-level validation failures.',
              items: { type: 'object', properties: { field: { type: 'string' }, message: { type: 'string' } }, required: ['message'] },
            },
            correlationId: { type: 'string', description: 'Echo of `x-correlation-id`; quote it in support requests.' },
          },
        },
      },
    },
    PageInfo: {
      type: 'object',
      required: ['page', 'pageSize', 'totalItems', 'totalPages', 'hasNextPage', 'hasPreviousPage'],
      properties: {
        page: { type: 'integer', minimum: 1 },
        pageSize: { type: 'integer', minimum: 1, maximum: 200 },
        totalItems: { type: 'integer', minimum: 0 },
        totalPages: { type: 'integer', minimum: 0 },
        hasNextPage: { type: 'boolean' },
        hasPreviousPage: { type: 'boolean' },
      },
    },
    Paginated: {
      type: 'object',
      required: ['items', 'pageInfo'],
      properties: {
        items: { type: 'array', items: { type: 'object', additionalProperties: true } },
        pageInfo: { $ref: '#/components/schemas/PageInfo' },
      },
    },
  };
  components.parameters = {
    OrganizationId: {
      name: 'x-organization-id',
      in: 'header',
      required: true,
      description: 'Workspace (organization) the request acts on. The user must hold an active membership.',
      schema: { type: 'string', format: 'uuid' },
    },
    BranchId: {
      name: 'x-branch-id',
      in: 'header',
      required: false,
      description: 'Branch context for branch-scoped data (stock, POS, purchasing). The user must be assigned to it.',
      schema: { type: 'string', format: 'uuid' },
    },
  };
  components.responses = {
    ValidationError: errorResponse('The request body, query or path failed validation. See `details` for each field.', 'VALIDATION_ERROR', 'Request validation failed'),
    Unauthenticated: errorResponse('No valid session. Sign in via `POST /api/v1/auth/login`.', 'UNAUTHENTICATED', 'Authentication required'),
    SubscriptionInactive: errorResponse('The workspace subscription has lapsed: data stays readable but new postings are blocked.', 'SUBSCRIPTION_INACTIVE', 'Subscription has lapsed. Renew to continue posting.'),
    Forbidden: errorResponse('Missing permission, branch assignment, plan module (`FEATURE_NOT_ENTITLED`) or the workspace is suspended.', 'FORBIDDEN', 'You do not have permission to perform this action'),
    NotFound: errorResponse('The resource does not exist in this workspace.', 'NOT_FOUND', 'Resource not found'),
    Conflict: errorResponse('The request conflicts with current state: duplicates, invalid state transitions, locked periods, stock or credit rules.', 'CONFLICT', 'The request conflicts with the current state'),
    AccountLocked: errorResponse('Too many failed sign-in attempts; the account is temporarily locked.', 'ACCOUNT_LOCKED', 'Account temporarily locked'),
  };
}

/**
 * Builds the OpenAPI 3 document: Nest's route scan, enriched with the Zod
 * schemas, permissions, plan modules and the hand-written operation catalog.
 * Throws when a route has no catalog entry so the reference never goes stale.
 */
export function createOpenApiDocument(app: INestApplication, serverUrl?: string): OpenAPIObject {
  const builder = new DocumentBuilder()
    .setTitle('MediCore API')
    .setDescription(API_INTRO)
    .setVersion('1.0.0')
    .setContact('MediCore', '', 'support@medicore.local')
    .addCookieAuth(SESSION_COOKIE_NAME, { type: 'apiKey', in: 'cookie', description: 'HttpOnly session cookie set by `POST /api/v1/auth/login`.' }, 'session-cookie')
    .addBearerAuth({ type: 'http', scheme: 'bearer', description: 'The same session token, sent as `Authorization: Bearer <token>` by scripts and integrations.' }, 'session-token');
  if (serverUrl) builder.addServer(serverUrl, 'This server');

  const document = SwaggerModule.createDocument(app, builder.build(), { operationIdFactory: operationIdFor });
  const facts = collectRouteFacts(app);
  const missing: string[] = [];
  const invalidExamples: string[] = [];

  for (const [path, item] of Object.entries<PathItemObject>(document.paths)) {
    for (const verb of VERBS) {
      const op = item[verb];
      if (!op) continue;
      const id = op.operationId ?? '';
      const doc = OPERATION_DOCS[id];
      const routeFacts = facts.get(id);
      if (!doc || !routeFacts) {
        missing.push(`${verb.toUpperCase()} ${path} (${id})`);
        continue;
      }
      if (doc.example !== undefined && routeFacts.bodySchema) {
        const check = routeFacts.bodySchema.safeParse(doc.example);
        if (!check.success) invalidExamples.push(`${id}: ${check.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
      }
      enrichOperation(path, verb, op, doc, routeFacts);
      op.tags = (op.tags ?? []).map((t) => TAGS[t]?.name ?? t);
    }
  }
  if (missing.length) throw new Error(`OpenAPI: undocumented routes, add them to operation-docs.ts:\n  ${missing.join('\n  ')}`);
  const stale = Object.keys(OPERATION_DOCS).filter((id) => !facts.has(id));
  if (stale.length) throw new Error(`OpenAPI: operation-docs.ts entries without a route: ${stale.join(', ')}`);
  if (invalidExamples.length) throw new Error(`OpenAPI: examples that fail their request schema:\n  ${invalidExamples.join('\n  ')}`);

  document.security = [{ 'session-cookie': [] }, { 'session-token': [] }];
  document.tags = Object.values(TAGS).map(({ name, description }) => ({ name, description }));
  (document as OpenAPIObject & { 'x-tagGroups': unknown })['x-tagGroups'] = TAG_GROUPS.map((g) => ({
    name: g.name,
    tags: g.tags.map((t) => TAGS[t]!.name),
  }));
  addComponents(document);
  return document;
}

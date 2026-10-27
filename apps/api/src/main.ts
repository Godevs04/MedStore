import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { apiReference } from '@scalar/nestjs-api-reference';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { loadEnv } from './config/env.js';
import { AppModule } from './app.module.js';
import { applyHttpConventions } from './app.setup.js';
import { createOpenApiDocument } from './openapi/openapi.js';

const DOCS_PATH = '/api/docs';
const SPEC_PATH = '/api/openapi.json';

async function bootstrap(): Promise<void> {
  const env = loadEnv();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Keep raw body for future webhook signature verification.
    rawBody: false,
  });

  // The API reference page loads Scalar from its CDN, so it gets a relaxed CSP; every API route keeps the strict default.
  const strictHelmet = helmet();
  const docsHelmet = helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false });
  app.use((req: Request, res: Response, next: NextFunction) =>
    (req.path === DOCS_PATH ? docsHelmet : strictHelmet)(req, res, next),
  );
  app.use(cookieParser());
  app.enableCors({
    origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'x-organization-id', 'x-branch-id', 'x-idempotency-key', 'x-correlation-id'],
    exposedHeaders: ['Content-Disposition'],
  });
  applyHttpConventions(app);
  app.set('trust proxy', 1); // behind local reverse proxies / LAN setups

  const document = createOpenApiDocument(app, `http://localhost:${env.PORT}`);
  app.use(SPEC_PATH, (_req: Request, res: Response) => {
    res.json(document);
  });
  app.use(
    DOCS_PATH,
    apiReference({
      url: SPEC_PATH,
      pageTitle: 'MediCore API Reference',
      theme: 'purple',
      layout: 'modern',
      defaultHttpClient: { targetKey: 'js', clientKey: 'fetch' },
      hideClientButton: false,
      persistAuth: true,
      metaData: { title: 'MediCore API Reference', description: 'Pharmacy ERP REST API' },
    }),
  );

  const port = env.PORT;
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(
    `MediCore API listening on http://localhost:${port}/api/v1 (reference at ${DOCS_PATH}, spec at ${SPEC_PATH})`,
  );
}

void bootstrap().catch((error) => {
  console.error('Fatal bootstrap error:', error);
  process.exit(1);
});

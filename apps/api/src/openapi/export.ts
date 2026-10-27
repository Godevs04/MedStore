/**
 * Writes the OpenAPI document to docs/api/openapi.json without starting an
 * HTTP listener. Run after `nest build`: `node dist/openapi/export.js`.
 */
import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { applyHttpConventions } from '../app.setup.js';
import { createOpenApiDocument } from './openapi.js';

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  applyHttpConventions(app);
  await app.init();
  const document = createOpenApiDocument(app);
  const target = resolve(process.argv[2] ?? resolve(__dirname, '../../../../docs/api/openapi.json'));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
  const operations = Object.values(document.paths).reduce((n, item) => n + Object.keys(item).length, 0);
  console.warn(`OpenAPI written to ${target} (${operations} operations)`);
  await app.close();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

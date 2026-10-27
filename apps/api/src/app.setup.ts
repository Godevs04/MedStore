import { VersioningType, type INestApplication } from '@nestjs/common';
import { GlobalExceptionFilter } from './common/global-exception.filter.js';

/** Routing conventions shared by the server and the OpenAPI export, so both see identical paths. */
export function applyHttpConventions(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new GlobalExceptionFilter());
}

import 'reflect-metadata';
import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { loadEnv } from './config/env.js';
import { AppModule } from './app.module.js';
import { GlobalExceptionFilter } from './common/global-exception.filter.js';

async function bootstrap(): Promise<void> {
  const env = loadEnv();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Keep raw body for future webhook signature verification.
    rawBody: false,
  });

  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'x-organization-id', 'x-branch-id', 'x-idempotency-key', 'x-correlation-id'],
  });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.set('trust proxy', 1); // behind local reverse proxies / LAN setups

  const openapi = new DocumentBuilder()
    .setTitle('MediCore API')
    .setDescription('MediCore pharmacy ERP platform API')
    .setVersion('0.1.0')
    .addCookieAuth('medicore_session')
    .addApiKey({ type: 'apiKey', name: 'Authorization', in: 'header' }, 'session-token')
    .build();
  const document = SwaggerModule.createDocument(app, openapi);
  SwaggerModule.setup('api/docs', app, document);

  const port = env.PORT;
  await app.listen(port, '0.0.0.0');
  console.log(`MediCore API listening on http://localhost:${port}/api/v1 (OpenAPI at /api/docs)`);
}

void bootstrap().catch((error) => {
  console.error('Fatal bootstrap error:', error);
  process.exit(1);
});

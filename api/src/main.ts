import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { existsSync } from 'node:fs';
import { AppModule } from './app.module.js';
import { loadConfig } from './config.js';

async function bootstrap() {
  if (existsSync('.env')) process.loadEnvFile('.env'); // local only; deployments set real env vars
  const config = loadConfig(); // fail fast on a bad environment, before Nest boots
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true }); // rawBody: payment webhook signatures
  app.setGlobalPrefix('v1'); // servers in docs/api/openapi.yaml end in /v1
  app.enableCors({
    origin: config.CORS_ORIGINS,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'If-Match', 'If-None-Match'],
    exposedHeaders: ['ETag', 'Retry-After'],
    maxAge: 600,
  });
  app.enableShutdownHooks();
  await app.listen(config.PORT);
  new Logger('bootstrap').log(`listening on http://localhost:${config.PORT}/v1 (${config.NODE_ENV})`);
}
await bootstrap();

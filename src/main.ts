import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import { AppModule } from './app.module';
import { setupApi } from './v2/api/setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(json({ limit: '20mb' }));
  const origin = process.env.V2_CORS_ORIGIN;
  if (origin)
    app.enableCors({ origin, credentials: true, methods: ['GET', 'POST', 'PATCH'] });
  setupApi(app);
  await app.listen(Number(process.env.V2_API_PORT || 3100), '0.0.0.0');
}
void bootstrap();

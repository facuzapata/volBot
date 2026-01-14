import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { INestApplication } from '@nestjs/common';

let cachedApp: INestApplication;

async function bootstrap() {
  if (!cachedApp) {
    const app = await NestFactory.create(AppModule, {
      logger: ['error', 'warn', 'log'],
    });
    await app.init();
    cachedApp = app;
  }
  return cachedApp;
}

// Para desarrollo local
if (process.env.NODE_ENV !== 'production') {
  bootstrap().then(app => {
    app.listen(process.env.PORT ?? 3000);
  });
}

// Para Vercel (serverless)
export default async function handler(req: any, res: any) {
  const app = await bootstrap();
  const server = app.getHttpAdapter().getInstance();
  return server(req, res);
}

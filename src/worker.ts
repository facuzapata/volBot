import { NestFactory } from '@nestjs/core';
import { V2WorkerModule } from './v2/modules';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(V2WorkerModule);
  app.enableShutdownHooks();
}
void bootstrap();

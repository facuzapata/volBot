import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { writeFile, mkdir } from 'fs/promises';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { API_CONTROLLERS } from './api/controllers';
import { ApiService } from './api/api.service';
import { LivePaperController } from './live-paper/controller';
import { LivePaperService } from './live-paper/service';

@Module({ controllers: [...API_CONTROLLERS,LivePaperController], providers: [{ provide: ApiService, useValue: {} },{provide:LivePaperService,useValue:{}}] })
class ContractModule {}
async function generate(): Promise<void> {
  const app = await NestFactory.create(ContractModule, { logger: false });
  app.setGlobalPrefix('api');
  const spec = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('VolBot V2 — PAPER ONLY')
      .setVersion('2.0.0')
      .addBearerAuth()
      .build(),
  );
  await mkdir('docs', { recursive: true });
  await writeFile('docs/openapi.json', JSON.stringify(spec, null, 2));
  await app.close();
}
void generate();

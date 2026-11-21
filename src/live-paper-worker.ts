import {NestFactory} from '@nestjs/core';
import {LivePaperWorkerModule} from './v2/live-paper/modules';
async function bootstrap(){const app=await NestFactory.createApplicationContext(LivePaperWorkerModule);app.enableShutdownHooks();}
void bootstrap();

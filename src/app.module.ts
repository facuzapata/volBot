import { Module } from '@nestjs/common';
import { V2ApiModule } from './v2/modules';
import { LivePaperApiModule } from './v2/live-paper/modules';

@Module({
  imports: [V2ApiModule, LivePaperApiModule],
})
export class AppModule {}

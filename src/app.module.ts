import { Module } from '@nestjs/common';
import { V2ApiModule } from './v2/modules';

@Module({
  imports: [V2ApiModule],
})
export class AppModule {}

import {Module} from '@nestjs/common';
import {CoreModule} from '../modules';
import {LivePaperService,PAPER_CLOCK} from './service';
import {LivePaperController} from './controller';
import {ProspectiveFeed} from './feed';
@Module({imports:[CoreModule],controllers:[LivePaperController],providers:[LivePaperService,{provide:PAPER_CLOCK,useValue:()=>Date.now()}]})
export class LivePaperApiModule{}
@Module({imports:[CoreModule],providers:[LivePaperService,ProspectiveFeed,{provide:PAPER_CLOCK,useValue:()=>Date.now()}]})
export class LivePaperWorkerModule{}

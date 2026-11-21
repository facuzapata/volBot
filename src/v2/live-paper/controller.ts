import {BadRequestException,Body,Controller,Get,Param,ParseUUIDPipe,Post,Query,Req} from '@nestjs/common';
import {ApiBearerAuth,ApiOperation,ApiProperty,ApiTags} from '@nestjs/swagger';
import {IsIn,IsOptional,IsString,Matches,MaxLength,IsInt,Min,Max} from 'class-validator';
import {Type} from 'class-transformer';
import {Admin,AuthRequest} from '../api/auth';
import {BOT_IDS,BotId} from './model';
import {LivePaperService} from './service';
export class PaperControlDto{
 @ApiProperty({required:false,description:'Exact immutable reviewed configuration SHA256'}) @IsOptional() @Matches(/^[a-f0-9]{64}$/) configHash?:string;
 @ApiProperty({required:false,enum:['PAPER_ONLY']}) @IsOptional() @IsIn(['PAPER_ONLY']) scope?:string;
 @ApiProperty({required:false,enum:['I_AUTHORIZE_VIRTUAL_FUNDS_ONLY','START_PAPER_30_DAYS','RESUME_PAPER_ONLY']}) @IsOptional() @IsIn(['I_AUTHORIZE_VIRTUAL_FUNDS_ONLY','START_PAPER_30_DAYS','RESUME_PAPER_ONLY']) confirmation?:string;
 @ApiProperty({required:false,enum:BOT_IDS}) @IsOptional() @IsIn(BOT_IDS) bot?:BotId;
 @ApiProperty({required:false}) @IsOptional() @IsString() @MaxLength(160) reason?:string;
}
export class PaperPageDto{
 @ApiProperty({required:false,enum:BOT_IDS}) @IsOptional() @IsIn(BOT_IDS) bot?:BotId;
 @ApiProperty({required:false,default:100,maximum:1000}) @Type(()=>Number) @IsInt() @Min(1) @Max(1000) limit=100;
 @ApiProperty({required:false,default:0}) @Type(()=>Number) @IsInt() @Min(0) offset=0;
}
@ApiTags('Prospective PAPER experiment') @ApiBearerAuth() @Admin() @Controller('paper')
export class LivePaperController{
 constructor(private readonly service:LivePaperService){}
 @Get('feed') @ApiOperation({summary:'Public feed freshness, dependencies and current symbol filters'}) feed(){return this.service.feed();}
 @Get('experiments') @ApiOperation({summary:'List isolated PAPER experiments and bot metrics'}) list(){return this.service.list();}
 @Post('experiments') @ApiOperation({summary:'Prepare two independent 500 USDT accounts; never activates entries'}) prepare(@Req() req:AuthRequest,@Body() _body:PaperControlDto){return this.service.prepare(req.user.id);}
 @Get('experiments/:id') @ApiOperation({summary:'Status, immutable configuration, capital, metrics, comparison and references'}) view(@Param('id',ParseUUIDPipe) id:string){return this.service.view(id);}
 @Get('experiments/:id/:kind') @ApiOperation({summary:'Read positions, orders, fills, ledger, trades, equity, signals, rejections or reports'}) records(@Param('id',ParseUUIDPipe) id:string,@Param('kind') kind:string,@Query() q:PaperPageDto){return this.service.records(id,kind,q.bot,q.limit,q.offset);}
 @Post('experiments/:id/:action') @ApiOperation({summary:'Manually authorize PAPER, start 30 days, pause, resume, revoke or stop; never LIVE'}) control(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Param('action') action:string,@Body() body:PaperControlDto){
  if(!['authorize','start','pause','resume','stop','revoke'].includes(action))throw new BadRequestException('UNKNOWN_PAPER_ACTION');return this.service.control(id,action as 'authorize'|'start'|'pause'|'resume'|'stop'|'revoke',req.user.id,body);
 }
}

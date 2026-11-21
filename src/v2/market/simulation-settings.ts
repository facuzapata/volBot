import { Injectable } from '@nestjs/common';
import { simulationConfig } from '../config';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { BtcV3Calibration, BTC_V3_REVISION } from '../strategy/btc-v3.config';

@Injectable()
export class SimulationSettings {
  config = simulationConfig();
  filtersUpdatedAt = 0;
  btcV3Calibration?:BtcV3Calibration;
  constructor(){
    const file=process.env.V3_CALIBRATION_FILE;
    if(file){
      const bytes=readFileSync(file),expected=process.env.V3_CALIBRATION_SHA256;
      if(!expected||createHash('sha256').update(bytes).digest('hex')!==expected)throw new Error('V3_CALIBRATION_HASH_MISMATCH');
      const model=JSON.parse(bytes.toString('utf8')) as BtcV3Calibration;
      if(model.revision!==BTC_V3_REVISION||!Number.isFinite(model.trainedThrough)||!Array.isArray(model.bins)||!model.trainingHash)throw new Error('INVALID_V3_CALIBRATION');
      this.btcV3Calibration=model;
      if(process.env.V2_STRATEGY==='btc-v3')this.config={...this.config,btcV3Calibration:model};
    }
  }
  updateFilters(
    filters: Pick<typeof this.config, 'stepSize' | 'tickSize' | 'minQty' | 'minNotional'>,
  ): void {
    this.config = { ...this.config, ...filters };
    this.filtersUpdatedAt = Date.now();
  }
}

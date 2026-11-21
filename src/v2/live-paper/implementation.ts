import {ProspectiveKernel} from './kernel';
import {frozenSignal,aggregate} from './strategies';
import {fingerprint} from './model';
import {PaperExecutionAdapter} from '../execution/paper-execution.adapter';
import {RiskPolicy} from '../risk/risk-policy';
import {assessExecutionRisk} from '../risk/execution-risk';
import {executionPrice,floorStep} from '../execution/pricing';
import {calculateATR,calculateEMA} from '../../utils/indicators';
/** Runtime algorithm identity; API and worker must run the same reviewed build. */
export function implementationHash(){return fingerprint([ProspectiveKernel,frozenSignal,aggregate,PaperExecutionAdapter,RiskPolicy,assessExecutionRisk,executionPrice,floorStep,calculateATR,calculateEMA].map(fn=>fn.toString()));}

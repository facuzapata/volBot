import { StrategyId } from '../domain/model';

/** V5 retries each fresh closed-minute opportunity; account risk controls decide entry. */
export const shouldPublishSignal = (
  strategy: StrategyId,
  eligible: boolean,
  wasEligible: boolean,
): boolean => eligible && (strategy === 'btc-v5' || strategy === 'btc-v6' || !wasEligible);

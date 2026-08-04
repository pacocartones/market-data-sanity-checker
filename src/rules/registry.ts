import type { Rule } from './types'
import { splitNotAdjusted } from './price/split-not-adjusted'
import { returnSpike } from './price/return-spike'
import { priceNonpositive } from './price/price-nonpositive'
import { insufficientData } from './price/insufficient-data'
import { ohlcInconsistent } from './price/ohlc-inconsistent'
import { volumeNegative } from './price/volume-negative'
import { zeroVolumeMoved } from './price/zero-volume-moved'
import { tsDuplicated } from './price/ts-duplicated'
import { tsUnordered } from './price/ts-unordered'
import { barMissing } from './price/bar-missing'
import { priceSpikeIntraday } from './price/price-spike-intraday'
import { stalePrice } from './price/stale-price'
import { currencyScaleSuspect } from './price/currency-scale-suspect'
import { divDuplicated } from './corporate/div-duplicated'
import { exdateAfterPaydate } from './corporate/exdate-after-paydate'
import { exdateMisplaced } from './corporate/exdate-misplaced'
import { divNotAdjusted } from './corporate/div-not-adjusted'
import { divScale100x } from './corporate/div-scale-100x'
import { divYieldImpossible } from './corporate/div-yield-impossible'
import { divSpecialMisclassified } from './corporate/div-special-misclassified'
import { splitRatioImprobable } from './corporate/split-ratio-improbable'
import { corpActionMissingFromFactor } from './corporate/corp-action-missing-from-factor'
import { marketcapMismatch } from './fundamentals/marketcap-mismatch'
import { peEpsIncompatible } from './fundamentals/pe-eps-incompatible'
import { payoutImpossible } from './fundamentals/payout-impossible'
import { signValidity } from './fundamentals/sign-validity'
import { currencySuspect } from './metadata/currency-suspect'
import { symbolMappingSuspect } from './metadata/symbol-mapping-suspect'
import { dividendFxMismatch } from './metadata/dividend-fx-mismatch'

/**
 * The rule corpus. Phase 1: price/OHLCV (12). Phase 2: corporate actions,
 * fundamentals and metadata (13). Phase 3 adds multi-source comparison.
 */
export const registry: Rule[] = [
  // price
  splitNotAdjusted,
  returnSpike,
  priceSpikeIntraday,
  priceNonpositive,
  insufficientData,
  ohlcInconsistent,
  volumeNegative,
  zeroVolumeMoved,
  tsDuplicated,
  tsUnordered,
  barMissing,
  stalePrice,
  currencyScaleSuspect,
  // corporate actions
  divDuplicated,
  exdateAfterPaydate,
  exdateMisplaced,
  divNotAdjusted,
  divScale100x,
  divYieldImpossible,
  divSpecialMisclassified,
  splitRatioImprobable,
  corpActionMissingFromFactor,
  // fundamentals
  marketcapMismatch,
  peEpsIncompatible,
  payoutImpossible,
  signValidity,
  // metadata
  currencySuspect,
  symbolMappingSuspect,
  dividendFxMismatch,
]

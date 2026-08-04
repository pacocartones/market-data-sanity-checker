import type { CompareRule } from './types'
import { symbolMismatch } from './rules/symbol-mismatch'
import { insufficientOverlap } from './rules/insufficient-overlap'
import { closeDivergence } from './rules/close-divergence'
import { priceDateMismatch } from './rules/price-date-mismatch'
import { dividendMismatch } from './rules/dividend-mismatch'
import { splitMismatch } from './rules/split-mismatch'
import { volumeDivergence } from './rules/volume-divergence'

/** The compare corpus. Guards first: identity and evidence before interpretation. */
export const compareRegistry: CompareRule[] = [
  symbolMismatch,
  insufficientOverlap,
  closeDivergence,
  priceDateMismatch,
  dividendMismatch,
  splitMismatch,
  volumeDivergence,
]

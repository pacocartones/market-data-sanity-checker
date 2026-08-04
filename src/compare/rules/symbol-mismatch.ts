import type { Finding } from '../../report/types'
import type { CompareRule } from '../types'

/**
 * SYMBOL_MISMATCH — comparing two different instruments.
 *
 * Every compare rule assumes both datasets describe the same asset. When the
 * symbols differ (AAPL vs MSFT — a slip in any pipeline), divergence findings
 * are nonsense: the sources don't "disagree", they measure different things.
 * This check runs before any interpretation and blocks the comparison.
 */
export const symbolMismatch: CompareRule = {
  meta: {
    id: 'SYMBOL_MISMATCH',
    severity: 'critical',
    dimension: 'consistency',
    description: 'The two datasets are for different symbols — comparison is meaningless',
    defaultParams: {},
    references: [],
  },

  check(a, b, context) {
    const symbolA = a.symbol.trim().toUpperCase()
    const symbolB = b.symbol.trim().toUpperCase()
    if (symbolA === symbolB) return []

    const finding: Finding = {
      rule: 'SYMBOL_MISMATCH',
      severity: context.config.severity,
      action: 'block',
      dimension: 'consistency',
      explanation:
        `Left side is ${a.symbol} but right side is ${b.symbol} — these datasets describe different ` +
        `instruments, so every divergence below would be meaningless. Block this comparison and check ` +
        `the symbol mapping upstream.`,
      evidence: { symbol_a: a.symbol, symbol_b: b.symbol },
    }
    return [finding]
  },
}

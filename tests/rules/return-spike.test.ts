import { describe, expect, it } from 'vitest'
import type { MarketDataSet } from '../../src/schema/market-data'
import { runRules } from '../../src/rules/engine'
import { returnSpike } from '../../src/rules/price/return-spike'
import type { RuleContext } from '../../src/rules/types'

/** Builds a steady series of N bars with small daily moves, then applies the given mutations. */
function steadySeries(closes: number[], volumes?: number[]): MarketDataSet {
  const start = Date.UTC(2024, 0, 1)
  return {
    symbol: 'TEST',
    source: 'synthetic',
    bars: closes.map((close, index) => {
      const date = new Date(start + index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)!
      return {
        timestamp: date,
        open: close * 0.999,
        high: close * 1.005,
        low: close * 0.995,
        close,
        ...(volumes ? { volume: volumes[index] } : {}),
      }
    }),
  }
}

const STEADY_CLOSES = Array.from({ length: 30 }, (_, i) => 100 * (1 + 0.001 * Math.sin(i) + 0.0005 * i))

describe('RETURN_SPIKE', () => {
  it('flags a violent non-split move in steady data', () => {
    const closes = [...STEADY_CLOSES]
    closes[15] = closes[14]! * 1.32 // +32% overnight: matches no split ratio
    const finding = runRules(steadySeries(closes)).find((f) => f.rule === 'RETURN_SPIKE')

    expect(finding).toBeDefined()
    expect(finding!.severity).toBe('warning')
    expect(finding!.action).toBe('flag')
    expect(finding!.explanation).toMatch(/modified z-score/)
  })

  it('does NOT fire on a split-like move (semantic dedup with SPLIT_NOT_ADJUSTED)', () => {
    const closes = [...STEADY_CLOSES]
    closes[15] = closes[14]! * 0.5 // −50%: split territory, not RETURN_SPIKE's job
    expect(runRules(steadySeries(closes)).find((f) => f.rule === 'RETURN_SPIKE')).toBeUndefined()
  })

  it('stays silent on steady data and on short series', () => {
    expect(runRules(steadySeries(STEADY_CLOSES)).find((f) => f.rule === 'RETURN_SPIKE')).toBeUndefined()
    expect(runRules(steadySeries(STEADY_CLOSES.slice(0, 5))).find((f) => f.rule === 'RETURN_SPIKE')).toBeUndefined()
  })
})


/**
 * Manual context with a controlled statistical profile, so the z-score of the
 * mutated move is exact: z = 0.6745·(return − medianReturn) / madReturn.
 */
function ctxWithProfile(medianReturn: number, madReturn: number): RuleContext {
  return {
    config: {
      severity: returnSpike.meta.severity,
      params: { ...returnSpike.meta.defaultParams },
    },
    profile: { returns: Array.from({ length: 15 }, () => 0.001), medianReturn, madReturn },
  }
}

describe('RETURN_SPIKE — severity tiering (anti-cry-wolf, 2026-07-31 audit)', () => {
  it('degrades an ordinary earnings-scale outlier (−5.7%, z ≈ −4.5) to info', () => {
    const closes = [...STEADY_CLOSES.slice(0, 16)]
    closes[15] = closes[14]! * (1 - 0.057) // past z > 3.5 and the 4% gate, below both caps
    const findings = returnSpike.check(steadySeries(closes), ctxWithProfile(0, 0.0085))

    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('info')
    expect(findings[0]!.action).toBe('flag')
    expect(findings[0]!.evidence).toMatchObject({ modified_zscore: -4.52 })
    expect(findings[0]!.explanation).toContain(
      '(statistically anomalous but within ordinary earnings-move magnitude)',
    )
  })

  it('keeps full severity when |z| ≥ 5 even if the move is under 8%', () => {
    const closes = [...STEADY_CLOSES.slice(0, 16)]
    closes[15] = closes[14]! * 1.05 // +5%: under the return cap, but z = 0.6745·0.05/0.005 ≈ 6.7
    const findings = returnSpike.check(steadySeries(closes), ctxWithProfile(0, 0.005))

    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('warning')
    expect(findings[0]!.explanation).not.toContain('statistically anomalous but within ordinary')
  })
})

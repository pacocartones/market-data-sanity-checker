import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { marketDataSetSchema } from '../../src/schema/market-data'
import type { RuleContext } from '../../src/rules/types'
import { currencySuspect } from '../../src/rules/metadata/currency-suspect'
import { symbolMappingSuspect } from '../../src/rules/metadata/symbol-mapping-suspect'

const currencyCtx: RuleContext = {
  config: { severity: currencySuspect.meta.severity, params: { ...currencySuspect.meta.defaultParams } },
  profile: { returns: [], medianReturn: 0, madReturn: 0 },
}

const symbolCtx: RuleContext = {
  config: { severity: symbolMappingSuspect.meta.severity, params: { ...symbolMappingSuspect.meta.defaultParams } },
  profile: { returns: [], medianReturn: 0, madReturn: 0 },
}

async function loadFixture(name: string) {
  const raw = await readFile(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8')
  return marketDataSetSchema.parse(JSON.parse(raw))
}

function barsWithCloses(closes: number[]) {
  return closes.map((close, index) => ({
    timestamp: `2024-01-${String(index + 2).padStart(2, '0')}`,
    open: close,
    high: close,
    low: close,
    close,
  }))
}

describe('CURRENCY_SUSPECT', () => {
  it('reports a missing currency as info', () => {
    const data = { symbol: 'VOD.L', source: 'test', bars: barsWithCloses([70, 71, 72]) }
    const findings = currencySuspect.check(data, currencyCtx)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule: 'CURRENCY_SUSPECT',
      severity: 'info',
      evidence: { reason: 'currency_missing' },
    })
  })

  it('flags a GBP-labelled .L series with pence-looking magnitudes', () => {
    const data = {
      symbol: 'VOD.L',
      source: 'test',
      currency: 'GBP' as const,
      bars: barsWithCloses([4490, 4500, 4510, 4505, 4495]),
    }
    const findings = currencySuspect.check(data, currencyCtx)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule: 'CURRENCY_SUSPECT',
      severity: 'warning',
      where: { date: '2024-01-06' },
      evidence: { reason: 'pence_magnitude', median_close: 4500 },
    })
  })

  it('accepts a GBP-labelled .L series with pound-looking magnitudes', () => {
    const data = {
      symbol: 'VOD.L',
      source: 'test',
      currency: 'GBP' as const,
      bars: barsWithCloses([68, 70, 71]),
    }
    expect(currencySuspect.check(data, currencyCtx)).toEqual([])
  })

  it('handles degenerate datasets (no bars, NaN closes)', () => {
    expect(currencySuspect.check({ symbol: 'X', source: 'test', bars: [] }, currencyCtx)).toEqual([
      expect.objectContaining({ severity: 'info' }),
    ])
    const data = {
      symbol: 'VOD.L',
      source: 'test',
      currency: 'GBP' as const,
      bars: [{ timestamp: '2024-01-02', open: NaN, high: NaN, low: NaN, close: NaN }],
    }
    expect(currencySuspect.check(data, currencyCtx)).toEqual([])
  })
})

describe('SYMBOL_MAPPING_SUSPECT', () => {
  it('flags an ISIN with an invalid checksum', () => {
    const data = {
      symbol: 'AB',
      source: 'test',
      exchange: 'NYSE',
      identifiers: { isin: 'US0028241005' },
      bars: [],
    }
    const findings = symbolMappingSuspect.check(data, symbolCtx)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule: 'SYMBOL_MAPPING_SUSPECT',
      severity: 'warning',
      evidence: { isin: 'US0028241005', reason: 'isin_checksum' },
    })
  })

  it('flags the AB fixture: US ISIN attributed to the LSE', async () => {
    const findings = symbolMappingSuspect.check(await loadFixture('ab-ticker-isin-mismatch.json'), symbolCtx)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule: 'SYMBOL_MAPPING_SUSPECT',
      severity: 'warning',
      evidence: {
        isin: 'US0028241000',
        isin_country: 'US',
        exchange: 'LSE',
        reason: 'country_exchange_mismatch',
      },
    })
  })

  it('accepts a US ISIN on NYSE', () => {
    const data = {
      symbol: 'AB',
      source: 'test',
      exchange: 'NYSE',
      identifiers: { isin: 'US0028241000' },
      bars: [],
    }
    expect(symbolMappingSuspect.check(data, symbolCtx)).toEqual([])
  })

  it('handles datasets without identifiers', () => {
    expect(symbolMappingSuspect.check({ symbol: 'AB', source: 'test', bars: [] }, symbolCtx)).toEqual([])
  })
})

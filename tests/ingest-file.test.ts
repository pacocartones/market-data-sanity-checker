import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ingestFile, IngestError } from '../src/ingest/index'
import { marketDataSetSchema } from '../src/schema/market-data'

/**
 * Platform tests for ingestFile's dispatch contract: extension-based routing,
 * the unsupported-extension error, and fs error propagation. The parsers
 * themselves are covered in tests/ingest.test.ts.
 */

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))

describe('ingestFile', () => {
  it('dispatches .csv files to the CSV parser', async () => {
    const raw = await ingestFile(fixture('ohlcv-valid.csv'), { symbol: 'AAPL', source: 'yahoo' })
    const parsed = marketDataSetSchema.parse(raw)
    expect(parsed.symbol).toBe('AAPL')
    expect(parsed.bars).toHaveLength(5)
    expect(parsed.bars[0]).toMatchObject({ timestamp: '2024-01-02', close: 185.14 })
  })

  it('dispatches .json files to the JSON parser', async () => {
    const raw = await ingestFile(fixture('mob-st-unadjusted-split.json'))
    const parsed = marketDataSetSchema.parse(raw)
    expect(parsed.symbol).toBe('MOB.ST')
    expect(parsed.source).toBe('yahoo')
    expect(parsed.bars.length).toBeGreaterThan(0)
  })

  it('rejects an unknown extension with a clear IngestError', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mdsc-ingest-'))
    try {
      const path = join(dir, 'data.txt')
      await writeFile(path, 'date,open,high,low,close\n2024-01-02,100,101,99,100.5\n', 'utf8')
      await expect(ingestFile(path)).rejects.toThrow(IngestError)
      await expect(ingestFile(path)).rejects.toThrow(/unsupported file extension.*"\.txt".*\.csv or \.json/i)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('propagates the fs ENOENT error for a missing file', async () => {
    const missing = fixture('definitely-not-there.json')
    await expect(ingestFile(missing)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(ingestFile(missing)).rejects.toThrow(/ENOENT/)
  })
})

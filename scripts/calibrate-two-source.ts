/**
 * Network half of `pnpm calibrate --two-source` (the pure half is scripts/two-source-calibration.ts).
 *
 * Fetches the fixed 24-symbol basket from Yahoo (6mo) and Alpha Vantage (free key: latest 100
 * unadjusted daily bars), classifies every Yahoo finding inside the overlap and writes
 * calibration/two-source.json. One Alpha Vantage request per symbol; symbols over the connector's
 * dailyRequestLimit() are reported as skipped, never requested, never counted as failures.
 *
 * Needs ALPHA_VANTAGE_API_KEY. It is run by the manually dispatched calibration workflow
 * (.github/workflows/calibration.yml), which uploads the file as an artifact; nothing is committed.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { yahoo } from '../src/connectors/yahoo'
import { alphaVantage } from '../src/connectors/alphavantage'
import { splitByDailyLimit } from '../src/connectors/types'
import {
  buildTwoSourceReport,
  redactSecrets,
  safeErrorMessage,
  TWO_SOURCE_SYMBOLS,
  YAHOO_TWO_SOURCE_RANGE,
  type TwoSourcePair,
} from './two-source-calibration'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Alpha Vantage's free tier allows about one request per second; Yahoo is keyless but rate-limited. */
const PAUSE_MS = { yahoo: 300, 'alpha-vantage': 1200 } as const

export const OUTPUT_PATH = 'calibration/two-source.json'

export async function runTwoSourceCalibration(): Promise<void> {
  if (!alphaVantage.available()) {
    console.error(`two-source calibration needs Alpha Vantage: it requires ${alphaVantage.requires}`)
    process.exitCode = 1
    return
  }
  const secrets = [process.env.ALPHA_VANTAGE_API_KEY]
  const { attempt, skip } = splitByDailyLimit(TWO_SOURCE_SYMBOLS, alphaVantage.dailyRequestLimit?.())
  if (skip.length > 0) {
    console.log(`${skip.length} symbol(s) skipped, over the Alpha Vantage daily request cap: ${skip.join(', ')}`)
  }

  const pairs: TwoSourcePair[] = []
  const failed: Array<{ symbol: string; provider: string; error: string }> = []
  for (const symbol of attempt) {
    let yahooData
    try {
      yahooData = await yahoo.fetchDaily(symbol, { range: YAHOO_TWO_SOURCE_RANGE })
    } catch (error) {
      failed.push({ symbol, provider: 'yahoo', error: safeErrorMessage(error, secrets) })
    }
    await sleep(PAUSE_MS.yahoo)

    let avData
    try {
      avData = await alphaVantage.fetchDaily(symbol)
    } catch (error) {
      failed.push({ symbol, provider: 'alpha-vantage', error: safeErrorMessage(error, secrets) })
    }
    await sleep(PAUSE_MS['alpha-vantage'])

    if (yahooData && avData) {
      pairs.push({ symbol, yahoo: yahooData, alphaVantage: avData })
      console.log(`${symbol.padEnd(8)} fetched (yahoo ${yahooData.bars.length} bars, alpha-vantage ${avData.bars.length} bars)`)
    } else {
      console.log(`${symbol.padEnd(8)} FETCH FAILED: ${failed.filter((entry) => entry.symbol === symbol).map((entry) => `${entry.provider}: ${entry.error}`).join('; ')}`)
    }
  }

  const report = buildTwoSourceReport({
    generatedAt: new Date().toISOString(),
    symbols: TWO_SOURCE_SYMBOLS,
    pairs,
    skipped: skip,
    failed,
    alphaVantageTier: process.env.ALPHA_VANTAGE_PREMIUM === 'true' ? 'premium' : 'free',
  })

  console.log('\n=== TWO-SOURCE CALIBRATION SUMMARY ===')
  console.log(
    `symbols compared: ${report.summary.symbols_compared}/${TWO_SOURCE_SYMBOLS.length} ` +
      `(${report.summary.symbols_failed} failed, ${report.summary.symbols_skipped} skipped)`,
  )
  const { totals } = report.summary
  console.log(
    `yahoo findings: ${totals.fired} · corroborated ${totals.corroborated} · contradicted ${totals.contradicted} · ` +
      `not comparable ${totals.not_comparable}`,
  )
  for (const [rule, entry] of Object.entries(report.summary.by_rule)) {
    console.log(
      `  ${rule}: fired ${entry.fired}, corroborated ${entry.corroborated}, contradicted ${entry.contradicted}, ` +
        `not comparable ${entry.not_comparable}`,
    )
  }

  await mkdir('calibration', { recursive: true })
  // Serialize once and scrub again: the file is uploaded as an artifact and must never hold the key.
  await writeFile(OUTPUT_PATH, `${redactSecrets(JSON.stringify(report, null, 2), secrets)}\n`)
  console.log(`\nwritten: ${OUTPUT_PATH}`)
  if (pairs.length === 0) {
    console.error('two-source calibration compared no symbol')
    process.exitCode = 1
  }
}

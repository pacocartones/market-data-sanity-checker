import type { Finding } from '../../report/types'
import type { Rule } from '../types'

const ISIN_FORMAT = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/

/**
 * Exchanges per ISIN country prefix (ISO 6166 prefixes are ISO 3166 country
 * codes). Deliberately small and explicit: an exchange absent from the map is
 * skipped, never guessed.
 */
const COUNTRY_EXCHANGES: Record<string, readonly string[]> = {
  US: ['NASDAQ', 'NYSE', 'NYSE AMERICAN', 'BATS', 'ARCA'],
  GB: ['LSE'],
  DE: ['XETRA', 'FRA'],
  FR: ['EPA'],
  CH: ['SIX'],
  ES: ['BME'],
  IT: ['BIT'],
  NL: ['AMS'],
  SE: ['STO'],
  JP: ['TSE'],
  HK: ['HKEX'],
  AU: ['ASX'],
  CA: ['TSX'],
}

/**
 * ISO 6166 check digit: letters become digits (A=10 … Z=35), the digits are
 * concatenated, and a Luhn pass doubles every second digit from the right.
 * Valid when the total is a multiple of 10.
 */
function hasValidIsinChecksum(isin: string): boolean {
  if (!ISIN_FORMAT.test(isin)) return false
  let digits = ''
  for (const char of isin) {
    const code = char.charCodeAt(0)
    digits += code >= 65 ? String(code - 55) : char
  }
  let sum = 0
  for (let index = digits.length - 1, position = 0; index >= 0; index -= 1, position += 1) {
    let digit = Number(digits[index])
    if (position % 2 === 1) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
  }
  return sum % 10 === 0
}

/**
 * SYMBOL_MAPPING_SUSPECT — the security's identity does not add up.
 *
 * Tickers get reused ('AB' has named six different companies; SNDK was SanDisk
 * and returns in 2026 as a different entity), so a ticker is not an identity —
 * an ISIN is. A failing ISIN check digit means the identifier itself is
 * corrupt, and an ISIN whose country prefix contradicts the exchange means the
 * series probably splices two different entities that shared a ticker.
 */
export const symbolMappingSuspect: Rule = {
  meta: {
    id: 'SYMBOL_MAPPING_SUSPECT',
    block: 'metadata',
    severity: 'warning',
    dimension: 'consistency',
    description: 'ISIN checksum invalid, or ISIN country prefix inconsistent with exchange',
    defaultParams: {},
    references: [
      'https://www.crucible-research.com/nasdaq-100-historical-constituents',
      'https://forum.amibroker.com/t/survivorship-bias-why-only-delisting-date/29543',
    ],
  },

  check(data, context) {
    const findings: Finding[] = []
    const isin = data.identifiers?.isin
    if (isin === undefined) return findings

    if (!hasValidIsinChecksum(isin)) {
      findings.push({
        rule: 'SYMBOL_MAPPING_SUSPECT',
        severity: context.config.severity,
        action: 'flag',
        dimension: 'consistency',
        explanation:
          `ISIN ${isin} fails the ISO 6166 check digit. A corrupt identifier means joins against ` +
          `reference data silently attach the wrong security — dangerous precisely because tickers ` +
          `get reused ('AB' has named six different companies). Re-fetch the ISIN from the issuer ` +
          `or exchange before using this dataset.`,
        evidence: { isin, reason: 'isin_checksum' },
      })
    }

    const exchange = data.exchange?.toUpperCase()
    if (exchange !== undefined) {
      const isinCountry = isin.slice(0, 2)
      const exchangeCountry = Object.entries(COUNTRY_EXCHANGES).find(([, exchanges]) =>
        exchanges.includes(exchange),
      )?.[0]
      if (exchangeCountry !== undefined && exchangeCountry !== isinCountry) {
        findings.push({
          rule: 'SYMBOL_MAPPING_SUSPECT',
          severity: context.config.severity,
          action: 'flag',
          dimension: 'consistency',
          explanation:
            `ISIN ${isin} has country prefix ${isinCountry} but the series is attributed to ` +
            `${exchange} (${exchangeCountry}). Tickers are reused across entities and venues, so ` +
            `this series possibly splices two different companies that shared the symbol ` +
            `${data.symbol}. Verify the identity by ISIN, not by ticker, and split the series ` +
            `at the entity change.`,
          evidence: {
            isin,
            isin_country: isinCountry,
            exchange,
            reason: 'country_exchange_mismatch',
          },
        })
      }
    }

    return findings
  },
}

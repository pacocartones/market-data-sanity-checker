import type { Finding } from '../../report/types'
import { latestClose, sortedBars } from '../series'
import type { Rule } from '../types'

/**
 * PE_EPS_INCOMPATIBLE — a P/E that cannot be reconciled with EPS and price.
 *
 * P/E = price / EPS, so with a positive price the ratio's sign is the EPS's
 * sign and its magnitude is fixed by the two inputs. Vendors still publish
 * positive P/Es on loss-makers, or P/Es computed off a different period or
 * share count than the EPS shown alongside — a recurring defect in published
 * fundamentals, catalogued in A Simple Model's review of sloppy sell-side
 * research data. A negative P/E with negative EPS is left alone: some vendors
 * report it as a convention for loss-makers, and it is at least coherent.
 */
export const peEpsIncompatible: Rule = {
  meta: {
    id: 'PE_EPS_INCOMPATIBLE',
    block: 'fundamentals',
    severity: 'warning',
    dimension: 'accuracy',
    description: 'P/E incompatible with EPS and price (or positive P/E with non-positive EPS)',
    defaultParams: {
      /** Max relative deviation between reported P/E and close / EPS. */
      tolerancePct: 0.1,
    },
    references: ['https://www.asimplemodel.com/insights/extremely-sloppy-and-dubious-sell-side-research'],
  },

  check(data, context) {
    const { tolerancePct } = context.config.params as { tolerancePct: number }
    const pe = data.fundamentals?.pe
    const eps = data.fundamentals?.eps
    if (pe === undefined || !Number.isFinite(pe) || eps === undefined || !Number.isFinite(eps)) {
      return []
    }

    const sorted = sortedBars(data.bars)
    const close = latestClose(sorted)
    if (close === undefined || sorted.length === 0) return []

    const lastBar = sorted[sorted.length - 1]!
    const findings: Finding[] = []

    // Sign mismatch: with a positive price, sign(P/E) must equal sign(EPS).
    if ((eps <= 0 && pe > 0) || (eps > 0 && pe < 0)) {
      findings.push({
        rule: 'PE_EPS_INCOMPATIBLE',
        severity: context.config.severity,
        action: 'flag',
        dimension: 'accuracy',
        where: { date: lastBar.timestamp },
        explanation:
          `P/E of ${pe} has the wrong sign for an EPS of ${eps}: with a positive close of ${close}, ` +
          `P/E = price / EPS implies ${close / eps}. One of the two fields is stale, mis-signed or from a ` +
          `different period — a documented class of vendor error in published fundamentals (A Simple Model, ` +
          `"Extremely Sloppy and Dubious Sell-Side Research"). Verify P/E and EPS against the issuer's ` +
          `latest filing.`,
        evidence: { pe, eps, close, implied_pe: Math.round((close / eps) * 100) / 100 },
      })
      return findings
    }

    // Both positive: the magnitude must reconcile too.
    if (eps > 0 && pe > 0) {
      const implied = close / eps
      const deviation = Math.abs(pe - implied) / pe
      if (deviation > tolerancePct) {
        findings.push({
          rule: 'PE_EPS_INCOMPATIBLE',
          severity: context.config.severity,
          action: 'flag',
          dimension: 'accuracy',
          where: { date: lastBar.timestamp },
          explanation:
            `Reported P/E of ${pe} deviates ${Math.round(deviation * 10000) / 100}% from close / EPS ` +
            `(implied ${Math.round(implied * 100) / 100} at a close of ${close}). The vendor is likely ` +
            `mixing periods or EPS definitions (basic vs diluted, GAAP vs adjusted) — a documented class ` +
            `of error in published fundamentals (A Simple Model, "Extremely Sloppy and Dubious Sell-Side ` +
            `Research"). Verify P/E and EPS against the issuer's latest filing.`,
          evidence: { pe, eps, close, implied_pe: Math.round(implied * 100) / 100 },
        })
      }
    }

    return findings
  },
}

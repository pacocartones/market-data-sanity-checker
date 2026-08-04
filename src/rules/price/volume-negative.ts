import type { Finding } from '../../report/types'
import type { Rule } from '../types'

/**
 * VOLUME_NEGATIVE — trade volume cannot be negative or non-finite. A negative
 * print is a vendor sign error (e.g. a correction record misread as a trade);
 * a NaN/Infinity is a parsing artifact. Zero volume, by contrast, is a real
 * market state (no trades in the session) and is judged by ZERO_VOLUME_MOVED,
 * not here.
 */
export const volumeNegative: Rule = {
  meta: {
    id: 'VOLUME_NEGATIVE',
    block: 'price',
    severity: 'critical',
    dimension: 'validity',
    description: 'Volume is negative or not a finite number',
    defaultParams: {},
    references: [
      'https://public.econ.duke.edu/~get/browse/courses/201/spr12/DOWNLOADS/MicroStructure/bhls_kernels_practice_08.pdf',
    ],
  },

  check(data, context) {
    const findings: Finding[] = []

    for (const bar of data.bars) {
      const volume = bar.volume
      if (volume === undefined || (Number.isFinite(volume) && volume >= 0)) continue

      findings.push({
        rule: 'VOLUME_NEGATIVE',
        severity: context.config.severity,
        action: 'block',
        dimension: 'validity',
        where: { date: bar.timestamp },
        explanation:
          `Volume is ${volume}, which is structurally impossible: trade volume is a count of shares ` +
          `and must be a finite, non-negative number (tick-data cleaning rules of Barndorff-Nielsen et al., 2009). ` +
          `Hypothesis: a vendor sign error or a parsing artifact in the feed. ` +
          `Block this bar and re-fetch it from the source.`,
        evidence: { volume },
      })
    }

    return findings
  },
}

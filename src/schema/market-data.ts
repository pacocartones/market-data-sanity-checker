import { z } from 'zod'

/**
 * Canonical internal schema. Everything the ingesters produce is normalized to
 * this shape before the rules engine runs.
 *
 * Important: this schema validates STRUCTURE, not plausibility. A negative
 * price is structurally valid — flagging it as suspicious is the rules
 * engine's job, with severity, explanation and recommended action.
 */

/** ISO 4217-like, three uppercase letters. GBX (pence) is NOT GBP — first-class distinction. */
export const currencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'currency must be a 3-letter uppercase code (e.g. USD, EUR, GBX)')

/** ISO 8601 date or datetime. Timezone must be explicit for datetimes. */
export const timestampSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'must be a parseable ISO 8601 date or datetime',
  })

export const barSchema = z.object({
  timestamp: timestampSchema,
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number().optional(),
  /**
   * adjusted_price / raw_price (Qlib convention). Keeping the factor per bar
   * makes the vendor's adjustment auditable — the source of half of all real
   * world data bugs — and lets consumers reconstruct raw prices.
   */
  adjustmentFactor: z.number().positive().optional(),
})

export const dividendSchema = z.object({
  exDate: timestampSchema,
  payDate: timestampSchema.optional(),
  amount: z.number(),
  currency: currencySchema.optional(),
  type: z.enum(['regular', 'special']).optional(),
})

export const splitSchema = z.object({
  exDate: timestampSchema,
  numerator: z.number().positive(),
  denominator: z.number().positive(),
})

export const fundamentalsSchema = z
  .object({
    marketCap: z.number(),
    sharesOutstanding: z.number(),
    eps: z.number(),
    pe: z.number(),
    dividendYield: z.number(),
    payoutRatio: z.number(),
  })
  .partial()

/** Security identifiers beyond the ticker — tickers get reused, ISINs don't. */
export const identifiersSchema = z
  .object({
    isin: z.string(),
    cusip: z.string(),
    figi: z.string(),
  })
  .partial()

/**
 * Per-symbol work budget for each corporate-action collection. This is far
 * above ordinary dividend and split histories while bounding every rule that
 * consumes these arrays, including callers that bypass schema parsing and use
 * the typed SDK engines directly.
 */
export const MAX_CORPORATE_ACTIONS = 512

export const marketDataSetSchema = z.object({
  symbol: z.string().min(1),
  exchange: z.string().optional(),
  currency: currencySchema.optional(),
  /** Provenance is mandatory: a report must always be able to say where each datum came from. */
  source: z.string().min(1),
  identifiers: identifiersSchema.optional(),
  bars: z.array(barSchema),
  dividends: z.array(dividendSchema).max(MAX_CORPORATE_ACTIONS).optional(),
  splits: z.array(splitSchema).max(MAX_CORPORATE_ACTIONS).optional(),
  fundamentals: fundamentalsSchema.optional(),
})

export type Bar = z.infer<typeof barSchema>
export type Dividend = z.infer<typeof dividendSchema>
export type Split = z.infer<typeof splitSchema>
export type Fundamentals = z.infer<typeof fundamentalsSchema>
export type Identifiers = z.infer<typeof identifiersSchema>
export type MarketDataSet = z.infer<typeof marketDataSetSchema>

/** Reject unsafe typed SDK inputs instead of truncating or partially checking them. */
export function assertCorporateActionBudget(
  data: Pick<MarketDataSet, 'dividends' | 'splits'>,
  label = 'dataset',
): void {
  if ((data.dividends?.length ?? 0) > MAX_CORPORATE_ACTIONS) {
    throw new RangeError(
      `${label} contains ${data.dividends!.length} dividends; the maximum is ${MAX_CORPORATE_ACTIONS}`,
    )
  }
  if ((data.splits?.length ?? 0) > MAX_CORPORATE_ACTIONS) {
    throw new RangeError(
      `${label} contains ${data.splits!.length} splits; the maximum is ${MAX_CORPORATE_ACTIONS}`,
    )
  }
}

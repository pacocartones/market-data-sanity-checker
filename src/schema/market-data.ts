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

export const marketDataSetSchema = z.object({
  symbol: z.string().min(1),
  exchange: z.string().optional(),
  currency: currencySchema.optional(),
  /** Provenance is mandatory: a report must always be able to say where each datum came from. */
  source: z.string().min(1),
  identifiers: identifiersSchema.optional(),
  bars: z.array(barSchema),
  dividends: z.array(dividendSchema).optional(),
  splits: z.array(splitSchema).optional(),
  fundamentals: fundamentalsSchema.optional(),
})

export type Bar = z.infer<typeof barSchema>
export type Dividend = z.infer<typeof dividendSchema>
export type Split = z.infer<typeof splitSchema>
export type Fundamentals = z.infer<typeof fundamentalsSchema>
export type Identifiers = z.infer<typeof identifiersSchema>
export type MarketDataSet = z.infer<typeof marketDataSetSchema>

import { z } from 'zod'

/**
 * Zod schemas for the JSON output of `mdsc check --format json` and
 * `mdsc compare --format json`: the single source of truth for the published
 * JSON Schemas in `schemas/` (generated with `pnpm schemas`).
 *
 * They describe exactly the TypeScript interfaces `Finding`, `SanityReport`
 * and `ComparisonReport`; a type-level test keeps them from drifting apart.
 * Objects are not strict: like the interfaces, they allow extra properties,
 * so a field added in a 1.x minor release still validates against v1.
 */

/** Base URL the published schemas' `$id`s live under (GitHub Pages). */
export const SCHEMA_BASE_URL = 'https://pacocartones.github.io/market-data-sanity-checker/schemas'

const severitySchema = z.enum(['critical', 'warning', 'info'])

/** Schema of one finding, shared by the check and compare reports (the `Finding` interface). */
export const findingSchema = z.object({
  rule: z.string().describe('Stable rule identifier, e.g. SPLIT_NOT_ADJUSTED.'),
  severity: severitySchema,
  action: z
    .enum(['block', 'flag', 'review'])
    .describe('What to do with the flagged datum: block it, flag it, or send it to manual review.'),
  dimension: z
    .enum(['completeness', 'validity', 'accuracy', 'consistency', 'timeliness', 'uniqueness'])
    .describe('DAMA-DMBOK data quality dimension.'),
  where: z
    .record(z.string(), z.union([z.string(), z.number()]))
    .optional()
    .describe('Where in the dataset the problem lives, e.g. { "date": "2024-06-03" }.'),
  explanation: z
    .string()
    .describe('Human-readable explanation with the causal hypothesis and the evidence behind it.'),
  evidence: z.record(z.string(), z.unknown()).optional().describe('Rule-specific evidence values.'),
  references: z
    .array(z.string())
    .optional()
    .describe("URLs to the real-world incident or literature justifying the rule's threshold."),
  occurrences: z.number().optional().describe('How many times this rule fired; a rule reports once per dataset.'),
})

const summarySchema = z
  .object({ critical: z.number(), warning: z.number(), info: z.number() })
  .describe('Per-severity count of distinct rules that fired (not occurrences).')

/** Schema of the `mdsc check --format json` output (the `SanityReport` interface). */
export const checkReportSchema = z.object({
  symbol: z.string(),
  source: z.string(),
  sanity_score: z.number().describe('0–100: 100 minus the sum of severity penalties.'),
  findings: z.array(findingSchema),
  summary: summarySchema,
  generated_at: z.string().describe('ISO 8601 timestamp of when the report was generated.'),
})

/** Schema of the `mdsc compare --format json` output (the `ComparisonReport` interface). */
export const compareReportSchema = z.object({
  symbol: z.string(),
  sources: z.tuple([z.string(), z.string()]).describe('Labels of the two compared sources.'),
  consistency_score: z.number().describe('0–100, built like the sanity_score: 100 minus the sum of severity penalties.'),
  compared_dates: z.number().describe('Number of dates present in both sources.'),
  only_in: z.record(z.string(), z.number()).describe('Per source label, the number of dates only that source has.'),
  findings: z.array(findingSchema),
  summary: summarySchema,
  generated_at: z.string().describe('ISO 8601 timestamp of when the report was generated.'),
})

/** Names of the published report schemas, as used by `mdsc schema <name>`. */
export const REPORT_SCHEMA_NAMES = ['check', 'compare'] as const
export type ReportSchemaName = (typeof REPORT_SCHEMA_NAMES)[number]

const REPORT_SCHEMAS = {
  check: {
    schema: checkReportSchema,
    file: 'check-report.v1.json',
    title: 'mdsc check report (v1)',
    description:
      'JSON output of `mdsc check --format json` (the SanityReport of market-data-sanity-checker 1.x).',
  },
  compare: {
    schema: compareReportSchema,
    file: 'compare-report.v1.json',
    title: 'mdsc compare report (v1)',
    description:
      'JSON output of `mdsc compare --format json` (the ComparisonReport of market-data-sanity-checker 1.x).',
  },
} as const

/** File name of a published report schema inside `schemas/`. */
export function reportSchemaFile(name: ReportSchemaName): string {
  return REPORT_SCHEMAS[name].file
}

/**
 * The JSON Schema (draft 2020-12) of a report, generated from its zod schema.
 * `io: 'input'` keeps objects open (no `additionalProperties: false`), matching
 * the non-strict zod objects.
 */
export function reportJsonSchema(name: ReportSchemaName): Record<string, unknown> {
  const { schema, file, title, description } = REPORT_SCHEMAS[name]
  const generated = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' }) as Record<string, unknown>
  const { $schema, ...rest } = generated
  return { $schema, $id: `${SCHEMA_BASE_URL}/${file}`, title, description, ...rest }
}

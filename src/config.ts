import { readFile } from 'node:fs/promises'
import { access } from 'node:fs/promises'
import { z } from 'zod'
import { registry } from './rules/registry'
import { compareRegistry } from './compare/registry'
import type { CheckerConfig } from './rules/types'
import type { CompareConfig } from './compare/types'

/**
 * Config file support — "custom rules by user" (phase 4).
 *
 * `mdsc.config.json` in the working directory (or `--config <path>`) holds
 * per-rule overrides for both engines. Every threshold in the corpus is
 * already a parameter; this makes them project-policy without touching code.
 *
 * Unknown rule ids, unknown param keys, non-finite param values and unknown
 * top-level keys are hard errors naming the valid catalog — a config that
 * silently does nothing is worse than no config (conservative principle).
 */

const severitySchema = z.enum(['critical', 'warning', 'info'])

const ruleOverrideSchema = z.object({
  enabled: z.boolean().optional(),
  severity: severitySchema.optional(),
  // Any finite number is a legitimate threshold (negatives included);
  // Infinity/NaN is always a typo. Keys are checked against the rule's
  // defaultParams after parsing (validateParams below).
  params: z.record(z.string(), z.number().finite()).optional(),
})

const configFileSchema = z
  .object({
    rules: z.record(z.string(), ruleOverrideSchema).optional(),
    compareRules: z.record(z.string(), ruleOverrideSchema).optional(),
  })
  .strict()

export interface MdscConfig {
  checker: CheckerConfig
  compare: CompareConfig
}

export class ConfigError extends Error {
  override name = 'ConfigError'
}

const DEFAULT_CONFIG_FILE = 'mdsc.config.json'

function validateRuleIds(config: z.infer<typeof configFileSchema>): void {
  const singleSourceIds = new Set(registry.map((rule) => rule.meta.id))
  const compareIds = new Set(compareRegistry.map((rule) => rule.meta.id))
  for (const id of Object.keys(config.rules ?? {})) {
    if (!singleSourceIds.has(id)) {
      throw new ConfigError(
        `Unknown rule id "${id}" in config. Valid single-source rules: ${[...singleSourceIds].join(', ')}`,
      )
    }
  }
  for (const id of Object.keys(config.compareRules ?? {})) {
    if (!compareIds.has(id)) {
      throw new ConfigError(
        `Unknown compare rule id "${id}" in config. Valid compare rules: ${[...compareIds].join(', ')}`,
      )
    }
  }
}

/**
 * Param keys must exist in the rule's defaultParams — a typo'd key would be
 * silently ignored by the engines, which is exactly what this file exists to
 * prevent. Unknown keys are a hard error listing the rule's valid params.
 * Runs after validateRuleIds, so every id here is known.
 */
function validateParams(config: z.infer<typeof configFileSchema>): void {
  const singleSourceDefaults = new Map(registry.map((rule) => [rule.meta.id, rule.meta.defaultParams]))
  const compareDefaults = new Map(compareRegistry.map((rule) => [rule.meta.id, rule.meta.defaultParams]))
  for (const [id, override] of Object.entries(config.rules ?? {})) {
    const defaults = singleSourceDefaults.get(id)
    if (defaults) assertKnownParams(id, override.params, defaults)
  }
  for (const [id, override] of Object.entries(config.compareRules ?? {})) {
    const defaults = compareDefaults.get(id)
    if (defaults) assertKnownParams(id, override.params, defaults)
  }
}

function assertKnownParams(
  ruleId: string,
  params: Record<string, number> | undefined,
  defaults: Record<string, number>,
): void {
  if (!params) return
  const validKeys = Object.keys(defaults)
  for (const key of Object.keys(params)) {
    if (validKeys.includes(key)) continue
    const catalog =
      validKeys.length > 0
        ? `Valid params: ${validKeys.join(', ')}`
        : `Rule "${ruleId}" has no configurable params`
    throw new ConfigError(`Unknown param "${key}" for rule "${ruleId}" in config. ${catalog}`)
  }
}

/** Formats one Zod issue; unknown top-level keys get the valid catalog named. */
function formatIssue(issue: z.ZodIssue): string {
  if (issue.code === 'unrecognized_keys') {
    const keys = issue.keys.map((key) => `"${key}"`).join(', ')
    return `unrecognized key(s) ${keys} — valid top-level keys: rules, compareRules`
  }
  return `${issue.path.join('.')}: ${issue.message}`
}

/**
 * Loads the config file. `path` explicit → must exist; omitted → looks for
 * mdsc.config.json in cwd and returns empty config when absent.
 */
export async function loadConfig(path?: string): Promise<MdscConfig> {
  const target = path ?? DEFAULT_CONFIG_FILE
  try {
    await access(target)
  } catch {
    if (path) throw new ConfigError(`Config file not found: ${target}`)
    return { checker: {}, compare: {} }
  }

  let raw: unknown
  try {
    raw = JSON.parse(await readFile(target, 'utf8'))
  } catch (error) {
    throw new ConfigError(`Config file ${target} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }

  const parsed = configFileSchema.safeParse(raw)
  if (!parsed.success) {
    throw new ConfigError(
      `Config file ${target} is invalid: ${parsed.error.issues.map(formatIssue).join('; ')}`,
    )
  }
  validateRuleIds(parsed.data)
  validateParams(parsed.data)
  return {
    checker: { rules: parsed.data.rules ?? {} },
    compare: { rules: parsed.data.compareRules ?? {} },
  }
}

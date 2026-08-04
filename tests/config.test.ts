import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from '../src/config'
import { registry } from '../src/rules/registry'
import { compareRegistry } from '../src/compare/registry'

/**
 * Config strictness — the file's own philosophy: a config that silently does
 * nothing is worse than no config. Typos in rule ids, param keys or top-level
 * keys, and non-finite thresholds, are hard errors that name the valid catalog.
 */

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mdsc-config-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Writes the config (object serialized; string written verbatim) and returns its path. */
async function writeConfig(content: unknown): Promise<string> {
  const path = join(dir, 'mdsc.config.json')
  await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content), 'utf8')
  return path
}

/** Writes the config and returns the error loadConfig throws for it (fails if it does not). */
async function loadConfigError(content: unknown): Promise<unknown> {
  const path = await writeConfig(content)
  return loadConfig(path).then(
    () => {
      throw new Error('expected loadConfig to reject, but it resolved')
    },
    (error: unknown) => error,
  )
}

function defaultParamKeys(id: string): string[] {
  const rule = registry.find((entry) => entry.meta.id === id)
  return Object.keys(rule?.meta.defaultParams ?? {})
}

function compareDefaultParamKeys(id: string): string[] {
  const rule = compareRegistry.find((entry) => entry.meta.id === id)
  return Object.keys(rule?.meta.defaultParams ?? {})
}

describe('loadConfig — strict validation', () => {
  it('accepts a complete valid config for both engines', async () => {
    const path = await writeConfig({
      rules: {
        RETURN_SPIKE: { enabled: true, severity: 'critical', params: { zscoreThreshold: 5 } },
        STALE_PRICE: { enabled: false },
      },
      compareRules: {
        CLOSE_DIVERGENCE: { severity: 'info', params: { medianTolerancePct: 0.01 } },
      },
    })
    const config = await loadConfig(path)
    expect(config.checker.rules?.RETURN_SPIKE).toEqual({
      enabled: true,
      severity: 'critical',
      params: { zscoreThreshold: 5 },
    })
    expect(config.checker.rules?.STALE_PRICE).toEqual({ enabled: false })
    expect(config.compare.rules?.CLOSE_DIVERGENCE).toEqual({
      severity: 'info',
      params: { medianTolerancePct: 0.01 },
    })
  })

  it('rejects a typo in a single-source param key and lists the valid ones', async () => {
    const error = await loadConfigError({
      rules: { RETURN_SPIKE: { params: { zsoreThreshold: 5 } } },
    })
    expect(error).toBeInstanceOf(ConfigError)
    const message = (error as Error).message
    expect(message).toContain('"zsoreThreshold"')
    expect(message).toContain('RETURN_SPIKE')
    for (const key of defaultParamKeys('RETURN_SPIKE')) {
      expect(message).toContain(key)
    }
  })

  it('rejects a typo in a compare param key and lists the valid ones', async () => {
    const error = await loadConfigError({
      compareRules: { CLOSE_DIVERGENCE: { params: { medianTolerancePtc: 0.01 } } },
    })
    expect(error).toBeInstanceOf(ConfigError)
    const message = (error as Error).message
    expect(message).toContain('"medianTolerancePtc"')
    expect(message).toContain('CLOSE_DIVERGENCE')
    for (const key of compareDefaultParamKeys('CLOSE_DIVERGENCE')) {
      expect(message).toContain(key)
    }
  })

  it('accepts negative param values — any finite number can be a legitimate threshold', async () => {
    const path = await writeConfig({
      rules: { RETURN_SPIKE: { params: { zscoreThreshold: -3.5 } } },
    })
    const config = await loadConfig(path)
    expect(config.checker.rules?.RETURN_SPIKE?.params?.zscoreThreshold).toBe(-3.5)
  })

  it('rejects non-finite param values', async () => {
    // JSON cannot spell Infinity, but 1e999 overflows to it when parsed.
    const error = await loadConfigError('{"rules":{"RETURN_SPIKE":{"params":{"zscoreThreshold":1e999}}}}')
    expect(error).toBeInstanceOf(ConfigError)
    expect((error as Error).message).toContain('zscoreThreshold')
  })

  it.each([['checker'], ['compare-rules']])(
    'rejects unknown top-level key "%s" and lists the valid ones',
    async (key) => {
      const error = await loadConfigError({ [key]: { RETURN_SPIKE: {} } })
      expect(error).toBeInstanceOf(ConfigError)
      const message = (error as Error).message
      expect(message).toContain(`"${key}"`)
      expect(message).toContain('rules')
      expect(message).toContain('compareRules')
    },
  )

  it('rejects unknown rule ids and lists the valid catalog', async () => {
    const error = await loadConfigError({ rules: { RETRUN_SPIKE: { enabled: false } } })
    expect(error).toBeInstanceOf(ConfigError)
    const message = (error as Error).message
    expect(message).toContain('"RETRUN_SPIKE"')
    expect(message).toContain('RETURN_SPIKE')
  })

  it('throws ConfigError for an explicit path that does not exist', async () => {
    await expect(loadConfig(join(dir, 'does-not-exist.json'))).rejects.toThrow(ConfigError)
  })

  it('throws ConfigError for broken JSON', async () => {
    const path = await writeConfig('{"rules": {')
    await expect(loadConfig(path)).rejects.toThrow(ConfigError)
  })
})

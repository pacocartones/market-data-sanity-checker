import { createHash } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const directories: string[] = []
afterEach(() => directories.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))
function consumer() {
  const dir = mkdtempSync(resolve(tmpdir(), 'mdsc-floor-lock-'))
  directories.push(dir)
  cpSync(resolve(root, '.github/fixtures/package-floor'), dir, { recursive: true })
  writeFileSync(resolve(dir, 'market-data-sanity-checker.tgz'), 'same-run artifact')
  const packed = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  writeFileSync(resolve(dir, 'packed-package.json'), JSON.stringify(packed))
  const entries = Object.entries(lock(dir).packages) as [string, { version: string; resolved: string }][]
  writeFileSync(resolve(dir, 'runtime-dependencies.json'), JSON.stringify({
    schemaVersion: 1, name: packed.name, version: packed.version,
    tarballIntegrity: 'sha512-' + createHash('sha512').update('same-run artifact').digest('base64'),
    dependencies: Object.fromEntries(entries.filter(([key]) => key !== '' && key !== 'node_modules/market-data-sanity-checker')
      .map(([key, value]) => [key.slice('node_modules/'.length), { version: value.version, resolved: value.resolved }])),
  }))
  return dir
}
function run(dir: string) {
  return spawnSync(process.execPath, [resolve(root, 'scripts/package-floor-lock.mjs'), dir], { encoding: 'utf8' })
}
function lock(dir: string) { return JSON.parse(readFileSync(resolve(dir, 'package-lock.json'), 'utf8')) }

describe('package floor consumer lock preparation', () => {
  it('rejects resolved runtime drift with unchanged dependency specs before touching the lock', () => {
    const dir = consumer(), before = readFileSync(resolve(dir, 'package-lock.json'), 'utf8')
    const runtime = JSON.parse(readFileSync(resolve(dir, 'runtime-dependencies.json'), 'utf8'))
    runtime.dependencies.zod.version = '4.6.8' // packed spec remains ^4.6.7
    writeFileSync(resolve(dir, 'runtime-dependencies.json'), JSON.stringify(runtime))
    const result = run(dir)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Resolved runtime versions drifted')
    expect(readFileSync(resolve(dir, 'package-lock.json'), 'utf8')).toBe(before)
  })
  it('rejects a missing same-run runtime manifest', () => {
    const dir = consumer()
    rmSync(resolve(dir, 'runtime-dependencies.json'))
    const result = run(dir)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('runtime-dependencies.json')
  })
  it('rejects a runtime manifest bound to another artifact', () => {
    const dir = consumer(), runtime = JSON.parse(readFileSync(resolve(dir, 'runtime-dependencies.json'), 'utf8'))
    runtime.tarballIntegrity = 'sha512-other-artifact'
    writeFileSync(resolve(dir, 'runtime-dependencies.json'), JSON.stringify(runtime))
    const result = run(dir)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Runtime manifest belongs to another tarball')
  })
  it('rejects unmodelled transitive runtime dependencies in the producer', () => {
    const dir = consumer(), graph = [{ name: 'market-data-sanity-checker', version: '1.7.0', dependencies: {
      zod: { from: 'zod', version: '4.6.7', resolved: 'https://registry.npmjs.org/zod/-/zod-4.6.7.tgz',
        dependencies: { extra: { version: '1.0.0' } } },
    } }]
    writeFileSync(resolve(dir, 'installed.json'), JSON.stringify(graph))
    const result = spawnSync(process.execPath, [resolve(root, 'scripts/package-floor-lock.mjs'), '--capture-runtime',
      resolve(dir, 'installed.json'), resolve(dir, 'market-data-sanity-checker.tgz'), resolve(dir, 'runtime-dependencies.json')], { encoding: 'utf8' })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Transitive runtime dependencies require fixture support')
  })
  it('binds only the same-run tarball digest and leaves the locked dependency graph intact', () => {
    const dir = consumer(), expected = lock(dir)
    expected.packages['node_modules/market-data-sanity-checker'].integrity =
      'sha512-' + createHash('sha512').update('same-run artifact').digest('base64')
    const result = run(dir)
    expect(result.status, result.stderr).toBe(0)
    expect(lock(dir)).toEqual(expected)
  })
  it('rejects changed packed dependency ranges without rewriting the lock', () => {
    const dir = consumer(), before = readFileSync(resolve(dir, 'package-lock.json'), 'utf8')
    const metadata = JSON.parse(readFileSync(resolve(dir, 'packed-package.json'), 'utf8'))
    metadata.dependencies.zod = '^4.6.8'
    writeFileSync(resolve(dir, 'packed-package.json'), JSON.stringify(metadata))
    expect(run(dir).status).not.toBe(0)
    expect(readFileSync(resolve(dir, 'package-lock.json'), 'utf8')).toBe(before)
  })
  it('rejects new optional dependencies absent from the reviewed lock', () => {
    const dir = consumer(), metadata = JSON.parse(readFileSync(resolve(dir, 'packed-package.json'), 'utf8'))
    metadata.optionalDependencies = { surprise: '1.0.0' }
    writeFileSync(resolve(dir, 'packed-package.json'), JSON.stringify(metadata))
    expect(run(dir).status).not.toBe(0)
  })
  it('rejects a changed binary target', () => {
    const dir = consumer(), metadata = JSON.parse(readFileSync(resolve(dir, 'packed-package.json'), 'utf8'))
    metadata.bin.mdsc = './dist/other.js'
    writeFileSync(resolve(dir, 'packed-package.json'), JSON.stringify(metadata))
    expect(run(dir).status).not.toBe(0)
  })
  it('rejects a changed engine promise', () => {
    const dir = consumer(), metadata = JSON.parse(readFileSync(resolve(dir, 'packed-package.json'), 'utf8'))
    metadata.engines.node = '>=24'
    writeFileSync(resolve(dir, 'packed-package.json'), JSON.stringify(metadata))
    expect(run(dir).status).not.toBe(0)
  })
  it('fails if the committed consumer lock is missing', () => {
    const dir = consumer()
    rmSync(resolve(dir, 'package-lock.json'))
    expect(run(dir).status).not.toBe(0)
  })
  it('rejects a lock that already contains an unreviewed own-package digest', () => {
    const dir = consumer(), changed = lock(dir)
    changed.packages['node_modules/market-data-sanity-checker'].integrity = 'sha512-unreviewed'
    writeFileSync(resolve(dir, 'package-lock.json'), JSON.stringify(changed))
    expect(run(dir).status).not.toBe(0)
  })
})

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

type Manifest = {
  version: string; dependencies: Record<string, string>; optionalDependencies?: Record<string, string>
  engines: Record<string, string>; bin: Record<string, string>
}
describe('package floor fixture version sync', () => {
  const fixtureLock = '.github/fixtures/package-floor/package-lock.json'
  const own = 'node_modules/market-data-sanity-checker'
  // A copy of the repository's package.json and consumer fixture, with package.json edited by `edit`.
  function repository(edit: (pkg: Manifest) => void = () => {}) {
    const dir = mkdtempSync(resolve(tmpdir(), 'mdsc-floor-sync-'))
    directories.push(dir)
    cpSync(resolve(root, '.github/fixtures/package-floor'), resolve(dir, '.github/fixtures/package-floor'), { recursive: true })
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
    edit(pkg)
    writeFileSync(resolve(dir, 'package.json'), JSON.stringify(pkg, null, 4) + '\n')
    return dir
  }
  function sync(dir: string) {
    return spawnSync(process.execPath, [resolve(root, 'scripts/sync-floor-fixture-version.mjs'), dir], { encoding: 'utf8' })
  }
  const text = (dir: string) => readFileSync(resolve(dir, fixtureLock), 'utf8')

  it('leaves the committed fixture unchanged at the current version', () => {
    const dir = repository(), before = text(dir)
    const result = sync(dir)
    expect(result.status, result.stderr).toBe(0)
    expect(text(dir)).toBe(before)
  })
  it('updates only the own-package version after a bump', () => {
    const dir = repository((pkg) => { pkg.version = '9.10.0' }), before = text(dir)
    const result = sync(dir)
    expect(result.status, result.stderr).toBe(0)
    const expected = JSON.parse(before)
    expected.packages[own].version = '9.10.0'
    expect(JSON.parse(text(dir))).toEqual(expected)
    const changed = text(dir).split('\n').filter((line, index) => line !== before.split('\n')[index])
    expect(changed).toEqual(['      "version": "9.10.0",'])
  })
  it.each([
    ['dependencies', (pkg: Manifest) => { pkg.dependencies.zod = '^4.7.0' }],
    ['optionalDependencies', (pkg: Manifest) => { pkg.optionalDependencies = { surprise: '1.0.0' } }],
    ['engines', (pkg: Manifest) => { pkg.engines.node = '>=24' }],
    ['bin', (pkg: Manifest) => { pkg.bin.mdsc = './dist/other.js' }],
  ])('refuses a bump that also changes %s, without touching the lock', (field, edit) => {
    const dir = repository((pkg) => { pkg.version = '9.10.0'; edit(pkg) }), before = text(dir)
    const result = sync(dir)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(`package.json ${field} changed`)
    expect(text(dir)).toBe(before)
  })
  it('refuses a lock whose own-package entry has other fields changed', () => {
    const dir = repository((pkg) => { pkg.version = '9.10.0' }), changed = JSON.parse(text(dir))
    changed.packages[own].resolved = 'https://registry.npmjs.org/market-data-sanity-checker/-/market-data-sanity-checker-1.8.0.tgz'
    writeFileSync(resolve(dir, fixtureLock), JSON.stringify(changed, null, 2) + '\n')
    const before = text(dir), result = sync(dir)
    expect(result.status).not.toBe(0)
    expect(text(dir)).toBe(before)
  })
  it('refuses a lock that is not in npm formatting rather than reformat it', () => {
    const dir = repository((pkg) => { pkg.version = '9.10.0' })
    writeFileSync(resolve(dir, fixtureLock), JSON.stringify(JSON.parse(text(dir))))
    const before = text(dir), result = sync(dir)
    expect(result.status).not.toBe(0)
    expect(text(dir)).toBe(before)
  })
  it('lets the preparation script pass after a simulated bump and sync', () => {
    const repo = repository((pkg) => { pkg.version = '9.10.0' })
    expect(sync(repo).status).toBe(0)
    const dir = consumer()
    cpSync(resolve(repo, fixtureLock), resolve(dir, 'package-lock.json'))
    const packed = JSON.parse(readFileSync(resolve(repo, 'package.json'), 'utf8'))
    writeFileSync(resolve(dir, 'packed-package.json'), JSON.stringify(packed))
    const runtime = JSON.parse(readFileSync(resolve(dir, 'runtime-dependencies.json'), 'utf8'))
    runtime.version = packed.version
    writeFileSync(resolve(dir, 'runtime-dependencies.json'), JSON.stringify(runtime))
    const result = run(dir)
    expect(result.status, result.stderr).toBe(0)
    expect(lock(dir).packages[own].version).toBe('9.10.0')
  })
  it('fails preparation after a bump without the sync', () => {
    const dir = consumer(), packed = JSON.parse(readFileSync(resolve(dir, 'packed-package.json'), 'utf8'))
    packed.version = '9.10.0'
    writeFileSync(resolve(dir, 'packed-package.json'), JSON.stringify(packed))
    const result = run(dir)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Packed version changed')
  })
  it('runs from the release workflow version step', () => {
    const workflow = readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8')
    expect(workflow).toMatch(/^\s+version-script: pnpm version-packages$/m)
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
    expect(pkg.scripts['version-packages']).toBe(
      'changeset version && node scripts/sync-floor-fixture-version.mjs && node scripts/sync-citation-version.mjs',
    )
  })
})

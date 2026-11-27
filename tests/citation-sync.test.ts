import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))
const script = resolve(root, 'scripts/sync-citation-version.mjs')
const { syncCitation } = (await import(new URL('../scripts/sync-citation-version.mjs', import.meta.url).href)) as {
  syncCitation(text: string, version: string, date: string): string
}
const citation = readFileSync(resolve(root, 'CITATION.cff'), 'utf8')
/** The committed citation with an old release date, so a same-day run still shows the date move. */
const dated = citation.replace(/^date-released: .*$/m, 'date-released: 2000-01-01')
const directories: string[] = []
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A copy of the repository's CITATION.cff and package.json, with the version set. */
function repository(version: string): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'mdsc-citation-sync-'))
  directories.push(dir)
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string }
  pkg.version = version
  writeFileSync(resolve(dir, 'package.json'), JSON.stringify(pkg, null, 4) + '\n')
  writeFileSync(resolve(dir, 'CITATION.cff'), dated)
  return dir
}

const changedLines = (before: string, after: string) => {
  const old = before.split('\n')
  return after.split('\n').filter((line, index) => line !== old[index])
}

describe('CITATION.cff version sync', () => {
  it('names the current package version', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string }
    expect(citation).toMatch(new RegExp(`^version: ${pkg.version.replaceAll('.', '\\.')}$`, 'm'))
  })

  it('sets only version and date-released after a bump', () => {
    const next = syncCitation(citation, '9.10.0', '2027-01-02')
    expect(changedLines(citation, next)).toEqual(['version: 9.10.0', 'date-released: 2027-01-02'])
    expect(next.split('\n')).toHaveLength(citation.split('\n').length)
  })

  it('changes nothing when the citation already names the version', () => {
    const version = /^version: (.*)$/m.exec(citation)![1]!
    expect(syncCitation(citation, version, '2099-12-31')).toBe(citation)
  })

  it('refuses an unusable version, date or file shape', () => {
    expect(() => syncCitation(citation, 'next', '2027-01-02')).toThrow('no usable version')
    expect(() => syncCitation(citation, '9.10.0', '02/01/2027')).toThrow('YYYY-MM-DD')
    expect(() => syncCitation(citation.replace(/^date-released: .*\n/m, ''), '9.10.0', '2027-01-02')).toThrow(
      'exactly one top-level "date-released:"',
    )
  })

  it('writes the bump with the current UTC date when run as a script', () => {
    const dir = repository('9.10.0')
    const result = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
    const today = new Date().toISOString().slice(0, 10)
    const after = readFileSync(resolve(dir, 'CITATION.cff'), 'utf8')
    expect(changedLines(dated, after)).toEqual(['version: 9.10.0', `date-released: ${today}`])
    const again = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' })
    expect(again.status, again.stderr).toBe(0)
    expect(readFileSync(resolve(dir, 'CITATION.cff'), 'utf8')).toBe(after)
  })

  it('runs in the release version step', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    expect(pkg.scripts['version-packages']).toBe(
      'changeset version && node scripts/sync-floor-fixture-version.mjs && node scripts/sync-citation-version.mjs',
    )
  })
})

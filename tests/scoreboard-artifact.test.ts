import { createHash } from 'node:crypto'
import { cp, link, mkdtemp, readFile, rm, symlink, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderScoreboardReadme } from '../src/scoreboard/readme'

const root = fileURLToPath(new URL('..', import.meta.url))
const env = {
  GITHUB_REPOSITORY: 'pacocartones/market-data-sanity-checker', GITHUB_REF: 'refs/heads/main',
  GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: 'a'.repeat(40),
  GITHUB_RUN_ID: '1234', GITHUB_RUN_ATTEMPT: '1', SCOREBOARD_AUTOMATION_READY: 'true',
  GITHUB_REPOSITORY_ID: '123',
  SCOREBOARD_APP_CLIENT_ID: 'Iv1.synthetic',
}
interface ArtifactModule {
  pack(source: string, target: string, env: Record<string, string>): Promise<{ payloadSha256: string }>
  loadArtifact(target: string, env: Record<string, string>, digest: string): Promise<{ files: Record<string, Buffer> }>
  checkArtifactMetadata(id: string, env: Record<string, string>, digest: string, request: (method: string, path: string) => Promise<unknown>): Promise<void>
}
const moduleUrl = new URL('../scripts/scoreboard-artifact.mjs', import.meta.url).href
async function module() { return await import(moduleUrl) as ArtifactModule }
let dir = ''
let source = ''
let bundle = ''
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mdsc-artifact-'))
  source = join(dir, 'source')
  bundle = join(dir, 'bundle')
  await cp(join(root, 'scoreboard'), source, { recursive: true })
})
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })
async function json() { return JSON.parse(await readFile(join(source, 'latest.json'), 'utf8')) }
async function editJson(edit: (data: ReturnType<typeof JSON.parse>) => void) {
  const data = await json()
  edit(data)
  await writeFile(join(source, 'latest.json'), JSON.stringify(data))
}
async function quorum(ok: number, failed: number, skipped: number, rules: string[] = []) {
  const seed = await json()
  const basket = seed.basket as string[]
  const provider = { provider: 'yahoo', symbols_ok: ok, symbols_failed: failed, symbols_skipped: skipped,
    mean_score: 80, min_score: 80, worst_symbols: basket.slice(0, Math.min(5, ok)).map(symbol => ({ symbol, score: 80, rules })),
    total_findings: { critical: 0, warning: ok * rules.length, info: 0 } }
  const excluded = [{ provider: 'alpha-vantage', failed: 10 }]
  const data = { generated_at: seed.generated_at, basket, range: '1y', providers: [provider], excluded, comparisons: [] }
  await writeFile(join(source, 'latest.json'), JSON.stringify(data))
  const rows = basket.map((symbol, index) => [seed.generated_at, 'yahoo', symbol,
    index < ok ? '80' : '', index < ok ? '0' : '', index < ok ? String(rules.length) : '', index < ok ? '0' : '',
    index < ok ? rules.join(';') : index < ok + failed ? 'FETCH_FAILED' : 'SKIPPED_DAILY_CAP'].join(','))
  await writeFile(join(source, 'latest.csv'), 'generated_at,provider,symbol,sanity_score,critical,warning,info,rules\n' + rows.join('\n') + '\n')
  await writeFile(join(source, 'README.md'), renderScoreboardReadme({
    generatedAt: seed.generated_at, basketSize: 30, providers: [provider], excluded,
    skipped: skipped ? [{ provider: 'yahoo', symbols: basket.slice(ok + failed) }] : [], comparisons: [],
  }))
}
describe('scoreboard artifact boundary', () => {
  it('accepts the checked-in 23/2/5 provider and preserves all four files', async () => {
    const { pack, loadArtifact } = await module()
    expect((await json()).providers.find((p: { provider: string }) => p.provider === 'alpha-vantage')).toMatchObject({
      symbols_ok: 23, symbols_failed: 2, symbols_skipped: 5,
    })
    const packed = await pack(source, bundle, env)
    const result = await loadArtifact(bundle, env, packed.payloadSha256)
    expect(Object.keys(result.files).sort()).toEqual(['README.md', 'datapackage.json', 'latest.csv', 'latest.json'])
    for (const [name, data] of Object.entries(result.files)) expect(data.equals(await readFile(join(source, name)))).toBe(true)
  })
  it('allows exactly 20 percent failures and a single healthy provider', async () => {
    await quorum(24, 6, 0)
    await expect((await module()).pack(source, bundle, env)).resolves.toHaveProperty('payloadSha256')
  })
  it('preserves repeated rule IDs for different findings', async () => {
    await quorum(30, 0, 0, ['RETURN_SPIKE', 'RETURN_SPIKE'])
    await expect((await module()).pack(source, bundle, env)).resolves.toHaveProperty('payloadSha256')
  })
  it('rejects invented daily skips for Yahoo even with a passing arithmetic quorum', async () => {
    await quorum(1, 0, 29)
    await expect((await module()).pack(source, bundle, env)).rejects.toThrow()
  })
  it.each([[23, 7, 0], [0, 0, 30]])('rejects invalid quorum %i/%i/%i before output', async (ok, failed, skipped) => {
    await quorum(ok, failed, skipped)
    await expect((await module()).pack(source, bundle, env)).rejects.toThrow()
    await expect(access(bundle)).rejects.toThrow()
  })
  it.each(['GITHUB_SHA', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_REPOSITORY'])(
    'rejects another %s even when the file manifest is internally consistent', async key => {
      const api = await module()
      const packed = await api.pack(source, bundle, env)
      await expect(api.loadArtifact(bundle, { ...env, [key]: key === 'GITHUB_SHA' ? 'b'.repeat(40) : key === 'GITHUB_REPOSITORY' ? 'fork/repo' : '9999' }, packed.payloadSha256)).rejects.toThrow()
    },
  )
  it('rejects a changed byte and does not trust a self-supplied manifest digest', async () => {
    const api = await module()
    const packed = await api.pack(source, bundle, env)
    const path = join(bundle, 'scoreboard-1234-1.json')
    const original = await readFile(path)
    // Whitespace keeps JSON and all inner hashes valid but changes the external digest.
    await writeFile(path, Buffer.concat([original, Buffer.from(' ')]))
    await expect(api.loadArtifact(bundle, env, packed.payloadSha256)).rejects.toThrow()
    await writeFile(path, original)
    const payload = JSON.parse(original.toString())
    payload.contents['README.md'] = Buffer.from('forged').toString('base64')
    const altered = Buffer.from(JSON.stringify(payload))
    await writeFile(path, altered)
    await expect(api.loadArtifact(bundle, env, createHash('sha256').update(altered).digest('hex'))).rejects.toThrow()
  })
  it.each([
    ['README extension', async () => { await writeFile(join(source, 'README.md'), (await readFile(join(source, 'README.md'), 'utf8')) + '\n[untrusted](https://example.test)') }],
    ['remote descriptor', async () => { const p = JSON.parse(await readFile(join(source, 'datapackage.json'), 'utf8')); p.resources[0].path = 'https://example.test/data.csv'; await writeFile(join(source, 'datapackage.json'), JSON.stringify(p)) }],
    ['mismatched aggregate', async () => { await editJson(data => { data.providers[0].mean_score += 1 }) }],
    ['no healthy provider', async () => { await editJson(data => { data.providers = [] }) }],
    ['duplicate provider', async () => { await editJson(data => { data.providers.push(data.providers[0]) }) }],
    ['string score', async () => { await editJson(data => { data.providers[0].mean_score = '80' }) }],
    ['unknown root field', async () => { await editJson(data => { data.untrusted = { script: 'run' } }) }],
    ['CSV contradiction', async () => { const lines = (await readFile(join(source, 'latest.csv'), 'utf8')).split('\n'); const row = lines[1]!.split(','); row[3] = '101'; lines[1] = row.join(','); await writeFile(join(source, 'latest.csv'), lines.join('\n')) }],
    ['extra file', async () => { await writeFile(join(source, 'script.mjs'), 'throw 1') }],
    ['missing file', async () => { await rm(join(source, 'latest.csv')) }],
    ['oversized file', async () => { await writeFile(join(source, 'README.md'), 'x'.repeat(262145)) }],
  ] as Array<[string, () => Promise<void>]>)('rejects %s before building an artifact', async (_name, mutate) => {
    await mutate()
    await expect((await module()).pack(source, bundle, env)).rejects.toThrow()
    await expect(access(bundle)).rejects.toThrow()
  })
  it.skipIf(process.platform === 'win32')('rejects links and ambiguous directory roots', async () => {
    const api = await module()
    await rm(join(source, 'README.md'))
    await symlink(join(root, 'README.md'), join(source, 'README.md'))
    await expect(api.pack(source, bundle, env)).rejects.toThrow()
    await rm(join(source, 'README.md'))
    await writeFile(join(source, 'README.md'), 'data')
    await link(join(source, 'README.md'), join(dir, 'hardlink'))
    await expect(api.pack(source, bundle, env)).rejects.toThrow()
    await symlink(source, join(dir, 'linked-root'))
    await expect(api.pack(join(dir, 'linked-root'), bundle, env)).rejects.toThrow()
  })
})

describe('artifact service identity before download', () => {
  const hash = 'a'.repeat(64)
  function metadata() {
    return { id: 42, name: 'scoreboard-1234-1.json', expired: false, size_in_bytes: 1000,
      digest: 'sha256:' + hash,
      workflow_run: { id: 1234, repository_id: 123, head_repository_id: 123, head_branch: 'main', head_sha: env.GITHUB_SHA } }
  }
  it('accepts only the expected artifact of this run/repository/SHA/attempt', async () => {
    const reads: string[] = []
    await (await module()).checkArtifactMetadata('42', env, hash, async (method, path) => {
      reads.push(method + ' ' + path); return metadata()
    })
    expect(reads).toEqual(['GET /repos/pacocartones/market-data-sanity-checker/actions/artifacts/42'])
  })
  it.each([
    ['other ID', (m: ReturnType<typeof metadata>) => { m.id = 43 }],
    ['other attempt', (m: ReturnType<typeof metadata>) => { m.name = 'scoreboard-1234-2.json' }],
    ['expired', (m: ReturnType<typeof metadata>) => { m.expired = true }],
    ['oversized', (m: ReturnType<typeof metadata>) => { m.size_in_bytes = 4 * 1024 * 1024 }],
    ['no digest', (m: ReturnType<typeof metadata>) => { m.digest = '' }],
    ['other run', (m: ReturnType<typeof metadata>) => { m.workflow_run.id = 5555 }],
    ['other repository', (m: ReturnType<typeof metadata>) => { m.workflow_run.repository_id = 456 }],
    ['fork source', (m: ReturnType<typeof metadata>) => { m.workflow_run.head_repository_id = 456 }],
    ['other branch', (m: ReturnType<typeof metadata>) => { m.workflow_run.head_branch = 'topic' }],
    ['other SHA', (m: ReturnType<typeof metadata>) => { m.workflow_run.head_sha = 'b'.repeat(40) }],
  ])('rejects metadata with %s', async (_name, mutate) => {
    const value = metadata()
    mutate(value)
    await expect((await module()).checkArtifactMetadata('42', env, hash, async () => value)).rejects.toThrow()
  })
})

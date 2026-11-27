import { createHash } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SHA = 'a'.repeat(40), TREE = 'd'.repeat(40), COMMIT = 'c'.repeat(40)
const env = { GITHUB_REPOSITORY: 'pacocartones/market-data-sanity-checker', GITHUB_REPOSITORY_ID: '123',
  GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: SHA,
  GITHUB_RUN_ID: '1234', GITHUB_RUN_ATTEMPT: '1', SCOREBOARD_AUTOMATION_READY: 'true',
  SCOREBOARD_APP_CLIENT_ID: 'Iv1.synthetic', SCOREBOARD_APP_TOKEN: 'synthetic-app-token', SCOREBOARD_APP_SLUG: 'scoreboard-test' }
type Body = Record<string, unknown>
type Request = (method: string, path: string, body?: Body, allow404?: boolean) => Promise<unknown>
interface Publisher {
  publish(bundle: string, digest: string, env: Record<string, string>, request: Request): Promise<{ changed: boolean; commit?: string; pr?: string }>
}
const publisherUrl = new URL('../scripts/publish-scoreboard.mjs', import.meta.url).href
const artifactUrl = new URL('../scripts/scoreboard-artifact.mjs', import.meta.url).href
let dir = '', bundle = '', digest = ''
const files: Record<string, Buffer> = {}
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mdsc-delivery-'))
  const source = join(dir, 'source')
  bundle = join(dir, 'bundle')
  await cp(new URL('../scoreboard', import.meta.url), source, { recursive: true })
  for (const name of ['README.md', 'datapackage.json', 'latest.csv', 'latest.json']) files[name] = await readFile(join(source, name))
  const artifact = await import(artifactUrl) as { pack(a: string, b: string, c: typeof env): Promise<{ payloadSha256: string }> }
  digest = (await artifact.pack(source, bundle, env)).payloadSha256
})
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })
const gitBlob = (data: Buffer) => createHash('sha1').update(Buffer.from('blob ' + data.length + '\0')).update(data).digest('hex')
function server(options: { noChange?: boolean; noBot?: boolean; leaseFail?: boolean; advance?: boolean; initialMain?: string; createPrFail?: boolean } = {}) {
  const state = { main: options.initialMain ?? SHA, bot: options.noBot ? null : 'b'.repeat(40),
    calls: [] as Array<{ method: string; path: string; body?: Body }>, branchWrites: 0, prCreated: false }
  const request: Request = async (method, path, body) => {
    state.calls.push({ method, path, body })
    const prefix = '/repos/pacocartones/market-data-sanity-checker/'
    if (method === 'GET' && path === prefix + 'git/ref/heads/main') return { object: { sha: state.main } }
    if (method === 'GET' && path === prefix + 'git/ref/heads/bot/scoreboard') return state.bot ? { object: { sha: state.bot } } : null
    if (method === 'GET' && path === prefix.slice(0, -1)) return { node_id: 'R_synthetic' }
    if (method === 'GET' && path === prefix + 'git/commits/' + SHA) return { tree: { sha: TREE } }
    if (method === 'GET' && path === prefix + 'git/trees/' + TREE + '?recursive=1') return {
      truncated: false, tree: Object.entries(files).map(([name, bytes]) => ({
        path: 'scoreboard/' + name, type: 'blob', mode: '100644', sha: options.noChange ? gitBlob(bytes) : '0'.repeat(40),
      })),
    }
    if (method === 'GET' && path === '/users/scoreboard-test%5Bbot%5D') return { login: 'scoreboard-test[bot]', id: 4321 }
    if (method === 'POST' && path === prefix + 'git/blobs') return { sha: gitBlob(Buffer.from(String(body?.content), 'base64')) }
    if (method === 'POST' && path === prefix + 'git/trees') {
      expect(body?.base_tree).toBe(TREE)
      const tree = body?.tree as Array<{ path: string; mode: string; type: string }>
      expect(tree.map(x => x.path).sort()).toEqual(['scoreboard/README.md','scoreboard/datapackage.json','scoreboard/latest.csv','scoreboard/latest.json'])
      expect(tree.every(x => x.mode === '100644' && x.type === 'blob')).toBe(true)
      return { sha: 'e'.repeat(40) }
    }
    if (method === 'POST' && path === prefix + 'git/commits') {
      expect(body?.parents).toEqual([SHA])
      expect(body?.author).toEqual({ name: 'scoreboard-test[bot]', email: '4321+scoreboard-test[bot]@users.noreply.github.com' })
      if (options.advance) state.main = 'f'.repeat(40)
      return { sha: COMMIT }
    }
    if (method === 'POST' && path === '/graphql') {
      const input = (body?.variables as { input: { repositoryId: string; refUpdates: Array<{ name: string; beforeOid: string; afterOid: string }> } }).input
      expect(input.repositoryId).toBe('R_synthetic')
      const update = input.refUpdates[0]!
      expect(update.name).toBe('refs/heads/bot/scoreboard')
      if (options.leaseFail) throw new Error('lease rejected')
      expect(update.beforeOid).toBe(state.bot)
      state.bot = update.afterOid; state.branchWrites++
      return { data: { updateRefs: { clientMutationId: 'scoreboard' } } }
    }
    if (method === 'POST' && path === prefix + 'git/refs') {
      expect(state.bot).toBeNull()
      expect(body).toEqual({ ref: 'refs/heads/bot/scoreboard', sha: COMMIT })
      state.bot = COMMIT; state.branchWrites++
      return { object: { sha: COMMIT } }
    }
    if (method === 'GET' && path.startsWith(prefix + 'pulls?')) return []
    if (method === 'POST' && path === prefix + 'pulls') {
      expect(body?.head).toBe('bot/scoreboard')
      expect(body?.base).toBe('main')
      if (options.createPrFail) throw new Error('PR creation rejected')
      state.prCreated = true
      return { html_url: 'https://github.com/pacocartones/market-data-sanity-checker/pull/999' }
    }
    throw new Error('Unexpected API call: ' + method + ' ' + path)
  }
  return { state, request }
}
async function module() { return await import(publisherUrl) as Publisher }
describe('scoreboard publication boundary', () => {
  it.each([false, true])('creates only four blobs, a main-based commit and a PR (new branch %s)', async noBot => {
    const { state, request } = server({ noBot })
    const result = await (await module()).publish(bundle, digest, env, request)
    expect(result).toMatchObject({ changed: true, commit: COMMIT, pr: 'https://github.com/pacocartones/market-data-sanity-checker/pull/999' })
    expect(state.bot).toBe(COMMIT)
    expect(state.branchWrites).toBe(1)
    expect(state.prCreated).toBe(true)
    expect(state.calls.filter(x => x.method === 'POST' && x.path.endsWith('/git/blobs'))).toHaveLength(4)
    expect(state.calls.some(x => x.path.includes('/workflows/') || x.path.endsWith('/merges'))).toBe(false)
  })
  it('skips commits, branch updates and PR creation when main already has the data', async () => {
    const { state, request } = server({ noChange: true })
    expect(await (await module()).publish(bundle, digest, env, request)).toEqual({ changed: false })
    expect(state.calls.filter(x => x.method !== 'GET')).toEqual([])
  })
  it('rejects missing App credentials without using the repository token', async () => {
    const { state, request } = server()
    await expect((await module()).publish(bundle, digest, { ...env, SCOREBOARD_APP_TOKEN: '', GH_TOKEN: 'synthetic-repo-token' }, request)).rejects.toThrow()
    expect(state.calls).toEqual([])
  })
  it('validates data before any API access', async () => {
    const { state, request } = server()
    await writeFile(join(bundle, 'extra.mjs'), 'throw new Error()')
    await expect((await module()).publish(bundle, digest, env, request)).rejects.toThrow()
    expect(state.calls).toEqual([])
  })
  it.each([false, true])('does not change a branch if main advanced (late %s)', async late => {
    const { state, request } = server(late ? { advance: true } : { initialMain: 'f'.repeat(40) })
    await expect((await module()).publish(bundle, digest, env, request)).rejects.toThrow()
    expect(state.branchWrites).toBe(0)
    expect(state.prCreated).toBe(false)
  })
  it('fails a stale branch lease without a blind-force fallback', async () => {
    const { state, request } = server({ leaseFail: true })
    await expect((await module()).publish(bundle, digest, env, request)).rejects.toThrow()
    expect(state.branchWrites).toBe(0)
    expect(state.calls.filter(x => x.method === 'POST' && x.path === '/graphql')).toHaveLength(1)
    expect(state.calls.some(x => x.method === 'PATCH')).toBe(false)
  })
  it('reports a PR error without merging or broadening credentials', async () => {
    const { state, request } = server({ createPrFail: true })
    await expect((await module()).publish(bundle, digest, env, request)).rejects.toThrow()
    // The data-only branch may have been updated before a PR API failure; it is not an atomic transaction.
    expect(state.branchWrites).toBe(1)
    expect(state.prCreated).toBe(false)
    expect(state.calls.some(x => x.path.endsWith('/merge'))).toBe(false)
  })
})

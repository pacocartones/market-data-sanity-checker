import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))
const script = join(root, 'scripts/check-automation-context.mjs')
const valid = {
  GITHUB_REPOSITORY: 'pacocartones/market-data-sanity-checker',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_SHA: 'a'.repeat(40),
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  DOCS_AUTOMATION_READY: 'true',
  SCOREBOARD_AUTOMATION_READY: 'true',
  SCOREBOARD_APP_CLIENT_ID: 'Iv1.synthetic',
}
function run(kind: string, override: Record<string, string> = {}) {
  try {
    return { code: 0, output: execFileSync(process.execPath, [script, kind], {
      env: { ...valid, ...override }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }) }
  } catch (error) {
    const failed = error as { status: number; stderr: string }
    return { code: failed.status, output: String(failed.stderr) }
  }
}
describe('automation context boundary', () => {
  it.each([['docs', 'push'], ['docs', 'workflow_dispatch'], ['scoreboard', 'schedule'], ['scoreboard', 'workflow_dispatch']])(
    'allows %s on main for %s after explicit activation', (kind, event) => {
      const result = run(kind, { GITHUB_EVENT_NAME: event })
      expect(result.code).toBe(0)
      expect(JSON.parse(result.output).sha).toBe(valid.GITHUB_SHA)
    },
  )
  it.each([
    ['docs', { DOCS_AUTOMATION_READY: '' }],
    ['docs', { DOCS_AUTOMATION_READY: 'false' }],
    ['scoreboard', { SCOREBOARD_AUTOMATION_READY: '' }],
    ['scoreboard', { SCOREBOARD_APP_CLIENT_ID: '' }],
    ['docs', { GITHUB_REPOSITORY: 'fork/market-data-sanity-checker' }],
    ['docs', { GITHUB_REF: 'refs/tags/main' }],
    ['docs', { GITHUB_REF: 'refs/heads/topic' }],
    ['docs', { GITHUB_SHA: 'not-a-sha' }],
    ['docs', { GITHUB_EVENT_NAME: 'pull_request' }],
    ['scoreboard', { GITHUB_EVENT_NAME: 'push' }],
  ] as Array<[string, Record<string, string>]>)('rejects %s context %o before effects', (kind, override) => {
    const result = run(kind, override)
    expect(result.code).toBe(1)
    expect(result.output).toContain('automation: rejected')
  })
})

describe('current main and credential routing', () => {
  it('rejects a main change before a privileged caller proceeds', async () => {
    const url = new URL('../scripts/check-automation-context.mjs', import.meta.url).href
    const api = await import(url) as {
      assertCurrentMain(context: { sha: string }, request: () => Promise<unknown>): Promise<void>
      githubRequest(token: string): (method: string, path: string) => Promise<unknown>
    }
    await expect(api.assertCurrentMain({ sha: valid.GITHUB_SHA }, async () => ({ object: { sha: valid.GITHUB_SHA } }))).resolves.toBeUndefined()
    await expect(api.assertCurrentMain({ sha: valid.GITHUB_SHA }, async () => ({ object: { sha: 'b'.repeat(40) } }))).rejects.toThrow('main advanced')
    expect(() => api.githubRequest('')).toThrow('missing credential')
    await expect(api.githubRequest('synthetic')('GET', 'https://example.test')).rejects.toThrow('API target')
    await expect(api.githubRequest('synthetic')('PATCH', '/repos/pacocartones/market-data-sanity-checker/git/refs/heads/main')).rejects.toThrow('API target')
  })
})

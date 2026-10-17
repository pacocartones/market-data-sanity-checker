// scripts/check-commit-policy.sh: the maintainer rules never fire on a contributor, whatever their
// name, and the branch rule never fires on a fork. Each case builds a throwaway repository.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(new URL('../scripts/check-commit-policy.sh', import.meta.url))
const NOREPLY = '253313177+pacocartones@users.noreply.github.com'
const OWN = 'pacocartones/market-data-sanity-checker'

interface Case {
  name: string
  email: string
  message?: string
  branch?: string
  headRepo?: string
}

function run({ name, email, message = 'change', branch, headRepo }: Case): number | null {
  const dir = mkdtempSync(join(tmpdir(), 'mdsc-commit-policy-'))
  try {
    const git = (args: string[], env: Record<string, string> = {}) =>
      execFileSync('git', args, { cwd: dir, env: { ...process.env, ...env }, encoding: 'utf8' }).trim()
    git(['init', '-q'])
    git(['-c', 'user.name=base', '-c', 'user.email=base@example.com', 'commit', '-q', '--allow-empty', '-m', 'base'])
    const base = git(['rev-parse', 'HEAD'])
    git(['commit', '-q', '--allow-empty', '-m', message], {
      GIT_AUTHOR_NAME: name,
      GIT_AUTHOR_EMAIL: email,
      GIT_COMMITTER_NAME: name,
      GIT_COMMITTER_EMAIL: email,
    })
    const env: Record<string, string | undefined> = {
      ...process.env,
      GITHUB_HEAD_REF: '',
      GITHUB_EVENT_PATH: '',
      GITHUB_REPOSITORY: OWN,
    }
    if (branch) {
      const event = join(dir, 'event.json')
      writeFileSync(event, JSON.stringify({ pull_request: { head: { repo: { full_name: headRepo } } } }))
      env.GITHUB_HEAD_REF = branch
      env.GITHUB_EVENT_PATH = event
    }
    return spawnSync('bash', [SCRIPT, base, 'HEAD'], { cwd: dir, env, encoding: 'utf8' }).status
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe.skipIf(process.platform === 'win32')('check-commit-policy.sh', () => {
  it('passes a maintainer commit with the noreply identity', () => {
    expect(run({ name: 'Paco Cartones', email: NOREPLY })).toBe(0)
  })

  it('fails a maintainer identity under a tool or agent name, or with a personal address', () => {
    expect(run({ name: 'agent:maintainer', email: NOREPLY })).toBe(1)
    expect(run({ name: 'paco', email: 'paco@hq.local' })).toBe(1)
    expect(run({ name: 'pacocartones', email: 'someone@example.com' })).toBe(1)
  })

  it('fails an AI trailer on a maintainer commit', () => {
    expect(
      run({ name: 'Paco Cartones', email: NOREPLY, message: 'change\n\nCo-Authored-By: Claude <noreply@anthropic.com>' }),
    ).toBe(1)
  })

  it('never checks a contributor, even one called Paco with their own address', () => {
    expect(run({ name: 'Paco', email: 'paco@example.com' })).toBe(0)
    expect(run({ name: 'Someone Else', email: 'someone@example.com' })).toBe(0)
  })

  it('checks the name of a branch of this repository, never a fork branch', () => {
    expect(run({ name: 'Paco Cartones', email: NOREPLY, branch: 'web/hero', headRepo: OWN })).toBe(1)
    expect(run({ name: 'Paco Cartones', email: NOREPLY, branch: 'feat/hero', headRepo: OWN })).toBe(0)
    expect(run({ name: 'Paco Cartones', email: NOREPLY, branch: 'gh-pages', headRepo: OWN })).toBe(0)
    expect(
      run({ name: 'Someone Else', email: 'someone@example.com', branch: 'web/hero', headRepo: 'someone/market-data-sanity-checker' }),
    ).toBe(0)
  })
})

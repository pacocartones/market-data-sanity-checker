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
  committerName?: string
  committerEmail?: string
  message?: string
  branch?: string
  headRepo?: string
  prAuthor?: string
  actor?: string
}

function run({ name, email, committerName = name, committerEmail = email, message = 'change', branch, headRepo, prAuthor = 'pacocartones', actor = 'pacocartones' }: Case): number | null {
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
      GIT_COMMITTER_NAME: committerName,
      GIT_COMMITTER_EMAIL: committerEmail,
    })
    const env: Record<string, string | undefined> = {
      ...process.env,
      GITHUB_ACTOR: actor,
      GITHUB_HEAD_REF: '',
      GITHUB_EVENT_PATH: '',
      GITHUB_REPOSITORY: OWN,
    }
    if (branch) {
      const event = join(dir, 'event.json')
      writeFileSync(event, JSON.stringify({ pull_request: { user: { login: prAuthor }, head: { repo: { full_name: headRepo } } } }))
      env.GITHUB_HEAD_REF = branch
      env.GITHUB_EVENT_PATH = event
    }
    const result = spawnSync('bash', [SCRIPT, base, 'HEAD'], { cwd: dir, env, encoding: 'utf8' })
    if (result.error) throw result.error
    return result.status
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

  // Observed heads of PRs #228, #230 and #232 on 2026-11-13.
  const securityBranches = [
    'codex-security/arp_b06980db192926d399661d7abb8f0352',
    'codex-security/arp_279198e0aa0e35849fb7165ca2e24d00',
    'codex-security/arp_d2a5c9ec03795d7469a6418266d2f390',
  ] as const
  const securityPr = { name: 'Paco Cartones', email: NOREPLY, branch: securityBranches[0], headRepo: OWN }

  for (const branch of securityBranches) {
    it(`accepts the generated Codex Security format: ${branch}`, () => {
      expect(run({ ...securityPr, branch })).toBe(0)
    })
  }

  it('rejects malformed or lookalike Codex Security branch names', () => {
    for (const branch of [
      'codex-security', 'codex-security/fix-network', 'codex-security/arp_',
      'codex-security/arp_b06980db192926d399661d7abb8f035',
      'codex-security/arp_b06980db192926d399661d7abb8f03520',
      'codex-security/arp_b06980db192926d399661d7abb8f035g',
      'codex-security/arp_B06980DB192926D399661D7ABB8F0352',
      `${securityBranches[0]}-fix`, `${securityBranches[0]}/fix`,
      `prefix/${securityBranches[0]}`,
    ]) expect(run({ ...securityPr, branch })).toBe(1)
  })

  it('does not use a PR author or workflow actor to bypass branch naming', () => {
    for (const actor of ['pacocartones', 'dependabot[bot]', 'codex-security']) {
      expect(run({ ...securityPr, branch: 'codex-security/fix-network', actor })).toBe(1)
      expect(run({ ...securityPr, branch: 'web/hero', prAuthor: 'dependabot[bot]', actor })).toBe(1)
    }
  })

  it('keeps maintainer author and committer identity checks on automation and fork PRs', () => {
    for (const headRepo of [OWN, 'someone/market-data-sanity-checker']) {
      const pr = { ...securityPr, headRepo }
      expect(run({ ...pr, name: 'agent:security' })).toBe(1)
      expect(run({ ...pr, email: 'paco@hq.local' })).toBe(1)
      expect(run({ ...pr, name: 'Someone Else', email: 'someone@example.com', committerName: 'agent:security', committerEmail: NOREPLY })).toBe(1)
    }
  })

  it('keeps maintainer attribution restrictions on automation and fork PRs', () => {
    for (const headRepo of [OWN, 'someone/market-data-sanity-checker']) {
      const pr = { ...securityPr, headRepo }
      expect(run({ ...pr, message: 'change\n\nCo-Authored-By: Claude <noreply@anthropic.com>' })).toBe(1)
      expect(run({ ...pr, name: 'Someone Else', email: 'someone@example.com', committerName: 'Paco Cartones', committerEmail: NOREPLY, message: 'Generated by Codex' })).toBe(1)
    }
  })

  it('keeps contributor fork names unrestricted', () => {
    for (const branch of ['Patch-1', 'codex-security/fix-network', securityBranches[0]]) {
      expect(run({ ...securityPr, branch, headRepo: 'someone/market-data-sanity-checker' })).toBe(0)
    }
  })

  it('preserves existing conventional and reserved branch formats', () => {
    for (const branch of ['gh-pages', 'changeset-release/main', 'bot/scoreboard', 'ci/policy', 'data/fixtures']) {
      expect(run({ ...securityPr, branch })).toBe(0)
    }
    for (const branch of ['main', 'security/network', 'fix/Network']) {
      expect(run({ ...securityPr, branch })).toBe(1)
    }
  })
})

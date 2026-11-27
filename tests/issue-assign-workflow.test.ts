// .github/workflows/issue-assign.yml: /take and /release on issue comments, with minimal
// permissions, and the "no claim" rule read from the issue type (plus the temporary label fallback).
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'yaml'
import { describe, expect, it } from 'vitest'

const path = fileURLToPath(new URL('../.github/workflows/issue-assign.yml', import.meta.url))
const document = parseDocument(readFileSync(path, 'utf8'), { uniqueKeys: true })
const workflow = document.toJS()
const step = workflow.jobs.assign.steps[0] as { env: Record<string, string>; run: string; uses?: string }

// The jq filter that decides "good first issue + Data: not assigned".
const filter = /jq -e --arg type "\$ISSUE_TYPE" '([^']+)'/.exec(step.run)?.[1]

function noClaim(labels: string[], type: string): boolean {
  if (!filter) throw new Error('decision filter not found')
  try {
    execFileSync('jq', ['-e', '--arg', 'type', type, filter], { input: JSON.stringify(labels), stdio: ['pipe', 'ignore', 'ignore'] })
    return true
  } catch {
    return false
  }
}

describe('issue-assign workflow contract', () => {
  it('runs on new issue comments only, with no default permissions', () => {
    expect(document.errors).toEqual([])
    expect(workflow.on).toEqual({ issue_comment: { types: ['created'] } })
    expect(workflow.permissions).toEqual({})
    expect(workflow.jobs.assign.permissions).toEqual({ issues: 'write' })
    expect(workflow.jobs.assign.if).toContain('!github.event.issue.pull_request')
  })

  it('checks out no code and passes event data only through env', () => {
    for (const s of workflow.jobs.assign.steps as Array<{ uses?: string; run?: string }>) {
      expect(s.uses).toBeUndefined()
      expect(s.run ?? '').not.toContain('${{')
    }
  })

  it('decides from the issue type, with the old data label as a temporary fallback', () => {
    expect(step.env.ISSUE_TYPE).toBe('${{ github.event.issue.type.name }}')
    expect(filter).toContain('$type == "Data"')
    expect(filter).toContain('index("data")')
    expect(step.run).toMatch(/Remove\s+# it once all open issues have types/)
  })

  it.skipIf(process.platform === 'win32')('refuses a claim only on good first issues of type Data', () => {
    expect(noClaim(['good first issue', 'help wanted'], 'Data')).toBe(true)
    expect(noClaim(['good first issue'], 'Task')).toBe(false)
    expect(noClaim(['good first issue'], '')).toBe(false)
    expect(noClaim(['help wanted'], 'Data')).toBe(false)
    expect(noClaim([], 'Data')).toBe(false)
    // Migration window: the old "data" label still counts as Data.
    expect(noClaim(['good first issue', 'data'], '')).toBe(true)
    expect(noClaim(['data'], '')).toBe(false)
  })
})

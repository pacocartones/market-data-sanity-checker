// .github/workflows/issue-assign.yml: /take and /release on issue comments, with minimal
// permissions; every issue is claimed the same way.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'yaml'
import { describe, expect, it } from 'vitest'

const path = fileURLToPath(new URL('../.github/workflows/issue-assign.yml', import.meta.url))
const document = parseDocument(readFileSync(path, 'utf8'), { uniqueKeys: true })
const workflow = document.toJS()
const step = workflow.jobs.assign.steps[0] as { env: Record<string, string>; run: string; uses?: string }

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

  it('claims every issue the same way: no exception by type or label', () => {
    expect(step.env.ISSUE_TYPE).toBeUndefined()
    expect(step.env.LABELS).toBeUndefined()
    expect(step.run).not.toContain('no need to claim')
    expect(step.run).toContain('--add-assignee "$AUTHOR"')
  })
})

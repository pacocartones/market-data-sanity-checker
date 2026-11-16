import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'yaml'
import { describe, expect, it } from 'vitest'

const path = fileURLToPath(new URL('../.github/workflows/docs.yml', import.meta.url))
const document = parseDocument(readFileSync(path, 'utf8'), { uniqueKeys: true })
const workflow = document.toJS()
describe('docs workflow security contract', () => {
  it('has unambiguous YAML and preserves manual/main', () => {
    expect(document.errors).toEqual([])
    expect(Object.keys(workflow.on)).toContain('workflow_dispatch')
    expect(workflow.on.workflow_dispatch?.inputs).toBeUndefined()
    expect(workflow.on.push.branches).toEqual(['main'])
  })
  it('gates privileged jobs on a read-only context check and pins checkouts', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(workflow.jobs.context.permissions).toEqual({ contents: 'read' })
    expect(workflow.jobs.context.if).toContain("github.ref == 'refs/heads/main'")
    expect(workflow.jobs.context.steps.some((step: { run?: string }) => step.run?.includes('check-automation-context.mjs docs --check-main'))).toBe(true)
    for (const [id, job] of Object.entries(workflow.jobs) as Array<[string, { needs?: string | string[]; if: string; steps: Array<{ uses?: string; with?: Record<string, unknown> }> }]>) {
      expect(job.if).toContain("github.repository == 'pacocartones/market-data-sanity-checker'")
      expect(job.if).toContain("github.ref == 'refs/heads/main'")
      if (id !== 'context') expect([job.needs].flat()).toContain('context')
      for (const step of job.steps.filter((step) => step.uses?.startsWith('actions/checkout@'))) {
        expect(step.with?.['persist-credentials']).toBe(false)
        expect(step.with?.ref).toBe('${{ github.sha }}')
      }
    }
  })
  it('keeps Pages authority in deploy and preserves coverage failure handling', () => {
    expect(workflow.jobs.build.permissions).toEqual({ contents: 'read' })
    expect(workflow.jobs.deploy.environment.name).toBe('github-pages')
    expect(workflow.jobs.deploy.permissions).toEqual({ contents: 'read', pages: 'write', 'id-token': 'write' })
    const coverage = workflow.jobs.build.steps.find((step: { id?: string }) => step.id === 'coverage')
    expect(coverage['continue-on-error']).toBe(true)
    const badge = workflow.jobs.build.steps.find((step: { run?: string }) => step.run?.includes('coverage:badge'))
    expect(badge.if).toContain("steps.coverage.outcome == 'success'")
    expect(badge.run).toContain('docs/api/coverage-badge.json')
  })
})

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'yaml'
import { describe, expect, it } from 'vitest'

const path = fileURLToPath(new URL('../.github/workflows/scoreboard.yml', import.meta.url))
const document = parseDocument(readFileSync(path, 'utf8'), { uniqueKeys: true })
const workflow = document.toJS()
describe('scoreboard workflow security contract', () => {
  it('has unambiguous YAML and preserves manual/main', () => {
    expect(document.errors).toEqual([])
    expect(Object.keys(workflow.on)).toContain('workflow_dispatch')
    expect(workflow.on.workflow_dispatch?.inputs).toBeUndefined()
    expect(workflow.on.schedule).toEqual([{ cron: '23 5 * * 1' }])
  })
  it('gates privileged jobs on a read-only context check and pins checkouts', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(workflow.jobs.context.permissions).toEqual({ contents: 'read' })
    expect(workflow.jobs.context.if).toContain("github.ref == 'refs/heads/main'")
    expect(workflow.jobs.context.steps.some((step: { run?: string }) => step.run?.includes('check-automation-context.mjs scoreboard --check-main'))).toBe(true)
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
  it('separates read-only calculation and App-only publication', () => {
    expect(workflow.concurrency['cancel-in-progress']).toBe(false)
    expect(workflow.jobs.produce.permissions).toEqual({ contents: 'read' })
    expect(workflow.jobs.produce.environment).toBe('scoreboard-data')
    expect(workflow.jobs.deliver.environment).toBe('scoreboard-delivery')
    expect(workflow.jobs.deliver.permissions).toEqual({ contents: 'read', actions: 'read' })
    const source = readFileSync(path, 'utf8')
    const calculate = workflow.jobs.produce.steps.find((step: { run?: string }) => step.run === 'pnpm scoreboard')
    expect(calculate.env.ALPHA_VANTAGE_DAILY_LIMIT).toBe('25')
    expect(calculate.env.ALPHA_VANTAGE_PREMIUM).toBe('false')
    expect(source).not.toContain('secrets.ALPHA_VANTAGE_API_KEY')
    expect(source).not.toContain('GH_PAT')
    expect(source).not.toContain('actions: write')
    expect(source).not.toContain('gh workflow run')
    const delivery = workflow.jobs.deliver.steps
    const validate = delivery.findIndex((step: { run?: string }) => step.run?.includes('scoreboard-artifact.mjs validate'))
    const mint = delivery.findIndex((step: { uses?: string }) => step.uses?.startsWith('actions/create-github-app-token@'))
    const publish = delivery.findIndex((step: { run?: string }) => step.run?.includes('publish-scoreboard.mjs'))
    expect(validate).toBeGreaterThanOrEqual(0)
    expect(mint).toBeGreaterThan(validate)
    expect(publish).toBeGreaterThan(mint)
    expect(delivery[mint].with['permission-contents']).toBe('write')
    expect(delivery[mint].with['permission-pull-requests']).toBe('write')
    const download = delivery.find((step: { uses?: string }) => step.uses?.startsWith('actions/download-artifact@'))
    expect(download.with['artifact-ids']).toBe('${{ needs.produce.outputs.artifact-id }}')
    expect(download.with['digest-mismatch']).toBe('error')
    expect(download.with['skip-decompress']).toBe(true)
    const metadata = delivery.findIndex((step: { run?: string }) => step.run?.includes('scoreboard-artifact.mjs check-artifact'))
    expect(metadata).toBeGreaterThanOrEqual(0)
    expect(delivery.indexOf(download)).toBeGreaterThan(metadata)
    expect(validate).toBeGreaterThan(delivery.indexOf(download))
    const upload = workflow.jobs.produce.steps.find((step: { uses?: string }) => step.uses?.startsWith('actions/upload-artifact@'))
    expect(upload.with.archive).toBe(false)
    expect(delivery.some((step: { run?: string }) => step.run?.includes('pnpm'))).toBe(false)
  })
})

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'yaml'
import { describe, expect, it } from 'vitest'

const path = fileURLToPath(new URL('../.github/workflows/calibration.yml', import.meta.url))
const source = readFileSync(path, 'utf8')
const document = parseDocument(source, { uniqueKeys: true })
const workflow = document.toJS()

type Step = { uses?: string; run?: string; env?: Record<string, string>; with?: Record<string, unknown> }

describe('calibration workflow security contract', () => {
  it('has unambiguous YAML and runs only by manual dispatch, without inputs', () => {
    expect(document.errors).toEqual([])
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch'])
    expect(workflow.on.workflow_dispatch).toBeNull()
  })

  it('grants nothing at the top level and contents: read to its single job', () => {
    expect(workflow.permissions).toEqual({})
    const jobs = Object.values(workflow.jobs) as Array<{ permissions: unknown; if: string; steps: Step[] }>
    expect(jobs).toHaveLength(1)
    const [job] = jobs
    expect(job!.permissions).toEqual({ contents: 'read' })
    expect(job!.if).toContain("github.repository == 'pacocartones/market-data-sanity-checker'")
    expect(job!.if).toContain("github.ref == 'refs/heads/main'")
    expect(job!.if).toContain("github.event_name == 'workflow_dispatch'")
  })

  it('pins every action by SHA and checks out without persisted credentials', () => {
    const steps = workflow.jobs['two-source'].steps as Step[]
    for (const step of steps.filter((entry) => entry.uses)) {
      expect(step.uses).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/)
    }
    const checkout = steps.find((step) => step.uses?.startsWith('actions/checkout@'))
    expect(checkout?.with?.['persist-credentials']).toBe(false)
    expect(checkout?.with?.ref).toBe('${{ github.sha }}')
  })

  it('passes the secret only to the calibration step, and uploads its output', () => {
    const steps = workflow.jobs['two-source'].steps as Step[]
    const withSecret = steps.filter((step) => JSON.stringify(step).includes('secrets.'))
    expect(withSecret).toHaveLength(1)
    expect(withSecret[0]!.run).toBe('pnpm calibrate --two-source')
    expect(withSecret[0]!.env?.ALPHA_VANTAGE_API_KEY).toBe('${{ secrets.SCOREBOARD_DATA_API_KEY }}')
    expect(withSecret[0]!.env?.ALPHA_VANTAGE_PREMIUM).toBe('false')
    expect(source.match(/secrets\./g)).toHaveLength(1)
    const upload = steps.find((step) => step.uses?.startsWith('actions/upload-artifact@'))
    expect(upload?.with?.name).toBe('calibration-two-source')
    expect(upload?.with?.path).toBe('calibration/two-source.json')
  })

  it('never writes to the repository', () => {
    for (const forbidden of ['git push', 'git commit', 'gh pr', 'gh release', 'gh workflow', 'contents: write', 'GH_TOKEN', 'github.token']) {
      expect(source).not.toContain(forbidden)
    }
  })
})

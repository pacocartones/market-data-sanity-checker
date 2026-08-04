import { describe, expect, it } from 'vitest'
import { computeSanityScore, summarize } from '../src/scoring/score'
import type { Finding } from '../src/report/types'

const finding = (severity: Finding['severity']): Finding => ({
  rule: 'TEST_RULE',
  severity,
  action: 'flag',
  dimension: 'validity',
  explanation: 'test',
})

describe('computeSanityScore', () => {
  it('is 100 with no findings', () => {
    expect(computeSanityScore([])).toBe(100)
  })

  it('subtracts penalties per severity', () => {
    expect(computeSanityScore([finding('critical')])).toBe(60)
    expect(computeSanityScore([finding('warning')])).toBe(85)
    expect(computeSanityScore([finding('info')])).toBe(95)
    expect(computeSanityScore([finding('critical'), finding('warning'), finding('info')])).toBe(40)
  })

  it('never goes below 0', () => {
    expect(computeSanityScore(Array(10).fill(finding('critical')))).toBe(0)
  })
})

describe('summarize', () => {
  it('counts findings per severity', () => {
    expect(summarize([finding('critical'), finding('critical'), finding('info')])).toEqual({
      critical: 2,
      warning: 0,
      info: 1,
    })
  })
})

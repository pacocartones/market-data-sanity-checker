import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BEGIN, END, escapePipes, parseIncident, readIncidents, renderTable, withTable } from '../scripts/incidents-index'

const GOOD = `---
case: "A short name"
source: "any"
reported_by: "@someone"
---

## What happened

One sentence.

## Evidence

[issue#1](https://example.com/1)

## A checker should report

\`RULE_ID\` with a reason.

## The check does NOT establish

What a pass leaves open.
`

describe('incident case files', () => {
  it('every file in incidents/ is well formed', () => {
    const { incidents, problems } = readIncidents('incidents')
    expect(problems).toEqual([])
    expect(incidents.length).toBeGreaterThan(0)
  })

  it('every case links public evidence and names who reported it', () => {
    const { incidents } = readIncidents('incidents')
    for (const i of incidents) {
      expect(i.sections.Evidence, i.file).toMatch(/https?:\/\//)
      expect(i.reportedBy, i.file).toMatch(/@\w/)
    }
  })

  it('a well formed file parses and a missing section is reported', () => {
    expect(parseIncident('a.md', GOOD).problems).toEqual([])
    const broken = GOOD.replace('## Evidence\n\n[issue#1](https://example.com/1)\n\n', '')
    expect(parseIncident('a.md', broken).problems.join(' ')).toContain('Evidence')
  })

  it('sections out of order, empty sections and bad front matter are reported', () => {
    const swapped = GOOD.replace('## What happened', '## X').replace('## Evidence', '## What happened').replace('## X', '## Evidence')
    expect(parseIncident('a.md', swapped).problems.length).toBeGreaterThan(0)
    expect(parseIncident('a.md', GOOD.replace('One sentence.', '')).problems.join(' ')).toContain('empty')
    expect(parseIncident('a.md', GOOD.replace('case: "A short name"', 'case: A short name')).problems.join(' ')).toContain('JSON string')
    expect(parseIncident('a.md', 'no front matter').problems.join(' ')).toContain('front matter')
  })

  it('the table has one row per file and escapes pipes inside a cell', () => {
    const parsed = parseIncident('a.md', GOOD.replace('One sentence.', 'a | b').replace('"A short name"', '"A | B"'))
    const table = renderTable([parsed.incident!])
    const rows = table.split('\n')
    expect(rows).toHaveLength(3)
    expect(rows[2]).toContain('a \\| b')
    expect(rows[2]).toContain('[A \\| B](incidents/a.md)')
  })

  it('a pipe is escaped, and a backslash right before it is doubled so it is not read as the escape', () => {
    expect(escapePipes('a | b')).toBe('a \\| b')
    expect(escapePipes('a \\| b')).toBe('a \\\\\\| b')
    expect(escapePipes('no pipe \\ here')).toBe('no pipe \\ here')
  })

  it('incidents.md carries the markers, and the table in it can be regenerated without changing anything else', () => {
    const doc = readFileSync('incidents.md', 'utf8')
    expect(doc).toContain(BEGIN)
    expect(doc).toContain(END)
    const { incidents } = readIncidents('incidents')
    const regenerated = withTable(doc, renderTable(incidents))
    expect(regenerated.slice(0, doc.indexOf(BEGIN))).toBe(doc.slice(0, doc.indexOf(BEGIN)))
    expect(regenerated.slice(regenerated.indexOf(END))).toBe(doc.slice(doc.indexOf(END)))
  })

  it('missing markers are an error, not a silent no-op', () => {
    expect(() => withTable('no markers here', 'x')).toThrow(/markers/)
  })
})

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildBadge, colorFor, linesPercent, run } from '../scripts/coverage-badge'

const summary = (pct: unknown) => ({ total: { lines: { pct }, statements: { pct: 1 }, branches: { pct: 2 }, functions: { pct: 3 } } })

describe('coverage badge', () => {
  it('colours at the documented boundaries: <60 red, <80 yellow, >=80 green', () => {
    expect(colorFor(0)).toBe('red')
    expect(colorFor(59.99)).toBe('red')
    expect(colorFor(60)).toBe('yellow')
    expect(colorFor(79.99)).toBe('yellow')
    expect(colorFor(80)).toBe('green')
    expect(colorFor(100)).toBe('green')
  })

  it('uses the lines percentage, not statements, branches or functions, and says so in the label', () => {
    expect(buildBadge(summary(87.5))).toEqual({
      schemaVersion: 1,
      label: 'coverage (lines)',
      message: '87%',
      color: 'green',
    })
  })

  it('rounds down so the badge never overstates, and colour agrees with the shown number', () => {
    expect(buildBadge(summary(79.99))).toMatchObject({ message: '79%', color: 'yellow' })
    expect(buildBadge(summary(59.5))).toMatchObject({ message: '59%', color: 'red' })
    expect(buildBadge(summary(80))).toMatchObject({ message: '80%', color: 'green' })
    expect(buildBadge(summary(100))).toMatchObject({ message: '100%', color: 'green' })
    expect(buildBadge(summary(0))).toMatchObject({ message: '0%', color: 'red' })
  })

  it.each([
    ['null', null],
    ['no total', {}],
    ['no lines', { total: {} }],
    ['"Unknown" (istanbul output when nothing was measured)', summary('Unknown')],
    ['NaN', summary(Number.NaN)],
    ['above 100', summary(100.1)],
    ['negative', summary(-1)],
  ])('rejects an unusable summary: %s', (_name, value) => {
    expect(() => linesPercent(value)).toThrow('total.lines.pct')
  })

  describe('command', () => {
    let dir: string
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'mdsc-cov-'))
      vi.spyOn(console, 'log').mockImplementation(() => {})
    })
    afterEach(() => {
      vi.restoreAllMocks()
      rmSync(dir, { recursive: true, force: true })
    })

    it('writes a Shields endpoint file (creating the folder) and exits 0', () => {
      const input = join(dir, 'summary.json')
      const output = join(dir, 'out', 'coverage-badge.json')
      writeFileSync(input, JSON.stringify(summary(91.2)))
      expect(run([input, output])).toBe(0)
      expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual({
        schemaVersion: 1,
        label: 'coverage (lines)',
        message: '91%',
        color: 'green',
      })
    })

    it('exits 1 with a clear message when the summary is missing, and writes nothing', () => {
      const lines: string[] = []
      const output = join(dir, 'badge.json')
      expect(run([join(dir, 'nope.json'), output], (l) => lines.push(l))).toBe(1)
      expect(lines.join('\n')).toContain('cannot build the badge')
      expect(lines.join('\n')).toContain('pnpm test:coverage')
      expect(() => readFileSync(output)).toThrow()
    })

    it('exits 1 on invalid JSON or an unusable summary, and writes nothing', () => {
      const input = join(dir, 'summary.json')
      const output = join(dir, 'badge.json')
      const lines: string[] = []
      writeFileSync(input, '{not json')
      expect(run([input, output], (l) => lines.push(l))).toBe(1)
      writeFileSync(input, JSON.stringify(summary('Unknown')))
      expect(run([input, output], (l) => lines.push(l))).toBe(1)
      expect(lines.join('\n')).toContain('total.lines.pct')
      expect(() => readFileSync(output)).toThrow()
    })

    it('exits 2 on too many arguments', () => {
      expect(run(['a', 'b', 'c'], () => {})).toBe(2)
    })
  })
})

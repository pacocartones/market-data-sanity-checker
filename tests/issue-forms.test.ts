// Every issue form sets a native issue type (standards v2), and every label it still sets
// exists in .github/labels.tsv.
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'yaml'
import { describe, expect, it } from 'vitest'

const dir = fileURLToPath(new URL('../.github/ISSUE_TEMPLATE/', import.meta.url))
const labelsFile = fileURLToPath(new URL('../.github/labels.tsv', import.meta.url))
const TYPES = ['Task', 'Bug', 'Feature', 'Docs', 'Data']

const labels = new Set(
  readFileSync(labelsFile, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('#'))
    .map((line) => line.split('\t')[0]),
)
const forms = readdirSync(dir).filter((file) => /\.ya?ml$/.test(file) && file !== 'config.yml')

describe('issue forms', () => {
  it('finds the forms and the labels', () => {
    expect(forms.length).toBeGreaterThanOrEqual(5)
    expect(labels.has('good first issue')).toBe(true)
  })

  for (const file of forms) {
    it(`${file} sets a valid type and only known labels`, () => {
      const document = parseDocument(readFileSync(`${dir}${file}`, 'utf8'), { uniqueKeys: true })
      expect(document.errors).toEqual([])
      const form = document.toJS() as { type?: unknown; labels?: unknown }
      expect(TYPES).toContain(form.type)
      const set = form.labels === undefined ? [] : form.labels
      expect(Array.isArray(set)).toBe(true)
      for (const label of set as unknown[]) expect(labels).toContain(label)
    })
  }
})

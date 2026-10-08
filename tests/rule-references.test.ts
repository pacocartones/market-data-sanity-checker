import { describe, expect, it } from 'vitest'
import { compareRegistry } from '../src/compare/registry'
import { registry } from '../src/rules/registry'

// Every rule says where it comes from: a documented incident or an
// authoritative source. The catalog is the product's claim ("rules tied to
// real failures"), so a rule without a reference fails here.
describe('rule references', () => {
  const all = [
    ...registry.map((rule) => ({ id: rule.meta.id, references: rule.meta.references })),
    ...compareRegistry.map((rule) => ({ id: rule.meta.id, references: rule.meta.references })),
  ]

  it('covers the whole catalog', () => {
    expect(all.length).toBe(36)
  })

  it.each(all)('$id cites at least one http(s) reference', ({ references }) => {
    expect(references.length).toBeGreaterThan(0)
    for (const reference of references) expect(reference).toMatch(/^https?:\/\//)
  })
})

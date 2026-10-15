import { describe, expect, it } from 'vitest'
import {
  buildReleaseNotes,
  changelogSection,
  checkReleaseNotes,
  contributors,
  firstSentence,
  normalizeEntry,
  parseGithubNotes,
} from '../scripts/release-notes'

const CHANGELOG = `# market-data-sanity-checker

## 2.0.0

### Major Changes

- abc1234: The \`check\` command now exits 3 on a structural error. Scripts that matched exit 2 must update.

### Minor Changes

- def5678: New rule \`FOO\` reports bars that foo. Thanks @alice and @bob-2.

### Patch Changes

- 0a1b2c3: Fix the bar. Credit to @carol.
  A second line of the same entry.

## 1.9.0

### Patch Changes

- 1111111: Older entry.
`

describe('release notes', () => {
  it('extracts one version section and fails on a missing one', () => {
    expect(changelogSection(CHANGELOG, '1.9.0')).toBe('### Patch Changes\n\n- 1111111: Older entry.')
    expect(() => changelogSection(CHANGELOG, '3.0.0')).toThrow('no "## 3.0.0" section')
  })

  it('takes the first sentence without markdown emphasis', () => {
    expect(firstSentence('**New:** rule `FOO` is here. More text.')).toBe('New: rule `FOO` is here')
    expect(firstSentence('No full stop')).toBe('No full stop')
  })

  it('collects thanked and credited handles once, in order', () => {
    expect(contributors(['Thanks @alice and @bob-2.', 'Credit to @carol. thanks @alice'])).toEqual(['@alice', '@bob-2', '@carol'])
  })

  it('builds the title and the house-format body', () => {
    const notes = buildReleaseNotes(CHANGELOG, '2.0.0')
    expect(notes.title).toBe('v2.0.0 — The `check` command now exits 3 on a structural error')
    expect(notes.body).toContain('Also 2 more changes, listed below.')
    expect(notes.body).not.toContain('No breaking changes.')
    expect(notes.body.indexOf('### Breaking changes and upgrade')).toBeLessThan(notes.body.indexOf('### Added'))
    expect(notes.body.indexOf('### Added')).toBeLessThan(notes.body.indexOf('### Changed and fixed'))
    expect(notes.body).toContain('- Fix the bar. Credit to @carol.\n  A second line of the same entry.')
    expect(notes.body).not.toMatch(/abc1234|def5678/)
    expect(notes.body).toContain('Thank you @alice, @bob-2, @carol.')
    expect(notes.body).toContain('npm view market-data-sanity-checker@2.0.0 dist.attestations')
    expect(checkReleaseNotes(notes.body, notes.title)).toEqual([])
  })

  it('says there are no breaking changes when there is no major entry', () => {
    const notes = buildReleaseNotes(CHANGELOG, '1.9.0')
    expect(notes.body).toContain('No breaking changes.')
    expect(notes.body).not.toContain('### Contributors')
    expect(notes.title).toBe('v1.9.0 — Older entry')
  })

  it('shortens a long title at a word boundary', () => {
    const long = `## 1.0.0\n\n### Patch Changes\n\n- 1234567: ${'word '.repeat(40)}end.\n`
    const { title } = buildReleaseNotes(long, '1.0.0')
    expect(title.length).toBeLessThanOrEqual(90)
    expect(title.endsWith('…')).toBe(true)
  })

  it.each([
    ['### Added\n\n- x\n\n### Verify\n', 'no summary paragraph'],
    ['Summary.\n\n### Added\n\n- x\n', 'no "### Verify" section'],
    ['Summary, thanks @dan.\n\n### Verify\n', 'no "### Contributors" section'],
    ['Summary.\n\nGenerated with Claude Code\n\n### Verify\n', 'AI attribution'],
  ])('flags a body that breaks the format: %j', (body, problem) => {
    expect(checkReleaseNotes(body).join('\n')).toContain(problem)
  })

  it('flags a title without the version and summary', () => {
    expect(checkReleaseNotes('Summary.\n\n### Verify\n', 'v1.5.1')).toEqual(['title is not "vX.Y.Z — <summary>"'])
    expect(checkReleaseNotes('Summary.\n\n### Verify\n', 'v1.6.0-rc.1 — Release candidate')).toEqual([])
  })
})

describe('entries written by @changesets/changelog-github', () => {
  const GH = `# market-data-sanity-checker

## 3.0.0

### Minor Changes

- [#112](https://github.com/o/r/pull/112) [\`abc1234\`](https://github.com/o/r/commit/abc1234) Thanks [@alice](https://github.com/alice)! - New rule \`FOO\` reports bars that foo.

### Patch Changes

- [\`def5678\`](https://github.com/o/r/commit/def5678) Thanks [@pacocartones](https://github.com/pacocartones)! - Fix the bar.
`

  it('moves the links to the end and keeps a plain "Thanks @user."', () => {
    const entry = '[#112](https://github.com/o/r/pull/112) [`abc1234`](https://github.com/o/r/commit/abc1234) Thanks [@alice](https://github.com/alice)! - New rule `FOO` reports bars that foo.'
    expect(normalizeEntry(entry)).toBe('New rule `FOO` reports bars that foo. ([#112](https://github.com/o/r/pull/112)) Thanks @alice.')
  })

  it('leaves other entries untouched', () => {
    expect(normalizeEntry('Plain entry. Thanks @bob.')).toBe('Plain entry. Thanks @bob.')
    expect(normalizeEntry('- starts with a dash? no, it is the body')).toBe('- starts with a dash? no, it is the body')
  })

  it('builds notes with the right lead and contributors, and does not thank maintainers', () => {
    const notes = buildReleaseNotes(GH, '3.0.0')
    expect(notes.title).toBe('v3.0.0 — New rule `FOO` reports bars that foo')
    expect(notes.body).toContain('### Contributors\n\nThank you @alice.')
    expect(notes.body).not.toContain('@pacocartones')
    expect(checkReleaseNotes(notes.body, notes.title)).toEqual([])
  })
})

describe('GitHub generate-notes sections', () => {
  const GENERATED = `## What's Changed
* docs(readme): pin the Action example to the v1.6.0 commit by @pacocartones in https://github.com/o/r/pull/121
* docs(readme): document gating and HTML flags on mdsc compare (#128) by @Enard52 in https://github.com/o/r/pull/134
* feat(cli): rules <ID> prints a single rule by @eddyflores100-lang in https://github.com/o/r/pull/112
* chore(deps): bump x from 1 to 2 by @dependabot[bot] in https://github.com/o/r/pull/117
* Version Packages by @github-actions[bot] in https://github.com/o/r/pull/147

## New Contributors
* @eddyflores100-lang made their first contribution in https://github.com/o/r/pull/112

**Full Changelog**: https://github.com/o/r/compare/v1.6.0...v1.7.0
`

  it('keeps the pull requests of people, not bots, maintainers or the version PR', () => {
    const g = parseGithubNotes(GENERATED)
    expect(g.merged.map((p) => p.number)).toEqual([134, 112])
    expect(g.firstTimers).toEqual([{ author: 'eddyflores100-lang', number: 112 }])
  })

  it('credits PRs without a changeset and names first-time contributors', () => {
    const notes = buildReleaseNotes(CHANGELOG, '2.0.0', parseGithubNotes(GENERATED))
    expect(notes.body).toContain('### Also merged')
    expect(notes.body).toContain('- docs(readme): document gating and HTML flags on mdsc compare (#128) (#134) by @Enard52')
    expect(notes.body).toMatch(/### Contributors\n\nThank you [^\n]*@Enard52[^\n]*@eddyflores100-lang/)
    expect(notes.body).toContain('### New Contributors\n\n- @eddyflores100-lang made their first contribution in #112')
    expect(checkReleaseNotes(notes.body, notes.title)).toEqual([])
  })

  it('does not change the notes when there is no GitHub body', () => {
    expect(buildReleaseNotes(CHANGELOG, '2.0.0').body).not.toContain('Also merged')
  })
})

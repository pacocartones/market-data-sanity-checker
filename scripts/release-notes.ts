/**
 * Release notes in the house format, built from the version's CHANGELOG.md section
 * (written by changesets), and a check that a release body follows that format.
 *
 *   tsx scripts/release-notes.ts build <version> [--github-notes <file>]   → JSON { title, body } on stdout
 *     (the optional file is GitHub's generate-notes body; it adds "Also merged" and "New Contributors")
 *   tsx scripts/release-notes.ts check <file>      → exit 1 and one line per problem
 *
 * Format: "vX.Y.Z — <summary>" as the title; the body opens with a one-paragraph
 * summary, then Breaking changes and upgrade / Added / Changed and fixed (only those
 * present), Contributors when an entry thanks someone, and Verify.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PACKAGE = 'market-data-sanity-checker'
const TITLE_MAX = 90

const HEADINGS: Record<string, string> = {
  'Major Changes': 'Breaking changes and upgrade',
  'Minor Changes': 'Added',
  'Patch Changes': 'Changed and fixed',
}

/** AI-attribution phrases that must never reach a release (title, body or changelog). */
const AI_ATTRIBUTION = /generated (with|by) (claude|chatgpt|copilot|an? ai)|co-authored-by:\s*(claude|gpt|copilot)|🤖/i

export interface ReleaseNotes {
  title: string
  body: string
}

/** The `## <version>` section of a changesets CHANGELOG, without its heading. */
export function changelogSection(changelog: string, version: string): string {
  const lines = changelog.split('\n')
  const start = lines.findIndex((line) => line.trim() === `## ${version}`)
  if (start === -1) throw new Error(`CHANGELOG.md has no "## ${version}" section`)
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => line.startsWith('## '))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim()
}

/** Maintainers are not thanked in the notes (the plugin thanks the author of every changeset PR). */
const MAINTAINERS = new Set(['pacocartones', 'leonmag'])

/**
 * Entries written by @changesets/changelog-github look like
 *   [#112](url) [`abc1234`](url) Thanks [@user](url)! - Summary.
 * Turn them into "Summary. ([#112](url)) Thanks @user." so the first sentence,
 * the title and the contributors list keep working. Entries in any other shape
 * pass through unchanged.
 */
export function normalizeEntry(entry: string): string {
  const m = /^((?:\[[^\]]+\]\([^)]*\) ?)*)(?:Thanks ((?:\[@[^\]]+\]\([^)]*\)(?:, )?)+)! )?- ([\s\S]*)$/.exec(entry)
  if (!m || (!m[1] && !m[2])) return entry
  const pr = /\[#\d+\]\([^)]*\)/.exec(m[1] ?? '')?.[0]
  const handles = [...(m[2] ?? '').matchAll(/\[@([A-Za-z0-9-]+)\]/g)]
    .map((h) => h[1]!)
    .filter((h) => !MAINTAINERS.has(h.toLowerCase()))
  let out = m[3]!.trimEnd()
  if (pr) out += ` (${pr})`
  if (handles.length > 0) out += ` Thanks ${handles.map((h) => `@${h}`).join(', ')}.`
  return out
}

/** Changeset entries grouped by their `### ... Changes` heading, commit prefixes removed. */
function entriesByHeading(section: string): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  let heading = ''
  for (const line of section.split('\n')) {
    const h = /^### (.+)$/.exec(line)
    if (h) {
      heading = h[1]!.trim()
      groups.set(heading, [])
      continue
    }
    if (!heading) continue
    const entries = groups.get(heading)!
    if (line.startsWith('- ')) entries.push(line.slice(2).replace(/^[0-9a-f]{7,40}: /, ''))
    else if (entries.length > 0) entries[entries.length - 1] += `\n${line}`
  }
  for (const [key, entries] of groups) groups.set(key, entries.map((entry) => normalizeEntry(entry.trimEnd())))
  return groups
}

/** First sentence of an entry, as plain text, for the title and the summary. */
export function firstSentence(entry: string): string {
  const flat = entry.split('\n')[0]!.replace(/\*\*/g, '').trim()
  const match = /^(.+?[.!?])(\s|$)/.exec(flat)
  return (match ? match[1]! : flat).replace(/[.!?]$/, '')
}

function shorten(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  return `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : cut.length)}…`
}

/** GitHub handles thanked or credited in the entries, in order of appearance. */
export function contributors(entries: string[]): string[] {
  const seen = new Set<string>()
  for (const entry of entries) {
    for (const m of entry.matchAll(/(?:thanks?|credit(?:s|ed)?(?: to)?)\s+((?:@[A-Za-z0-9-]+(?:,?\s*(?:and\s+)?)?)+)/gi)) {
      for (const handle of m[1]!.match(/@[A-Za-z0-9-]+/g) ?? []) seen.add(handle)
    }
  }
  return [...seen]
}

export interface GithubNotes {
  /** Merged pull requests by people (not bots, not maintainers), without "Version Packages". */
  merged: { title: string; author: string; number: number }[]
  /** People whose first contribution is in this release. */
  firstTimers: { author: string; number: number }[]
}

/**
 * Reads the body printed by GitHub's generate-notes API ("What's Changed" and
 * "New Contributors" lists) and keeps what is needed to credit everyone, also
 * the pull requests that have no changeset (docs, tests, fixtures).
 */
export function parseGithubNotes(body: string): GithubNotes {
  const merged: GithubNotes['merged'] = []
  const firstTimers: GithubNotes['firstTimers'] = []
  for (const line of body.split('\n')) {
    const pr = /^\* (.+) by @([A-Za-z0-9-]+(?:\[bot\])?) in \S+\/pull\/(\d+)\s*$/.exec(line)
    if (pr) {
      const [, title, author, number] = pr
      if (author!.endsWith('[bot]') || MAINTAINERS.has(author!.toLowerCase()) || /^Version Packages$/i.test(title!)) continue
      merged.push({ title: title!, author: author!, number: Number(number) })
      continue
    }
    const first = /^\* @([A-Za-z0-9-]+) made their first contribution in \S+\/pull\/(\d+)\s*$/.exec(line)
    if (first && !MAINTAINERS.has(first[1]!.toLowerCase())) firstTimers.push({ author: first[1]!, number: Number(first[2]) })
  }
  return { merged, firstTimers }
}

export function buildReleaseNotes(changelog: string, version: string, github?: GithubNotes): ReleaseNotes {
  const groups = entriesByHeading(changelogSection(changelog, version))
  const ordered = ['Major Changes', 'Minor Changes', 'Patch Changes'].filter((h) => (groups.get(h) ?? []).length > 0)
  if (ordered.length === 0) throw new Error(`the ${version} section has no changeset entries`)
  const all = ordered.flatMap((h) => groups.get(h)!)
  const lead = firstSentence(all[0]!)

  const parts: string[] = []
  const more = all.length - 1
  parts.push(`${lead}.${more > 0 ? ` Also ${more} more change${more === 1 ? '' : 's'}, listed below.` : ''}`)
  if (!groups.get('Major Changes')?.length) parts.push('No breaking changes.')
  for (const heading of ordered) {
    parts.push(`### ${HEADINGS[heading]}\n\n${groups.get(heading)!.map((entry) => `- ${entry}`).join('\n')}`)
  }
  if (github && github.merged.length > 0) {
    parts.push(`### Also merged\n\n${github.merged.map((p) => `- ${p.title} (#${p.number}) by @${p.author}`).join('\n')}`)
  }
  const people = [...new Set([...contributors(all), ...(github?.merged ?? []).map((p) => `@${p.author}`)])]
  if (people.length > 0) parts.push(`### Contributors\n\nThank you ${people.join(', ')}.`)
  if (github && github.firstTimers.length > 0) {
    parts.push(`### New Contributors\n\n${github.firstTimers.map((p) => `- @${p.author} made their first contribution in #${p.number}`).join('\n')}`)
  }
  parts.push(
    [
      '### Verify',
      '',
      'Releases published from CI carry npm provenance (trusted publishing). To check this one:',
      '',
      '```bash',
      `npm view ${PACKAGE}@${version} dist.attestations`,
      `npm install ${PACKAGE}@${version} && npm audit signatures`,
      '```',
    ].join('\n'),
  )

  return { title: shorten(`v${version} — ${lead}`, TITLE_MAX), body: `${parts.join('\n\n')}\n` }
}

/** Problems with a release body that claims the house format; empty when it complies. */
export function checkReleaseNotes(body: string, title?: string): string[] {
  const problems: string[] = []
  const firstHeading = body.search(/^### /m)
  const summary = (firstHeading === -1 ? body : body.slice(0, firstHeading)).trim()
  if (summary.length === 0) problems.push('no summary paragraph before the first ### section')
  if (!/^### Verify$/m.test(body)) problems.push('no "### Verify" section')
  if (/thanks? @/i.test(body) && !/^### Contributors$/m.test(body)) problems.push('an entry thanks someone but there is no "### Contributors" section')
  if (AI_ATTRIBUTION.test(body) || (title !== undefined && AI_ATTRIBUTION.test(title))) problems.push('AI attribution in the release')
  if (title !== undefined && !/^v\d+\.\d+\.\d+(-[0-9A-Za-z.]+)? — \S/.test(title)) problems.push('title is not "vX.Y.Z — <summary>"')
  return problems
}

function main(argv: string[]): number {
  const [command, arg, ...rest] = argv
  if (command === 'build' && arg) {
    const ghIndex = rest.indexOf('--github-notes')
    const github = ghIndex !== -1 && rest[ghIndex + 1] ? parseGithubNotes(readFileSync(rest[ghIndex + 1]!, 'utf8')) : undefined
    const notes = buildReleaseNotes(readFileSync('CHANGELOG.md', 'utf8'), arg.replace(/^v/, ''), github)
    process.stdout.write(`${JSON.stringify(notes, null, 2)}\n`)
    return 0
  }
  if (command === 'check' && arg) {
    const titleIndex = rest.indexOf('--title')
    const title = titleIndex === -1 ? undefined : rest[titleIndex + 1]
    const problems = checkReleaseNotes(readFileSync(arg, 'utf8'), title)
    for (const problem of problems) console.error(`release-notes: ${problem}`)
    return problems.length === 0 ? 0 : 1
  }
  console.error('usage: release-notes.ts build <version> | check <file> [--title "<title>"]')
  return 2
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2))
}

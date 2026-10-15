#!/usr/bin/env node
/* global process, console */
// Builds CONTRIBUTORS.md from the merged pull requests of this repository.
// No services, no dependencies: it reads the JSON that `gh` prints.
//
//   gh pr list --state merged --limit 1000 --json number,title,author,mergedAt > /tmp/merged.json
//   node scripts/contributors.mjs /tmp/merged.json > CONTRIBUTORS.md
//
// Maintainers, bots and apps are left out (see EXCLUDE). Only public GitHub handles
// are listed, never emails or real names. Counts are merged pull requests.
import { readFileSync } from 'node:fs';

const EXCLUDE = new Set(['pacocartones', 'LeonMAG']);
const isBot = (login) => login.startsWith('app/') || login.endsWith('[bot]');

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/contributors.mjs merged.json'); process.exit(2); }
const prs = JSON.parse(readFileSync(file, 'utf8'));

const people = new Map();
for (const pr of prs) {
  const login = pr.author?.login;
  if (!login || isBot(login) || EXCLUDE.has(login)) continue;
  const p = people.get(login) ?? { login, prs: [], first: pr.mergedAt };
  p.prs.push(pr.number);
  if (pr.mergedAt < p.first) p.first = pr.mergedAt;
  people.set(login, p);
}

const repo = process.env.GITHUB_REPOSITORY || process.argv[3] || '';
const link = (n) => (repo ? `[#${n}](https://github.com/${repo}/pull/${n})` : `#${n}`);
const rows = [...people.values()].sort((a, b) => (a.first < b.first ? -1 : a.first > b.first ? 1 : a.login.localeCompare(b.login)));

const out = [];
out.push('# Contributors', '');
out.push('Thank you to everyone whose pull request was merged here. This list is generated from the merged pull requests (`scripts/contributors.mjs`), so it only contains what is in the history; it is ordered by first merged contribution.', '');
out.push('| Contributor | Merged PRs | First merged |', '|---|---|---|');
for (const p of rows) {
  const nums = p.prs.sort((a, b) => a - b);
  const shown = nums.slice(0, 6).map(link).join(', ') + (nums.length > 6 ? `, and ${nums.length - 6} more` : '');
  out.push(`| [@${p.login}](https://github.com/${p.login}) | ${nums.length}: ${shown} | ${p.first.slice(0, 10)} |`);
}
out.push('', 'Issues, reviews, ideas and bug reports count too; they are not in this table because they are not in the git history. If you contributed that way and want to be named, open an issue.', '');
process.stdout.write(out.join('\n'));

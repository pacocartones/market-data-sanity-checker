// Keep CITATION.cff in step with a version bump, and nothing else.
//
// Run by `pnpm version-packages` right after `changeset version` (and the package-floor
// fixture sync), so the bump and the citation land in the same reviewed "Version Packages"
// commit. It sets `version:` to package.json's version and `date-released:` to the current
// UTC date, and leaves every other byte of the file as it is. When the citation already
// names the current version it changes nothing, so a re-run never moves the release date.
//
// Usage: node scripts/sync-citation-version.mjs [REPOSITORY_ROOT]
import assert from 'node:assert/strict';
import process from 'node:process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function replaceField(text, field, value) {
  const pattern = new RegExp(`^${field}: .*$`, 'gm');
  const matches = text.match(pattern) ?? [];
  assert.equal(matches.length, 1, `CITATION.cff must have exactly one top-level "${field}:" line`);
  return text.replace(pattern, `${field}: ${value}`);
}

/** Returns the CITATION.cff text with only `version:` and `date-released:` set. */
export function syncCitation(text, version, date) {
  assert.match(version, VERSION, 'package.json has no usable version');
  assert.match(date, DATE, 'The release date must be YYYY-MM-DD');
  const current = text.match(/^version: (.*)$/m)?.[1];
  if (current === version) return text;
  return replaceField(replaceField(text, 'version', version), 'date-released', date);
}

function main() {
  const root = resolve(process.argv[2] ?? '.');
  const path = resolve(root, 'CITATION.cff');
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'market-data-sanity-checker', 'Run from the repository root');
  const text = readFileSync(path, 'utf8');
  const next = syncCitation(text, pkg.version, new Date().toISOString().slice(0, 10));
  if (next === text) {
    process.stdout.write(`CITATION.cff already at ${pkg.version}\n`);
    return;
  }
  writeFileSync(path, next);
  process.stdout.write(`CITATION.cff: version ${pkg.version}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

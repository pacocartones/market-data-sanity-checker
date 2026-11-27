// Keep the package-floor consumer lock in step with a version bump, and nothing else.
//
// Run by the release workflow right after `changeset version`, so the bump and the fixture
// land in the same reviewed "Version Packages" commit. It sets only the `version` of the
// package's own `file:` entry to package.json's version. Anything else that would have to
// change (dependency ranges, bin targets, engines, platform constraints, the registry pins)
// still needs the manual procedure in .github/fixtures/package-floor/README.md, so the script
// refuses instead of touching the lock.
//
// Usage: node scripts/sync-floor-fixture-version.mjs [REPOSITORY_ROOT]
import assert from 'node:assert/strict';
import process from 'node:process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '.');
const lockPath = resolve(root, '.github/fixtures/package-floor/package-lock.json');
const name = 'market-data-sanity-checker';
const key = `node_modules/${name}`;

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const text = readFileSync(lockPath, 'utf8');
const lock = JSON.parse(text);
const serialize = (value) => JSON.stringify(value, null, 2) + '\n';
const manual = 'update and review the consumer fixture by hand (.github/fixtures/package-floor/README.md)';

assert.equal(pkg.name, name, 'Run from the repository root');
assert.match(pkg.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'package.json has no usable version');
assert.equal(serialize(lock), text, 'The consumer lock is not in npm\'s formatting: ' + manual);
assert.equal(lock.lockfileVersion, 3, 'Expected the reviewed npm consumer lock');
const entry = lock.packages?.[key];
assert.ok(entry, `The consumer lock has no ${key} entry`);
assert.equal(entry.resolved, `file:${name}.tgz`, 'The own-package entry must stay a file: tarball');
assert.equal(entry.integrity, 'SAME_RUN_TARBALL_SHA512', 'The own-package integrity must stay the template marker');

// The same fields scripts/package-floor-lock.mjs compares against the packed package.json.
for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta',
  'bundleDependencies', 'bundledDependencies', 'os', 'cpu', 'libc', 'engines']) {
  assert.deepEqual(entry[field], pkg[field], `package.json ${field} changed: ${manual}`);
}
const normalizeBin = (bin) => Object.fromEntries(
  Object.entries(bin ?? {}).map(([command, path]) => [command, path.replace(/^\.\//, '')]),
);
assert.deepEqual(normalizeBin(entry.bin), normalizeBin(pkg.bin), `package.json bin changed: ${manual}`);

if (entry.version === pkg.version) {
  process.stdout.write(`package-floor fixture already at ${name}@${pkg.version}\n`);
  process.exit(0);
}
const previous = entry.version;
entry.version = pkg.version;
const next = serialize(lock);

// Belt and braces: the rewrite may differ from the committed lock in that one value only.
const restored = JSON.parse(next);
restored.packages[key].version = previous;
assert.deepEqual(restored, JSON.parse(text), 'Syncing the version would change more than the own-package version');
const changed = next.split('\n').filter((line, index) => line !== text.split('\n')[index]);
assert.deepEqual(changed, [`      "version": "${pkg.version}",`], 'Syncing the version would change more than one line');

writeFileSync(lockPath, next);
process.stdout.write(`package-floor fixture: ${name} ${previous} -> ${pkg.version}\n`);

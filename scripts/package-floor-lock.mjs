// Bind only the locally built artifact; registry dependencies remain versioned in the fixture lock.
import assert from 'node:assert/strict';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const integrity = (file) => 'sha512-' + createHash('sha512').update(readFileSync(file)).digest('base64');
if (process.argv[2] === '--capture-runtime') {
  const [, , , input, tarball, output] = process.argv;
  const installed = JSON.parse(readFileSync(input, 'utf8'));
  assert.equal(installed.length, 1, 'Expected one frozen repository installation');
  const root = installed[0], dependencies = {};
  assert.equal(root.name, 'market-data-sanity-checker');
  assert.deepEqual(root.devDependencies ?? {}, {}, 'Capture must use --prod');
  assert.deepEqual(root.optionalDependencies ?? {}, {}, 'Optional runtime roots require fixture support');
  assert.ok(Object.keys(root.dependencies ?? {}).length, 'Missing installed runtime dependencies');
  for (const [name, dependency] of Object.entries(root.dependencies)) {
    assert.equal(dependency.from, name, 'Runtime aliases require fixture support');
    assert.match(dependency.version, /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
    assert.match(dependency.resolved, /^https:\/\/registry\.npmjs\.org\//);
    assert.deepEqual(dependency.dependencies ?? {}, {}, 'Transitive runtime dependencies require fixture support');
    assert.deepEqual(dependency.optionalDependencies ?? {}, {}, 'Transitive runtime dependencies require fixture support');
    dependencies[name] = { version: dependency.version, resolved: dependency.resolved };
  }
  writeFileSync(output, JSON.stringify({ schemaVersion: 1, name: root.name, version: root.version,
    tarballIntegrity: integrity(tarball), dependencies }, null, 2) + '\n');
  process.exit(0);
}

const directory = process.argv[2];
assert.ok(directory, 'Usage: node scripts/package-floor-lock.mjs CONSUMER_DIRECTORY');
const readJson = (file) => JSON.parse(readFileSync(resolve(directory, file), 'utf8'));
const manifest = readJson('package.json');
const lock = readJson('package-lock.json');
const packed = readJson('packed-package.json');
const name = 'market-data-sanity-checker';
const artifact = `${name}.tgz`;
const entry = lock.packages?.[`node_modules/${name}`];
assert.equal(lock.lockfileVersion, 3, 'Expected the reviewed npm consumer lock');
assert.deepEqual(manifest.dependencies, { [name]: `file:${artifact}` });
assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies);
assert.equal(packed.name, name);
assert.equal(entry?.resolved, `file:${artifact}`);
assert.equal(entry.integrity, 'SAME_RUN_TARBALL_SHA512', 'Copy a fresh fixture before binding');
for (const field of ['version', 'dependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta',
  'bundleDependencies', 'bundledDependencies', 'os', 'cpu', 'libc', 'engines']) {
  assert.deepEqual(packed[field], entry[field], `Packed ${field} changed: update and review the consumer fixture`);
}
// npm normalizes bin paths in its lock while tarball metadata retains './'.
const normalizeBin = (bin) => Object.fromEntries(
  Object.entries(bin).map(([name, path]) => [name, path.replace(/^\.\//, '')]),
);
assert.deepEqual(normalizeBin(packed.bin), normalizeBin(entry.bin), 'Packed bin targets changed');
for (const [dependency, version] of Object.entries(manifest.overrides ?? {})) {
  assert.equal(lock.packages[`node_modules/${dependency}`]?.version, version);
}
for (const [path, dependency] of Object.entries(lock.packages)) {
  if (path === '' || path === `node_modules/${name}`) continue;
  assert.match(dependency.resolved, /^https:\/\/registry\.npmjs\.org\//);
  assert.match(dependency.integrity, /^sha512-[A-Za-z0-9+/]+=*$/);
}
const runtime = readJson('runtime-dependencies.json');
assert.equal(runtime.schemaVersion, 1);
assert.equal(runtime.name, name);
assert.equal(runtime.version, packed.version);
const artifactIntegrity = integrity(resolve(directory, artifact));
assert.equal(runtime.tarballIntegrity, artifactIntegrity, 'Runtime manifest belongs to another tarball');
const pinned = Object.fromEntries(Object.entries(lock.packages)
  .filter(([path]) => path !== '' && path !== `node_modules/${name}`)
  .map(([path, dependency]) => [path.slice('node_modules/'.length),
    { version: dependency.version, resolved: dependency.resolved }]));
assert.deepEqual(runtime.dependencies, pinned, 'Resolved runtime versions drifted: update and review the consumer lock');
entry.integrity = artifactIntegrity;
writeFileSync(resolve(directory, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n');

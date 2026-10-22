#!/usr/bin/env node
// Waits until npm and PyPI serve the given packages at one version, the way
// an install reads them (lib/registry-served.mjs), and fails once the
// deadline passes, naming what is still not served. A lockstep release has
// one version; PyPI's is its PEP 440 form (1.0.0-beta.0 is 1.0.0b0).
//
// Run by the release's shell-driven publishes (e3-core's Windows job
// launcher, the east-c-cli launcher and its per-platform packages, the PyPI
// upload), whose jobs then end only once their registry serves what they
// published (#1399), and by the Docker image workflow before it builds
// against a release.
//
// Usage: wait-served.mjs --version <semver> [--npm <name>...] [--pypi <project>...]
//                        [--deadline <minutes>]
import { semverToPep440 } from './set-python-version.mjs';
import { DEFAULT_DEADLINE_MINUTES, describeTarget, waitUntilServed } from './lib/registry-served.mjs';

function usage(problem) {
  console.error(`${problem}\nUsage: wait-served.mjs --version <semver> [--npm <name>...] [--pypi <project>...] [--deadline <minutes>, ${DEFAULT_DEADLINE_MINUTES} unless given]`);
  process.exit(1);
}

let version = null;
let deadlineMinutes = DEFAULT_DEADLINE_MINUTES;
const npm = [];
const pypi = [];
let into = null;
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--version') {
    version = process.argv[++i] ?? usage('--version needs a semver');
    into = null;
  } else if (arg === '--deadline') {
    deadlineMinutes = Number(process.argv[++i]);
    if (!(deadlineMinutes > 0)) usage('--deadline needs a number of minutes');
    into = null;
  } else if (arg === '--npm') {
    into = npm;
  } else if (arg === '--pypi') {
    into = pypi;
  } else if (arg.startsWith('--') || into === null) {
    usage(`unexpected argument: ${arg}`);
  } else {
    into.push(arg);
  }
}
if (version === null) usage('--version is required');
if (npm.length + pypi.length === 0) usage('nothing to wait for: give --npm and/or --pypi');

const targets = [
  ...npm.map((name) => ({ registry: 'npm', name, version })),
  ...pypi.map((name) => ({ registry: 'pypi', name, version: semverToPep440(version) })),
];
console.log(`Waiting up to ${deadlineMinutes} min until the registries serve ${targets.length} package(s) at ${version}`);
const missing = await waitUntilServed(targets, { deadlineMs: deadlineMinutes * 60_000 });
for (const target of missing) {
  console.error(`::error::${describeTarget(target)} is not served ${deadlineMinutes} min after the wait began`);
}
process.exit(missing.length > 0 ? 1 : 0);

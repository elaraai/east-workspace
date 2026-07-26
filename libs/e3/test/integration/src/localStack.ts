/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A local stand-in for PyPI and npm, serving THIS tree's `@elaraai` build.
 *
 * ## Why this exists
 *
 * `environment-e2e.spec.ts` scaffolds a create-e3 project and locks it, as a
 * user would. But the scaffold pins `@elaraai/*` to `RELEASED_VERSION`, read
 * from the workspace `package.json` — and because the release workflow pushes
 * the version bump to `main`, that is always *the version already published*.
 * So the environment those tests materialize contained the **previous
 * release's** East runtime, and the suite quietly became a regression test for
 * the last release rather than for the code under review. Anything this repo
 * changes in the runtime — a wire format, a builtin — was invisible here until
 * a release had already shipped it.
 *
 * That inversion is not the contract the repo offers:
 * `libs/e3/design/e3-environment-granularity.md` records the stance as
 * "none — lockstep upgrade", i.e. an old reader is NOT expected to decode a
 * new SDK's bytes. Cross-version behaviour is asserted deliberately and
 * narrowly in `released-runtime-compat.spec.ts`; it does not belong here as an
 * accident of scaffolding.
 *
 * ## Why a registry rather than a path
 *
 * The environments under test are materialized by e3 with
 *
 *     uv sync --frozen --all-packages --no-install-workspace --no-install-local
 *
 * `--no-install-local` deliberately skips every path/editable/directory source,
 * because a materialized env must not depend on directories that exist only on
 * the machine that built it. A `[tool.uv.sources] { path, editable }` override
 * is therefore excluded from the env outright — and, worse, e3's capture then
 * treats it as first-party code to vendor (`environment-capture.ts` →
 * `localSource()`), which breaks member resolution.
 *
 * A **named flat index** is classified by uv as a `registry` source
 * (`source = { registry = "<dir>" }` in the lock), so `uv sync` installs it
 * normally and `localSource()` — which matches only editable/directory/virtual
 * — never sees it. That single classification difference is the whole trick.
 *
 * npm has no `--no-install-local` analogue; the lock's `resolved` URL for
 * `@elaraai` names points at this server and `npm ci` uses it verbatim (npm
 * host-rewrites only when the lock host IS the default registry).
 *
 * ## What it serves
 *
 * Only the `@elaraai` packages whose behaviour is under test. Every other
 * `@elaraai` name is 302-redirected to npmjs, so unrelated packages
 * (`east-c-cli`'s native launcher, `east-ui`, the editor plugins) resolve
 * normally and never need building in the e3 job.
 */

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The workspace `libs/` directory (…/libs/e3/test/integration/dist → …/libs). */
const WORKSPACE_LIBS = join(import.meta.dirname, '..', '..', '..', '..');

/** Built artifacts live here; git-ignored, rebuilt on demand. */
const STACK_DIR = join(import.meta.dirname, '..', '.local-stack');
const PYPI_DIR = join(STACK_DIR, 'pypi');
const NPM_DIR = join(STACK_DIR, 'npm');

/**
 * Python distributions to serve locally.
 *
 * `east-py` carries the beast2 codec, `east-py-cli` is the runner shim the
 * materialized env puts on PATH, and `east-py-std` is a hard scaffold
 * dependency. `-io` and `-datascience` stay on PyPI: their `elaraai-east-py`
 * requirement is unpinned, and uv unifies to a single version per name.
 */
const PY_PACKAGES = ['east-py', 'east-py-std', 'east-py-cli'] as const;

/**
 * npm packages to serve locally, as workspace-relative directories.
 *
 * The east-node trio is what a materialized node env actually runs. The e3
 * packages are served too so the scaffolded project builds against this tree's
 * typings rather than the last release's.
 */
const NPM_PACKAGES = [
  'east',
  'east-node/packages/east-node-std',
  'east-node/packages/east-node-io',
  'east-node/packages/east-node-cli',
  'e3/packages/e3-types',
  'e3/packages/e3',
  'e3/packages/e3-core',
  'e3/packages/e3-api-client',
  'e3/packages/e3-cli',
] as const;

/** Handle onto the running stand-in registry pair. */
export interface LocalStack {
  /** Absolute path to the flat wheel index, for `[[tool.uv.index]]`. */
  pypiDir: string;
  /** `file://` URL of the same, safe to embed in TOML on Windows. */
  pypiIndexUrl: string;
  /** `http://127.0.0.1:<port>` — the value for `@elaraai:registry`. */
  npmRegistryUrl: string;
  /** `@elaraai/*` names this stack serves itself (the rest 302 to npmjs). */
  servedNpmNames: string[];
}

let cached: LocalStack | null | undefined;
let failure: string | undefined;
let step = 'not started';
let registry: ChildProcess | undefined;

function run(command: string, args: string[], cwd?: string): void {
  execFileSync(command, args, {
    cwd,
    stdio: 'pipe',
    // npm/pnpm are .cmd shims on Windows; a shell resolves both.
    shell: process.platform === 'win32',
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Build the three east-py wheels into the flat index, if not already there. */
function buildPythonWheels(): void {
  mkdirSync(PYPI_DIR, { recursive: true });
  const built = readdirSync(PYPI_DIR).filter(f => f.endsWith('.whl'));
  const missing = PY_PACKAGES.filter(
    name => !built.some(f => f.startsWith(name.replace(/-/g, '_') + '-')),
  );
  for (const name of missing) {
    run('uv', ['build', '--wheel', '--out-dir', PYPI_DIR,
      join(WORKSPACE_LIBS, 'east-py', 'packages', name)]);
  }
}

/**
 * `pnpm pack` each npm package into the stack dir.
 *
 * pnpm, never npm: `east-node-cli` carries `"@elaraai/east": "workspace:*"` in
 * peerDependencies, which npm cannot parse.
 */
function buildNpmTarballs(): string[] {
  mkdirSync(NPM_DIR, { recursive: true });
  for (const rel of NPM_PACKAGES) {
    run('pnpm', ['pack', '--pack-destination', NPM_DIR], join(WORKSPACE_LIBS, rel));
  }
  return readdirSync(NPM_DIR).filter(f => f.endsWith('.tgz'));
}

/**
 * Start `localRegistry.js` in its OWN process and wait for its base URL.
 *
 * It must not share this process: the suite drives npm/uv through
 * `execFileSync`, which blocks the event loop, so an in-process server cannot
 * answer the very install that is blocking it — npm waits on the registry, the
 * registry waits on npm, and the run deadlocks. (Exactly that was observed: the
 * python cases passed, because a `file://` flat index needs no server, while
 * every node case hung.)
 */
function startNpmRegistry(): Promise<string> {
  return new Promise((resolve, reject) => {
    const script = join(import.meta.dirname, 'localRegistry.js');
    const child = spawn(process.execPath, [script, NPM_DIR], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    registry = child;
    let out = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error('stand-in npm registry did not start within 30s'));
    }, 30_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf-8');
      const line = out.split('\n')[0];
      if (!settled && line && line.startsWith('http://')) {
        settled = true;
        clearTimeout(timer);
        resolve(line.trim());
      }
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`stand-in npm registry exited early (code ${code})`));
    });
  });
}

/** The `@elaraai` names the stand-in registry serves itself. */
function servedNames(files: string[]): string[] {
  return files.map(file => {
    const manifest = JSON.parse(
      execFileSync('tar', ['-xzOf', join(NPM_DIR, file), 'package/package.json'], {
        encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024,
      }),
    ) as { name: string };
    return manifest.name;
  });
}

/**
 * Build (once) and start the local stand-in registries.
 *
 * @returns the stack, or `null` when it cannot be built — callers skip with a
 *   clear reason rather than failing, matching the suite's existing
 *   tool-availability convention.
 */
export async function ensureLocalStack(): Promise<LocalStack | null> {
  if (cached !== undefined) return cached;
  try {
    // The wheel build and e3's own `uv venv` must agree on the interpreter, or
    // the cp3xx wheel will not install into the materialized env.
    process.env['UV_PYTHON'] ??= '3.11';
    // Label each step: when this fails on a platform you cannot reproduce
    // locally, the skip reason must name WHICH step broke, not just that
    // something did.
    step = 'building east-py wheels (uv build)';
    buildPythonWheels();
    step = 'packing @elaraai npm tarballs (pnpm pack)';
    const tarballs = buildNpmTarballs();
    step = 'starting the stand-in npm registry';
    const npmRegistryUrl = await startNpmRegistry();
    step = 'reading packed manifests (tar)';
    cached = {
      pypiDir: PYPI_DIR,
      pypiIndexUrl: pathToFileURL(PYPI_DIR).href,
      npmRegistryUrl,
      servedNpmNames: servedNames(tarballs),
    };
  } catch (error) {
    // NEVER fall through silently. Without the stack the suites would install
    // the LAST RELEASE and quietly pass — which is the exact defect this module
    // exists to remove, and it is invisible until a wire change makes it fail
    // somewhere confusing. Record why, and let callers skip with the reason.
    failure = `${step}: ${(error as Error).message.split('\n')[0]}`;
    cached = null;
  }
  return cached;
}

/**
 * Why the local stack is unavailable — a skip reason, never an empty string.
 *
 * Call only after {@link ensureLocalStack} has returned null.
 */
export function localStackUnavailable(): string {
  return `local @elaraai stack unavailable (${failure ?? 'unknown'}) — the environment e2e `
    + 'would otherwise silently materialize the LAST RELEASE instead of this tree; '
    + "run 'make -C libs/e3 e2e-stack' (needs uv + pnpm + network)";
}

/** Stop the stand-in npm registry. Idempotent. */
export function stopLocalStack(): void {
  registry?.kill();
  registry = undefined;
}

/**
 * Point a scaffolded project's `elaraai-east-py*` deps at the flat index.
 *
 * Merges into any existing `[tool.uv.sources]` — a multi-package scaffold root
 * already declares one for its members, and a second table of the same name is
 * invalid TOML. Appending blind would also land the block inside
 * `[tool.setuptools]` in the single-package variant.
 */
export function injectLocalPythonIndex(projectDir: string, stack: LocalStack): void {
  const pyProject = join(projectDir, 'pyproject.toml');
  if (!existsSync(pyProject)) return;
  const pins = PY_PACKAGES
    .map(name => `elaraai-${name} = { index = "east-local" }`)
    .join('\n');
  const index = `\n[[tool.uv.index]]\nname = "east-local"\nurl = ${JSON.stringify(stack.pypiIndexUrl)}\nformat = "flat"\n`;
  const toml = readFileSync(pyProject, 'utf-8');
  const merged = toml.includes('[tool.uv.sources]')
    ? toml.replace('[tool.uv.sources]', `[tool.uv.sources]\n${pins}`)
    : `${toml}\n[tool.uv.sources]\n${pins}\n`;
  writeFileSync(pyProject, merged + index, 'utf-8');
}

/** Point a scaffolded project's `@elaraai` npm deps at the stand-in registry. */
export function injectLocalNpmRegistry(projectDir: string, stack: LocalStack): void {
  writeFileSync(join(projectDir, '.npmrc'), `@elaraai:registry=${stack.npmRegistryUrl}\n`, 'utf-8');
}

/**
 * Assert every locally-served `@elaraai` package actually resolved to the
 * stand-in registry.
 *
 * Without this, a misconfigured redirect degrades silently into "installed the
 * published release again" — exactly the failure this module exists to remove.
 */
export function assertNpmLockUsesLocalStack(
  projectDir: string, stack: LocalStack, assertOk: (ok: boolean, message: string) => void,
): void {
  const lockPath = join(projectDir, 'package-lock.json');
  if (!existsSync(lockPath)) return;
  const lock = readFileSync(lockPath, 'utf-8');
  for (const name of stack.servedNpmNames) {
    if (!lock.includes(`"node_modules/${name}"`)) continue; // not in this scaffold
    assertOk(
      lock.includes(`${stack.npmRegistryUrl}/${name}/-/`),
      `${name} must resolve from the local stand-in registry, not the published release`,
    );
  }
}

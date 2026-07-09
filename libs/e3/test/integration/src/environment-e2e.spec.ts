/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * End-to-end execution environments (#201), on REAL scaffolded projects: a
 * package whose task calls a project-owned platform function carries the
 * implementation inside the bundle, and a fresh repo runs it via the
 * materialized environment — for the python (east-py) AND node (east-node)
 * runtimes.
 *
 * The proof shape, per runtime:
 * 1. Scaffold a project with `create-e3`'s engine (`--platform` feature) —
 *    the same artifacts every user starts from, deps pinned to the released
 *    `@elaraai/*` / `elaraai-*` versions.
 * 2. Make it runnable the way a user would: `uv lock` (python) or
 *    `npm install` + `npm run build` (node).
 * 3. Author a task calling the scaffolded example platform function,
 *    declaring `environment: {python|node: {project}}`; `e3.export` captures
 *    manifest + lockfile + the built project package (sdist / npm pack).
 * 4. DELETE the project directory — nothing can resolve from the working
 *    tree afterwards.
 * 5. Import into a fresh repo, deploy, `e3 dataflow run`, read the output —
 *    success means the implementation travelled inside the package and ran
 *    from the materialized environment alone.
 *
 * The python flavor needs `uv` on PATH (CI installs it via setup-uv); both
 * flavors need registry access for the released runtime deps; suites
 * self-skip when the toolchain is unavailable.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { East, IntegerType, FloatType, ArrayType } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { createTestDir, removeTestDir, runE3Command } from './helpers.js';

const WORKSPACE_LIBS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const TEMPLATE_DIR = join(WORKSPACE_LIBS, 'create', 'templates', 'e3');
// Loaded dynamically (not a workspace dep): libs/e3 must stay buildable
// without libs/create — CI builds scaffold-core before running these suites,
// and a local run without it skips with a pointer.
const SCAFFOLD_CORE_DIST = join(WORKSPACE_LIBS, 'create', 'packages', 'scaffold-core', 'dist', 'index.js');
const hasScaffoldCore = existsSync(SCAFFOLD_CORE_DIST);
const SKIP_NO_SCAFFOLD = 'scaffold-core not built — run `pnpm -r build` in libs/create first';

type ScaffoldFn = (options: {
  kind: 'e3'; name: string; cwd: string; templateDir: string; version: string;
  install: boolean; log: (msg: string) => void; features: Record<string, boolean>;
  packages?: { python?: string[]; node?: string[]; c?: string[] };
}) => { projectDir: string };

async function loadScaffold(): Promise<ScaffoldFn> {
  const mod = await import(pathToFileURL(SCAFFOLD_CORE_DIST).href) as { scaffold: ScaffoldFn };
  return mod.scaffold;
}
/** The released lockstep version the scaffold pins `@elaraai/*` deps to. */
const RELEASED_VERSION = (JSON.parse(
  readFileSync(join(WORKSPACE_LIBS, 'east', 'package.json'), 'utf-8'),
) as { version: string }).version;

function toolAvailable(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { stdio: 'ignore', shell: process.platform === 'win32' });
    return true;
  } catch {
    return false;
  }
}

function runTool(command: string, args: string[], cwd: string): void {
  execFileSync(command, args, {
    cwd,
    stdio: 'pipe',
    // npm/npx are .cmd shims on Windows; a shell resolves both.
    shell: process.platform === 'win32',
    maxBuffer: 32 * 1024 * 1024,
  });
}

/** Scaffold a create-e3 project with the platform feature into `parentDir`. */
async function scaffoldPlatformProject(
  parentDir: string,
  name: string,
  runners: { py: boolean; node: boolean },
): Promise<string> {
  const scaffold = await loadScaffold();
  mkdirSync(parentDir, { recursive: true });
  const result = scaffold({
    kind: 'e3',
    name,
    cwd: parentDir,
    templateDir: TEMPLATE_DIR,
    version: RELEASED_VERSION,
    install: false,
    log: () => { /* quiet */ },
    features: {
      'platform': true,
      'runner:east-py': runners.py,
      'runner:east-node': runners.node,
      'runner:east-c': false,
      'tests': false,
      'ui': false,
      'eslint': false,
      'editor-diagnostics': false,
    },
  });
  return result.projectDir;
}

/** Scaffold a create-e3 project split into per-runtime workspace packages. */
async function scaffoldMultiPackageProject(
  parentDir: string,
  name: string,
  packages: { python?: string[]; node?: string[]; c?: string[] },
): Promise<string> {
  const scaffold = await loadScaffold();
  mkdirSync(parentDir, { recursive: true });
  const result = scaffold({
    kind: 'e3',
    name,
    cwd: parentDir,
    templateDir: TEMPLATE_DIR,
    version: RELEASED_VERSION,
    install: false,
    log: () => { /* quiet */ },
    features: {
      // The package flags carry the runtimes; the single-file platform demo is off.
      'platform': false,
      'runner:east-py': Boolean(packages.python?.length),
      'runner:east-node': Boolean(packages.node?.length),
      'runner:east-c': Boolean(packages.c?.length),
      'tests': false,
      'ui': false,
      'eslint': false,
      'editor-diagnostics': false,
    },
    packages,
  });
  return result.projectDir;
}

/** Import zip into a fresh repo, deploy, run the dataflow, return a dataset value. */
async function importDeployRun(
  testDir: string, zipPath: string, pkgRef: string, outputPath: string,
): Promise<string> {
  const repoDir = join(testDir, 'repo');
  const steps: string[][] = [
    ['repo', 'create', repoDir],
    ['package', 'import', repoDir, zipPath],
    ['workspace', 'create', repoDir, 'ws'],
    ['workspace', 'deploy', repoDir, 'ws', pkgRef],
    ['dataflow', 'run', repoDir, 'ws'],
  ];
  for (const args of steps) {
    const result = await runE3Command(args, testDir);
    assert.strictEqual(result.exitCode, 0,
      `e3 ${args.join(' ')} failed:\n${result.stderr}\n${result.stdout}`);
  }
  const get = await runE3Command(['dataset', 'get', repoDir, `ws.${outputPath}`], testDir);
  assert.strictEqual(get.exitCode, 0, `dataset get failed:\n${get.stderr}\n${get.stdout}`);
  return get.stdout;
}

describe('execution environments e2e — scaffolded python platform travels with the package', () => {
  const hasUv = toolAvailable('uv', ['--version']);
  let testDir: string;
  let projectDir: string;

  before(async () => {
    if (!hasUv || !hasScaffoldCore) return;
    testDir = createTestDir();
    mkdirSync(testDir, { recursive: true });
    projectDir = await scaffoldPlatformProject(testDir, 'envpy', { py: true, node: false });
    // Lock the scaffolded project against the registry, as a user would.
    runTool('uv', ['lock'], projectDir);
  });

  after(() => {
    if (testDir) removeTestDir(testDir);
  });

  it('runs the scaffolded @platform_function from the materialized env after the project is deleted',
    { skip: (!hasUv && 'uv not on PATH') || (!hasScaffoldCore && SKIP_NO_SCAFFOLD) }, async () => {
      // Mirror of the scaffolded platform_module example:
      //   @platform_function(name="envpy.example_python",
      //                      inputs=[ArrayType(FloatType)], output=FloatType)
      const examplePython = East.platform('envpy.example_python', [ArrayType(FloatType)], FloatType);
      const values = e3.input('values', ArrayType(FloatType), [1.0, 2.0, 3.0]);
      const mean = e3.task('mean', [values],
        East.function([ArrayType(FloatType)], FloatType, (_$, v) => examplePython(v)),
        {
          runner: { runtime: 'east-py', platforms: [{ custom: 'platform_module' }] },
          environment: { python: { project: projectDir } },
        });
      const pkg = e3.package('envpy', '1.0.0', mean);

      const zipPath = join(testDir, 'envpy.zip');
      await e3.export(pkg, zipPath);

      // The bundle must now be self-contained: remove the source project.
      rmSync(projectDir, { recursive: true, force: true });
      assert.ok(!existsSync(projectDir));

      const output = await importDeployRun(testDir, zipPath, 'envpy@1.0.0', 'mean');
      assert.match(output, /2(\.0*)?/, `expected mean of [1,2,3], got: ${output}`);
    });
});

describe('execution environments e2e — scaffolded node platform travels with the package', () => {
  const hasNpm = toolAvailable('npm', ['--version']);
  let testDir: string;
  let projectDir: string;

  before(async () => {
    if (!hasNpm || !hasScaffoldCore) return;
    testDir = createTestDir();
    mkdirSync(testDir, { recursive: true });
    projectDir = await scaffoldPlatformProject(testDir, 'envnode', { py: false, node: true });
    // Install + build the scaffolded project the way a user would, so the
    // `./platform` export (dist/platform/index.js) exists for `npm pack`.
    runTool('npm', ['install', '--no-audit', '--no-fund'], projectDir);
    runTool('npm', ['run', 'build'], projectDir);
  });

  after(() => {
    if (testDir) removeTestDir(testDir);
  });

  it('runs the scaffolded East.platform implementation from the materialized env after the project is deleted',
    { skip: (!hasNpm && 'npm not on PATH') || (!hasScaffoldCore && SKIP_NO_SCAFFOLD) }, async () => {
      // Mirror of the scaffolded src/platform/example.ts:
      //   East.platform("envnode.example_node", [IntegerType, FloatType], IntegerType)
      //   impl: ceil(value * factor)
      const exampleNode = East.platform('envnode.example_node', [IntegerType, FloatType], IntegerType);
      const value = e3.input('value', IntegerType, 21n);
      const factor = e3.input('factor', FloatType, 2.0);
      const scaled = e3.task('scaled', [value, factor],
        East.function([IntegerType, FloatType], IntegerType, (_$, v, f) => exampleNode(v, f)),
        {
          runner: { runtime: 'east-node', platforms: [{ custom: '@elaraai/envnode' }] },
          environment: { node: { project: projectDir } },
        });
      const pkg = e3.package('envnode', '1.0.0', scaled);

      const zipPath = join(testDir, 'envnode.zip');
      await e3.export(pkg, zipPath);

      rmSync(projectDir, { recursive: true, force: true });
      assert.ok(!existsSync(projectDir));

      const output = await importDeployRun(testDir, zipPath, 'envnode@1.0.0', 'scaled');
      assert.match(output, /42/, `expected ceil(21 * 2.0) = 42, got: ${output}`);
    });
});

describe('execution environments e2e — python multi-package scaffold, AUTO-derived environments', () => {
  const hasUv = toolAvailable('uv', ['--version']);
  let testDir: string;
  let projectDir: string;

  before(async () => {
    if (!hasUv || !hasScaffoldCore) return;
    testDir = createTestDir();
    mkdirSync(testDir, { recursive: true });
    // Two INDEPENDENT python packages; only `pricing` is referenced below, so
    // `forecasting` is an unrelated sibling that must NOT ride the derived env.
    projectDir = await scaffoldMultiPackageProject(testDir, 'shop', { python: ['pricing', 'forecasting'] });
    runTool('uv', ['lock'], projectDir);
  });

  after(() => {
    if (testDir) removeTestDir(testDir);
  });

  it('derives a task env from its { custom } platform reference (NO environment field) and runs after the project is deleted',
    { skip: (!hasUv && 'uv not on PATH') || (!hasScaffoldCore && SKIP_NO_SCAFFOLD) }, async () => {
      // Mirror of the scaffolded packages/python/pricing/src/pricing/example.py:
      //   @platform_function(name="pricing.example", inputs=[ArrayType(FloatType)], output=FloatType)
      const pricing = East.platform('pricing.example', [ArrayType(FloatType)], FloatType);
      const priceValues = e3.input('price_values', ArrayType(FloatType), [2.0, 4.0, 6.0]);
      // NO `environment` — e3 auto-derives it from `{ custom: 'pricing' }`,
      // capturing packages/python/pricing's closure (not forecasting's).
      const priced = e3.task('priced', [priceValues],
        East.function([ArrayType(FloatType)], FloatType, (_$, v) => pricing(v)),
        { runner: { runtime: 'east-py', platforms: [{ custom: 'pricing' }, 'east-py-std'] } });
      const pkg = e3.package('shop', '1.0.0', priced);

      const zipPath = join(testDir, 'shop.zip');
      // Auto-derivation resolves the workspace from the process cwd (the e3 CLI
      // runs export in the project dir); drive e3.export from the project root.
      const prevCwd = process.cwd();
      process.chdir(projectDir);
      try {
        await e3.export(pkg, zipPath);
      } finally {
        process.chdir(prevCwd);
      }

      // Self-contained now: remove the source workspace entirely.
      rmSync(projectDir, { recursive: true, force: true });
      assert.ok(!existsSync(projectDir));

      const output = await importDeployRun(testDir, zipPath, 'shop@1.0.0', 'priced');
      assert.match(output, /4(\.0*)?/, `expected mean of [2,4,6] = 4, got: ${output}`);
    });
});

describe('execution environments e2e — node multi-package scaffold, AUTO-derived environments', () => {
  const hasNpm = toolAvailable('npm', ['--version']);
  let testDir: string;
  let projectDir: string;

  before(async () => {
    if (!hasNpm || !hasScaffoldCore) return;
    testDir = createTestDir();
    mkdirSync(testDir, { recursive: true });
    projectDir = await scaffoldMultiPackageProject(testDir, 'shop', { node: ['api'] });
    // Install + build the workspace so the member's dist/platform.js exists for
    // `npm pack` (the root build runs `npm run build --workspaces` first).
    runTool('npm', ['install', '--no-audit', '--no-fund'], projectDir);
    runTool('npm', ['run', 'build'], projectDir);
  });

  after(() => {
    if (testDir) removeTestDir(testDir);
  });

  it('derives a node task env from its { custom } platform reference (NO environment field) and runs after the project is deleted',
    { skip: (!hasNpm && 'npm not on PATH') || (!hasScaffoldCore && SKIP_NO_SCAFFOLD) }, async () => {
      // Mirror of packages/node/api/src/platform.ts: api.example = ceil(value * factor)
      const api = East.platform('api.example', [IntegerType, FloatType], IntegerType);
      const value = e3.input('api_value', IntegerType, 21n);
      const factor = e3.input('api_factor', FloatType, 2.0);
      // NO `environment` — e3 derives it from `{ custom: '@shop/api' }`,
      // resolving the npm workspace member and capturing its closure.
      const apiScaled = e3.task('api_scaled', [value, factor],
        East.function([IntegerType, FloatType], IntegerType, (_$, v, f) => api(v, f)),
        { runner: { runtime: 'east-node', platforms: [{ custom: '@shop/api' }] } });
      const pkg = e3.package('shop', '1.0.0', apiScaled);

      const zipPath = join(testDir, 'shop-node.zip');
      const prevCwd = process.cwd();
      process.chdir(projectDir);
      try {
        await e3.export(pkg, zipPath);
      } finally {
        process.chdir(prevCwd);
      }

      rmSync(projectDir, { recursive: true, force: true });
      assert.ok(!existsSync(projectDir));

      const output = await importDeployRun(testDir, zipPath, 'shop@1.0.0', 'api_scaled');
      assert.match(output, /42/, `expected ceil(21 * 2.0) = 42, got: ${output}`);
    });
});

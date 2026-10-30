/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Self-resolving cross-language imports at export (#652).
 *
 * `East.importFunction(pkg, name, type)` names a package. Where that
 * package is a member of the uv or npm workspace the export runs in —
 * resolved the way a `{ custom }` platform is, by name against the
 * governing `uv.lock` / npm lockfile — its function manifest is produced
 * here, in the package's own environment (`east-py export-functions` on a
 * python member's root module, `east-node export-functions` on a node
 * member's built `./functions` entry), and linked exactly as an explicit
 * `functions:` manifest would be. The user writes the reference and nothing
 * else; the platform DX. A manifest passed explicitly wins for its package
 * (a package built elsewhere, a published one); a referenced package that is
 * neither given nor a local member is an export error naming the import.
 *
 * Providers — the packages implementing the platform functions an exported
 * function calls — come from the importing owner's runner, in the exporting
 * language: a stock platform maps to its python / node family member
 * (`@elaraai/east-node-std` → `east-py-std`, `east-py-std` →
 * `@elaraai/east-node-std`), a `{ custom }` name passes through on a runner
 * of the exporting runtime. The exporter records them per dependency, so
 * the runner check at link is unchanged. A manifest is per package and
 * provider set, of exactly the functions the owners with those providers
 * import (`--only`): a sibling function's platform call never fails an
 * owner that does not use it, and each owner links against the manifests
 * produced for its own runner.
 *
 * One process exports each package (#1459): it imports the package once and
 * writes a manifest per provider set, from a batch (`export-functions
 * --batch`), since the import is where the time goes. The packages' processes
 * run side by side, as many at once as the export has cores. A python
 * member's manifests are kept in the export cache (`functions-cache.ts`),
 * so a package whose python has not changed since its last export runs no
 * process at all.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { walkIR, decodeFunctionManifest, encodeBeast2For, FunctionExportBatchType, IMPORT_PLATFORM, type FunctionManifest } from '@elaraai/east';
import { STOCK_PLATFORM_FAMILIES, type Runner } from './runner.js';
import { pythonWorkspaceMember, nodeWorkspaceMember, pythonMemberSources } from './environment-capture.js';
import { ManifestCache, sourceKey } from './functions-cache.js';

/** One package an owner's IR imports from: the functions it names, and the runner whose providers the export takes. */
export interface ImportReference {
  /** The package named by `East.importFunction`. */
  package: string;
  /** The functions the owner imports from it. */
  functions: string[];
  /** The owning task / function / mutation, for messages. */
  owner: string;
  /** The owner's runner, for the exporter's providers. */
  runner: Runner | undefined;
}

/** Progress of one resolved package (#652): its manifests, which one process wrote. */
export interface ResolveEvent {
  /** The package resolved. */
  package: string;
  /** The tool that produced its manifests. */
  tool: string;
  /** How many functions its manifests export between them. */
  count: number;
  /** Whether every manifest came from the export cache, so no process ran (#1459). */
  cached: boolean;
}

/**
 * One entry of a package's export batch (#1459): the manifest the owners on
 * one provider set link against, of the functions they import from it.
 */
export interface ExportBatchEntry {
  /** The platform packages providing their platform calls, as `-p` names them. */
  providers: string[];
  /** The functions to export, as `--only` names them. */
  only: string[];
  /** An owner importing them, for messages. */
  owner: string;
}

/**
 * The functions an IR imports, by package — every distinct
 * `East.importFunction(pkg, name, …)` in it.
 */
export function importedFunctions(ir: unknown): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  walkIR(ir as any, (node) => {
    if (node.type !== 'Platform' || node.value.name !== IMPORT_PLATFORM) return;
    const [first, second] = node.value.arguments as any[];
    if (first?.type !== 'Value' || typeof first.value?.value?.value !== 'string') return;
    if (second?.type !== 'Value' || typeof second.value?.value?.value !== 'string') return;
    const pkg = first.value.value.value as string;
    let names = found.get(pkg);
    if (names === undefined) {
      names = new Set();
      found.set(pkg, names);
    }
    names.add(second.value.value.value as string);
  });
  return found;
}

/** The packages an IR imports from — every distinct `East.importFunction` package name in it. */
export function importedPackages(ir: unknown): string[] {
  return [...importedFunctions(ir).keys()];
}

/** The stock platform packages of one runtime a runner's platforms map to, plus its `{ custom }` names on that runtime. */
function providersFor(runner: Runner | undefined, runtime: 'east-py' | 'east-node', prefix: string): string[] {
  if (runner === undefined || runner.runtime === 'custom') return [];
  const out = new Set<string>();
  for (const p of runner.platforms ?? []) {
    if (typeof p === 'string') {
      const family = STOCK_PLATFORM_FAMILIES.find((f) => f.includes(p));
      const member = family?.find((n) => n.startsWith(prefix));
      if (member !== undefined) out.add(member);
    } else if (runner.runtime === runtime) {
      out.add(p.custom);
    }
  }
  return [...out].sort();
}

/**
 * The python platform packages an owner's runner implies for the exporter's
 * `-p`: each stock platform's python family member, and a `{ custom }` name
 * as it stands on an east-py runner (on another runtime it is that runtime's
 * package and cannot be loaded by python). A custom-command runner implies
 * nothing.
 */
export function pythonProviders(runner: Runner | undefined): string[] {
  return providersFor(runner, 'east-py', 'east-py-');
}

/**
 * The node platform packages an owner's runner implies for `east-node
 * export-functions -p`: each stock platform's node family member, and a
 * `{ custom }` name as it stands on an east-node runner. The twin of
 * {@link pythonProviders}.
 */
export function nodeProviders(runner: Runner | undefined): string[] {
  return providersFor(runner, 'east-node', '@elaraai/east-node-');
}

/** The `east-py` command for a package: the nearest `.venv` above its directory, else PATH. */
export function findEastPy(fromDir: string): string {
  const override = process.env['EAST_PY'];
  if (override !== undefined && override !== '') return override;
  let dir = fromDir;
  for (;;) {
    for (const candidate of [path.join(dir, '.venv', 'bin', 'east-py'), path.join(dir, '.venv', 'Scripts', 'east-py.exe')]) {
      if (fs.existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return 'east-py';
    dir = parent;
  }
}

/**
 * The `east-node` command for a package, as a command and its leading
 * arguments: `EAST_NODE` names an executable outright; else the
 * `@elaraai/east-node-cli` installed in the nearest `node_modules` above the
 * package's directory (the project's own install — the one whose
 * `@elaraai/east` the package's built module shares, run by this node with
 * no bin shim and no shell); else `east-node` on PATH. The walk is over the
 * directories, not `require.resolve`: the CLI's exports map exposes no
 * `./package.json`, and an east-node from elsewhere carries its own copy of
 * `@elaraai/east`, which does not recognise the member's functions.
 */
export function findEastNode(fromDir: string): { command: string; args: string[] } {
  const override = process.env['EAST_NODE'];
  if (override !== undefined && override !== '') return { command: override, args: [] };
  let dir = fromDir;
  for (;;) {
    const manifest = path.join(dir, 'node_modules', '@elaraai', 'east-node-cli', 'package.json');
    if (fs.existsSync(manifest)) {
      const bin = (JSON.parse(fs.readFileSync(manifest, 'utf-8')) as { bin?: string | Record<string, string> }).bin;
      const entry = typeof bin === 'string' ? bin : bin?.['east-node'];
      if (typeof entry === 'string') return { command: process.execPath, args: [path.join(path.dirname(manifest), entry)] };
    }
    const parent = path.dirname(dir);
    if (parent === dir) return { command: 'east-node', args: [] };
    dir = parent;
  }
}

/** How a package's export runs: the tool, what it exports from, and where. */
interface ExportCommand {
  /** The tool, as messages name it: `east-py` or `east-node`. */
  tool: string;
  /** The executable. */
  command: string;
  /** The arguments before the tool's own. */
  leading: string[];
  /** What the tool exports from: the python module, or the node member's built entry. */
  target: string;
  /** The environment it runs in. */
  env: NodeJS.ProcessEnv;
  /** The error for an owner when the executable cannot be found. */
  unavailable: (owner: string) => string;
}

/**
 * Runs a command to completion, its stdout discarded.
 *
 * @throws {Error} When it cannot start (its `code` the spawn's), when it exits
 *   unsuccessfully (its `stderr` what the command wrote there), or when the
 *   signal aborts it
 */
function run(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; signal: AbortSignal }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      signal: options.signal,
      stdio: ['ignore', 'ignore', 'pipe'],
      shell: process.platform === 'win32',
    });
    const stderr: Buffer[] = [];
    child.stderr!.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) return resolve();
      reject(Object.assign(new Error(`exited with ${code ?? signal}`), { stderr: Buffer.concat(stderr).toString('utf-8') }));
    });
  });
}

/**
 * Exports a package's manifests in one process (#1459): `<tool>
 * export-functions <target> --batch <file> --name <package>
 * [--package-version <version>]` in the package's directory, the batch in a
 * temporary directory beside each entry's manifest. The process imports the
 * package once and writes every entry's manifest.
 *
 * @param batch - The manifests to write, one per provider set
 * @param signal - Aborts the process
 * @returns Each entry's manifest as the tool wrote it, in batch order
 * @throws {Error} Naming the owner of the entry the export failed on — the
 *   first whose manifest was not written, since the entries run in order and
 *   the first failure ends them — and the package: no tool to run, or an
 *   export the tool refused (its own message)
 */
async function exportManifests(spec: ExportCommand, pkg: string, dir: string, version: string | null, batch: ExportBatchEntry[], signal: AbortSignal): Promise<Uint8Array[]> {
  const outDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'e3-functions-'));
  try {
    const file = path.join(outDir, 'batch.beast2');
    const output = (index: number): string => `${index}.functions.beast2`;
    await fs.promises.writeFile(file, encodeBeast2For(FunctionExportBatchType)(
      batch.map((entry, index) => ({ only: entry.only, output: output(index), packages: entry.providers }))));
    const args = ['export-functions', spec.target, '--batch', file, '--name', pkg, ...(version === null ? [] : ['--package-version', version])];
    try {
      await run(spec.command, [...spec.leading, ...args], { cwd: dir, env: spec.env, signal });
    } catch (err) {
      if (signal.aborted) throw err;
      const failed = batch.find((_, index) => !fs.existsSync(path.join(outDir, output(index)))) ?? batch[0]!;
      const e = err as NodeJS.ErrnoException & { stderr?: string };
      if (e.code === 'ENOENT') throw new Error(spec.unavailable(failed.owner));
      const providers = failed.providers.length === 0 ? 'no -p package' : `-p ${failed.providers.join(' -p ')}`;
      throw new Error(
        `${failed.owner} imports from "${pkg}": '${spec.tool} export-functions ${spec.target}' failed in '${dir}', ` +
        `exporting ${failed.only.join(', ')} with ${providers}:\n${e.stderr?.trim() ?? String(err)}`);
    }
    return await Promise.all(batch.map(async (_, index) =>
      new Uint8Array(await fs.promises.readFile(path.join(outDir, output(index))))));
  } finally {
    await fs.promises.rm(outDir, { recursive: true, force: true });
  }
}

/**
 * Exports a python workspace member's `east_functions` as a manifest per
 * batch entry, in one process in its own environment: `east-py
 * export-functions <package> --batch …` with the member's source roots on
 * `PYTHONPATH`, so the package imports whether or not it is installed.
 *
 * @param batch - The manifests to write, one per provider set
 * @param signal - Aborts the export
 * @returns Each entry's manifest as east-py wrote it, in batch order
 * @throws {Error} Naming the owner and the package: no `east-py` to run, or
 *   an export the tool refused (its own message — no `east_functions`, a
 *   function it does not export, a platform call no provider implements, a
 *   function that is not closed)
 */
export function exportPythonManifests(pkg: string, dir: string, version: string | null, batch: ExportBatchEntry[], signal: AbortSignal): Promise<Uint8Array[]> {
  const roots = [path.join(dir, 'src'), dir].filter((d) => fs.existsSync(d));
  const pythonPath = [...roots, process.env['PYTHONPATH'] ?? ''].filter((p) => p !== '').join(path.delimiter);
  return exportManifests({
    tool: 'east-py',
    command: findEastPy(dir),
    leading: [],
    target: pkg.replace(/-/g, '_'),
    // UTF-8 stdio: python encodes a piped stderr in the locale's code page
    // on Windows (cp1252), and the exporter's messages carry an em dash
    env: { ...process.env, PYTHONPATH: pythonPath, PYTHONIOENCODING: 'utf-8' },
    unavailable: (owner) =>
      `${owner} imports from "${pkg}", a package of this workspace at '${dir}', but no east-py is available to export its functions — ` +
      `install east-py-cli in the project's .venv (uv add east-py-cli) or on PATH, or pass the package's manifest in \`functions:\``,
  }, pkg, dir, version, batch, signal);
}

/**
 * What an east-py says it is (`east-py version`: east-py-cli's version and
 * east-py's), which the export cache keys on, or null when it cannot run —
 * whose export then says why.
 */
function eastPyVersion(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(command, ['version'], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      shell: process.platform === 'win32',
      encoding: 'utf-8',
    }, (err, stdout) => resolve(err === null ? stdout : null));
  });
}

/**
 * A python member's manifests (#1459): the ones the export cache keeps for
 * its source state and what each entry asks for, and the rest exported in
 * one process, then kept. A member whose sources or east-py cannot be told
 * is exported every time.
 *
 * @param batch - The manifests the owners need, one per provider set
 * @param cache - The export cache
 * @param versionOf - What an east-py says it is (`east-py version`)
 * @param signal - Aborts the export
 * @returns Each entry's manifest in batch order, and whether all came from the cache
 * @throws {Error} As {@link exportPythonManifests}
 */
async function pythonManifests(
  pkg: string,
  member: Member,
  batch: ExportBatchEntry[],
  anchorDir: string,
  cache: ManifestCache,
  versionOf: (command: string) => Promise<string | null>,
  signal: AbortSignal,
): Promise<{ manifests: FunctionManifest[]; cached: boolean }> {
  const eastPy = findEastPy(member.dir);
  const sources = pythonMemberSources(pkg, anchorDir, batch[0]!.owner);
  const version = await versionOf(eastPy);
  const key = sources === null || version === null ? null : sourceKey({
    root: sources.root,
    dirs: sources.dirs,
    args: [pkg, JSON.stringify(member.version), eastPy, version, process.env['PYTHONPATH'] ?? ''],
  });
  const kept = batch.map((entry) => (key === null ? null : cache.read(pkg, key, entry.providers, entry.only)));
  const missing = batch.filter((_, index) => kept[index] === null);
  if (missing.length === 0) return { manifests: kept as FunctionManifest[], cached: true };
  const written = await exportPythonManifests(pkg, member.dir, member.version, missing, signal);
  const exported = written.map((bytes) => decodeFunctionManifest(bytes));
  if (key !== null) {
    cache.write(pkg, key, missing.map((entry, index) => ({ providers: entry.providers, only: entry.only, bytes: written[index]! })));
  }
  let next = 0;
  return { manifests: kept.map((manifest) => manifest ?? exported[next++]!), cached: false };
}

/**
 * The built module a node member exports its East functions from: the
 * target of its `package.json` `exports["./functions"]` (a path, or a
 * conditional object's `import` / `default`), which must exist — a member
 * is built before it is exported, as it is before it is packed.
 *
 * @throws {Error} Naming the owner and the package: no `./functions` export,
 *   or a target that is not built
 */
function nodeFunctionsEntry(pkg: string, dir: string, owner: string): string {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8')) as { exports?: unknown };
  const exports = manifest.exports;
  const declared = exports !== null && typeof exports === 'object' ? (exports as Record<string, unknown>)['./functions'] : undefined;
  const target = typeof declared === 'string'
    ? declared
    : declared !== null && typeof declared === 'object'
      ? (declared as Record<string, unknown>)['import'] ?? (declared as Record<string, unknown>)['default']
      : undefined;
  if (typeof target !== 'string') {
    throw new Error(
      `${owner} imports from "${pkg}", a package of this workspace at '${dir}', but its package.json exports no "./functions" entry — ` +
      `add "./functions": "./dist/functions.js" (a module exporting \`eastFunctions\`, name -> East.function) to its exports, ` +
      `or pass the package's manifest in \`functions:\``,
    );
  }
  const entry = path.resolve(dir, target);
  if (!fs.existsSync(entry)) {
    throw new Error(
      `${owner} imports from "${pkg}": its "./functions" entry '${entry}' does not exist — build the package first (npm run build), ` +
      `or pass its manifest in \`functions:\``,
    );
  }
  return entry;
}

/**
 * Exports a node workspace member's `eastFunctions` as a manifest per batch
 * entry, in one process in its own environment: `east-node export-functions
 * <entry> --batch …` in the member's directory, `<entry>` its built
 * `./functions` export.
 *
 * @param batch - The manifests to write, one per provider set
 * @param signal - Aborts the export
 * @returns Each entry's manifest as east-node wrote it, in batch order
 * @throws {Error} Naming the owner and the package: no `./functions` export
 *   or an unbuilt one, no `east-node` to run, or an export the tool refused
 *   (its own message — no `eastFunctions`, a function it does not export, a
 *   platform call no provider implements, a function that is not closed)
 */
export async function exportNodeManifests(pkg: string, dir: string, version: string | null, batch: ExportBatchEntry[], signal: AbortSignal): Promise<Uint8Array[]> {
  const entry = nodeFunctionsEntry(pkg, dir, batch[0]!.owner);
  const eastNode = findEastNode(dir);
  return exportManifests({
    tool: 'east-node',
    command: eastNode.command,
    leading: eastNode.args,
    target: entry,
    env: process.env,
    unavailable: (owner) =>
      `${owner} imports from "${pkg}", a package of this workspace at '${dir}', but no east-node is available to export its functions — ` +
      `install @elaraai/east-node-cli in the project (npm install -D @elaraai/east-node-cli) or on PATH, or pass the package's manifest in \`functions:\``,
  }, pkg, dir, version, batch, signal);
}

/** A workspace member an import resolves to: which workspace holds it, where, and its version. */
type Member = { kind: 'python' | 'node'; dir: string; version: string | null };

/** The manifests the export produced, served per owner. */
export interface ResolvedManifests {
  /**
   * The manifests an owner links against: the explicit ones, and every
   * workspace package's manifest exported for this runner's providers.
   */
  forOwner(runner: Runner | undefined): FunctionManifest[];
}

/** Options for {@link resolveFunctionManifests}. */
export interface ResolveOptions {
  /** How many packages export at once (default: the CPUs available). */
  cores?: number;
  /** Progress, once per package exported. */
  onEvent?: (event: ResolveEvent) => void;
}

/**
 * Runs each task, at most `limit` at once, starting them in list order. The
 * first to fail stops the rest: no other starts, those running are aborted
 * through the signal each was given, and its error is thrown once every task
 * started has settled.
 */
async function inParallel(tasks: Array<(signal: AbortSignal) => Promise<void>>, limit: number): Promise<void> {
  const controller = new AbortController();
  let next = 0;
  let failure: { error: unknown } | undefined;
  const worker = async (): Promise<void> => {
    while (failure === undefined && next < tasks.length) {
      const task = tasks[next++]!;
      try {
        await task(controller.signal);
      } catch (error) {
        if (failure === undefined) {
          failure = { error };
          controller.abort();
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), tasks.length) }, worker));
  if (failure !== undefined) throw failure.error;
}

/**
 * The manifests for every imported package the explicit ones do not cover,
 * produced from the workspace (#652). One process exports each package
 * (#1459), writing a manifest per provider set of the union of the functions
 * the owners with those providers import; the packages export side by side,
 * `cores` at once. A python member's manifests come from the export cache
 * under `<anchorDir>/node_modules/.cache/e3/functions` where it keeps them,
 * and only the rest are exported. A package that is not a local workspace
 * member is an error naming the import, raised before any export runs; the
 * first export to fail stops the others.
 *
 * @param references - Every import an owner's IR makes, with its runner
 * @param explicit - The manifests the export was given (they win)
 * @param anchorDir - Directory the workspace is resolved from (the export cwd)
 * @param options - The cores to export on, and progress per package
 * @returns The manifests, served per owner
 */
export async function resolveFunctionManifests(
  references: ImportReference[],
  explicit: FunctionManifest[],
  anchorDir: string,
  options: ResolveOptions = {},
): Promise<ResolvedManifests> {
  const covered = new Set(explicit.map((m) => m.package));
  const members = new Map<string, Member | null>();
  const memberOf = (ref: ImportReference): Member | null => {
    let member = members.get(ref.package);
    if (member === undefined) {
      const python = pythonWorkspaceMember(ref.package, anchorDir, ref.owner);
      const node = python === null ? nodeWorkspaceMember(ref.package, anchorDir) : null;
      member = python !== null ? { kind: 'python', ...python } : node !== null ? { kind: 'node', ...node } : null;
      members.set(ref.package, member);
    }
    return member;
  };
  const providersOf = (member: Member, runner: Runner | undefined): string[] =>
    member.kind === 'python' ? pythonProviders(runner) : nodeProviders(runner);
  const keyOf = (pkg: string, providers: string[]): string => `${pkg}\0${providers.join(',')}`;

  // One export per package, of a manifest per provider set: every function
  // the owners with those providers import.
  const exports = new Map<string, { member: Member; entries: Map<string, { providers: string[]; functions: Set<string>; owner: string }> }>();
  for (const ref of references) {
    if (covered.has(ref.package)) continue;
    const member = memberOf(ref);
    if (member === null) {
      throw new Error(
        `${ref.owner} imports from "${ref.package}", but no function manifest was given for it and it is not a member of the uv or npm workspace ` +
        `at or above '${anchorDir}' — add the package to the workspace (a python package whose root module declares \`east_functions\`, ` +
        `a node package whose "./functions" export declares \`eastFunctions\`), ` +
        `or export it where it lives (east-py export-functions / east-node export-functions) and pass the manifest in \`functions:\``,
      );
    }
    let exported = exports.get(ref.package);
    if (exported === undefined) {
      exported = { member, entries: new Map() };
      exports.set(ref.package, exported);
    }
    const providers = providersOf(member, ref.runner);
    let entry = exported.entries.get(keyOf(ref.package, providers));
    if (entry === undefined) {
      entry = { providers, functions: new Set(), owner: ref.owner };
      exported.entries.set(keyOf(ref.package, providers), entry);
    }
    for (const name of ref.functions) entry.functions.add(name);
  }
  // The export cache lives beside the project, as the bundles of a source
  // deploy do; each east-py is asked what it is once.
  const cache = new ManifestCache(path.join(anchorDir, 'node_modules', '.cache', 'e3', 'functions'));
  const versions = new Map<string, Promise<string | null>>();
  const versionOf = (command: string): Promise<string | null> => {
    let version = versions.get(command);
    if (version === undefined) {
      version = eastPyVersion(command);
      versions.set(command, version);
    }
    return version;
  };
  const resolved = new Map<string, FunctionManifest>();
  await inParallel([...exports].map(([pkg, { member, entries }]) => async (signal: AbortSignal) => {
    const batch = [...entries.values()].map((entry) => ({ providers: entry.providers, only: [...entry.functions].sort(), owner: entry.owner }));
    const { manifests, cached } = member.kind === 'python'
      ? await pythonManifests(pkg, member, batch, anchorDir, cache, versionOf, signal)
      : {
        manifests: (await exportNodeManifests(pkg, member.dir, member.version, batch, signal)).map((bytes) => decodeFunctionManifest(bytes)),
        cached: false,
      };
    batch.forEach((entry, index) => resolved.set(keyOf(pkg, entry.providers), manifests[index]!));
    options.onEvent?.({
      package: pkg,
      tool: `${member.kind === 'python' ? 'east-py' : 'east-node'} export-functions`,
      count: new Set(batch.flatMap((entry) => entry.only)).size,
      cached,
    });
  }), options.cores ?? os.availableParallelism());
  return {
    forOwner(runner) {
      const own = [...explicit];
      for (const [pkg, member] of members) {
        if (member === null) continue;
        const hit = resolved.get(keyOf(pkg, providersOf(member, runner)));
        if (hit !== undefined) own.push(hit);
      }
      return own;
    },
  };
}

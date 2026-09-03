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
 * the runner check at link is unchanged.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { walkIR, decodeFunctionManifest, IMPORT_PLATFORM, type FunctionManifest } from '@elaraai/east';
import { STOCK_PLATFORM_FAMILIES, type Runner } from './runner.js';
import { pythonWorkspaceMember, nodeWorkspaceMember } from './environment-capture.js';

/** One package an owner's IR imports from, with the providers its runner implies. */
export interface ImportReference {
  /** The package named by `East.importFunction`. */
  package: string;
  /** The owning task / function / mutation, for messages. */
  owner: string;
  /** The owner's runner, for the exporter's providers. */
  runner: Runner | undefined;
}

/** Progress of one resolved package (#652). */
export interface ResolveEvent {
  /** The package resolved. */
  package: string;
  /** The tool that produced its manifest. */
  tool: string;
  /** How many functions it exports. */
  count: number;
}

/**
 * The packages an IR imports from — every distinct `East.importFunction`
 * package name in it.
 */
export function importedPackages(ir: unknown): string[] {
  const names = new Set<string>();
  walkIR(ir as any, (node) => {
    if (node.type !== 'Platform' || node.value.name !== IMPORT_PLATFORM) return;
    const first = (node.value.arguments as any[])[0];
    if (first?.type === 'Value' && typeof first.value?.value?.value === 'string') names.add(first.value.value.value as string);
  });
  return [...names];
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

/**
 * Exports a python workspace member's `east_functions` as a manifest, in its
 * own environment: `east-py export-functions <package> --name <package>
 * [-p provider…]` with the member's source roots on `PYTHONPATH`, so the
 * package imports whether or not it is installed.
 *
 * @throws {Error} Naming the owner and the package: no `east-py` to run, or
 *   an export the tool refused (its own message — no `east_functions`, a
 *   platform call no provider implements, a function that is not closed)
 */
export function exportPythonManifest(pkg: string, dir: string, version: string | null, providers: string[], owner: string): FunctionManifest {
  const eastPy = findEastPy(dir);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-functions-'));
  const out = path.join(outDir, `${pkg}.functions.beast2`);
  const module = pkg.replace(/-/g, '_');
  const args = ['export-functions', module, '-o', out, '--name', pkg, ...(version === null ? [] : ['--package-version', version])];
  for (const p of providers) args.push('-p', p);
  const roots = [path.join(dir, 'src'), dir].filter((d) => fs.existsSync(d));
  const pythonPath = [...roots, process.env['PYTHONPATH'] ?? ''].filter((p) => p !== '').join(path.delimiter);
  try {
    execFileSync(eastPy, args, {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONPATH: pythonPath },
      shell: process.platform === 'win32',
    });
    return decodeFunctionManifest(new Uint8Array(fs.readFileSync(out)));
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: Buffer };
    if (e.code === 'ENOENT') {
      throw new Error(
        `${owner} imports from "${pkg}", a package of this workspace at '${dir}', but no east-py is available to export its functions — ` +
        `install east-py-cli in the project's .venv (uv add east-py-cli) or on PATH, or pass the package's manifest in \`functions:\``,
      );
    }
    const stderr = e.stderr?.toString().trim() ?? String(err);
    throw new Error(`${owner} imports from "${pkg}": 'east-py ${args.join(' ')}' failed in '${dir}':\n${stderr}`);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
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
 * Exports a node workspace member's `eastFunctions` as a manifest, in its
 * own environment: `east-node export-functions <entry> --name <package>
 * [-p provider…]` in the member's directory, `<entry>` its built
 * `./functions` export.
 *
 * @throws {Error} Naming the owner and the package: no `./functions` export
 *   or an unbuilt one, no `east-node` to run, or an export the tool refused
 *   (its own message — no `eastFunctions`, a platform call no provider
 *   implements, a function that is not closed)
 */
export function exportNodeManifest(pkg: string, dir: string, version: string | null, providers: string[], owner: string): FunctionManifest {
  const entry = nodeFunctionsEntry(pkg, dir, owner);
  const eastNode = findEastNode(dir);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-functions-'));
  const out = path.join(outDir, `${pkg.replace(/[^\w.-]+/g, '_')}.functions.beast2`);
  const args = ['export-functions', entry, '-o', out, '--name', pkg, ...(version === null ? [] : ['--package-version', version])];
  for (const p of providers) args.push('-p', p);
  try {
    execFileSync(eastNode.command, [...eastNode.args, ...args], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    return decodeFunctionManifest(new Uint8Array(fs.readFileSync(out)));
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: Buffer };
    if (e.code === 'ENOENT') {
      throw new Error(
        `${owner} imports from "${pkg}", a package of this workspace at '${dir}', but no east-node is available to export its functions — ` +
        `install @elaraai/east-node-cli in the project (npm install -D @elaraai/east-node-cli) or on PATH, or pass the package's manifest in \`functions:\``,
      );
    }
    const stderr = e.stderr?.toString().trim() ?? String(err);
    throw new Error(`${owner} imports from "${pkg}": 'east-node ${args.join(' ')}' failed in '${dir}':\n${stderr}`);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

/** A workspace member an import resolves to: which workspace holds it, where, and its version. */
type Member = { kind: 'python' | 'node'; dir: string; version: string | null };

/**
 * The manifests for every imported package the explicit ones do not cover,
 * produced from the workspace (#652). One export per distinct package and
 * provider set; a package that is not a local workspace member is an error
 * naming the import.
 *
 * @param references - Every import an owner's IR makes, with its runner
 * @param explicit - The manifests the export was given (they win)
 * @param anchorDir - Directory the workspace is resolved from (the export cwd)
 * @param onEvent - Progress per resolved package
 * @returns The resolved manifests, in first-reference order
 */
export function resolveFunctionManifests(
  references: ImportReference[],
  explicit: FunctionManifest[],
  anchorDir: string,
  onEvent?: (event: ResolveEvent) => void,
): FunctionManifest[] {
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
  const resolved = new Map<string, FunctionManifest>();
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
    const providers = member.kind === 'python' ? pythonProviders(ref.runner) : nodeProviders(ref.runner);
    const key = `${ref.package}\0${providers.join(',')}`;
    if (resolved.has(key)) continue;
    const manifest = member.kind === 'python'
      ? exportPythonManifest(ref.package, member.dir, member.version, providers, ref.owner)
      : exportNodeManifest(ref.package, member.dir, member.version, providers, ref.owner);
    resolved.set(key, manifest);
    onEvent?.({ package: ref.package, tool: `${member.kind === 'python' ? 'east-py' : 'east-node'} export-functions`, count: manifest.functions.length });
  }
  return [...resolved.values()];
}

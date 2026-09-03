/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Self-resolving cross-language imports at export (#652).
 *
 * `East.importFunction(pkg, name, type)` names a package. Where that
 * package is a member of the uv workspace the export runs in — resolved the
 * way a `{ custom }` platform is, by name against the governing `uv.lock` —
 * its function manifest is produced here, in the package's own environment
 * (`east-py export-functions`), and linked exactly as an explicit
 * `functions:` manifest would be. The user writes the reference and nothing
 * else; the platform DX. A manifest passed explicitly wins for its package
 * (a package built elsewhere, a published one); a referenced package that is
 * neither given nor a local member is an export error naming the import.
 *
 * Providers — the packages implementing the platform functions an exported
 * function calls — come from the importing owner's runner: a stock platform
 * maps to its python family member (`@elaraai/east-node-std` → `east-py-std`),
 * a `{ custom }` name passes through on an east-py runner. The exporter
 * records them per dependency, so the runner check at link is unchanged.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { walkIR, decodeFunctionManifest, IMPORT_PLATFORM, type FunctionManifest } from '@elaraai/east';
import { STOCK_PLATFORM_FAMILIES, type Runner } from './runner.js';
import { pythonWorkspaceMember } from './environment-capture.js';

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

/**
 * The python platform packages an owner's runner implies for the exporter's
 * `-p`: each stock platform's python family member, and a `{ custom }` name
 * as it stands on an east-py runner (on another runtime it is that runtime's
 * package and cannot be loaded by python). A custom-command runner implies
 * nothing.
 */
export function pythonProviders(runner: Runner | undefined): string[] {
  if (runner === undefined || runner.runtime === 'custom') return [];
  const out = new Set<string>();
  for (const p of runner.platforms ?? []) {
    if (typeof p === 'string') {
      const family = STOCK_PLATFORM_FAMILIES.find((f) => f.includes(p));
      const python = family?.find((n) => n.startsWith('east-py-'));
      if (python !== undefined) out.add(python);
    } else if (runner.runtime === 'east-py') {
      out.add(p.custom);
    }
  }
  return [...out].sort();
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
  const resolved = new Map<string, FunctionManifest>();
  for (const ref of references) {
    if (covered.has(ref.package)) continue;
    const providers = pythonProviders(ref.runner);
    const key = `${ref.package}\0${providers.join(',')}`;
    if (resolved.has(key)) continue;
    const member = pythonWorkspaceMember(ref.package, anchorDir, ref.owner);
    if (member === null) {
      throw new Error(
        `${ref.owner} imports from "${ref.package}", but no function manifest was given for it and it is not a member of the uv workspace ` +
        `at or above '${anchorDir}' — add the package to the workspace (its root module declaring \`east_functions\`), ` +
        `or export it where it lives (east-py export-functions / east-node export-functions) and pass the manifest in \`functions:\``,
      );
    }
    const manifest = exportPythonManifest(ref.package, member.dir, member.version, providers, ref.owner);
    resolved.set(key, manifest);
    onEvent?.({ package: ref.package, tool: 'east-py export-functions', count: manifest.functions.length });
  }
  return [...resolved.values()];
}

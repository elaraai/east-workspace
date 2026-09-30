/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The seams e3-core's shared code goes through.
 *
 * A mechanism another backend needs reaches storage, locks and compute only
 * through the interfaces a backend implements, so a shared module never
 * imports the local backend, nor reaches into the machine's filesystem on a
 * repository's behalf, nor judges a process alive on the host that answers.
 * The modules that may are listed below, each with why; an entry that no
 * longer needs its exception fails too, so the list only shrinks.
 *
 * And the portable entry (`portable.ts`) runs wherever JavaScript does: every
 * module it reaches imports only another of them, East and e3's types, and
 * names none of Node's globals.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, posix, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/** e3-core's sources: the spec runs from `dist/src`. */
const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

/** Every source module, by its path under `src`, forward-slashed. */
function sources(): string[] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .map((file) => file.split(sep).join('/'))
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts') && !file.endsWith('.d.ts'));
}

/** The module specifiers a source imports, statically or dynamically. */
function imports(file: string): string[] {
  const text = readFileSync(join(SRC, file), 'utf8');
  return [...text.matchAll(/(?:from|import\()\s*'([^']+)'/g)].map((match) => match[1]!);
}

/** Whether a path falls under one of the directories, or is one of the files. */
function within(file: string, places: readonly string[]): boolean {
  return places.some((place) => place.endsWith('/') ? file.startsWith(place) : file === place);
}

/**
 * The local backend and the local runner, which are local by what they are:
 * the modules that run a unit as a process on this machine and judge its
 * processes here. The rest of `execution/` — the engine and its drivers, the
 * planners, the runner interface — is shared, and every backend's driver runs
 * it.
 */
const LOCAL = [
  'storage/local/',
  'execution/LocalTaskRunner.ts', 'execution/processExec.ts', 'execution/processHelpers.ts', 'execution/runDetached.ts',
  'execution/intake.ts', 'execution/units.ts', 'execution/environment.ts', 'execution/scratch.ts', 'execution/budget.ts',
  'execution/cgroups.ts', 'execution/memory.ts', 'execution/segment-fetch.ts', 'execution/local-orchestrator.ts',
];

/** Test support: it creates local repositories and temporary files for tests. */
const TEST_SUPPORT = ['test-helpers.ts', 'contract/'];

/** The modules besides {@link LOCAL} that may import the local backend, and why. */
const LOCAL_IMPORTS: Record<string, string> = {
  'index.ts': 'the package exports the local backend beside the interfaces',
  'storage/index.ts': 'the storage barrel exports the local backend beside the interfaces',
  'dataflow/state-store/FileStateStore.ts': 'the local implementation of the execution state store',
  'transfer/InMemoryTransferBackend.ts': 'the local server\'s transfer backend, which stages in the repository',
};

/** The modules besides {@link LOCAL} that may use the machine's filesystem, and why. */
const FILE_SYSTEM: Record<string, string> = {
  'dataflow/state-store/FileStateStore.ts': 'the local implementation of the execution state store',
  'transfer/InMemoryTransferBackend.ts': 'the local server\'s transfer backend, which stages in the repository',
  'transfer/process-files.ts': 'a zip job given a file reads or writes it on the machine that runs it',
  'package-files.ts': 'an import reads, and an export writes, a zip given as a file on this machine',
  'workspace-files.ts': 'an export writes a zip given as a file, and a deploy reads a `file` source, on this machine',
  'dataset-adopt-file.ts': 'an adoption takes in a file on this machine',
  'delivery-intake-file.ts': 'an intake reads the index of a delivered file on this machine, to cut it into pieces',
  'store-collection-file.ts': 'the store\'s door reads a runner\'s output files on this machine',
  'formats.ts': 'the CLI\'s formats read and write a user\'s files on this machine',
  'storage/in-memory/InMemoryStorage.ts': 'its object store adopts and materializes files on this machine, as the interface asks',
};

/** Whether a specifier names the local backend. */
const isLocalBackend = (specifier: string): boolean => /(^|\/)storage\/local\/|^\.\/local\//.test(specifier);

/** Whether a specifier names the filesystem or the OS. */
const isFileSystem = (specifier: string): boolean => /^(node:)?(fs|fs\/promises|os)$/.test(specifier);

/** Whether a source judges a pid alive, which only the host running the
 *  process can. */
const judgesProcessAlive = (file: string): boolean =>
  /\b(?:isProcessAlive|processExited)\s*\(/.test(readFileSync(join(SRC, file), 'utf8'));

/** The arguments of each call a source makes of the execution cache's probe. */
const probeCalls = (file: string): string[][] =>
  [...readFileSync(join(SRC, file), 'utf8').matchAll(/\bprobeExecutionCache\s*\(([^()]*)\)/g)]
    .map((match) => match[1]!.split(',').map((arg) => arg.trim()).filter((arg) => arg !== ''));

describe('the seams shared code goes through', () => {
  it('no shared module imports the local backend', () => {
    const reaching = sources()
      .filter((file) => !within(file, [...LOCAL, ...TEST_SUPPORT]) && !(file in LOCAL_IMPORTS))
      .filter((file) => imports(file).some(isLocalBackend));
    assert.deepEqual(reaching, [], 'these reach into the local backend: go through the storage interfaces instead');
  });

  it('no shared module uses the machine\'s filesystem on a repository\'s behalf', () => {
    const reaching = sources()
      .filter((file) => !within(file, [...LOCAL, ...TEST_SUPPORT]) && !(file in FILE_SYSTEM))
      .filter((file) => imports(file).some(isFileSystem));
    assert.deepEqual(reaching, [], 'these use the filesystem: go through the storage interfaces, or say why here');
  });

  it('no shared module judges a process alive on the host that answers', () => {
    const judging = sources()
      .filter((file) => !within(file, [...LOCAL, ...TEST_SUPPORT]))
      .filter(judgesProcessAlive);
    assert.deepEqual(judging, [], 'these judge a pid alive where they run: ask the runner (TaskRunner.executionAlive) or the lock service (LockService.isHolderAlive)');
  });

  it('no shared module probes the execution cache without the liveness it was given', () => {
    // Without one the probe judges on the host that runs it, and rewrites a
    // unit still running on another host as interrupted.
    const probing = sources()
      .filter((file) => !within(file, [...LOCAL, ...TEST_SUPPORT]))
      .filter((file) => probeCalls(file).some((args) => args.length < 5));
    assert.deepEqual(probing, [], 'these probe with the local judgement of what still runs: pass the liveness the driver was given (TaskRunner.executionAlive)');
  });

  it('every exception is still one', () => {
    for (const [list, needs] of [[LOCAL_IMPORTS, isLocalBackend], [FILE_SYSTEM, isFileSystem]] as const) {
      for (const file of Object.keys(list)) {
        assert.ok(existsSync(join(SRC, file)), `${file} is gone: remove its exception`);
        assert.ok(imports(file).some(needs), `${file} no longer needs its exception: remove it`);
      }
    }
    for (const place of LOCAL) assert.ok(existsSync(join(SRC, place)), `${place} is gone: remove it from the local modules`);
  });
});

/** The packages a portable module may import: East, and e3's types. */
const PORTABLE_PACKAGES: ReadonlySet<string> = new Set(['@elaraai/east', '@elaraai/east/internal', '@elaraai/e3-types']);

/** Node's globals, which a portable module never names: a browser has none of
 *  them. */
const NODE_GLOBALS: ReadonlySet<string> = new Set(['Buffer', 'process', 'require', '__dirname', '__filename', 'global']);

/** The names of the global object, through which a Node global is reached as
 *  surely as by its own name. */
const GLOBAL_OBJECTS: ReadonlySet<string> = new Set(['globalThis', 'global', 'self', 'window']);

/**
 * The module a node imports: its specifier; `null` when the import computes
 * it; `undefined` when the node imports nothing.
 *
 * @remarks
 * Every import counts, whatever it carries: a static import or re-export, a
 * type-only one, a dynamic `import()`, an `import('…')` type, a CommonJS
 * `import x = require(…)`, and a module declaration. A type-only import of a
 * Node module still needs Node's types to compile against.
 */
function importedBy(node: ts.Node): string | null | undefined {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
    return ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null;
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    return ts.isStringLiteral(node.moduleReference.expression) ? node.moduleReference.expression.text : null;
  }
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const specifier = node.arguments[0];
    return specifier !== undefined && ts.isStringLiteralLike(specifier) ? specifier.text : null;
  }
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
    return node.argument.literal.text;
  }
  if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) return node.name.text;
  return undefined;
}

/** Whether an identifier is the name of a member — a property, a method, an
 *  accessor, a key a binding reads, a name imported or exported — rather than
 *  a reference to a variable. */
function namesMember(node: ts.Identifier): boolean {
  const parent = node.parent;
  if ((ts.isPropertyAccessExpression(parent) || ts.isQualifiedName(parent)) && (ts.isPropertyAccessExpression(parent) ? parent.name : parent.right) === node) {
    return true;
  }
  if ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent)
    || ts.isMethodSignature(parent) || ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent) || ts.isEnumMember(parent))
    && parent.name === node) {
    return true;
  }
  if (ts.isBindingElement(parent) && parent.propertyName === node) return true;
  return ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent);
}

/** The Node global a node names, or `null`: by its own name, or as the global
 *  object's property. */
function nodeGlobalOf(node: ts.Node): string | null {
  if (ts.isIdentifier(node) && NODE_GLOBALS.has(node.text) && !namesMember(node)) return node.text;
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && GLOBAL_OBJECTS.has(node.expression.text)
    && NODE_GLOBALS.has(node.name.text)) {
    return `${node.expression.text}.${node.name.text}`;
  }
  if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && GLOBAL_OBJECTS.has(node.expression.text)
    && ts.isStringLiteralLike(node.argumentExpression) && NODE_GLOBALS.has(node.argumentExpression.text)) {
    return `${node.expression.text}.${node.argumentExpression.text}`;
  }
  return null;
}

/**
 * Walks a module graph from `entry` through the modules it imports relatively,
 * and says where it reaches beyond them: an import of a Node builtin or of any
 * package but East and e3's types, an import of a module that is not there or
 * whose name is computed, and a use of Node's globals.
 *
 * @param entry - The entry module, by its path, forward-slashed
 * @param read - Reads a module's text by its path, or gives `null` for none
 * @returns The modules the walk reached, sorted, and each fault, by the file
 *   and line it is on
 */
function portableGraph(entry: string, read: (file: string) => string | null): { modules: string[]; faults: string[] } {
  const reached = new Set<string>();
  const faults: string[] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (reached.has(file)) continue;
    const text = read(file);
    if (text === null) {
      faults.push(`${file} is no module`);
      continue;
    }
    reached.add(file);
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
    const at = (node: ts.Node): string => `${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
    const visit = (node: ts.Node): void => {
      const specifier = importedBy(node);
      if (specifier === null) {
        faults.push(`${at(node)} imports a module it computes`);
      } else if (specifier !== undefined && specifier.startsWith('.')) {
        const target = posix.normalize(posix.join(posix.dirname(file), specifier)).replace(/\.js$/, '.ts');
        if (read(target) === null) faults.push(`${at(node)} imports ${specifier}, which is no module`);
        else queue.push(target);
      } else if (specifier !== undefined && !PORTABLE_PACKAGES.has(specifier)) {
        faults.push(`${at(node)} imports ${specifier}`);
      }
      const global = nodeGlobalOf(node);
      if (global !== null) faults.push(`${at(node)} uses ${global}`);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { modules: [...reached].sort(), faults };
}

describe('the portable entry', () => {
  /** A graph of modules held in memory, by path. */
  const graph = (modules: Record<string, string>) => (file: string): string | null => modules[file] ?? null;

  it('reaches nothing but its own modules, East and e3\'s types, and names none of Node\'s globals', () => {
    const { modules, faults } = portableGraph('portable.ts', (file) => {
      const path = join(SRC, file);
      return existsSync(path) ? readFileSync(path, 'utf8') : null;
    });
    assert.deepEqual(faults, [], 'these reach beyond the portable modules: move what needs Node to a module of the root entry');
    for (const carried of ['dataflow/orchestrator/LocalOrchestrator.ts', 'execution/engine.ts', 'execution/cache.ts', 'store-collection.ts', 'workspaces.ts', 'gc.ts']) {
      assert.ok(modules.includes(carried), `the walk reached ${carried}`);
    }
  });

  it('fails a module that reaches Node, or a package besides East and e3\'s types, however far from the entry', () => {
    const cases: [what: string, modules: Record<string, string>, faults: string[]][] = [
      ['a builtin', { 'entry.ts': "import { readFile } from 'node:fs/promises';" }, ['entry.ts:1 imports node:fs/promises']],
      ['a builtin by its bare name', { 'entry.ts': "import * as fs from 'fs';" }, ['entry.ts:1 imports fs']],
      ['a type-only import', { 'entry.ts': "import type { Writable } from 'node:stream';" }, ['entry.ts:1 imports node:stream']],
      ['a re-export', { 'entry.ts': "export { createHash } from 'node:crypto';" }, ['entry.ts:1 imports node:crypto']],
      ['a dynamic import', { 'entry.ts': "export const load = () => import('node:zlib');" }, ['entry.ts:1 imports node:zlib']],
      ['an import it computes', { 'entry.ts': 'export const load = (name: string) => import(name);' }, ['entry.ts:1 imports a module it computes']],
      ['an import type', { 'entry.ts': "export type Sink = import('node:stream').Writable;" }, ['entry.ts:1 imports node:stream']],
      ['another package', { 'entry.ts': "import yauzl from 'yauzl';" }, ['entry.ts:1 imports yauzl']],
      ['the SDK', { 'entry.ts': "import { readDatasetFileHeader } from '@elaraai/e3';" }, ['entry.ts:1 imports @elaraai/e3']],
      ['a module further on', {
        'entry.ts': "export * from './a.js';",
        'a.ts': "export { b } from './sub/b.js';",
        'sub/b.ts': "import { randomUUID } from 'node:crypto';\nexport const b = randomUUID;",
      }, ['sub/b.ts:1 imports node:crypto']],
      ['a module that is not there', { 'entry.ts': "import './gone.js';" }, ['entry.ts:1 imports ./gone.js, which is no module']],
      ['Buffer', { 'entry.ts': 'export const bytes = (text: string) => Buffer.from(text);' }, ['entry.ts:1 uses Buffer']],
      ['process', { 'entry.ts': 'export const home = () => process.env.HOME;' }, ['entry.ts:1 uses process']],
      ['process through the global object', { 'entry.ts': 'export const env = () => globalThis.process?.env;' }, ['entry.ts:1 uses globalThis.process']],
      ['Buffer by the global object\'s key', { 'entry.ts': "export const B = globalThis['Buffer'];" }, ['entry.ts:1 uses globalThis.Buffer']],
    ];
    for (const [what, modules, faults] of cases) {
      assert.deepEqual(portableGraph('entry.ts', graph(modules)).faults, faults, what);
    }
  });

  it('passes a graph that reaches only its own modules, East and e3\'s types, and names Node\'s globals only as members', () => {
    const { modules, faults } = portableGraph('entry.ts', graph({
      'entry.ts': [
        "import { variant } from '@elaraai/east';",
        "import type { TaskObject } from '@elaraai/e3-types';",
        "export * from './a.js';",
        "export const load = () => import('./b.js');",
        'export type Task = TaskObject;',
        'export const none = variant;',
      ].join('\n'),
      'a.ts': [
        'export const record = { process: 1, Buffer: 2 };',
        'export interface Shape { process: number; Buffer: string }',
        'export const read = (shape: Shape) => shape.process + shape.Buffer.length;',
      ].join('\n'),
      'b.ts': "export type Read = import('./a.js').Shape;",
    }));
    assert.deepEqual(faults, []);
    assert.deepEqual(modules, ['a.ts', 'b.ts', 'entry.ts']);
  });
});

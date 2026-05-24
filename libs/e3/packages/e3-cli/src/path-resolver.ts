/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Dataset path resolver.
 *
 * Users address datasets with the flat form `<ws>.<name>`. The on-disk storage
 * uses `<ws>/inputs/<name>` for inputs and `<ws>/tasks/<name>/output` for task
 * outputs. The resolver maps between them, consulting the workspace tree to
 * discover which kind a name refers to.
 *
 * The async wrappers (`buildWorkspaceIndex`, `resolveDatasetPath`) fetch the
 * workspace tree once per call. The pure helpers (`indexFromTree`,
 * `indexFromRemoteEntries`, `resolveDatasetPathFromIndex`) take the index
 * directly and are used by unit tests.
 */

import {
  workspaceGetTree,
  LocalStorage,
  type TreeNode,
} from '@elaraai/e3-core';
import {
  datasetListRecursive,
  type ListEntry,
} from '@elaraai/e3-api-client';
import { variant } from '@elaraai/east';
import { parseDatasetPath } from '@elaraai/e3-types';
import type { TreePath } from '@elaraai/e3-types';
import type { RepoLocation } from './utils.js';

/** Kind of a resolved dataset. */
export type DatasetKind = 'input' | 'task-output' | 'other';

/** A resolved dataset entry from the workspace. */
export interface ResolvedEntry {
  /** The short name a user types (e.g. `greet`). */
  name: string;
  /** Storage TreePath (e.g. `[tasks, greet, output]`). */
  storage: TreePath;
  /** Whether this is an input, task output, or something else. */
  kind: DatasetKind;
}

/** Result of a successful path resolution. */
export interface ResolvedPath {
  ws: string;
  /** Storage TreePath (always the canonical on-disk path). */
  path: TreePath;
  /** The kind of dataset resolved. */
  kind: DatasetKind;
}

// =============================================================================
// Pure helpers (unit-testable without a repo)
// =============================================================================

/**
 * Build an index from a workspace tree as returned by `workspaceGetTree`.
 *
 * Pure. Leaf nodes under `inputs/` become `kind: 'input'`. Leaf nodes under
 * `tasks/` become `kind: 'task-output'` and the storage path gains the
 * `output` suffix (because `workspaceGetTree` collapses task subtrees).
 * Leaves elsewhere get `kind: 'other'` with a dotted name.
 */
export function indexFromTree(tree: TreeNode[]): ResolvedEntry[] {
  return collectEntries(tree, []);
}

/**
 * Build an index from remote `datasetListRecursive` entries.
 *
 * Pure. Each entry's path is a dot-separated string; same partitioning rules
 * as `indexFromTree`.
 */
export function indexFromRemoteEntries(items: ListEntry[]): ResolvedEntry[] {
  const out: ResolvedEntry[] = [];
  for (const item of items) {
    if (item.type !== 'dataset') continue;
    const segments = item.value.path.split('.').filter((s) => s.length > 0);
    if (segments.length === 0) continue;
    const name = segments[segments.length - 1]!;
    const prefix = segments.slice(0, -1);
    out.push(entryForLeaf(name, prefix));
  }
  return out;
}

/**
 * Resolve a flat dataset path against a pre-built index.
 *
 * Pure. Implements the same rules as `resolveDatasetPath` but takes the
 * index as a parameter so unit tests don't need a repo.
 *
 * @throws Error with suggestions when the name is unknown or ambiguous.
 */
export function resolveDatasetPathFromIndex(
  pathSpec: string,
  index: ResolvedEntry[],
): ResolvedPath {
  const { ws, path: parsed } = parseDatasetPath(pathSpec);

  if (parsed.length === 0) {
    throw new Error(`Path must include a name (e.g. '${ws}.<name>')`);
  }

  const head = String(parsed[0]!.value);
  const rest = parsed.slice(1).map((s) => String(s.value));

  // Detect tree paths (no sub-name given).
  if ((head === 'inputs' || head === 'tasks') && rest.length === 0) {
    throw new Error(
      `'${ws}.${head}' is a tree, not a dataset. Use '${ws}.<name>' to address a specific dataset.`,
    );
  }

  // Detect legacy forms and reject with a friendly message.
  if (head === 'inputs' && rest.length === 1) {
    throw new Error(
      `Use the short form: '${ws}.${rest[0]!}' instead of '${ws}.inputs.${rest[0]!}'.`,
    );
  }
  if (head === 'tasks' && rest.length === 2 && rest[1] === 'output') {
    throw new Error(
      `Use the short form: '${ws}.${rest[0]!}' instead of '${ws}.tasks.${rest[0]!}.output'.`,
    );
  }

  // Detect access to internal task datasets (e.g. tasks.double.function_ir) — not writable.
  if (head === 'tasks' && rest.length >= 2 && rest[rest.length - 1] !== 'output') {
    throw new Error(
      `'${ws}.tasks.${rest.join('.')}' is not writable. Only inputs and task outputs can be read or written.`,
    );
  }

  const matches = index.filter((e) => e.name === head);
  if (matches.length === 0) {
    throw notFoundError(ws, head, index);
  }
  if (matches.length > 1) {
    throw ambiguousError(ws, head, matches);
  }
  const match = matches[0]!;

  if (rest.length > 0) {
    throw new Error(
      `Nested field access ('${pathSpec}') is not supported; ` +
        `read the full value with 'e3 dataset get ${ws}.${head}' and select the field.`,
    );
  }

  return { ws, path: match.storage, kind: match.kind };
}

// =============================================================================
// Async wrappers (fetch the tree, then delegate to pure helpers)
// =============================================================================

/**
 * Fetch the workspace tree and build an index of every dataset reachable
 * by its short name.
 */
export async function buildWorkspaceIndex(
  location: RepoLocation,
  ws: string,
): Promise<ResolvedEntry[]> {
  if (location.type === 'local') {
    const storage = new LocalStorage();
    const tree = await workspaceGetTree(storage, location.path, ws, []);
    return indexFromTree(tree);
  }

  const items = await datasetListRecursive(
    location.baseUrl,
    location.repo,
    ws,
    [],
    { token: location.token },
  );
  return indexFromRemoteEntries(items);
}

/**
 * Resolve a flat dataset path (`<ws>.<name>`) to a canonical storage path,
 * fetching the workspace index as needed.
 */
export async function resolveDatasetPath(
  location: RepoLocation,
  pathSpec: string,
): Promise<ResolvedPath> {
  const { ws } = parseDatasetPath(pathSpec);
  const index = await buildWorkspaceIndex(location, ws);
  return resolveDatasetPathFromIndex(pathSpec, index);
}

// =============================================================================
// Internal helpers
// =============================================================================

function collectEntries(nodes: TreeNode[], prefix: string[]): ResolvedEntry[] {
  const out: ResolvedEntry[] = [];
  for (const node of nodes) {
    if (node.kind === 'dataset') {
      out.push(entryForLeaf(node.name, prefix));
    } else if (node.kind === 'tree') {
      out.push(...collectEntries(node.children, [...prefix, node.name]));
    }
  }
  return out;
}

function entryForLeaf(name: string, prefix: string[]): ResolvedEntry {
  if (prefix.length === 1 && prefix[0] === 'tasks') {
    return {
      name,
      kind: 'task-output',
      storage: toTreePath(['tasks', name, 'output']),
    };
  }
  // customTask outputs are stored as tasks/<taskName>/output (one level deeper)
  if (prefix.length === 2 && prefix[0] === 'tasks' && name === 'output') {
    const taskName = prefix[1]!;
    return {
      name: taskName,
      kind: 'task-output',
      storage: toTreePath(['tasks', taskName, 'output']),
    };
  }
  if (prefix.length === 1 && prefix[0] === 'inputs') {
    return {
      name,
      kind: 'input',
      storage: toTreePath(['inputs', name]),
    };
  }
  return {
    name: [...prefix, name].join('.'),
    kind: 'other',
    storage: toTreePath([...prefix, name]),
  };
}

function toTreePath(segments: string[]): TreePath {
  return segments.map((s) => variant('field', s));
}

function notFoundError(ws: string, name: string, index: ResolvedEntry[]): Error {
  const suggestions = suggestSimilar(name, index.map((e) => e.name), 5);
  let msg = `'${ws}.${name}' not found in workspace '${ws}'.`;
  if (suggestions.length > 0) {
    msg += ` Did you mean:\n`;
    for (const s of suggestions) {
      const entry = index.find((e) => e.name === s)!;
      msg += `  ${ws}.${s}  (${entry.kind})\n`;
    }
    msg = msg.replace(/\n$/, '');
  } else if (index.length > 0) {
    msg += ` Available names:\n`;
    for (const e of index.slice(0, 10)) {
      msg += `  ${ws}.${e.name}  (${e.kind})\n`;
    }
    if (index.length > 10) msg += `  ... and ${index.length - 10} more`;
    msg = msg.replace(/\n$/, '');
  }
  return new Error(msg);
}

function ambiguousError(ws: string, name: string, matches: ResolvedEntry[]): Error {
  const lines = matches.map((m) => `  ${ws}.${name}  (${m.kind})`);
  return new Error(
    `'${ws}.${name}' is ambiguous. Multiple datasets share this name:\n${lines.join('\n')}`,
  );
}

/**
 * Return the candidates most similar to `target`, sorted best-first.
 *
 * Uses Levenshtein distance with a relative threshold so short typos near
 * short names still match (e.g. `gret` → `greet`). Candidates with distance
 * exceeding the threshold are filtered out.
 */
export function suggestSimilar(
  target: string,
  candidates: string[],
  max: number,
): string[] {
  if (candidates.length === 0) return [];
  const scored = candidates
    .map((c) => ({ c, d: levenshtein(target, c) }))
    .sort((a, b) => a.d - b.d);

  const threshold = Math.max(2, Math.floor(target.length / 2));
  return scored
    .filter((s) => s.d <= threshold)
    .slice(0, max)
    .map((s) => s.c);
}

/** Standard Levenshtein edit distance. Exported for testing. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j]! + 1,
        curr[j - 1]! + 1,
        prev[j - 1]! + cost,
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!;
  }
  return prev[b.length]!;
}

/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 list command - List workspaces or dataset paths in a workspace
 *
 * Usage:
 *   e3 list .              # List all workspaces
 *   e3 list . ws           # List all dataset paths in workspace (flat form)
 *   e3 list . ws -l        # Same, with type/kind/status/size columns
 */

import {
  workspaceList,
  workspaceGetState,
  workspaceGetTree,
  LocalStorage,
  type TreeNode,
} from '@elaraai/e3-core';
import {
  workspaceList as workspaceListRemote,
  datasetListRecursive as datasetListRecursiveRemote,
  type ListEntry,
} from '@elaraai/e3-api-client';
import { printFor, EastTypeType, type EastTypeValue } from '@elaraai/east';
import { parseRepoLocation, formatError, exitError } from '../utils.js';
import { formatSize } from '../format.js';

const printTypeValue = printFor(EastTypeType);

interface ListOptions {
  long?: boolean;
}

interface Row {
  name: string;
  kind: 'input' | 'task' | 'other';
  type: string;
  status: string;
  size: string;
}

/**
 * List workspaces (no path) or flat dataset paths in a workspace.
 */
export async function listCommand(repoArg: string, pathSpec: string | undefined, options: ListOptions): Promise<void> {
  try {
    const location = await parseRepoLocation(repoArg);
    const long = options.long ?? false;

    if (!pathSpec) {
      await listWorkspaces(location);
      return;
    }

    const ws = pathSpec;
    const rows = location.type === 'local'
      ? await collectRowsLocal(location.path, ws)
      : await collectRowsRemote(location.baseUrl, location.repo, ws, location.token);

    if (rows.length === 0) {
      console.log('(empty)');
      return;
    }

    rows.sort((a, b) => a.name.localeCompare(b.name));

    if (long) {
      printTable(rows);
    } else {
      for (const row of rows) {
        console.log(row.name);
      }
    }
  } catch (err) {
    exitError(formatError(err));
  }
}

async function listWorkspaces(location: Awaited<ReturnType<typeof parseRepoLocation>>): Promise<void> {
  if (location.type === 'local') {
    const storage = new LocalStorage();
    const workspaces = await workspaceList(storage, location.path);
    if (workspaces.length === 0) {
      console.log('No workspaces');
      return;
    }
    for (const ws of workspaces) {
      const state = await workspaceGetState(storage, location.path, ws);
      if (state) {
        console.log(`${ws}  (${state.packageName}@${state.packageVersion})`);
      } else {
        console.log(`${ws}  (not deployed)`);
      }
    }
    return;
  }

  const workspaces = await workspaceListRemote(location.baseUrl, location.repo, { token: location.token });
  if (workspaces.length === 0) {
    console.log('No workspaces');
    return;
  }
  for (const ws of workspaces) {
    if (ws.deployed && ws.packageName.type === 'some' && ws.packageVersion.type === 'some') {
      console.log(`${ws.name}  (${ws.packageName.value}@${ws.packageVersion.value})`);
    } else {
      console.log(`${ws.name}  (not deployed)`);
    }
  }
}

async function collectRowsLocal(repoPath: string, ws: string): Promise<Row[]> {
  const storage = new LocalStorage();
  const tree = await workspaceGetTree(storage, repoPath, ws, [], {
    includeTypes: true,
    includeStatus: true,
  });
  const rows: Row[] = [];
  for (const top of tree) {
    if (top.kind !== 'tree') continue;
    if (top.name !== 'inputs' && top.name !== 'tasks') continue;
    if (top.name === 'inputs') {
      for (const leaf of top.children) {
        if (leaf.kind !== 'dataset') continue;
        rows.push(leafToRow(ws, leaf.name, 'input', leaf));
      }
    } else {
      for (const child of top.children) {
        if (child.kind === 'dataset') {
          // flat task output: tasks/<name>
          rows.push(leafToRow(ws, child.name, 'task', child));
        } else if (child.kind === 'tree') {
          // customTask output: tasks/<name>/output
          for (const leaf of child.children) {
            if (leaf.kind !== 'dataset' || leaf.name !== 'output') continue;
            rows.push(leafToRow(ws, child.name, 'task', leaf));
          }
        }
      }
    }
  }
  return rows;
}

async function collectRowsRemote(baseUrl: string, repo: string, ws: string, token: string): Promise<Row[]> {
  const items = await datasetListRecursiveRemote(baseUrl, repo, ws, [], { token });
  const rows: Row[] = [];
  for (const item of items) {
    if (item.type !== 'dataset') continue;
    const segments = item.value.path.split('.').filter(s => s.length > 0);
    if (segments.length !== 2) continue;
    const [head, name] = segments;
    if (head !== 'inputs' && head !== 'tasks') continue;
    const kind = head === 'inputs' ? 'input' : 'task';
    rows.push(remoteEntryToRow(ws, name!, kind, item));
  }
  return rows;
}

function leafToRow(ws: string, name: string, kind: 'input' | 'task', node: TreeNode & { kind: 'dataset' }): Row {
  return {
    name: `${ws}.${name}`,
    kind,
    type: node.datasetType ? safePrintType(node.datasetType) : '-',
    status: leafStatus(node.refType),
    size: leafSize(node.refType, node.size),
  };
}

function remoteEntryToRow(ws: string, name: string, kind: 'input' | 'task', entry: ListEntry & { type: 'dataset' }): Row {
  const v = entry.value;
  const hasHash = v.hash.type === 'some';
  const hasSize = v.size.type === 'some';
  let status: string;
  let size: string;
  if (!hasHash && !hasSize) {
    status = 'unset';
    size = '-';
  } else if (hasSize && v.size.value === 0n) {
    status = 'set';
    size = '0 B';
  } else {
    status = 'set';
    size = hasSize ? formatSize(Number(v.size.value)) : '-';
  }
  return {
    name: `${ws}.${name}`,
    kind,
    type: safePrintType(v.type),
    status,
    size,
  };
}

function leafStatus(refType: string | undefined): string {
  if (refType === undefined) return '-';
  if (refType === 'unassigned') return 'unset';
  if (refType === 'null') return 'set';
  return 'set';
}

function leafSize(refType: string | undefined, size: number | undefined): string {
  if (refType === 'unassigned') return '-';
  if (refType === 'null') return '0 B';
  if (size !== undefined) return formatSize(size);
  return '-';
}

function safePrintType(type: EastTypeValue): string {
  try {
    return printTypeValue(type);
  } catch {
    return '?';
  }
}

function printTable(rows: Row[]): void {
  const nameW = Math.max(4, ...rows.map(r => r.name.length));
  const kindW = Math.max(4, ...rows.map(r => r.kind.length));
  const typeW = Math.max(4, ...rows.map(r => r.type.length));
  const statusW = Math.max(6, ...rows.map(r => r.status.length));
  const sizeW = Math.max(4, ...rows.map(r => r.size.length));
  const pad = (s: string, w: number) => s.padEnd(w);
  console.log(`${pad('PATH', nameW)}  ${pad('KIND', kindW)}  ${pad('TYPE', typeW)}  ${pad('STATUS', statusW)}  ${pad('SIZE', sizeW)}`);
  for (const r of rows) {
    console.log(`${pad(r.name, nameW)}  ${pad(r.kind, kindW)}  ${pad(r.type, typeW)}  ${pad(r.status, statusW)}  ${pad(r.size, sizeW)}`);
  }
}

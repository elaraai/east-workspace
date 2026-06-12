/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Hidden `e3 __complete <cword> <words...>` handler.
 *
 * Called by the shell completion scripts. Given the position of the cursor
 * and the words on the command line (excluding the leading `e3`), prints
 * newline-separated candidates that the shell uses to populate completion.
 *
 * Static candidates (subcommand names, flag names, enum values) are returned
 * immediately. Dynamic candidates (workspace names, dataset paths) query the
 * relevant list functions; errors are swallowed silently so the shell never
 * sees noise from a missing repo or unreachable server.
 */

import { workspaceList, LocalStorage } from '@elaraai/e3-core';
import { workspaceList as workspaceListRemote } from '@elaraai/e3-api-client';
import { parseRepoLocation, defaultRepoArg } from '../utils.js';
import { buildWorkspaceIndex } from '../path-resolver.js';

// =============================================================================
// Static tables
// =============================================================================

/** Top-level subcommand names. */
const TOP_LEVEL = [
  'repo', 'package', 'workspace', 'dataset', 'task', 'dataflow', 'auth',
  'run', 'call', 'watch', 'convert', 'completion',
];

/** Subcommand names per noun group. */
const SUBCOMMANDS: Record<string, readonly string[]> = {
  repo: ['create', 'remove', 'status', 'gc', 'list'],
  package: ['import', 'export', 'list', 'remove'],
  workspace: ['create', 'remove', 'list', 'status', 'deploy', 'export'],
  dataset: ['get', 'set', 'list', 'status', 'find'],
  task: ['logs', 'list'],
  dataflow: ['run'],
  auth: ['login', 'logout', 'status', 'token', 'whoami'],
  completion: ['bash', 'zsh', 'fish'],
};

/** Enum values for known options. */
const FORMAT_VALUES = ['east', 'json', 'beast2'];

/** Number of dynamic candidates to emit at most. */
const MAX_DYNAMIC_CANDIDATES = 100;

// =============================================================================
// Entry point (commander action wrapper)
// =============================================================================

export async function completeCommand(cwordStr: string, words: string[] = []): Promise<void> {
  for (const c of await completionCandidates(cwordStr, words)) {
    console.log(c);
  }
}

/**
 * Pure(-ish) helper that produces the candidate list for given inputs.
 *
 * Static branches never touch the network or filesystem. Dynamic branches
 * (workspace / dataset path completion) may call out to local storage or
 * the API client — wrapped in try/catch so completion never errors.
 */
export async function completionCandidates(cwordStr: string, words: string[]): Promise<string[]> {
  const cword = Number.parseInt(cwordStr, 10);
  if (!Number.isInteger(cword) || cword < 0) return [];

  const current = words[cword] ?? '';
  const prev = cword > 0 ? words[cword - 1]! : '';

  if (prev === '--format' || prev === '-f') {
    return filterByPrefix(FORMAT_VALUES, current);
  }

  if (cword === 0) {
    return filterByPrefix(TOP_LEVEL, current);
  }

  const cmd = words[0]!;

  if (cword === 1 && SUBCOMMANDS[cmd]) {
    return filterByPrefix(SUBCOMMANDS[cmd]!, current);
  }

  const sub = words[1] ?? '';
  return dispatchPositional(cmd, sub, cword, words, current);
}

// =============================================================================
// Positional dispatcher
// =============================================================================

async function dispatchPositional(
  cmd: string,
  sub: string,
  cword: number,
  words: string[],
  current: string,
): Promise<string[]> {
  // For all noun groups, `<cmd> <sub> <repo> [more...]` puts the repo at index 2.
  const repoIndex = 2;

  if (cword === repoIndex) {
    return filterByPrefix(['.', 'http://', 'https://'], current);
  }

  // dataset.{get,set,status}: third positional is the dotted dataset path.
  if (cmd === 'dataset' && (sub === 'get' || sub === 'set' || sub === 'status') && cword === repoIndex + 1) {
    return completeDatasetPath(words[repoIndex], current);
  }

  // dataset.{list,find}: third positional is the workspace name.
  if (cmd === 'dataset' && (sub === 'list' || sub === 'find') && cword === repoIndex + 1) {
    return completeWorkspaceName(words[repoIndex], current);
  }

  // task.list / dataflow.run: third positional is the workspace name.
  if ((cmd === 'task' && sub === 'list') ||
      (cmd === 'dataflow' && sub === 'run')) {
    if (cword === repoIndex + 1) {
      return completeWorkspaceName(words[repoIndex], current);
    }
  }

  // task.logs: third positional is the dotted task path.
  if (cmd === 'task' && sub === 'logs' && cword === repoIndex + 1) {
    return completeDatasetPath(words[repoIndex], current);
  }

  // workspace.{remove,status,export,deploy}: third positional is the ws name.
  if (cmd === 'workspace' &&
      (sub === 'remove' || sub === 'status' || sub === 'export' || sub === 'deploy') &&
      cword === repoIndex + 1) {
    return completeWorkspaceName(words[repoIndex], current);
  }

  return [];
}

// =============================================================================
// Dynamic candidates
// =============================================================================

async function completeWorkspaceName(repoArg: string | undefined, current: string): Promise<string[]> {
  try {
    const location = await parseRepoLocation(defaultRepoArg(repoArg));
    const names = location.type === 'local'
      ? await workspaceList(new LocalStorage(), location.path)
      : (await workspaceListRemote(location.baseUrl, location.repo, { token: location.token }))
          .map((w) => w.name);
    return filterByPrefix(names, current);
  } catch {
    return [];
  }
}

async function completeDatasetPath(repoArg: string | undefined, current: string): Promise<string[]> {
  // The current word looks like `<ws>` or `<ws>.<prefix>`. With no dot, suggest
  // workspace names with a trailing dot to invite drill-down; with a dot,
  // suggest dataset names under that workspace.
  try {
    const location = await parseRepoLocation(defaultRepoArg(repoArg));
    const dotIdx = current.indexOf('.');

    if (dotIdx === -1) {
      const wsNames = location.type === 'local'
        ? await workspaceList(new LocalStorage(), location.path)
        : (await workspaceListRemote(location.baseUrl, location.repo, { token: location.token }))
            .map((w) => w.name);
      return filterByPrefix(wsNames.map((w) => `${w}.`), current);
    }

    const ws = current.slice(0, dotIdx);
    const index = await buildWorkspaceIndex(location, ws);
    return filterByPrefix(index.map((e) => `${ws}.${e.name}`), current);
  } catch {
    return [];
  }
}

// =============================================================================
// Filter
// =============================================================================

function filterByPrefix(candidates: readonly string[], current: string): string[] {
  const out: string[] = [];
  for (const c of candidates) {
    if (!c.startsWith(current)) continue;
    out.push(c);
    if (out.length >= MAX_DYNAMIC_CANDIDATES) break;
  }
  return out;
}

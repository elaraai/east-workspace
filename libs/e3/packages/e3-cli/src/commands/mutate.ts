/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 mutate command - apply a mutation to a record.
 *
 * Usage:
 *   e3 mutate <repo> -w <ws> <record>.<mutation> [args...]
 *
 * A mutation is the only write door into a record: it runs a pure East reducer
 * server-side under optimistic concurrency and appends an audited commit. Each
 * positional argument is an .east literal or a .beast2/.json/.east file path,
 * parsed against the mutation's declared parameter type. Records are
 * workspace-scoped, so --workspace is required.
 */

import { some, none } from '@elaraai/east';
import {
  recordMutate,
  recordDescribe,
  LocalStorage,
  LocalTaskRunner,
  type MutationOutcome,
} from '@elaraai/e3-core';
import {
  workspaceRecordDescribe,
  workspaceRecordMutate,
  type MutationResult,
} from '@elaraai/e3-api-client';
import { parseRepoLocation, formatError, exitError } from '../utils.js';
import { encodeArg } from './call.js';

/** Split a `<record>.<mutation>` spec on its final dot. */
function parseMutationSpec(spec: string): { record: string; mutation: string } {
  const dot = spec.lastIndexOf('.');
  if (dot <= 0 || dot === spec.length - 1) {
    throw new Error(`Invalid mutation specifier '${spec}'. Expected '<record>.<mutation>'.`);
  }
  return { record: spec.slice(0, dot), mutation: spec.slice(dot + 1) };
}

function actor(): string {
  return `cli:${process.env.USER ?? process.env.USERNAME ?? 'unknown'}`;
}

/**
 * Render a terminal mutation outcome. Both the local `MutationOutcome` and the
 * remote `MutationResult.outcome` share these tags and payload field names.
 */
function renderOutcome(outcome: { kind: string; [field: string]: unknown }): void {
  const kind = outcome.kind;
  if (kind === 'committed') {
    console.log(`Committed ${String(outcome.commitHash)}`);
    return;
  }
  if (kind === 'failed') {
    const stderr = String(outcome.stderr ?? '');
    if (stderr.trim()) {
      process.stderr.write(stderr);
      if (!stderr.endsWith('\n')) process.stderr.write('\n');
    }
    exitError(`Mutation reducer failed (exit code ${String(outcome.exitCode)})`);
  }
  if (kind === 'invalid') exitError(String(outcome.message));
  if (kind === 'too_large') exitError(`New state too large (${String(outcome.bytes)} bytes > ${String(outcome.limit)} limit)`);
  if (kind === 'timed_out') exitError(`Mutation timed out after ${String(outcome.ms)}ms`);
  if (kind === 'conflict') exitError(`Mutation conflicted after ${String(outcome.attempts)} attempts; try again`);
  exitError(`Unknown mutation outcome '${kind}'`);
}

async function mutateLocal(repoPath: string, ws: string, record: string, mutation: string, rawArgs: string[]): Promise<void> {
  const storage = new LocalStorage();
  const sig = await recordDescribe(storage, repoPath, ws, record);
  if (!sig) exitError(`Record '${record}' not found in workspace '${ws}'`);
  const mut = sig.mutations.find((m) => m.name === mutation);
  if (!mut) {
    exitError(`Mutation '${mutation}' not found on record '${record}'. Available: ${sig.mutations.map((m) => m.name).join(', ') || '(none)'}`);
  }
  if (rawArgs.length !== mut.argTypes.length) {
    exitError(`Mutation '${mutation}' expects ${mut.argTypes.length} argument(s), got ${rawArgs.length}`);
  }
  const args: Uint8Array[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    args.push(await encodeArg(rawArgs[i]!, mut.argTypes[i]!, i));
  }

  const outcome: MutationOutcome = await recordMutate(
    storage, new LocalTaskRunner(repoPath), repoPath, ws, record, mutation, args, { actor: actor() },
  );
  renderOutcome(outcome);
}

async function mutateRemote(baseUrl: string, repo: string, token: string, ws: string, record: string, mutation: string, rawArgs: string[]): Promise<void> {
  const opts = { token };
  const sig = await workspaceRecordDescribe(baseUrl, repo, ws, record, opts);
  const mut = sig.mutations.find((m) => m.name === mutation);
  if (!mut) {
    exitError(`Mutation '${mutation}' not found on record '${record}'. Available: ${sig.mutations.map((m) => m.name).join(', ') || '(none)'}`);
  }
  if (rawArgs.length !== mut.argTypes.length) {
    exitError(`Mutation '${mutation}' expects ${mut.argTypes.length} argument(s), got ${rawArgs.length}`);
  }
  const args: Uint8Array[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    args.push(await encodeArg(rawArgs[i]!, mut.argTypes[i]!, i));
  }

  const result: MutationResult = await workspaceRecordMutate(
    baseUrl, repo, ws, record, mutation, { args, actor: some(actor()), limits: none }, opts,
  );
  renderOutcome({ kind: result.outcome.type, ...result.outcome.value });
}

/** `e3 mutate` entry point. */
export async function mutateCommand(
  repoArg: string,
  spec: string,
  args: string[],
  options: { workspace?: string },
): Promise<void> {
  try {
    if (!options.workspace) {
      exitError('e3 mutate requires --workspace (records hold live workspace state)');
    }
    const { record, mutation } = parseMutationSpec(spec);
    const location = await parseRepoLocation(repoArg);
    if (location.type === 'local') {
      await mutateLocal(location.path, options.workspace, record, mutation, args);
    } else {
      await mutateRemote(location.baseUrl, location.repo, location.token, options.workspace, record, mutation, args);
    }
  } catch (err) {
    exitError(formatError(err));
  }
}

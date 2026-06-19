/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { decodeBeast2For, encodeBeast2For } from '@elaraai/east';
import { ExecutionStatusType, DataflowRunType } from '@elaraai/e3-types';
import type { ExecutionStatus, DataflowRun } from '@elaraai/e3-types';
import type { RefStore } from '../interfaces.js';
import { isNotFoundError, ExecutionCorruptError } from '../../errors.js';
import { atomicWriteFile } from './localHelpers.js';

/**
 * Local filesystem implementation of RefStore.
 *
 * The `repo` parameter is the path to the e3 repository directory.
 */
export class LocalRefStore implements RefStore {
  // -------------------------------------------------------------------------
  // Package References
  // -------------------------------------------------------------------------

  async packageList(repo: string): Promise<{ name: string; version: string }[]> {
    const packagesDir = path.join(repo, 'packages');
    const packages: { name: string; version: string }[] = [];

    try {
      const names = await fs.readdir(packagesDir);
      for (const name of names) {
        const nameDir = path.join(packagesDir, name);
        const stat = await fs.stat(nameDir);
        if (stat.isDirectory()) {
          const versions = await fs.readdir(nameDir);
          for (const version of versions) {
            // Skip in-flight / crash-orphaned atomic-write staging files
            // (packageWrite stages `<version>.<rand>.partial` siblings here).
            if (version.includes('.partial')) continue;
            packages.push({ name, version });
          }
        }
      }
    } catch (err) {
      // Only suppress ENOENT - directory may not exist yet
      if (!isNotFoundError(err)) {
        throw err;
      }
    }

    return packages;
  }

  async packageResolve(repo: string, name: string, version: string): Promise<string | null> {
    const refPath = path.join(repo, 'packages', name, version);
    try {
      const content = await fs.readFile(refPath, 'utf-8');
      return content.trim();
    } catch (err) {
      if (isNotFoundError(err)) {
        return null;
      }
      throw err;
    }
  }

  async packageWrite(repo: string, name: string, version: string, hash: string): Promise<void> {
    const refPath = path.join(repo, 'packages', name, version);
    await atomicWriteFile(refPath, hash + '\n');
  }

  async packageRemove(repo: string, name: string, version: string): Promise<void> {
    const refPath = path.join(repo, 'packages', name, version);
    try {
      await fs.unlink(refPath);
    } catch (err) {
      if (isNotFoundError(err)) {
        return; // Already removed, idempotent
      }
      throw err;
    }

    // Try to remove the package name directory if empty
    const packageDir = path.join(repo, 'packages', name);
    try {
      await fs.rmdir(packageDir);
    } catch {
      // Directory not empty, that's fine
    }
  }

  // -------------------------------------------------------------------------
  // Workspace State
  // -------------------------------------------------------------------------

  async workspaceList(repo: string): Promise<string[]> {
    const workspacesDir = path.join(repo, 'workspaces');
    const names: string[] = [];

    try {
      const entries = await fs.readdir(workspacesDir);
      for (const entry of entries) {
        if (entry.endsWith('.beast2')) {
          names.push(entry.slice(0, -7)); // Remove .beast2 extension
        }
      }
    } catch (err) {
      // Only suppress ENOENT - directory may not exist yet
      if (!isNotFoundError(err)) {
        throw err;
      }
    }

    return names;
  }

  async workspaceRead(repo: string, name: string): Promise<Uint8Array | null> {
    const stateFile = path.join(repo, 'workspaces', `${name}.beast2`);

    try {
      return await fs.readFile(stateFile);
    } catch (err) {
      if (isNotFoundError(err)) {
        return null;
      }
      throw err;
    }
  }

  async workspaceWrite(repo: string, name: string, state: Uint8Array): Promise<void> {
    const stateFile = path.join(repo, 'workspaces', `${name}.beast2`);
    // Atomic stage-and-rename: a concurrent reader sees the old or new complete
    // state, never a 0-byte truncation window.
    await atomicWriteFile(stateFile, state);
  }

  async workspaceRemove(repo: string, name: string): Promise<void> {
    const stateFile = path.join(repo, 'workspaces', `${name}.beast2`);
    try {
      await fs.unlink(stateFile);
    } catch (err) {
      if (isNotFoundError(err)) {
        return; // Already removed, idempotent
      }
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Execution Cache (with execution history)
  // -------------------------------------------------------------------------

  /**
   * Path to execution directory: executions/<taskHash>/<inputsHash>/<executionId>/
   */
  private executionDir(repo: string, taskHash: string, inputsHash: string, executionId: string): string {
    return path.join(repo, 'executions', taskHash, inputsHash, executionId);
  }

  /**
   * Path to inputs directory: executions/<taskHash>/<inputsHash>/
   */
  private inputsDir(repo: string, taskHash: string, inputsHash: string): string {
    return path.join(repo, 'executions', taskHash, inputsHash);
  }

  async executionGet(repo: string, taskHash: string, inputsHash: string, executionId: string): Promise<ExecutionStatus | null> {
    const execDir = this.executionDir(repo, taskHash, inputsHash, executionId);
    const statusPath = path.join(execDir, 'status.beast2');

    let data: Buffer;
    try {
      data = await fs.readFile(statusPath);
    } catch (err) {
      if (isNotFoundError(err)) {
        return null;
      }
      throw err;
    }

    try {
      const decoder = decodeBeast2For(ExecutionStatusType);
      return decoder(data);
    } catch (err) {
      throw new ExecutionCorruptError(
        taskHash,
        inputsHash,
        err instanceof Error ? err : new Error(String(err))
      );
    }
  }

  async executionWrite(repo: string, taskHash: string, inputsHash: string, executionId: string, status: ExecutionStatus): Promise<void> {
    const execDir = this.executionDir(repo, taskHash, inputsHash, executionId);

    // A single execution rewrites status.beast2 several times over its lifetime
    // (running → success/failed). A bare overwrite truncates the file to 0 bytes
    // mid-write, which a concurrent reader (e.g. a workspace-status poll calling
    // executionGet) decodes as "Data too short for Beast2 format". Stage-and-
    // rename makes each update atomic, so a reader only ever sees a complete
    // status object.
    const encoder = encodeBeast2For(ExecutionStatusType);
    await atomicWriteFile(path.join(execDir, 'status.beast2'), encoder(status));

    // Also write output hash for success status
    if (status.type === 'success') {
      await atomicWriteFile(path.join(execDir, 'output'), status.value.outputHash + '\n');
    }
  }

  async executionListIds(repo: string, taskHash: string, inputsHash: string): Promise<string[]> {
    const inputDir = this.inputsDir(repo, taskHash, inputsHash);

    try {
      const entries = await fs.readdir(inputDir);
      // Filter for UUIDv7-like format (36 chars with dashes) and sort lexicographically
      const uuids = entries.filter((e) => /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(e));
      return uuids.sort();
    } catch (err) {
      if (isNotFoundError(err)) {
        return [];
      }
      throw err;
    }
  }

  async executionGetLatest(repo: string, taskHash: string, inputsHash: string): Promise<ExecutionStatus | null> {
    const ids = await this.executionListIds(repo, taskHash, inputsHash);
    if (ids.length === 0) {
      return null;
    }
    // Get the lexicographically greatest (latest) execution
    const latestId = ids[ids.length - 1]!;
    return this.executionGet(repo, taskHash, inputsHash, latestId);
  }

  async executionGetLatestOutput(repo: string, taskHash: string, inputsHash: string): Promise<string | null> {
    const ids = await this.executionListIds(repo, taskHash, inputsHash);
    // Iterate from latest to oldest, return first success
    for (let i = ids.length - 1; i >= 0; i--) {
      const execDir = this.executionDir(repo, taskHash, inputsHash, ids[i]!);
      const outputPath = path.join(execDir, 'output');
      try {
        const content = await fs.readFile(outputPath, 'utf-8');
        return content.trim();
      } catch (err) {
        if (!isNotFoundError(err)) {
          throw err;
        }
        // No output file, check status to see if it's a success without output
        // or just continue to next execution
      }
    }
    return null;
  }

  async executionList(repo: string): Promise<{ taskHash: string; inputsHash: string }[]> {
    const executionsDir = path.join(repo, 'executions');
    const result: { taskHash: string; inputsHash: string }[] = [];

    try {
      const taskDirs = await fs.readdir(executionsDir);

      for (const taskHash of taskDirs) {
        if (!/^[a-f0-9]{64}$/.test(taskHash)) continue;

        const taskDir = path.join(executionsDir, taskHash);
        const stat = await fs.stat(taskDir);
        if (!stat.isDirectory()) continue;

        const inputsDirs = await fs.readdir(taskDir);
        for (const inputsHash of inputsDirs) {
          if (/^[a-f0-9]{64}$/.test(inputsHash)) {
            result.push({ taskHash, inputsHash });
          }
        }
      }
    } catch (err) {
      if (!isNotFoundError(err)) {
        throw err;
      }
    }

    return result;
  }

  async executionListForTask(repo: string, taskHash: string): Promise<string[]> {
    const taskDir = path.join(repo, 'executions', taskHash);

    try {
      const entries = await fs.readdir(taskDir);
      return entries.filter((e) => /^[a-f0-9]{64}$/.test(e));
    } catch (err) {
      if (!isNotFoundError(err)) {
        throw err;
      }
      return [];
    }
  }

  async executionListLatest(repo: string, taskHash: string): Promise<Array<{ inputsHash: string; status: ExecutionStatus }>> {
    // Local FS: compose from per-inputsHash lookups, in parallel — directory
    // reads are cheap here; the single-round-trip contract matters for
    // remote backends.
    const inputsHashes = await this.executionListForTask(repo, taskHash);
    const entries = await Promise.all(
      inputsHashes.map(async (inputsHash) => {
        const status = await this.executionGetLatest(repo, taskHash, inputsHash);
        return status ? { inputsHash, status } : null;
      })
    );
    return entries.filter((e): e is { inputsHash: string; status: ExecutionStatus } => e !== null);
  }

  // -------------------------------------------------------------------------
  // Dataflow Run History
  // -------------------------------------------------------------------------

  private dataflowDir(repo: string, workspace: string): string {
    return path.join(repo, 'dataflows', workspace);
  }

  private dataflowRunPath(repo: string, workspace: string, runId: string): string {
    return path.join(this.dataflowDir(repo, workspace), `${runId}.beast2`);
  }

  async dataflowRunGet(repo: string, workspace: string, runId: string): Promise<DataflowRun | null> {
    const runPath = this.dataflowRunPath(repo, workspace, runId);

    let data: Buffer;
    try {
      data = await fs.readFile(runPath);
    } catch (err) {
      if (isNotFoundError(err)) {
        return null;
      }
      throw err;
    }

    const decoder = decodeBeast2For(DataflowRunType);
    return decoder(data);
  }

  async dataflowRunWrite(repo: string, workspace: string, run: DataflowRun): Promise<void> {
    // A run record is rewritten in place as the run progresses (initial →
    // cancelled/final); stage-and-rename so a concurrent dataflowRunGet never
    // observes a 0-byte truncation window.
    const encoder = encodeBeast2For(DataflowRunType);
    const runPath = this.dataflowRunPath(repo, workspace, run.runId);
    await atomicWriteFile(runPath, encoder(run));
  }

  async dataflowRunList(repo: string, workspace: string): Promise<string[]> {
    const dir = this.dataflowDir(repo, workspace);

    try {
      const entries = await fs.readdir(dir);
      // Filter for .beast2 files, extract runId, and sort
      const runIds = entries
        .filter((e) => e.endsWith('.beast2'))
        .map((e) => e.slice(0, -7))  // Remove .beast2
        .filter((e) => /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(e));
      return runIds.sort();
    } catch (err) {
      if (isNotFoundError(err)) {
        return [];
      }
      throw err;
    }
  }

  async dataflowRunGetLatest(repo: string, workspace: string): Promise<DataflowRun | null> {
    const ids = await this.dataflowRunList(repo, workspace);
    if (ids.length === 0) {
      return null;
    }
    const latestId = ids[ids.length - 1]!;
    return this.dataflowRunGet(repo, workspace, latestId);
  }

  async dataflowRunDelete(repo: string, workspace: string, runId: string): Promise<void> {
    const runPath = this.dataflowRunPath(repo, workspace, runId);
    try {
      await fs.unlink(runPath);
    } catch (err) {
      if (isNotFoundError(err)) return; // idempotent
      throw err;
    }
  }
}

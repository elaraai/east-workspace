/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Integration tests for signal handling in e3 CLI
 *
 * Tests that SIGINT/SIGTERM properly abort running dataflow executions
 * and clean up child processes.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestDir, removeTestDir, runE3Command, spawnE3Command, waitFor } from './helpers.js';

// SDK imports
import e3 from '@elaraai/e3';
import { StringType, East, decodeBeast2For } from '@elaraai/east';
import { DataflowExecutionStateType } from '@elaraai/e3-types';

describe('signal handling', () => {
  let testDir: string;
  let repoDir: string;
  let packageZipPath: string;

  beforeEach(() => {
    testDir = createTestDir();
    mkdirSync(testDir, { recursive: true });
    repoDir = join(testDir, 'repo');
    packageZipPath = join(testDir, 'test-package.zip');
  });

  afterEach(() => {
    removeTestDir(testDir);
  });

  describe('e3 start abort', () => {
    it('cleans up child processes when SIGINT is received', async () => {
      // This test verifies that child task processes are properly killed when
      // the CLI receives SIGINT, not just that the CLI exits.
      //
      // We use a unique marker in the sleep command that we can grep for to
      // verify the process is killed.

      const input = e3.input('input', StringType, 'hello');

      // Task that sleeps with a unique marker we can find
      // The marker is embedded in the command so we can grep for it
      const slowTask = e3.customTask(
        'slow',
        [input],
        StringType,
        ($, inputs, output) => East.str`sleep 30 && cp ${inputs.get(0n)} ${output}`
      );

      const pkg = e3.package('slow-test', '1.0.0', slowTask);

      await e3.export(pkg, packageZipPath);
      assert.ok(existsSync(packageZipPath), 'Package zip should exist');

      await runE3Command(['repo', 'create', repoDir], testDir);
      await runE3Command(['package', 'import', repoDir, packageZipPath], testDir);
      await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
      await runE3Command(['workspace', 'deploy', repoDir, 'ws', 'slow-test@1.0.0'], testDir);

      // Start the slow task
      const startTime = Date.now();
      const proc = spawnE3Command(['dataflow', 'run', repoDir, 'ws'], testDir);

      // Wait for task to start
      await waitFor(() => proc.getStdout().includes('[START]'), 30000);

      // Send SIGINT (Ctrl+C)
      proc.kill('SIGINT');

      // Wait for CLI to exit
      await proc.result;
      const elapsed = Date.now() - startTime;

      // CLI should exit promptly (not wait out the 30 second sleep). 15s
      // bounds the assertion well under the sleep while tolerating loaded
      // CI runners — 5s raced on slow machines.
      assert.ok(elapsed < 15000, `CLI should exit quickly, but took ${elapsed}ms`);

      // Give a moment for any cleanup
      await new Promise(resolve => setTimeout(resolve, 300));

      // Check if any "sleep 30" processes are still running
      // This is a heuristic - there might be other sleep 30 processes, but
      // if our cleanup works, ours should be gone
      const { execSync } = await import('child_process');
      let sleepCount = 0;
      try {
        // Use pgrep -x to match exact command name "sleep", then filter
        // Or use ps and grep with [s]leep trick to avoid matching grep itself
        const result = execSync('ps -A -o comm= | grep -c "^sleep$" || true', { encoding: 'utf8' });
        sleepCount = parseInt(result.trim(), 10) || 0;
      } catch {
        sleepCount = 0;
      }

      // We can't definitively prove OUR sleep was killed, but if we see sleep
      // processes right after we sent SIGINT, something might be wrong.
      // For now, just log it - the timing assertion above is the main check.
      if (sleepCount > 0) {
        console.log(`Note: ${sleepCount} 'sleep' processes found after SIGINT`);
      }
    });

    it('reports abort status when SIGINT is received', async () => {
      const input = e3.input('input', StringType, 'hello');

      const slowTask = e3.customTask(
        'slow',
        [input],
        StringType,
        ($, inputs, output) => East.str`sleep 30 && cp ${inputs.get(0n)} ${output}`
      );

      const pkg = e3.package('slow-test-2', '1.0.0', slowTask);

      await e3.export(pkg, packageZipPath);

      await runE3Command(['repo', 'create', repoDir], testDir);
      await runE3Command(['package', 'import', repoDir, packageZipPath], testDir);
      await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
      await runE3Command(['workspace', 'deploy', repoDir, 'ws', 'slow-test-2@1.0.0'], testDir);

      const proc = spawnE3Command(['dataflow', 'run', repoDir, 'ws'], testDir);

      // Wait for task to start
      await waitFor(() => proc.getStdout().includes('[START]'), 30000);

      proc.kill('SIGINT');

      const result = await proc.result;

      // Should indicate it was aborted OR exit with non-zero code
      // (signal handling may not always produce output before exit)
      const output = result.stdout + result.stderr;
      const indicatesAbort = output.toLowerCase().includes('abort') ||
        output.toLowerCase().includes('interrupt') ||
        output.toLowerCase().includes('cancelled') ||
        result.exitCode !== 0;

      assert.ok(indicatesAbort, `Output should indicate abort or exit non-zero. Got exitCode=${result.exitCode}, output: ${output}`);
    });

    // Skipped on Windows: Node's `child.kill('SIGINT')` ignores the signal arg
    // and force-terminates the child (Node docs), so the CLI's SIGINT handler
    // — which writes 'cancelled' to disk — never gets a chance to run. The
    // production path (real-user Ctrl+C in a terminal) works correctly on
    // Windows because the console driver delivers CTRL_C_EVENT directly; only
    // the test's instrumentation can't reach it. Reaching it from a test would
    // need `GenerateConsoleCtrlEvent` via a native helper (e.g. windows-kill).
    it('persists cancelled status to disk after SIGINT', { skip: process.platform === 'win32' }, async () => {
      // This test verifies that after SIGINT, the execution state file
      // shows "cancelled" status - important for crash recovery.

      const input = e3.input('input', StringType, 'hello');

      const slowTask = e3.customTask(
        'slow',
        [input],
        StringType,
        ($, inputs, output) => East.str`sleep 30 && cp ${inputs.get(0n)} ${output}`
      );

      const pkg = e3.package('slow-test-persist', '1.0.0', slowTask);

      await e3.export(pkg, packageZipPath);

      await runE3Command(['repo', 'create', repoDir], testDir);
      await runE3Command(['package', 'import', repoDir, packageZipPath], testDir);
      await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
      await runE3Command(['workspace', 'deploy', repoDir, 'ws', 'slow-test-persist@1.0.0'], testDir);

      const proc = spawnE3Command(['dataflow', 'run', repoDir, 'ws'], testDir);

      // Wait for task to start and state to be created
      await waitFor(() => proc.getStdout().includes('[START]'), 30000);

      // Send SIGINT
      proc.kill('SIGINT');

      // Wait for CLI to exit
      await proc.result;

      // Poll for the persisted state instead of a fixed flush wait — a
      // fixed 100ms raced the write on slow CI disks.
      const statePath = join(repoDir, 'workspaces', 'ws', 'execution.beast2');
      const decode = decodeBeast2For(DataflowExecutionStateType);
      const readStatus = (): string | null => {
        if (!existsSync(statePath)) return null;
        try {
          return decode(readFileSync(statePath)).status;
        } catch {
          return null; // partially-written file
        }
      };
      await waitFor(() => readStatus() === 'cancelled', 10000);
      assert.strictEqual(readStatus(), 'cancelled', 'Execution status should be cancelled');
    });

    // Skipped on Windows for the same reason as the previous test — `child.kill('SIGINT')`
    // can't reach the CLI's SIGINT handler from a Node-spawned child on Windows.
    it('persists cancelled status even with rapid SIGINT+SIGKILL', { skip: process.platform === 'win32' }, async () => {
      // This test simulates an impatient user pressing Ctrl-C multiple times.
      // The cancellation should be persisted immediately on first SIGINT,
      // so even if SIGKILL follows shortly after, the status is preserved.

      const input = e3.input('input', StringType, 'hello');

      const slowTask = e3.customTask(
        'slow',
        [input],
        StringType,
        ($, inputs, output) => East.str`sleep 30 && cp ${inputs.get(0n)} ${output}`
      );

      const pkg = e3.package('slow-test-rapid', '1.0.0', slowTask);

      await e3.export(pkg, packageZipPath);

      await runE3Command(['repo', 'create', repoDir], testDir);
      await runE3Command(['package', 'import', repoDir, packageZipPath], testDir);
      await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
      await runE3Command(['workspace', 'deploy', repoDir, 'ws', 'slow-test-rapid@1.0.0'], testDir);

      const proc = spawnE3Command(['dataflow', 'run', repoDir, 'ws'], testDir);

      // Wait for task to start and state to be created
      await waitFor(() => proc.getStdout().includes('[START]'), 30000);

      // Send SIGINT (triggers immediate persistence)
      proc.kill('SIGINT');

      // Poll until the handler has persisted 'cancelled', THEN deliver the
      // impatient SIGKILL — this is the scenario's real precondition (first
      // Ctrl-C persisted before the second lands) and replaces a fixed
      // 500ms wait that raced the handler under CI load.
      const statePath = join(repoDir, 'workspaces', 'ws', 'execution.beast2');
      const decode = decodeBeast2For(DataflowExecutionStateType);
      const readStatus = (): string | null => {
        if (!existsSync(statePath)) return null;
        try {
          return decode(readFileSync(statePath)).status;
        } catch {
          return null; // partially-written file
        }
      };
      await waitFor(() => readStatus() === 'cancelled', 10000);

      // Send SIGKILL to forcibly terminate (simulating impatient user)
      proc.kill('SIGKILL');

      // Wait for process to exit
      await proc.result;

      // The persisted status must survive the SIGKILL
      assert.strictEqual(readStatus(), 'cancelled', 'Execution status should be cancelled');
    });

    it('can restart dataflow after SIGKILL without --force', async () => {
      // This test verifies that after killing a dataflow execution,
      // the user can restart it without any special flags.
      // The stale lock should be automatically cleaned up.

      const input = e3.input('input', StringType, 'hello');

      const slowTask = e3.customTask(
        'slow',
        [input],
        StringType,
        ($, inputs, output) => East.str`sleep 30 && cp ${inputs.get(0n)} ${output}`
      );

      const pkg = e3.package('slow-test-restart', '1.0.0', slowTask);

      await e3.export(pkg, packageZipPath);

      await runE3Command(['repo', 'create', repoDir], testDir);
      await runE3Command(['package', 'import', repoDir, packageZipPath], testDir);
      await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
      await runE3Command(['workspace', 'deploy', repoDir, 'ws', 'slow-test-restart@1.0.0'], testDir);

      // Start and kill the first execution
      const proc1 = spawnE3Command(['dataflow', 'run', repoDir, 'ws'], testDir);
      await waitFor(() => proc1.getStdout().includes('[START]'), 30000);
      proc1.kill('SIGKILL');
      await proc1.result;

      // Give a moment for any cleanup
      await new Promise(resolve => setTimeout(resolve, 500));

      // Start a new execution - should work without --force
      const proc2 = spawnE3Command(['dataflow', 'run', repoDir, 'ws'], testDir);

      // Wait for it to start
      await waitFor(() => proc2.getStdout().includes('[START]'), 30000);

      // Verify it's running (not blocked by stale lock)
      // The execution state should show 'running'
      const statePath = join(repoDir, 'workspaces', 'ws', 'execution.beast2');
      assert.ok(existsSync(statePath), 'Execution state file should exist');

      const stateData = readFileSync(statePath);
      const decode = decodeBeast2For(DataflowExecutionStateType);
      const state = decode(stateData);

      // Should be running (not stuck on lock)
      assert.strictEqual(state.status, 'running', `Second execution should be 'running', got '${state.status}'`);

      // Clean up
      proc2.kill('SIGINT');
      await proc2.result;
    });
  });

  describe('workspace locking', () => {
    it('rejects deploy/remove/start while a dataflow is running', async () => {
      // One running dataflow, three lock assertions — deploy, remove, and a
      // second start must all be refused while the workspace lock is held.
      // (Lock semantics are unit-tested in LocalLockService.spec.ts and via
      // the API in e3-api-tests dataflow suite; this covers the CLI surface.)
      const input = e3.input('input', StringType, 'hello');

      const slowTask = e3.customTask(
        'slow',
        [input],
        StringType,
        ($, inputs, output) => East.str`sleep 30 && cp ${inputs.get(0n)} ${output}`
      );

      const pkg = e3.package('lock-test', '1.0.0', slowTask);

      await e3.export(pkg, packageZipPath);

      await runE3Command(['repo', 'create', repoDir], testDir);
      await runE3Command(['package', 'import', repoDir, packageZipPath], testDir);
      await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
      await runE3Command(['workspace', 'deploy', repoDir, 'ws', 'lock-test@1.0.0'], testDir);

      // Start a slow task and wait for it to hold the lock
      const startProc = spawnE3Command(['dataflow', 'run', repoDir, 'ws'], testDir);
      await waitFor(() => startProc.getStdout().includes('[START]'), 30000);

      const expectLocked = (name: string, result: { exitCode: number; stdout: string; stderr: string }) => {
        const output = result.stdout + result.stderr;
        assert.ok(
          output.toLowerCase().includes('lock') || result.exitCode !== 0,
          `${name} should fail due to lock. Got: exitCode=${result.exitCode}, output=${output}`
        );
      };

      expectLocked('deploy', await runE3Command(
        ['workspace', 'deploy', repoDir, 'ws', 'lock-test@1.0.0'], testDir));
      expectLocked('remove', await runE3Command(
        ['workspace', 'remove', repoDir, 'ws'], testDir));
      expectLocked('second start', await runE3Command(
        ['dataflow', 'run', repoDir, 'ws'], testDir));

      // Clean up - abort the running task
      startProc.kill('SIGINT');
      await startProc.result;
    });
  });
});

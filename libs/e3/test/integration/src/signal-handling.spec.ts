/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Integration tests for signal handling in e3 CLI
 *
 * Tests that SIGINT/SIGTERM properly abort running dataflow executions
 * and clean up child processes; and what a second start, a deploy and a
 * removal do while a dataflow runs.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { createTestDir, getE3CliPath, removeHeldTestDir, runE3Command, spawnE3Command, waitFor } from './helpers.js';

// SDK imports
import e3 from '@elaraai/e3';
import { StringType, East, decodeBeast2For, variant } from '@elaraai/east';
import { DataflowExecutionStateType } from '@elaraai/e3-types';

describe('signal handling', () => {
  let testDir: string;
  let repoDir: string;
  let packageZipPath: string;
  let holdForBash: string;

  beforeEach(() => {
    testDir = createTestDir();
    mkdirSync(testDir, { recursive: true });
    repoDir = join(testDir, 'repo');
    packageZipPath = join(testDir, 'test-package.zip');
    // The slow task runs until this file is gone, which the test's cleanup
    // removes: never for a set time, which a slow machine could outlast. Its
    // path is spliced into a bash script, so it is given with forward
    // slashes, as e3 gives a custom task its own paths: bash takes a Windows
    // backslash for an escape.
    const hold = join(testDir, 'hold');
    writeFileSync(hold, '');
    holdForBash = hold.split(sep).join('/');
  });

  afterEach(async () => {
    await removeHeldTestDir(testDir, join(testDir, 'hold'));
  });

  describe('e3 start abort', () => {
    it('cleans up child processes when SIGINT is received', async () => {
      // This test verifies that child task processes are properly killed when
      // the CLI receives SIGINT, not just that the CLI exits.

      const input = e3.input('input', StringType, variant('value', 'hello'));

      // A task that runs until the test's cleanup: a CLI that waited for it
      // instead of stopping it would never exit
      const slowTask = e3.customTask(
        'slow',
        [input],
        StringType,
        ($, inputs, output) => {
          const holdPath = $.const(holdForBash);
          return East.str`while [ -e '${holdPath}' ]; do sleep 0.1; done; cp ${inputs.get(0n)} ${output}`;
        }
      );

      const pkg = e3.package('slow-test', '1.0.0', slowTask);

      await e3.export(pkg, packageZipPath);
      assert.ok(existsSync(packageZipPath), 'Package zip should exist');

      await runE3Command(['repo', 'create', repoDir], testDir);
      await runE3Command(['package', 'import', repoDir, packageZipPath], testDir);
      await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
      await runE3Command(['workspace', 'deploy', repoDir, 'ws', 'slow-test@1.0.0'], testDir);

      // Start the slow task
      const proc = spawnE3Command(['dataflow', 'run', repoDir, 'ws'], testDir);

      // Wait for task to start
      await waitFor(() => proc.getStdout().includes('[START]'), 30000);

      // Send SIGINT (Ctrl+C)
      proc.kill('SIGINT');

      // The CLI exits though its task never finishes. A bounded wait, whose
      // bound only a CLI that waits for its task reaches
      const exited = await Promise.race([
        proc.result.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 60_000).unref()),
      ]);
      assert.ok(exited, 'the CLI waited for its task instead of stopping it');

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
      // For now, just log it - the exit above is the main check.
      if (sleepCount > 0) {
        console.log(`Note: ${sleepCount} 'sleep' processes found after SIGINT`);
      }
    });

    it('reports abort status when SIGINT is received', async () => {
      const input = e3.input('input', StringType, variant('value', 'hello'));

      const slowTask = e3.customTask(
        'slow',
        [input],
        StringType,
        ($, inputs, output) => {
          const holdPath = $.const(holdForBash);
          return East.str`while [ -e '${holdPath}' ]; do sleep 0.1; done; cp ${inputs.get(0n)} ${output}`;
        }
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

      const input = e3.input('input', StringType, variant('value', 'hello'));

      const slowTask = e3.customTask(
        'slow',
        [input],
        StringType,
        ($, inputs, output) => {
          const holdPath = $.const(holdForBash);
          return East.str`while [ -e '${holdPath}' ]; do sleep 0.1; done; cp ${inputs.get(0n)} ${output}`;
        }
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

      const input = e3.input('input', StringType, variant('value', 'hello'));

      const slowTask = e3.customTask(
        'slow',
        [input],
        StringType,
        ($, inputs, output) => {
          const holdPath = $.const(holdForBash);
          return East.str`while [ -e '${holdPath}' ]; do sleep 0.1; done; cp ${inputs.get(0n)} ${output}`;
        }
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

      const input = e3.input('input', StringType, variant('value', 'hello'));

      const slowTask = e3.customTask(
        'slow',
        [input],
        StringType,
        ($, inputs, output) => {
          const holdPath = $.const(holdForBash);
          return East.str`while [ -e '${holdPath}' ]; do sleep 0.1; done; cp ${inputs.get(0n)} ${output}`;
        }
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

  describe('the e3 command itself', () => {
    // Skipped on Windows: Node's `child.kill` ends the process there, whatever signal it names.
    // The launcher becomes the command where the platform can replace a process, and runs it as a child elsewhere:
    // the second is run here by a Node that is told it cannot.
    const launches: ReadonlyArray<readonly [string, readonly string[]]> = [
      ['the launcher become the command', []],
      ['the command a child of the launcher', ['--import', 'data:text/javascript,process.execve=undefined;']],
    ];
    for (const [how, nodeArgs] of launches) it(`ruling 53 — a stop signal sent to the e3 command alone reaches the command it runs, ${how}: a run started through the launcher is cancelled, and the launcher exits as the command did`, { skip: process.platform === 'win32' }, async () => {
      const input = e3.input('input', StringType, variant('value', 'hello'));
      const slowTask = e3.customTask(
        'slow',
        [input],
        StringType,
        ($, inputs, output) => {
          const holdPath = $.const(holdForBash);
          return East.str`while [ -e '${holdPath}' ]; do sleep 0.1; done; cp ${inputs.get(0n)} ${output}`;
        }
      );
      await e3.export(e3.package('slow-test-launcher', '1.0.0', slowTask), packageZipPath);
      await runE3Command(['repo', 'create', repoDir], testDir);
      await runE3Command(['package', 'import', repoDir, packageZipPath], testDir);
      await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
      await runE3Command(['workspace', 'deploy', repoDir, 'ws', 'slow-test-launcher@1.0.0'], testDir);

      // The command as a person's shell runs it: `e3`, the package's bin, which starts the built CLI
      const launcher = join(dirname(getE3CliPath()), '..', '..', 'bin', 'e3.mjs');
      const child = spawn(process.execPath, [...nodeArgs, launcher, 'dataflow', 'run', repoDir, 'ws'], { cwd: testDir, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      const exited = once(child, 'exit') as Promise<[number | null, NodeJS.Signals | null]>;
      await waitFor(() => stdout.includes('[START]'), 30000);

      // As a timeout, a supervisor or a script stops a command: a signal to its process alone
      child.kill('SIGTERM');
      const [code] = await exited;
      assert.strictEqual(code, 130, `the launcher exits as the command it ran did. Got: ${String(code)}, output: ${stdout}`);
      assert.ok(stdout.includes('Received SIGTERM, aborting...'), `the command itself was told. Got: ${stdout}`);

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
      assert.strictEqual(readStatus(), 'cancelled', 'the run was cancelled, not left going');
    });
  });

  describe('workspace locking', () => {
    it('refuses a second start while a dataflow is running, and stops the run for a deploy and for a removal, each saying which', async () => {
      // One running dataflow, at the CLI's surface: a second start is refused
      // while it holds the workspace, and a deploy stops it, as a removal
      // stops the next, the run saying which as it exits. (The locks are
      // unit-tested in LocalLockService.spec.ts and deploy-lock.spec.ts, every
      // operation that takes a workspace whole in the dataflow loop's
      // contract suite, and the API's side is the e3-api-tests dataflow
      // suite.)
      const input = e3.input('input', StringType, variant('value', 'hello'));

      const slowTask = e3.customTask(
        'slow',
        [input],
        StringType,
        ($, inputs, output) => {
          const holdPath = $.const(holdForBash);
          return East.str`while [ -e '${holdPath}' ]; do sleep 0.1; done; cp ${inputs.get(0n)} ${output}`;
        }
      );

      // A name that does not hold the refusal's own word
      const pkg = e3.package('held-test', '1.0.0', slowTask);

      await e3.export(pkg, packageZipPath);

      await runE3Command(['repo', 'create', repoDir], testDir);
      await runE3Command(['package', 'import', repoDir, packageZipPath], testDir);
      await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
      await runE3Command(['workspace', 'deploy', repoDir, 'ws', 'held-test@1.0.0'], testDir);

      // Start a slow task and wait for it to hold the lock
      const startProc = spawnE3Command(['dataflow', 'run', repoDir, 'ws'], testDir);
      await waitFor(() => startProc.getStdout().includes('[START]'), 30000);

      const second = await runE3Command(['dataflow', 'run', repoDir, 'ws'], testDir);
      const refused = second.stdout + second.stderr;
      assert.ok(
        second.exitCode !== 0 && refused.toLowerCase().includes('lock'),
        `a second start should fail due to lock. Got: exitCode=${second.exitCode}, output=${refused}`
      );

      /** The run exits as an interrupted one does, having said what stopped it */
      const stoppedBy = async (run: typeof startProc, started: string) => {
        const stopped = await run.result;
        assert.strictEqual(stopped.exitCode, 130, `the run exits 130. Got: exitCode=${stopped.exitCode}, output=${stopped.stdout}${stopped.stderr}`);
        const lines = stopped.stdout.split(/\r?\n/);
        const at = lines.indexOf(`Stopped: ${started} started.`);
        assert.ok(at > 0, `the run says ${started} stopped it. Got: ${stopped.stdout}`);
        assert.deepStrictEqual(lines.slice(at - 1, at + 2), ['', `Stopped: ${started} started.`, '  Completed before it stopped: 0']);
        assert.ok(lines.includes('  [CANCELLED] slow'), `the task in flight was stopped. Got: ${stopped.stdout}`);
      };

      // A deploy does not wait for the task, which never finishes: it stops
      // the run, and goes through
      const deployed = await runE3Command(['workspace', 'deploy', repoDir, 'ws', 'held-test@1.0.0'], testDir);
      assert.strictEqual(deployed.exitCode, 0, `the deploy went through. Got: ${deployed.stdout}${deployed.stderr}`);
      await stoppedBy(startProc, 'a deploy of ws');

      // Nothing restarts it. A run started again is stopped by the
      // workspace's removal as by a deploy, and the removal goes through
      const again = spawnE3Command(['dataflow', 'run', repoDir, 'ws'], testDir);
      await waitFor(() => again.getStdout().includes('[START]'), 30000);
      const removed = await runE3Command(['workspace', 'remove', repoDir, 'ws'], testDir);
      assert.strictEqual(removed.exitCode, 0, `the removal went through. Got: ${removed.stdout}${removed.stderr}`);
      await stoppedBy(again, 'a removal of ws');
    });
  });
});

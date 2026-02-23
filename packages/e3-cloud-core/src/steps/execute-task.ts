/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Core Task Execution Logic
 *
 * Shared execution logic for both Lambda (execute-task.ts) and
 * Fargate (execute-task-compute-entry.ts) task execution.
 *
 * Executes tasks using the east-py CLI. The runtime container
 * (ghcr.io/elaraai/e3) includes Node.js 22, Python 3.11,
 * east-py, and all required plugins.
 */

import { spawn } from 'child_process';
import { writeFileSync, readFileSync, mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { inputsHash } from '@elaraai/e3-core';
import type { ObjectStore, LogStore, ExecutionStateStore } from '@elaraai/e3-core';
import type { ExecutionTracker } from '../execution-tracker.js';

// Default timeout: leave 1 minute buffer for Lambda overhead
const DEFAULT_TIMEOUT_MS = 14 * 60 * 1000;

// Log chunking configuration
const LOG_CHUNK_SIZE = 64 * 1024; // 64KB - flush when buffer reaches this size
const LOG_FLUSH_INTERVAL_MS = 2000; // 2 seconds - flush at least this often

/**
 * Dependencies for task execution, injected by the caller.
 */
export interface TaskExecutionDeps {
  /** Content-addressed object store for task IR and outputs */
  objects: ObjectStore;
  /** Log store for streaming task stdout/stderr */
  logs: LogStore;
  /** Execution state store for status checks */
  executions: ExecutionStateStore;
  /** Execution tracker for recording task events */
  executionTracker: ExecutionTracker;
}

/**
 * Buffered log writer that chunks and streams logs to LogStore.
 *
 * Flushes when:
 * - Buffer exceeds LOG_CHUNK_SIZE (64KB)
 * - LOG_FLUSH_INTERVAL_MS (2s) has passed since last flush
 * - Explicitly flushed (e.g., on process completion)
 */
export class LogBuffer {
  private buffer = '';
  private lastFlush = Date.now();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushPromise: Promise<void> = Promise.resolve();

  constructor(
    private readonly logStore: LogStore,
    private readonly repo: string,
    private readonly taskHash: string,
    private readonly inputsHash: string,
    private readonly executionId: string,
    private readonly stream: 'stdout' | 'stderr'
  ) {}

  /**
   * Append data to the buffer, flushing if needed.
   */
  async write(data: string): Promise<void> {
    this.buffer += data;

    // Flush if buffer is large enough
    if (this.buffer.length >= LOG_CHUNK_SIZE) {
      await this.flush();
    } else {
      // Schedule a timed flush if not already scheduled
      this.scheduleFlush();
    }
  }

  /**
   * Schedule a flush after the interval if not already scheduled.
   */
  private scheduleFlush(): void {
    if (this.flushTimer) return;

    const elapsed = Date.now() - this.lastFlush;
    const delay = Math.max(0, LOG_FLUSH_INTERVAL_MS - elapsed);

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (this.buffer.length > 0) {
        // Fire and forget - don't block the event loop
        this.flush().catch(err => console.error('Log flush error:', err));
      }
    }, delay);
  }

  /**
   * Flush the buffer to LogStore.
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    // Clear timer if pending
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const data = this.buffer;
    this.buffer = '';
    this.lastFlush = Date.now();

    // Chain flush operations to ensure ordering
    this.flushPromise = this.flushPromise.then(async () => {
      await this.logStore.append(this.repo, this.taskHash, this.inputsHash, this.executionId, this.stream, data);
    });

    await this.flushPromise;
  }

  /**
   * Wait for all pending flushes to complete.
   */
  async finalize(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
    await this.flushPromise;
  }
}

export interface TaskExecutionEvent {
  repo: string;
  workspace: string;
  executionId: number;
  taskName: string;
  taskHash: string;
  inputHashes: string[];
  outputPath: string;
  /** UUIDv7 execution ID for this specific task execution */
  taskExecutionId?: string;
  /** Timeout in minutes (used by Fargate compute) */
  timeoutMinutes?: number;
}

export interface TaskExecutionResult {
  taskName: string;
  status: 'success' | 'failed';
  outputHash?: string;
  exitCode?: number;
  error?: string;
  duration?: number;
  stdout?: string;
  stderr?: string;
}

export interface ExecuteTaskCoreOptions {
  /** Task timeout in milliseconds. Default: 14 minutes (Lambda). */
  timeoutMs?: number;
}

/**
 * Core task execution logic shared by Lambda and Fargate handlers.
 *
 * This function:
 * 1. Checks for cancellation before starting
 * 2. Downloads task IR and inputs from S3
 * 3. Runs east-py CLI to execute the task
 * 4. Uploads output to S3
 * 5. Returns output hash
 */
export async function executeTaskCore(
  event: TaskExecutionEvent,
  deps: TaskExecutionDeps,
  options?: ExecuteTaskCoreOptions
): Promise<TaskExecutionResult> {
  const { repo, workspace, executionId, taskName, taskHash, inputHashes, taskExecutionId } = event;
  const { objects, logs, executions, executionTracker } = deps;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startTime = Date.now();
  const workDir = mkdtempSync(join(tmpdir(), 'task-'));
  const inHash = inputsHash(inputHashes);
  const execIdStr = executionId.toString().padStart(10, '0');

  // The taskExecutionId is the UUIDv7 for this specific task execution (used as log partition key)
  const logExecutionId = taskExecutionId ?? '';

  // Check for cancellation before starting expensive work
  const currentState = await executions.read(repo, workspace, execIdStr);
  if (currentState?.status === 'cancelled') {
    console.log(`Execution ${executionId} was cancelled, skipping task ${taskName}`);
    rmSync(workDir, { recursive: true, force: true });
    return {
      taskName,
      status: 'failed',
      error: 'Execution was cancelled',
      duration: Date.now() - startTime,
    };
  }

  // Record 'start' event immediately when task begins execution
  try {
    await executionTracker.addExecutionEvent(repo, workspace, executionId, {
      type: 'start',
      task: taskName,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error(`Failed to record start event: ${err}`);
    // Continue execution even if event recording fails
  }

  // Helper to write progress logs via LogStore
  const log = async (message: string) => {
    await logs.append(repo, taskHash, inHash, logExecutionId, 'stdout', message);
  };

  console.log(`Executing task ${taskName} (hash: ${taskHash.slice(0, 12)}...)`);
  console.log(`Input hashes: ${inputHashes.length} inputs`);

  try {
    // Log download phase
    const inputCount = inputHashes.length - 1; // First is task IR
    await log(`Downloading task IR and ${inputCount} input${inputCount !== 1 ? 's' : ''}...\n`);

    // Download task IR (first input hash is the function IR, stored as BEAST2 encoded data)
    const taskIrPath = join(workDir, 'task.beast2');
    const taskIrData = await objects.read(repo, inputHashes[0]);
    writeFileSync(taskIrPath, taskIrData);
    console.log(`Downloaded task IR: ${inputHashes[0].slice(0, 12)}...`);

    // Download remaining inputs (skip first which is the function IR)
    const inputPaths: string[] = [];
    for (let i = 1; i < inputHashes.length; i++) {
      const inputPath = join(workDir, `input-${i - 1}.beast2`);
      const inputData = await objects.read(repo, inputHashes[i]);
      writeFileSync(inputPath, inputData);
      inputPaths.push(inputPath);
    }
    console.log(`Downloaded ${inputPaths.length} input(s)`);

    // Prepare output path (needs .beast2 extension for east-py)
    const outputFilePath = join(workDir, 'output.beast2');

    // Build command
    const args = [
      'run',
      taskIrPath,
      '-p', 'east_py_std',
      '-p', 'east_py_io',
      ...inputPaths.flatMap((p) => ['-i', p]),
      '-o', outputFilePath,
    ];

    console.log(`Running: east-py ${args.join(' ')}`);

    // Log task starting
    await log(`Task starting...\n`);

    // Create streaming log buffers for stdout/stderr
    const stdoutBuffer = new LogBuffer(logs, repo, taskHash, inHash, logExecutionId, 'stdout');
    const stderrBuffer = new LogBuffer(logs, repo, taskHash, inHash, logExecutionId, 'stderr');

    // Track last chunks for error reporting
    let lastStdout = '';
    let lastStderr = '';

    // Execute task via east-py CLI with streaming
    const { exitCode, error } = await new Promise<{ exitCode: number | null; error?: Error }>((resolve) => {
      const child = spawn('east-py', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // Set up timeout
      const timeoutId = setTimeout(() => {
        child.kill('SIGKILL');
        resolve({ exitCode: null, error: new Error(`Task timed out after ${timeoutMs / 1000}s`) });
      }, timeoutMs);

      // Stream stdout - read both into buffer for streaming and keep last chunk for errors
      child.stdout.setEncoding('utf-8');
      child.stdout.on('data', (chunk: string) => {
        lastStdout = (lastStdout + chunk).slice(-10000); // Keep last 10KB for error reporting
        stdoutBuffer.write(chunk).catch(err => console.error('stdout write error:', err));
      });

      // Stream stderr - same pattern
      child.stderr.setEncoding('utf-8');
      child.stderr.on('data', (chunk: string) => {
        lastStderr = (lastStderr + chunk).slice(-10000);
        stderrBuffer.write(chunk).catch(err => console.error('stderr write error:', err));
      });

      child.on('error', (err) => {
        clearTimeout(timeoutId);
        resolve({ exitCode: null, error: err });
      });

      child.on('close', (code) => {
        clearTimeout(timeoutId);
        resolve({ exitCode: code });
      });
    });

    // Finalize log buffers - ensure all chunks are flushed
    await Promise.all([
      stdoutBuffer.finalize(),
      stderrBuffer.finalize(),
    ]);

    const duration = Date.now() - startTime;

    // Check for execution errors
    if (error) {
      const errorMsg = error.message || 'Unknown spawn error';
      console.error(`Task ${taskName} spawn error: ${errorMsg}`);
      await log(`Task failed: ${errorMsg}\n`);
      return {
        taskName,
        status: 'failed',
        exitCode: exitCode ?? -1,
        error: errorMsg,
        duration,
        stdout: lastStdout.slice(0, 10000),
        stderr: lastStderr.slice(0, 10000),
      };
    }

    if (exitCode !== 0) {
      const errorMsg = lastStderr.slice(0, 1000) || lastStdout.slice(0, 1000) || 'Unknown error';
      console.error(`Task ${taskName} failed with exit code ${exitCode}: ${errorMsg}`);
      await log(`Task failed with exit code ${exitCode}\n`);
      return {
        taskName,
        status: 'failed',
        exitCode: exitCode ?? -1,
        error: errorMsg,
        duration,
        stdout: lastStdout.slice(0, 10000),
        stderr: lastStderr.slice(0, 10000),
      };
    }

    // Check output file exists
    if (!existsSync(outputFilePath)) {
      console.error(`Task ${taskName} did not create output file`);
      await log(`Task failed: output file not created\n`);
      return {
        taskName,
        status: 'failed',
        error: 'Output file not created',
        duration,
        stdout: lastStdout.slice(0, 10000),
        stderr: lastStderr.slice(0, 10000),
      };
    }

    // Upload output (objects.write computes hash)
    await log(`Uploading output...\n`);
    const outputContent = readFileSync(outputFilePath);
    const outputHash = await objects.write(repo, outputContent);

    const durationSecs = (duration / 1000).toFixed(2);
    await log(`Task complete (${durationSecs}s)\n`);
    console.log(`Task ${taskName} succeeded in ${duration}ms, output: ${outputHash.slice(0, 12)}...`);

    return {
      taskName,
      status: 'success',
      outputHash,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`Task ${taskName} error: ${errorMsg}`);
    return {
      taskName,
      status: 'failed',
      error: errorMsg,
      duration,
    };
  } finally {
    // Clean up temp directory
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Lambda Task Executor
 *
 * Executes tasks using the east-py CLI. This handler runs in a container
 * based on ghcr.io/elaraai/e3 which includes Node.js 22, Python 3.11,
 * east-py, and all required plugins.
 *
 * Invoked directly by Step Functions for synchronous task execution.
 * No heartbeat or claim tracking needed - Lambda manages timeout and
 * Step Functions handles retries.
 */

import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { writeFileSync, readFileSync, mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient, UpdateItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
// Import directly from s3-object-store to avoid loading s3-dynamo-storage which has e3-core dependencies
import { S3ObjectStore } from '@elaraai/e3-aws-storage/s3-object-store';

const s3 = new S3Client({});
const dynamo = new DynamoDBClient({});
const BUCKET_NAME = process.env.BUCKET_NAME!;
const TABLE_NAME = process.env.TABLE_NAME!;

// Object store handles catalogue-aware reads/writes
const objectStore = new S3ObjectStore(s3, dynamo, BUCKET_NAME, TABLE_NAME);

// Default TTL for log chunks in seconds (7 days)
const LOG_TTL_SECONDS = 7 * 24 * 60 * 60;

// Sequence counter for log ordering within same millisecond
let logSequence = 0;

// Timeout buffer: leave 1 minute for Lambda overhead
const TASK_TIMEOUT_MS = 14 * 60 * 1000;

// Log chunking configuration
const LOG_CHUNK_SIZE = 64 * 1024; // 64KB - flush when buffer reaches this size
const LOG_FLUSH_INTERVAL_MS = 2000; // 2 seconds - flush at least this often

/**
 * Buffered log writer that chunks and streams logs to DynamoDB.
 *
 * Flushes when:
 * - Buffer exceeds LOG_CHUNK_SIZE (64KB)
 * - LOG_FLUSH_INTERVAL_MS (2s) has passed since last flush
 * - Explicitly flushed (e.g., on process completion)
 */
class LogBuffer {
  private buffer = '';
  private lastFlush = Date.now();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushPromise: Promise<void> = Promise.resolve();

  constructor(
    private readonly repo: string,
    private readonly taskHash: string,
    private readonly inputsHash: string,
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
   * Flush the buffer to DynamoDB.
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
      await writeLog(this.repo, this.taskHash, this.inputsHash, this.stream, data);
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

/**
 * Lambda handler: Execute a task using east-py CLI.
 *
 * This handler:
 * 1. Checks for cancellation before starting
 * 2. Downloads task IR and inputs from S3
 * 3. Runs east-py CLI to execute the task
 * 4. Uploads output to S3
 * 5. Returns output hash for Step Functions
 */
export async function handler(event: TaskExecutionEvent): Promise<TaskExecutionResult> {
  const { repo, workspace, executionId, taskName, taskHash, inputHashes } = event;
  const startTime = Date.now();
  const workDir = mkdtempSync(join(tmpdir(), 'task-'));
  const inputsHash = computeInputsHash(inputHashes);

  // Check for cancellation before starting expensive work
  // Note: We use a lightweight DynamoDB check here rather than loading full state
  const execStatus = await checkExecutionStatus(repo, workspace, executionId);
  if (execStatus === 'cancelled') {
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
    await recordStartEvent(repo, workspace, executionId, taskName);
  } catch (err) {
    console.error(`Failed to record start event: ${err}`);
    // Continue execution even if event recording fails
  }

  // Helper to write progress logs
  const log = async (message: string) => {
    await writeLog(repo, taskHash, inputsHash, 'stdout', message);
  };

  console.log(`Executing task ${taskName} (hash: ${taskHash.slice(0, 12)}...)`);
  console.log(`Input hashes: ${inputHashes.length} inputs`);

  try {
    // Log download phase
    const inputCount = inputHashes.length - 1; // First is task IR
    await log(`Downloading task IR and ${inputCount} input${inputCount !== 1 ? 's' : ''}...\n`);

    // Download task IR (first input hash is the function IR, stored as BEAST2 encoded data)
    const taskIrPath = join(workDir, 'task.beast2');
    await downloadObject(repo, inputHashes[0], taskIrPath);
    console.log(`Downloaded task IR: ${inputHashes[0].slice(0, 12)}...`);

    // Download remaining inputs (skip first which is the function IR)
    const inputPaths: string[] = [];
    for (let i = 1; i < inputHashes.length; i++) {
      const inputPath = join(workDir, `input-${i - 1}.beast2`);
      await downloadObject(repo, inputHashes[i], inputPath);
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
    const stdoutBuffer = new LogBuffer(repo, taskHash, inputsHash, 'stdout');
    const stderrBuffer = new LogBuffer(repo, taskHash, inputsHash, 'stderr');

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
        resolve({ exitCode: null, error: new Error(`Task timed out after ${TASK_TIMEOUT_MS / 1000}s`) });
      }, TASK_TIMEOUT_MS);

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

    // Upload output (objectStore.write computes hash)
    await log(`Uploading output...\n`);
    const outputContent = readFileSync(outputFilePath);
    const outputHash = await uploadObject(repo, outputContent);

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

/**
 * Download an object to a local file using the object store.
 */
async function downloadObject(repo: string, hash: string, localPath: string): Promise<void> {
  const data = await objectStore.read(repo, hash);
  writeFileSync(localPath, data);
}

/**
 * Upload an object using the object store and return its hash.
 */
async function uploadObject(repo: string, content: Buffer): Promise<string> {
  return objectStore.write(repo, content);
}

/**
 * Compute the combined hash of input hashes.
 * This matches e3-core's inputsHash function.
 */
function computeInputsHash(inputHashes: string[]): string {
  const data = inputHashes.join('\0');
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Write a log message to DynamoDB.
 * Uses the same schema as DynamoLogStore for consistency.
 */
async function writeLog(
  repo: string,
  taskHash: string,
  inputsHash: string,
  stream: 'stdout' | 'stderr',
  message: string
): Promise<void> {
  const now = Date.now();
  const timestamp = now.toString().padStart(15, '0');
  const seq = (logSequence++).toString().padStart(6, '0');
  const ttl = Math.floor(now / 1000) + LOG_TTL_SECONDS;

  await dynamo.send(
    new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall({
        PK: `REPO#${repo}`,
        SK: `LOG#${taskHash}#${inputsHash}#${stream}#${timestamp}#${seq}`,
        data: message,
        timestamp: now,
        ttl,
      }),
    })
  );
}

/**
 * Check execution status from DynamoDB.
 * Returns the current status or null if not found.
 */
async function checkExecutionStatus(
  repo: string,
  workspace: string,
  executionId: number
): Promise<string | null> {
  const { GetItemCommand } = await import('@aws-sdk/client-dynamodb');

  const pk = `STATE/${repo}/${workspace}`;
  const sk = executionId.toString().padStart(10, '0');

  try {
    const response = await dynamo.send(
      new GetItemCommand({
        TableName: TABLE_NAME,
        Key: marshall({ PK: pk, SK: sk }),
        ProjectionExpression: '#status',
        ExpressionAttributeNames: { '#status': 'status' },
      })
    );

    if (!response.Item) {
      return null;
    }

    const item = unmarshall(response.Item);
    return item.status ?? null;
  } catch (err) {
    console.error('Error checking execution status:', err);
    return null;
  }
}

/**
 * Record a 'start' event for a task execution.
 * Phase 3 schema: EVENT/{repo}/{executionId}
 */
async function recordStartEvent(
  repo: string,
  workspace: string,
  executionId: number,
  taskName: string
): Promise<void> {
  const now = new Date().toISOString();

  // Step 1: Atomically increment eventSeq on the execution record
  const execPk = `EXEC/${repo}/${workspace}`;
  const execSk = executionId.toString().padStart(10, '0');

  const seqResponse = await dynamo.send(
    new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ PK: execPk, SK: execSk }),
      UpdateExpression: 'SET eventSeq = if_not_exists(eventSeq, :zero) + :one',
      ExpressionAttributeValues: marshall({ ':zero': 0, ':one': 1 }),
      ReturnValues: 'UPDATED_NEW',
    })
  );

  const seq = seqResponse.Attributes
    ? (unmarshall(seqResponse.Attributes).eventSeq as number)
    : 1;

  // Step 2: Write the start event
  const eventPk = `EVENT/${repo}/${executionId}`;
  const paddedSeq = seq.toString().padStart(6, '0');

  await dynamo.send(
    new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall({
        PK: eventPk,
        SK: paddedSeq,
        eventType: 'start',
        task: taskName,
        timestamp: now,
      }),
    })
  );
}

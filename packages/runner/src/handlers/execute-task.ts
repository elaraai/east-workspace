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

import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { writeFileSync, readFileSync, mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({});
const BUCKET_NAME = process.env.BUCKET_NAME!;

// Timeout buffer: leave 1 minute for Lambda overhead
const TASK_TIMEOUT_MS = 14 * 60 * 1000;

export interface TaskExecutionEvent {
  repo: string;
  workspace: string;
  executionId: string;
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
 * 1. Downloads task IR and inputs from S3
 * 2. Runs east-py CLI to execute the task
 * 3. Uploads output to S3
 * 4. Returns output hash for Step Functions
 */
export async function handler(event: TaskExecutionEvent): Promise<TaskExecutionResult> {
  const { repo, taskName, taskHash, inputHashes } = event;
  const startTime = Date.now();
  const workDir = mkdtempSync(join(tmpdir(), 'task-'));

  console.log(`Executing task ${taskName} (hash: ${taskHash.slice(0, 12)}...)`);
  console.log(`Input hashes: ${inputHashes.length} inputs`);

  try {
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

    // Execute task via east-py CLI
    const result = spawnSync('east-py', args, {
      timeout: TASK_TIMEOUT_MS,
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer for stdout/stderr
      encoding: 'utf-8',
    });

    const duration = Date.now() - startTime;

    // Check for execution errors
    if (result.error) {
      const errorMsg = result.error.message || 'Unknown spawn error';
      console.error(`Task ${taskName} spawn error: ${errorMsg}`);
      return {
        taskName,
        status: 'failed',
        error: errorMsg,
        duration,
        stdout: result.stdout?.slice(0, 10000),
        stderr: result.stderr?.slice(0, 10000),
      };
    }

    if (result.status !== 0) {
      const errorMsg = result.stderr?.slice(0, 1000) || result.stdout?.slice(0, 1000) || 'Unknown error';
      console.error(`Task ${taskName} failed with exit code ${result.status}: ${errorMsg}`);
      return {
        taskName,
        status: 'failed',
        exitCode: result.status ?? -1,
        error: errorMsg,
        duration,
        stdout: result.stdout?.slice(0, 10000),
        stderr: result.stderr?.slice(0, 10000),
      };
    }

    // Check output file exists
    if (!existsSync(outputFilePath)) {
      console.error(`Task ${taskName} did not create output file`);
      return {
        taskName,
        status: 'failed',
        error: 'Output file not created',
        duration,
        stdout: result.stdout?.slice(0, 10000),
        stderr: result.stderr?.slice(0, 10000),
      };
    }

    // Upload output and compute hash
    const outputContent = readFileSync(outputFilePath);
    const outputHash = createHash('sha256').update(outputContent).digest('hex');
    await uploadObject(repo, outputHash, outputContent);

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
 * Download an object from S3 to a local file.
 */
async function downloadObject(repo: string, hash: string, localPath: string): Promise<void> {
  const key = `${repo}/objects/${hash}`;
  const response = await s3.send(
    new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    })
  );

  const body = await response.Body!.transformToByteArray();
  writeFileSync(localPath, body);
}

/**
 * Upload an object to S3 (content-addressed).
 */
async function uploadObject(repo: string, hash: string, content: Buffer): Promise<void> {
  const key = `${repo}/objects/${hash}`;
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: content,
    })
  );
}

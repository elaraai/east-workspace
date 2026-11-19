/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Test helpers for CLI command testing
 *
 * Provides utilities for:
 * - Creating temporary test directories
 * - Writing test input files
 * - Cleaning up after tests
 * - Running a command whose error exits, and capturing what it prints
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFileSync } from 'node:fs';

/**
 * Track parent temp directories for cleanup
 */
const tempDirParents = new Map<string, string>();

/**
 * Create a temporary directory for CLI testing
 */
export function createTestDir(): string {
  const parentDir = mkdtempSync(join(tmpdir(), 'e3-cli-test-'));
  const testDir = join(parentDir, 'test');
  tempDirParents.set(testDir, parentDir);
  return testDir;
}

/**
 * Remove a temporary test directory
 */
export function removeTestDir(testDir: string): void {
  const parentDir = tempDirParents.get(testDir);
  if (parentDir) {
    rmSync(parentDir, { recursive: true, force: true });
    tempDirParents.delete(testDir);
  }
}

/**
 * Write a test file to the test directory
 */
export function writeTestFile(
  testDir: string,
  filename: string,
  content: string | Buffer
): string {
  const filePath = join(testDir, filename);
  writeFileSync(filePath, content);
  return filePath;
}

/**
 * Runs a command with `process.exit` stubbed to throw, so `exitError` surfaces
 * as a rejection rather than ending the test runner, and `console.error` kept
 * from the terminal.
 *
 * @param fn - The command
 * @param said - Where each line given to `console.error` goes
 * @returns Once the command has run
 * @throws `exit <code>` when the command exits
 */
export async function withExitStub(fn: () => Promise<void>, said: string[] = []): Promise<void> {
  const origExit = process.exit;
  const origErr = console.error;
  process.exit = ((code?: number) => { throw new Error(`exit ${code ?? 0}`); }) as never;
  console.error = (...a: unknown[]) => { said.push(a.map(String).join(' ')); };
  try {
    await fn();
  } finally {
    process.exit = origExit;
    console.error = origErr;
  }
}

/**
 * Runs a command with `console.log` captured.
 *
 * @param fn - The command
 * @returns The lines it logged, joined by newlines
 */
export async function captured(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const origLog = console.log;
  console.log = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  try {
    await fn();
  } finally {
    console.log = origLog;
  }
  return lines.join('\n');
}

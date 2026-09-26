/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import type { StorageBackend } from '../storage/interfaces.js';
import { uuidv7 } from '../uuid.js';
import type { SplitUnit, TaskRunner, TaskExecuteOptions, TaskResult } from './interfaces.js';
import type { DetachedSpec, DetachedResult, DetachedRunOptions } from './runDetached.js';

/**
 * A result a test configures. It may leave out the execution's id: the mock
 * then reports a fresh one, as a runner reports the attempt it ran.
 */
export type MockTaskResult = Omit<TaskResult, 'executionId'> & { executionId?: string };

/**
 * Record of a single task execution call.
 */
export interface MockTaskCall {
  taskHash: string;
  inputHashes: string[];
  options?: TaskExecuteOptions;
}

/**
 * Record of a single unit execution call.
 */
export interface MockUnitCall {
  taskHash: string;
  unit: SplitUnit;
  options?: TaskExecuteOptions;
}

/**
 * TaskRunner mock for testing dataflow orchestration without spawning processes.
 *
 * Allows configuring responses per task and records all calls for assertions.
 */
export class MockTaskRunner implements TaskRunner {
  private results = new Map<string, MockTaskResult | ((inputHashes: string[]) => MockTaskResult | Promise<MockTaskResult>)>();
  private calls: MockTaskCall[] = [];
  private defaultResult: MockTaskResult = { state: 'success', cached: false, outputHash: 'mock-hash' };
  private unitResults = new Map<string, (unit: SplitUnit) => MockTaskResult | Promise<MockTaskResult>>();
  private unitCalls: MockUnitCall[] = [];

  /**
   * Set result for a specific task hash.
   *
   * @param taskHash - The task hash to configure
   * @param result - Either a static result or a function that computes result from inputHashes
   */
  setResult(taskHash: string, result: MockTaskResult | ((inputHashes: string[]) => MockTaskResult | Promise<MockTaskResult>)): void {
    this.results.set(taskHash, result);
  }

  /**
   * Set default result for tasks without specific results configured.
   *
   * @param result - The default result to return
   */
  setDefaultResult(result: MockTaskResult): void {
    this.defaultResult = result;
  }

  /**
   * Get all recorded calls.
   *
   * @returns Readonly array of all execute() calls
   */
  getCalls(): readonly MockTaskCall[] {
    return this.calls;
  }

  /**
   * Clear recorded calls.
   */
  clearCalls(): void {
    this.calls = [];
    this.unitCalls = [];
  }

  async execute(
    _storage: StorageBackend,
    taskHash: string,
    inputHashes: string[],
    options?: TaskExecuteOptions
  ): Promise<TaskResult> {
    this.calls.push({ taskHash, inputHashes, options });

    const configured = this.results.get(taskHash);
    const result = configured === undefined ? this.defaultResult
      : typeof configured === 'function' ? await configured(inputHashes) : configured;
    return { ...result, executionId: result.executionId ?? uuidv7() };
  }

  /**
   * Set how the units of a task split into pieces execute.
   *
   * @param taskHash - The task hash to configure
   * @param result - Computes a unit's result from the unit
   */
  setUnitResult(taskHash: string, result: (unit: SplitUnit) => MockTaskResult | Promise<MockTaskResult>): void {
    this.unitResults.set(taskHash, result);
  }

  /**
   * Get all recorded unit calls.
   *
   * @returns Readonly array of all executeUnit() calls
   */
  getUnitCalls(): readonly MockUnitCall[] {
    return this.unitCalls;
  }

  async executeUnit(
    _storage: StorageBackend,
    taskHash: string,
    unit: SplitUnit,
    options?: TaskExecuteOptions
  ): Promise<TaskResult> {
    this.unitCalls.push({ taskHash, unit, options });
    const configured = this.unitResults.get(taskHash);
    const result = configured ? await configured(unit) : this.defaultResult;
    return { ...result, executionId: result.executionId ?? uuidv7() };
  }

  private detachedResult: DetachedResult = {
    kind: 'success',
    value: new Uint8Array(),
    stdout: '',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
  };
  private detachedCalls: DetachedSpec[] = [];

  /** Set the result returned by runDetached. */
  setDetachedResult(result: DetachedResult): void {
    this.detachedResult = result;
  }

  /** Get all recorded runDetached calls. */
  getDetachedCalls(): readonly DetachedSpec[] {
    return this.detachedCalls;
  }

  runDetached(spec: DetachedSpec, _options?: DetachedRunOptions): Promise<DetachedResult> {
    this.detachedCalls.push(spec);
    return Promise.resolve(this.detachedResult);
  }
}

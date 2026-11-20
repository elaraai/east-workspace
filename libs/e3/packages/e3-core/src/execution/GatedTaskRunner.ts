/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import type { StopReason } from '@elaraai/e3-types';
import type { StorageBackend } from '../storage/interfaces.js';
import { uuidv7 } from '../uuid.js';
import type {
  DetachedResult, DetachedRunOptions, DetachedSpec, IntakeOptions, IntakeResult, IntakeSpec, RunningExecution, SplitUnit, TaskRunner,
  TaskExecuteOptions, TaskResult,
} from './interfaces.js';

/**
 * An execution a {@link GatedTaskRunner} holds: what it was launched on.
 */
export interface GatedLaunch {
  /** The task, by the name the run handed its runner */
  readonly task: string;
  /** The task object's hash */
  readonly taskHash: string;
  /** The inputs it was launched on: a task's, or a unit's */
  readonly inputHashes: readonly string[];
  /** The unit, for a unit of a split task; `null` for a task's execution */
  readonly unit: SplitUnit | null;
}

/** An execution held at the gate, and what lets it go. */
interface Held {
  readonly launch: GatedLaunch;
  /** Whether {@link GatedTaskRunner.launched} has answered with it */
  told: boolean;
  /** Lets it run on through the wrapped runner, or settles it failed */
  settle(how: { release: true } | { fail: string }): void;
}

/**
 * A `TaskRunner` that wraps another and holds each execution of the tasks a
 * test names until the test lets it go, so a test replays an interleaving of
 * a run one step at a time, and nothing waits on a clock.
 *
 * @remarks
 * It holds a task's `execute` and each unit's `executeUnit`, and knows a task
 * by the name the run hands its runner (`TaskExecuteOptions.taskName`), so a
 * catch-up run is held as its task's. A task the test names nothing for runs
 * straight through. An execution held when its run is stopped settles as one
 * e3 stopped does, cancelled, and never reaches the wrapped runner. Every
 * other member of `TaskRunner` goes straight to the wrapped runner.
 *
 * @example
 * ```ts
 * const runner = new GatedTaskRunner(new MockTaskRunner(), ['clean', 'forecast']);
 * const handle = await orchestrator.start(storage, repo, 'main', { runner });
 * await runner.launched('clean');     // clean is held: it has started
 * await commitAnEdit();               // an edit lands while it runs
 * runner.release('clean');            // its result lands; it runs once more
 * await runner.launched('clean');
 * ```
 */
export class GatedTaskRunner implements TaskRunner {
  private readonly gated: Set<string>;
  private readonly held = new Map<string, Held[]>();
  private readonly watchers = new Map<string, Array<() => void>>();

  /**
   * @param inner - The runner a released execution runs on
   * @param tasks - The tasks whose executions are held
   */
  constructor(private readonly inner: TaskRunner, tasks: Iterable<string> = []) {
    this.gated = new Set(tasks);
  }

  /**
   * Holds the executions of a task from now on.
   *
   * @param task - The task's name
   */
  hold(task: string): void {
    this.gated.add(task);
  }

  /**
   * Stops holding a task's executions: those held already stay held, and
   * later ones run straight through.
   *
   * @param task - The task's name
   */
  pass(task: string): void {
    this.gated.delete(task);
  }

  /**
   * Answers once an execution of the task is held that it has not answered
   * with before, the oldest first, with what it was launched on.
   *
   * @param task - The task's name
   * @returns What the held execution was launched on
   */
  async launched(task: string): Promise<GatedLaunch> {
    for (;;) {
      const next = this.held.get(task)?.find((each) => !each.told);
      if (next !== undefined) {
        next.told = true;
        return next.launch;
      }
      await new Promise<void>((resolve) => {
        const waiting = this.watchers.get(task) ?? [];
        waiting.push(resolve);
        this.watchers.set(task, waiting);
      });
    }
  }

  /**
   * How many executions of a task are held.
   *
   * @param task - The task's name
   * @returns The count
   */
  holding(task: string): number {
    return this.held.get(task)?.length ?? 0;
  }

  /**
   * Lets the oldest held execution of a task run on, through the wrapped
   * runner.
   *
   * @param task - The task's name
   * @throws {Error} When no execution of the task is held
   */
  release(task: string): void {
    this.oldest(task).settle({ release: true });
  }

  /**
   * Fails the oldest held execution of a task, which never reaches the
   * wrapped runner.
   *
   * @param task - The task's name
   * @param message - What its result says went wrong
   * @throws {Error} When no execution of the task is held
   */
  fail(task: string, message: string): void {
    this.oldest(task).settle({ fail: message });
  }

  /** Takes the oldest held execution of a task out of what is held. */
  private oldest(task: string): Held {
    const next = this.held.get(task)?.shift();
    if (next === undefined) throw new Error(`GatedTaskRunner: no execution of '${task}' is held`);
    return next;
  }

  /**
   * Holds an execution of a gated task until the test lets it go, its run is
   * stopped, or the test fails it; any other runs straight through.
   */
  private gate(launch: GatedLaunch, options: TaskExecuteOptions | undefined, run: () => Promise<TaskResult>): Promise<TaskResult> {
    if (!this.gated.has(launch.task)) return run();
    return new Promise<TaskResult>((resolve, reject) => {
      const signal = options?.signal;
      const cancelled = (): void => {
        const queue = this.held.get(launch.task);
        const at = queue?.indexOf(entry) ?? -1;
        if (at >= 0) queue!.splice(at, 1);
        resolve({ state: 'error', cached: false, executionId: uuidv7(), error: 'cancelled: the run was stopped', cancelled: true });
      };
      const entry: Held = {
        launch,
        told: false,
        settle: (how) => {
          signal?.removeEventListener('abort', cancelled);
          if ('fail' in how) resolve({ state: 'failed', cached: false, executionId: uuidv7(), exitCode: 1, error: how.fail });
          else run().then(resolve, reject);
        },
      };
      if (signal?.aborted) {
        cancelled();
        return;
      }
      signal?.addEventListener('abort', cancelled, { once: true });
      const queue = this.held.get(launch.task) ?? [];
      queue.push(entry);
      this.held.set(launch.task, queue);
      for (const tell of this.watchers.get(launch.task)?.splice(0) ?? []) tell();
    });
  }

  execute(storage: StorageBackend, taskHash: string, inputHashes: string[], options?: TaskExecuteOptions): Promise<TaskResult> {
    return this.gate(
      { task: options?.taskName ?? taskHash, taskHash, inputHashes, unit: null },
      options,
      () => this.inner.execute(storage, taskHash, inputHashes, options),
    );
  }

  executeUnit(storage: StorageBackend, taskHash: string, unit: SplitUnit, options?: TaskExecuteOptions): Promise<TaskResult> {
    return this.gate(
      { task: options?.taskName ?? taskHash, taskHash, inputHashes: unit.inputs, unit },
      options,
      () => this.inner.executeUnit(storage, taskHash, unit, options),
    );
  }

  executionAlive(storage: StorageBackend, taskHash: string, inputsHash: string, running: RunningExecution): Promise<boolean | StopReason> {
    return this.inner.executionAlive(storage, taskHash, inputsHash, running);
  }

  runDetached(spec: DetachedSpec, options?: DetachedRunOptions): Promise<DetachedResult> {
    return this.inner.runDetached(spec, options);
  }

  get wholeIntakeLimit(): number | null {
    return this.inner.wholeIntakeLimit;
  }

  get firstWave(): 'measure' | 'estimate' | undefined {
    return this.inner.firstWave;
  }

  intake(storage: StorageBackend, spec: IntakeSpec, options?: IntakeOptions): Promise<IntakeResult> {
    return this.inner.intake(storage, spec, options);
  }
}

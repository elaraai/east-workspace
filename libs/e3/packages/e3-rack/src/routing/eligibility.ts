/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import type { TaskBodyRequest } from '@elaraai/e3-core';
import { decodeTaskObject } from '@elaraai/e3-types';
import { selectTask, type RackPolicy } from './policy.js';
import { rackTierFor, type IneligibleReason, type RackTier } from './tiers.js';
import { scanProgram } from './host-coupling.js';

/** A request's rack destination, or why it remains local. */
export type Eligibility =
  | { eligible: true; tier: RackTier; size: string; timeoutMinutes: number }
  | { eligible: false; reason: IneligibleReason };

/**
 * Evaluates routing once per logical task and graph name for a run.
 * The program and output reducer are task-object references, so a merge that
 * arrives before any map (cached maps) receives the same complete scan.
 * @example
 * const eligibility = await new EligibilityEvaluator(policy).evaluate(request);
 */
export class EligibilityEvaluator {
  private readonly verdicts = new Map<string, Promise<Eligibility>>();

  /** @param policy - The policy snapshot for this run */
  constructor(private readonly policy: RackPolicy) {}

  /**
   * Checks selection, runtime, environment and every executable IR bundle.
   * @param request - A task or split unit after its cache miss
   * @returns Its eligibility, with a deterministic reason on refusal
   */
  evaluate(request: TaskBodyRequest): Promise<Eligibility> {
    const name = request.options.taskName;
    if (name === undefined) return Promise.resolve({ eligible: false, reason: 'no-task-name' });
    const hash = request.logicalTaskHash ?? request.taskHash;
    const key = JSON.stringify([request.repo, hash, name]);
    let result = this.verdicts.get(key);
    if (result === undefined) {
      if (this.verdicts.size >= 4096) this.verdicts.clear();
      result = this.check(request, hash, name);
      this.verdicts.set(key, result);
    }
    return result;
  }

  private async check(request: TaskBodyRequest, logicalHash: string, name: string): Promise<Eligibility> {
    const selection = selectTask(this.policy, name);
    if (selection.target === 'local') return { eligible: false, reason: 'not-selected' };
    try {
      const task = logicalHash === request.taskHash ? request.task : decodeTaskObject(await request.storage.objects.read(request.repo, logicalHash));
      if (task.environment.type === 'some') return { eligible: false, reason: 'environment' };
      const tier = rackTierFor(task.runner);
      if ('ineligible' in tier) return { eligible: false, reason: tier.ineligible };
      if (task.body.type !== 'east') return { eligible: false, reason: 'custom-runner' };
      if (!selection.allowHostCoupled) {
        const programs = [task.body.value.program];
        const output = task.output.kind;
        if (output.type === 'dict' && output.value.merge.type === 'some') programs.push(output.value.merge.value);
        if (output.type === 'fold') programs.push(output.value.combine);
        const blocked = new Set<string>();
        for (const hash of programs) {
          for (const platform of await scanProgram(hash, () => request.storage.objects.read(request.repo, hash))) blocked.add(platform);
        }
        if (blocked.size > 0) return { eligible: false, reason: `host-coupled:${[...blocked].sort().join(',')}` };
      }
      return { eligible: true, tier: tier.tier, size: selection.size, timeoutMinutes: selection.timeoutMinutes };
    } catch {
      return { eligible: false, reason: 'unscannable' };
    }
  }
}

/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ArrayType, BooleanType, IntegerType, NullType, OptionType, StringType, StructType, VariantType, decodeBeast2For, encodeBeast2For, none, some, variant, type ValueTypeOf } from '@elaraai/east';
import { atomicWriteFile } from '@elaraai/e3-core';

/** The VM shapes the rack agent supports. */
export const RackComputeSizeType = VariantType({ serverless: NullType, small: NullType, medium: NullType, large: NullType, xlarge: NullType });
/** A whole-task-name glob and its execution policy; first match wins. */
export const RackRuleType = StructType({
  tasks: StringType,
  target: VariantType({ rack: NullType, local: NullType }),
  size: OptionType(RackComputeSizeType),
  timeoutMinutes: OptionType(IntegerType),
  allowHostCoupled: BooleanType,
});
/**
 * Stores this repository's rack opt-in. Runtime policy never affects hashes.
 * This is repository state: a future shape change needs a repository upgrade
 * under WIRE_MIGRATION.md, not a fallback decoder or an in-place widening.
 */
export const RackPolicyType = StructType({
  enabled: BooleanType,
  mode: VariantType({ optIn: NullType, auto: NullType }),
  rules: ArrayType(RackRuleType),
  defaultSize: RackComputeSizeType,
  defaultTimeoutMinutes: IntegerType,
  spill: BooleanType,
  claimTimeoutSeconds: IntegerType,
  retryTaskFailuresLocally: BooleanType,
});
/** A repository's rack policy. */
export type RackPolicy = ValueTypeOf<typeof RackPolicyType>;
/** A task's rule. */
export type RackRule = ValueTypeOf<typeof RackRuleType>;
/** An agent VM shape. */
export type RackComputeSize = ValueTypeOf<typeof RackComputeSizeType>['type'];

/** Conservative defaults: disabled, with explicit task selection required. */
export const DEFAULT_RACK_POLICY: RackPolicy = {
  enabled: false, mode: variant('optIn', null), rules: [], defaultSize: variant('large', null),
  defaultTimeoutMinutes: 1440n, spill: true, claimTimeoutSeconds: 30n, retryTaskFailuresLocally: false,
};
const encode = encodeBeast2For(RackPolicyType);
const decode = decodeBeast2For(RackPolicyType);

/** Explains a policy that cannot be used; no damaged policy silently delegates. */
export class RackPolicyError extends Error {
  /** @param message - The invalid policy and its remedy */
  constructor(message: string) { super(message); this.name = 'RackPolicyError'; }
}

/**
 * Names a repository's runtime rack policy.
 * @param repo - Repository path
 * @returns Its policy path
 * @example
 * const path = policyPath(repo);
 */
export function policyPath(repo: string): string { return join(repo, 'rack', 'policy.beast2'); }

function positive(value: bigint, field: string): void {
  if (!Number.isSafeInteger(Number(value)) || Number(value) <= 0) throw new RackPolicyError(`${field} must be a positive safe integer`);
}

function validate(policy: RackPolicy): void {
  positive(policy.defaultTimeoutMinutes, 'defaultTimeoutMinutes');
  positive(policy.claimTimeoutSeconds, 'claimTimeoutSeconds');
  if (Number(policy.claimTimeoutSeconds) > Number.MAX_SAFE_INTEGER / 1000) throw new RackPolicyError('claimTimeoutSeconds is too large');
  if (Number(policy.defaultTimeoutMinutes) > Number.MAX_SAFE_INTEGER / 60_000) throw new RackPolicyError('defaultTimeoutMinutes is too large');
  for (const rule of policy.rules) {
    if (rule.tasks.length === 0) throw new RackPolicyError('A task pattern cannot be empty');
    if (rule.timeoutMinutes.type === 'some') {
      positive(rule.timeoutMinutes.value, 'timeoutMinutes');
      if (Number(rule.timeoutMinutes.value) > Number.MAX_SAFE_INTEGER / 60_000) throw new RackPolicyError('timeoutMinutes is too large');
    }
  }
}

/**
 * Reads the policy, or returns independent defaults when none exists.
 * @param repo - Repository path
 * @returns The policy
 * @throws {RackPolicyError} When the file is invalid, naming its reset command
 * @example
 * const policy = await loadPolicy(repo);
 */
export async function loadPolicy(repo: string): Promise<RackPolicy> {
  const file = policyPath(repo);
  let bytes: Uint8Array;
  try { bytes = await readFile(file); } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return decode(encode(DEFAULT_RACK_POLICY));
    throw err;
  }
  try {
    const policy = decode(bytes);
    validate(policy);
    return policy;
  } catch (err) {
    throw new RackPolicyError(`${file}: ${err instanceof Error ? err.message : String(err)}; use 'e3 rack policy reset' to restore defaults`);
  }
}

/**
 * Atomically persists a validated rack policy.
 * @param repo - Repository path
 * @param policy - The new policy
 * @returns Once durable to concurrent readers
 * @example
 * await savePolicy(repo, setEnabled(await loadPolicy(repo), true));
 */
export async function savePolicy(repo: string, policy: RackPolicy): Promise<void> {
  validate(policy);
  await atomicWriteFile(policyPath(repo), encode(policy));
}

const patterns = new Map<string, RegExp>();
function pattern(text: string): RegExp {
  let result = patterns.get(text);
  if (result === undefined) {
    result = new RegExp(`^${[...text].map((c) => c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')).join('')}$`, 'u');
    if (patterns.size >= 4096) patterns.clear();
    patterns.set(text, result);
  }
  return result;
}

/** A task's selected runtime policy, with the winning rule's index. */
export interface TaskSelection {
  /** Where this task is requested to run. */
  target: 'rack' | 'local';
  /** Rack VM shape. */
  size: RackComputeSize;
  /** Maximum execution time in minutes. */
  timeoutMinutes: number;
  /** Whether the author deliberately overrides the host-access guard. */
  allowHostCoupled: boolean;
  /** First matching rule, or null for policy defaults. */
  ruleIndex: number | null;
}

/**
 * Selects the first whole-name matching rule, then policy defaults.
 * @param policy - The run's policy
 * @param taskName - The graph task name
 * @returns Its selection (eligibility is checked separately)
 * @example
 * const selection = selectTask(policy, 'train_model');
 */
export function selectTask(policy: RackPolicy, taskName: string): TaskSelection {
  const index = policy.rules.findIndex((rule) => pattern(rule.tasks).test(taskName));
  const rule = policy.rules[index];
  return {
    target: rule?.target.type ?? (policy.mode.type === 'auto' ? 'rack' : 'local'),
    size: rule?.size.type === 'some' ? rule.size.value.type : policy.defaultSize.type,
    timeoutMinutes: Number(rule?.timeoutMinutes.type === 'some' ? rule.timeoutMinutes.value : policy.defaultTimeoutMinutes),
    allowHostCoupled: rule?.allowHostCoupled ?? false,
    ruleIndex: index < 0 ? null : index,
  };
}

/** Optional settings applied when replacing or adding a task rule. */
export interface RuleSettings {
  /** Rack VM shape. */
  size?: RackComputeSize;
  /** Maximum task time in minutes. */
  timeoutMinutes?: number;
  /** Deliberate override of the host-access guard. */
  allowHostCoupled?: boolean;
}

/**
 * Replaces a rule in place, or appends it, leaving its input policy unchanged.
 * @param policy - Original policy
 * @param tasks - Whole-name glob
 * @param target - Requested location
 * @param settings - Optional overrides
 * @returns An independent policy
 * @example
 * const next = setRule(policy, 'train_*', 'rack', { size: 'large' });
 */
export function setRule(policy: RackPolicy, tasks: string, target: 'rack' | 'local', settings: RuleSettings = {}): RackPolicy {
  const next = decode(encode(policy));
  if (settings.timeoutMinutes !== undefined && (!Number.isSafeInteger(settings.timeoutMinutes) || settings.timeoutMinutes <= 0)) {
    throw new RackPolicyError('timeoutMinutes must be a positive safe integer');
  }
  const rule: RackRule = { tasks, target: variant(target, null), size: settings.size === undefined ? none : some(variant(settings.size, null)),
    timeoutMinutes: settings.timeoutMinutes === undefined ? none : some(BigInt(settings.timeoutMinutes)), allowHostCoupled: settings.allowHostCoupled ?? false };
  const index = next.rules.findIndex((r) => r.tasks === tasks);
  if (index < 0) next.rules.push(rule); else next.rules[index] = rule;
  validate(next);
  return next;
}

/**
 * Removes an exact pattern without changing the input policy.
 * @param policy - Original policy
 * @param tasks - Pattern to remove
 * @returns An independent policy
 * @example
 * const next = removeRule(policy, 'train_*');
 */
export function removeRule(policy: RackPolicy, tasks: string): RackPolicy {
  const next = decode(encode(policy)); return { ...next, rules: next.rules.filter((r) => r.tasks !== tasks) };
}

/**
 * Changes whether rack routing is enabled by default.
 * @param policy - Original policy
 * @param enabled - New default
 * @returns An independent policy
 * @example
 * const next = setEnabled(policy, true);
 */
export function setEnabled(policy: RackPolicy, enabled: boolean): RackPolicy { return { ...decode(encode(policy)), enabled }; }

/**
 * Changes the unmatched-task selection mode.
 * @param policy - Original policy
 * @param mode - optIn or auto
 * @returns An independent policy
 * @example
 * const next = setMode(policy, 'auto');
 */
export function setMode(policy: RackPolicy, mode: 'optIn' | 'auto'): RackPolicy { return { ...decode(encode(policy)), mode: variant(mode, null) }; }

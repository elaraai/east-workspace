/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The local-repository upgrade that carries a repository's rack policy into
 * the form in which a rule may hold a memory limit and ask for a GPU: each
 * rule gained `memoryLimit` and `gpu`.
 *
 * The policy is a file of a local repository's own (`rack/policy.beast2`),
 * which the rack package reads and writes. Its beast2 header names the whole
 * policy type, and a decode refuses a header whose type differs, so a policy
 * an earlier release stored is rewritten: every rule it holds is kept as it
 * is, with no memory limit and no GPU.
 *
 * Both forms are frozen copies, which nothing but this upgrade reads: the step
 * reads what the releases before it wrote and writes what it shipped, however
 * the policy changes after.
 *
 * @packageDocumentation
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ArrayType, BooleanType, IntegerType, NullType, OptionType, StringType, StructType, VariantType,
  decodeBeast2For, encodeBeast2For, isTypeValueEqual, none, readBeast2Type, toEastTypeValue,
  type EastType, type EastTypeValue, type ValueTypeOf,
} from '@elaraai/east';
import type { RepositoryUpgrade } from '../interfaces.js';
import { atomicWriteFile } from './localHelpers.js';

/** A rack's compute size, as both forms name it. */
const FrozenSizeType = VariantType({ serverless: NullType, small: NullType, medium: NullType, large: NullType, xlarge: NullType });

/** A rule's fields, as both forms hold them. */
const FROZEN_RULE = {
  tasks: StringType,
  target: VariantType({ rack: NullType, local: NullType }),
  size: OptionType(FrozenSizeType),
  timeoutMinutes: OptionType(IntegerType),
  allowHostCoupled: BooleanType,
};

/** A repository's rack policy, with its rules in the form given. */
function policyType<R extends EastType>(rule: R) {
  return StructType({
    enabled: BooleanType,
    mode: VariantType({ optIn: NullType, auto: NullType }),
    rules: ArrayType(rule),
    defaultSize: FrozenSizeType,
    defaultTimeoutMinutes: IntegerType,
    spill: BooleanType,
    claimTimeoutSeconds: IntegerType,
    retryTaskFailuresLocally: BooleanType,
  });
}

/**
 * A repository's rack policy as the releases before this upgrade wrote it,
 * frozen.
 *
 * @internal
 */
export const RackPolicyBeforeLimitsType = policyType(StructType(FROZEN_RULE));

/**
 * A repository's rack policy as this upgrade writes it, frozen: a rule may
 * hold a memory limit, in bytes, and ask for a GPU.
 *
 * @internal
 */
export const RackPolicyWithLimitsType = policyType(StructType({ ...FROZEN_RULE, memoryLimit: OptionType(IntegerType), gpu: BooleanType }));

/** A policy in the form before this upgrade. */
type PolicyBeforeLimits = ValueTypeOf<typeof RackPolicyBeforeLimitsType>;
/** A policy in the form this upgrade writes. */
type PolicyWithLimits = ValueTypeOf<typeof RackPolicyWithLimitsType>;

const BEFORE_TYPE = toEastTypeValue(RackPolicyBeforeLimitsType);
const WITH_TYPE = toEastTypeValue(RackPolicyWithLimitsType);
const decodeBefore = decodeBeast2For(RackPolicyBeforeLimitsType);
const encodeWith = encodeBeast2For(RackPolicyWithLimitsType);

/** The name a repository's record keeps once the upgrade is applied. */
export const RACK_POLICY_LIMITS = 'rack-policy-limits';

/**
 * Where a local repository keeps its rack policy.
 *
 * @param repo - The repository's path
 * @returns The policy's path
 *
 * @internal
 */
export function rackPolicyFile(repo: string): string {
  return join(repo, 'rack', 'policy.beast2');
}

/** Whether a stored policy's header names a form's type; false for bytes
 *  whose header does not read. */
function isForm(bytes: Uint8Array, type: EastTypeValue): boolean {
  try {
    return isTypeValueEqual(readBeast2Type(bytes), type);
  } catch {
    return false;
  }
}

/** A stored policy in the form before this upgrade, or null for bytes of any
 *  other form, or that do not decode. */
function beforeLimits(bytes: Uint8Array): PolicyBeforeLimits | null {
  if (!isForm(bytes, BEFORE_TYPE)) return null;
  try {
    return decodeBefore(bytes);
  } catch {
    return null;
  }
}

/** A policy of the form before this upgrade, in the form it writes: each rule
 *  as it was, with no memory limit and no GPU. */
function withLimits(policy: PolicyBeforeLimits): PolicyWithLimits {
  return { ...policy, rules: policy.rules.map((rule) => ({ ...rule, memoryLimit: none, gpu: false })) };
}

/**
 * Rewrites a local repository's rack policy in the form in which a rule may
 * hold a memory limit and ask for a GPU: every rule an earlier release stored
 * is kept, with neither.
 *
 * @remarks
 * A repository with no policy file has the defaults, and is left without one.
 * A policy already in the form this upgrade writes is left as it is; and so is
 * one in neither form, which a crash or a failing disk left, and which a read
 * refuses as it did before, naming its reset. The file is replaced whole, so a
 * reader sees the one form or the other.
 *
 * The step is one unit of work: a policy is one small file.
 */
export const rackPolicyLimits: RepositoryUpgrade = {
  name: RACK_POLICY_LIMITS,
  async apply(_storage, repo) {
    const file = rackPolicyFile(repo);
    let bytes: Uint8Array;
    try {
      bytes = await readFile(file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
    if (isForm(bytes, WITH_TYPE)) return null;
    const earlier = beforeLimits(bytes);
    if (earlier !== null) await atomicWriteFile(file, encodeWith(withLimits(earlier)));
    return null;
  },
};

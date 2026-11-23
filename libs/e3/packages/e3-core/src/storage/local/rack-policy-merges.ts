/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The local-repository upgrade that carries a repository's rack policy into
 * the form that says where a split task's merge units run: the policy gained
 * `defaultMerges`, after `retryTaskFailuresLocally`, and each rule `merges`,
 * after `gpu`.
 *
 * The policy is a file of a local repository's own (`rack/policy.beast2`),
 * which the rack package reads and writes. Its beast2 header names the whole
 * policy type, and a decode refuses a header whose type differs, so a policy
 * an earlier release stored is rewritten: everything it holds is kept as it
 * is, and its merges run on a rack, where its pieces run, as they did before.
 *
 * The form it reads is the one `rack-policy-limits` writes, which runs before
 * it; both forms are frozen copies, which nothing but the upgrades read.
 *
 * @packageDocumentation
 */

import { readFile } from 'node:fs/promises';
import {
  ArrayType, BooleanType, IntegerType, NullType, OptionType, StringType, StructType, VariantType,
  decodeBeast2For, encodeBeast2For, isTypeValueEqual, none, readBeast2Type, toEastTypeValue, variant,
  type EastTypeValue, type ValueTypeOf,
} from '@elaraai/east';
import type { RepositoryUpgrade } from '../interfaces.js';
import { atomicWriteFile } from './localHelpers.js';
import { RackPolicyWithLimitsType, rackPolicyFile } from './rack-policy-limits.js';

/** A rack's compute size, as the form names it. */
const FrozenSizeType = VariantType({ serverless: NullType, small: NullType, medium: NullType, large: NullType, xlarge: NullType });

/** Where a split task's merge units run, as the form names it. */
const FrozenMergesType = VariantType({ rack: NullType, local: NullType });

/**
 * A repository's rack policy as this upgrade writes it, frozen: the form with
 * limits, where a split task's merge units run unless its rule says, and
 * where each rule's run.
 *
 * @internal
 */
export const RackPolicyWithMergesType = StructType({
  enabled: BooleanType,
  mode: VariantType({ optIn: NullType, auto: NullType }),
  rules: ArrayType(StructType({
    tasks: StringType,
    target: VariantType({ rack: NullType, local: NullType }),
    size: OptionType(FrozenSizeType),
    timeoutMinutes: OptionType(IntegerType),
    allowHostCoupled: BooleanType,
    memoryLimit: OptionType(IntegerType),
    gpu: BooleanType,
    merges: OptionType(FrozenMergesType),
  })),
  defaultSize: FrozenSizeType,
  defaultTimeoutMinutes: IntegerType,
  spill: BooleanType,
  claimTimeoutSeconds: IntegerType,
  retryTaskFailuresLocally: BooleanType,
  defaultMerges: FrozenMergesType,
});

/** A policy in the form before this upgrade. */
type PolicyWithLimits = ValueTypeOf<typeof RackPolicyWithLimitsType>;
/** A policy in the form this upgrade writes. */
type PolicyWithMerges = ValueTypeOf<typeof RackPolicyWithMergesType>;

const BEFORE_TYPE = toEastTypeValue(RackPolicyWithLimitsType);
const WITH_TYPE = toEastTypeValue(RackPolicyWithMergesType);
const decodeBefore = decodeBeast2For(RackPolicyWithLimitsType);
const encodeWith = encodeBeast2For(RackPolicyWithMergesType);

/** The name a repository's record keeps once the upgrade is applied. */
export const RACK_POLICY_MERGES = 'rack-policy-merges';

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
function withLimits(bytes: Uint8Array): PolicyWithLimits | null {
  if (!isForm(bytes, BEFORE_TYPE)) return null;
  try {
    return decodeBefore(bytes);
  } catch {
    return null;
  }
}

/** A policy of the form before this upgrade, in the form it writes: as it
 *  was, each rule naming no merges of its own, and every merge on a rack. */
function withMerges(policy: PolicyWithLimits): PolicyWithMerges {
  return { ...policy, rules: policy.rules.map((rule) => ({ ...rule, merges: none })), defaultMerges: variant('rack', null) };
}

/**
 * Rewrites a local repository's rack policy in the form that says where a
 * split task's merge units run: everything an earlier release stored is
 * kept, and its merges run on a rack, as they did.
 *
 * @remarks
 * A repository with no policy file has the defaults, and is left without one.
 * A policy already in the form this upgrade writes is left as it is; and so is
 * one in no form the upgrades know, which a read refuses as it did before,
 * naming its reset. The file is replaced whole, so a reader sees the one form
 * or the other.
 *
 * The step is one unit of work: a policy is one small file.
 */
export const rackPolicyMerges: RepositoryUpgrade = {
  name: RACK_POLICY_MERGES,
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
    const earlier = withLimits(bytes);
    if (earlier !== null) await atomicWriteFile(file, encodeWith(withMerges(earlier)));
    return null;
  },
};

/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The local-repository upgrade that carries a repository's rack policy into
 * the form that says how long a rack keeps what the policy's work wrote there
 * for later work to read: the policy gained `keep`, after `defaultMerges`.
 *
 * The policy is a file of a local repository's own (`rack/policy.beast2`),
 * which the rack package reads and writes. Its beast2 header names the whole
 * policy type, and a decode refuses a header whose type differs, so a policy
 * an earlier release stored is rewritten: everything it holds is kept as it
 * is, and a rack keeps what it wrote for a split task's later units alone
 * (`split`), as it did before.
 *
 * The form it reads is the one `rack-policy-merges` writes, which runs before
 * it, after `rack-policy-limits` and `rack-policy-weigh-fetch`; both forms are
 * frozen copies, which nothing but the upgrades read.
 *
 * @packageDocumentation
 */

import { readFile } from 'node:fs/promises';
import {
  ArrayType, BooleanType, IntegerType, NullType, OptionType, StringType, StructType, VariantType,
  decodeBeast2For, encodeBeast2For, isTypeValueEqual, readBeast2Type, toEastTypeValue, variant,
  type EastTypeValue, type ValueTypeOf,
} from '@elaraai/east';
import type { RepositoryUpgrade } from '../interfaces.js';
import { atomicWriteFile } from './localHelpers.js';
import { rackPolicyFile } from './rack-policy-limits.js';
import { RackPolicyWithMergesType } from './rack-policy-merges.js';

/** A rack's compute size, as the form names it. */
const FrozenSizeType = VariantType({ serverless: NullType, small: NullType, medium: NullType, large: NullType, xlarge: NullType });

/** Where a split task's merge units run, as the form names it. */
const FrozenMergesType = VariantType({ rack: NullType, local: NullType });

/** How long a rack keeps what work wrote there for later work, as the form names it. */
const FrozenKeepType = VariantType({ split: NullType, session: NullType });

/**
 * A repository's rack policy as this upgrade writes it, frozen: the form that
 * weighs what work would fetch, says where a split task's merge units run,
 * and how long a rack keeps what work wrote there for later work.
 *
 * @internal
 */
export const RackPolicyWithKeepType = StructType({
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
  weighFetch: BooleanType,
  defaultMerges: FrozenMergesType,
  keep: FrozenKeepType,
});

/** A policy in the form before this upgrade. */
type PolicyWithMerges = ValueTypeOf<typeof RackPolicyWithMergesType>;
/** A policy in the form this upgrade writes. */
type PolicyWithKeep = ValueTypeOf<typeof RackPolicyWithKeepType>;

const BEFORE_TYPE = toEastTypeValue(RackPolicyWithMergesType);
const WITH_TYPE = toEastTypeValue(RackPolicyWithKeepType);
const decodeBefore = decodeBeast2For(RackPolicyWithMergesType);
const encodeWith = encodeBeast2For(RackPolicyWithKeepType);

/** The name a repository's record keeps once the upgrade is applied. */
export const RACK_POLICY_KEEP = 'rack-policy-keep';

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
function withMerges(bytes: Uint8Array): PolicyWithMerges | null {
  if (!isForm(bytes, BEFORE_TYPE)) return null;
  try {
    return decodeBefore(bytes);
  } catch {
    return null;
  }
}

/** A policy of the form before this upgrade, in the form it writes: as it
 *  was, a rack keeping what work wrote for a split task's later units alone. */
function withKeep(policy: PolicyWithMerges): PolicyWithKeep {
  return { ...policy, keep: variant('split', null) };
}

/**
 * Rewrites a local repository's rack policy in the form that says how long a
 * rack keeps what work wrote there: everything an earlier release stored is
 * kept, and a rack keeps what work wrote for a split task's later units
 * alone, as it did.
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
export const rackPolicyKeep: RepositoryUpgrade = {
  name: RACK_POLICY_KEEP,
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
    const earlier = withMerges(bytes);
    if (earlier !== null) await atomicWriteFile(file, encodeWith(withKeep(earlier)));
    return null;
  },
};

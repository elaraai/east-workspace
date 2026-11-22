/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The local-repository upgrade that carries a repository's rack policy into
 * the form that says whether a task or a unit whose inputs would take longer
 * to fetch than it takes to run runs here: the policy gained `weighFetch`,
 * after `retryTaskFailuresLocally`.
 *
 * The policy is a file of a local repository's own (`rack/policy.beast2`),
 * which the rack package reads and writes. Its beast2 header names the whole
 * policy type, and a decode refuses a header whose type differs, so a policy
 * an earlier release stored is rewritten: everything it holds is kept as it
 * is, and it weighs what work would fetch, as a new policy does.
 *
 * The form it reads is the one `rack-policy-limits` writes, which runs before
 * it; both forms are frozen copies, which nothing but the upgrades read.
 *
 * @packageDocumentation
 */

import { readFile } from 'node:fs/promises';
import {
  ArrayType, BooleanType, IntegerType, NullType, OptionType, StringType, StructType, VariantType,
  decodeBeast2For, encodeBeast2For, isTypeValueEqual, readBeast2Type, toEastTypeValue,
  type EastTypeValue, type ValueTypeOf,
} from '@elaraai/east';
import type { RepositoryUpgrade } from '../interfaces.js';
import { atomicWriteFile } from './localHelpers.js';
import { RackPolicyWithLimitsType, rackPolicyFile } from './rack-policy-limits.js';

/** A rack's compute size, as the form names it. */
const FrozenSizeType = VariantType({ serverless: NullType, small: NullType, medium: NullType, large: NullType, xlarge: NullType });

/**
 * A repository's rack policy as this upgrade writes it, frozen: the form with
 * limits, and whether work that would fetch for longer than it runs runs
 * here.
 *
 * @internal
 */
export const RackPolicyWithWeighFetchType = StructType({
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
  })),
  defaultSize: FrozenSizeType,
  defaultTimeoutMinutes: IntegerType,
  spill: BooleanType,
  claimTimeoutSeconds: IntegerType,
  retryTaskFailuresLocally: BooleanType,
  weighFetch: BooleanType,
});

/** A policy in the form before this upgrade. */
type PolicyWithLimits = ValueTypeOf<typeof RackPolicyWithLimitsType>;
/** A policy in the form this upgrade writes. */
type PolicyWithWeighFetch = ValueTypeOf<typeof RackPolicyWithWeighFetchType>;

const BEFORE_TYPE = toEastTypeValue(RackPolicyWithLimitsType);
const WITH_TYPE = toEastTypeValue(RackPolicyWithWeighFetchType);
const decodeBefore = decodeBeast2For(RackPolicyWithLimitsType);
const encodeWith = encodeBeast2For(RackPolicyWithWeighFetchType);

/** The name a repository's record keeps once the upgrade is applied. */
export const RACK_POLICY_WEIGH_FETCH = 'rack-policy-weigh-fetch';

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
 *  was, weighing what work would fetch. */
function withWeighFetch(policy: PolicyWithLimits): PolicyWithWeighFetch {
  return { ...policy, weighFetch: true };
}

/**
 * Rewrites a local repository's rack policy in the form that says whether
 * work that would fetch for longer than it runs runs here: everything an
 * earlier release stored is kept, and the policy weighs it, as a new one
 * does.
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
export const rackPolicyWeighFetch: RepositoryUpgrade = {
  name: RACK_POLICY_WEIGH_FETCH,
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
    if (earlier !== null) await atomicWriteFile(file, encodeWith(withWeighFetch(earlier)));
    return null;
  },
};

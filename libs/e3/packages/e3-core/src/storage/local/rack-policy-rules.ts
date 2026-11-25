/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The local-repository upgrade that carries a repository's rack policy into
 * the form of rules and defaults alone: the policy loses `weighFetch`,
 * `defaultMerges` and `keep`, and each rule its `merges`.
 *
 * A rack policy now says which tasks go to a rack, and how — each rule's
 * target, size, timeout, memory limit, GPU and host-access override — and the
 * defaults beside them: a size, a timeout, spill, the claim timeout and the
 * retry of a task's failures here. What a rack keeps of the work is no
 * policy's: a rack keeps what a hub's tasks read and write for as long as the
 * hub runs, encrypted under a key only the running hub holds. Work is no
 * longer weighed for what it would fetch, and a split task's merges run where
 * its pieces do.
 *
 * The policy is a file of a local repository's own (`rack/policy.beast2`),
 * which the rack package reads and writes. Its beast2 header names the whole
 * policy type, and a decode refuses a header whose type differs, so a policy
 * an earlier release stored is rewritten: its rules and defaults are kept as
 * they are, and what the form no longer holds is let go.
 *
 * The form it reads is the one `rack-policy-keep` writes, which runs before it,
 * after `rack-policy-limits`, `rack-policy-weigh-fetch` and
 * `rack-policy-merges`; both forms are frozen copies, which nothing but the
 * upgrades read.
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
import { rackPolicyFile } from './rack-policy-limits.js';
import { RackPolicyWithKeepType } from './rack-policy-keep.js';

/** A rack's compute size, as the form names it. */
const FrozenSizeType = VariantType({ serverless: NullType, small: NullType, medium: NullType, large: NullType, xlarge: NullType });

/**
 * A repository's rack policy as this upgrade writes it, frozen: its rules,
 * and the defaults beside them.
 *
 * @internal
 */
export const RackPolicyRulesType = StructType({
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
});

/** A policy in the form before this upgrade. */
type PolicyWithKeep = ValueTypeOf<typeof RackPolicyWithKeepType>;
/** A policy in the form this upgrade writes. */
type PolicyOfRules = ValueTypeOf<typeof RackPolicyRulesType>;

const BEFORE_TYPE = toEastTypeValue(RackPolicyWithKeepType);
const RULES_TYPE = toEastTypeValue(RackPolicyRulesType);
const decodeBefore = decodeBeast2For(RackPolicyWithKeepType);
const encodeRules = encodeBeast2For(RackPolicyRulesType);

/** The name a repository's record keeps once the upgrade is applied. */
export const RACK_POLICY_RULES = 'rack-policy-rules';

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
function withKeep(bytes: Uint8Array): PolicyWithKeep | null {
  if (!isForm(bytes, BEFORE_TYPE)) return null;
  try {
    return decodeBefore(bytes);
  } catch {
    return null;
  }
}

/** A policy of the form before this upgrade, in the form it writes: its rules
 *  and defaults as they were, without what the form no longer holds. */
function ofRules(policy: PolicyWithKeep): PolicyOfRules {
  return {
    enabled: policy.enabled, mode: policy.mode, defaultSize: policy.defaultSize, defaultTimeoutMinutes: policy.defaultTimeoutMinutes,
    spill: policy.spill, claimTimeoutSeconds: policy.claimTimeoutSeconds, retryTaskFailuresLocally: policy.retryTaskFailuresLocally,
    rules: policy.rules.map((rule) => ({ tasks: rule.tasks, target: rule.target, size: rule.size, timeoutMinutes: rule.timeoutMinutes,
      allowHostCoupled: rule.allowHostCoupled, memoryLimit: rule.memoryLimit, gpu: rule.gpu })),
  };
}

/**
 * Rewrites a local repository's rack policy in the form of rules and defaults
 * alone: its rules and defaults are kept, and `weighFetch`, `defaultMerges`,
 * `keep` and each rule's `merges` are let go.
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
export const rackPolicyRules: RepositoryUpgrade = {
  name: RACK_POLICY_RULES,
  async apply(_storage, repo) {
    const file = rackPolicyFile(repo);
    let bytes: Uint8Array;
    try {
      bytes = await readFile(file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
    if (isForm(bytes, RULES_TYPE)) return null;
    const earlier = withKeep(bytes);
    if (earlier !== null) await atomicWriteFile(file, encodeRules(ofRules(earlier)));
    return null;
  },
};

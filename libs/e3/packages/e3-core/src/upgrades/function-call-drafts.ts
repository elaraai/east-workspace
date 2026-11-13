/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The repository upgrade that carries kept function calls into the form in
 * which a call holds its drafts (east-workspace#1619): the call gained
 * `drafts`, its state the case `conflict`, and the record its store keeps
 * `drafted`, what the call's run lays its drafts from.
 *
 * A kept call's beast2 header names its whole type, and a decode refuses a
 * header whose type differs, so every call an earlier release filed is
 * rewritten, whatever its state: it passed no draft, and holds none.
 *
 * Both forms are frozen copies, which nothing but this upgrade reads: the step
 * reads what the releases before it wrote and writes what it shipped, however
 * the kept call changes after.
 *
 * @packageDocumentation
 */

import {
  ArrayType, BooleanType, DateTimeType, DictType, IntegerType, NullType, OptionType, StringType, StructType, VariantType,
  decodeBeast2For, encodeBeast2For, isTypeValueEqual, readBeast2Type, toEastTypeValue,
  type EastType, type EastTypeValue, type ValueTypeOf,
} from '@elaraai/east';
import { OBJECT_CONCURRENCY } from '../concurrency.js';
import type { RepositoryUpgrade } from '../storage/interfaces.js';
import { workInParts } from './parts.js';

/** A dataset's path, as both forms hold it. */
const FrozenTreePathType = ArrayType(VariantType({ field: StringType }));

/** A dataset read at a hash, as both forms hold it. */
const FrozenPinType = StructType({ path: FrozenTreePathType, hash: StringType });

/** How a stock runner reads a unit's inputs, as both forms hold it. */
const FrozenUnitDecodeType = VariantType({ lazy: NullType, whole: NullType });

/** A stock runner, as both forms hold it. */
const FrozenStockRunnerType = StructType({ platforms: ArrayType(StringType), decode: FrozenUnitDecodeType });

/** A call's runner, as both forms hold it. */
const FrozenRunnerType = VariantType({
  custom:    StructType({ command: ArrayType(StringType) }),
  east_c:    FrozenStockRunnerType,
  east_node: FrozenStockRunnerType,
  east_py:   FrozenStockRunnerType,
});

/** The states a call stands in, or ended in, in both forms. */
const FROZEN_STATES = {
  cancelled: StructType({ by: OptionType(StringType) }),
  failed:    StructType({ exitCode: IntegerType }),
  invalid:   StructType({
    diagnostics: ArrayType(StructType({
      message:  StringType,
      filename: OptionType(StringType),
      line:     OptionType(IntegerType),
      column:   OptionType(IntegerType),
    })),
  }),
  lost:      StructType({ message: StringType }),
  running:   NullType,
  succeeded: StructType({ value: StringType }),
  timed_out: StructType({ ms: IntegerType }),
  too_large: StructType({ bytes: IntegerType, limit: IntegerType }),
};

/** A call's state in the form this upgrade writes: the states both forms
 *  hold, and a draft that no longer fits its record. */
const FrozenStateWithConflictType = VariantType({
  ...FROZEN_STATES,
  conflict: StructType({ record: StringType, mutation: StringType, message: StringType }),
});

/** A call's draft, as this upgrade's form holds it. */
const FrozenDraftType = StructType({
  record:   StringType,
  mutation: StringType,
  args:     OptionType(StringType),
  commit:   StringType,
});

/** A record a call drafts, as this upgrade's form holds it for the call's
 *  run. */
const FrozenDraftedType = StructType({
  record:    StringType,
  path:      FrozenTreePathType,
  base:      StringType,
  mutations: DictType(StringType, StringType),
});

/** What a call's fields before its inputs are, with its state in the form
 *  given. */
function callHead<S extends EastType>(state: S) {
  return {
    id:        StringType,
    function:  OptionType(StringType),
    caller:    OptionType(StringType),
    startedAt: DateTimeType,
    endedAt:   OptionType(DateTimeType),
    state,
    package:   OptionType(StructType({ name: StringType, version: StringType })),
    args:      ArrayType(VariantType({ dataset: FrozenPinType, value: StringType })),
    inputs:    ArrayType(FrozenPinType),
  };
}

/** A call's fields after its inputs and its drafts, as both forms hold
 *  them. */
const CALL_TAIL = {
  limits:          StructType({ timeoutMs: IntegerType, maxResultBytes: IntegerType, maxLogBytes: IntegerType }),
  expiresAt:       DateTimeType,
  stdout:          StringType,
  stderr:          StringType,
  stdoutTruncated: BooleanType,
  stderrTruncated: BooleanType,
};

/** What a store keeps beside a call, as both forms hold it. */
const JOB_TAIL = {
  workspace:      StringType,
  functionObject: StringType,
  runner:         FrozenRunnerType,
  verbose:        BooleanType,
  deadline:       DateTimeType,
  cancel:         OptionType(StructType({ by: OptionType(StringType), at: DateTimeType })),
  keep:           StructType({ succeeded: IntegerType, failed: IntegerType }),
};

/**
 * A kept call as the releases before this upgrade stored it, frozen: it holds
 * no draft, and no state names one.
 *
 * @internal
 */
export const FunctionCallJobBeforeDraftsType = StructType({
  call: StructType({ ...callHead(VariantType(FROZEN_STATES)), ...CALL_TAIL }),
  ...JOB_TAIL,
});

/**
 * A kept call as this upgrade writes it, frozen: it holds its drafts, each
 * with the commit its record stood at; its state may be `conflict`; and its
 * store keeps, beside it, what its run lays the drafts from.
 *
 * @internal
 */
export const FunctionCallJobWithDraftsType = StructType({
  call: StructType({ ...callHead(FrozenStateWithConflictType), drafts: ArrayType(FrozenDraftType), ...CALL_TAIL }),
  ...JOB_TAIL,
  drafted: ArrayType(FrozenDraftedType),
});

/** A kept call in the form before this upgrade. */
type JobBeforeDrafts = ValueTypeOf<typeof FunctionCallJobBeforeDraftsType>;
/** A kept call in the form this upgrade writes. */
type JobWithDrafts = ValueTypeOf<typeof FunctionCallJobWithDraftsType>;

const BEFORE_TYPE = toEastTypeValue(FunctionCallJobBeforeDraftsType);
const WITH_TYPE = toEastTypeValue(FunctionCallJobWithDraftsType);
const decodeBefore = decodeBeast2For(FunctionCallJobBeforeDraftsType);
const encodeWith = encodeBeast2For(FunctionCallJobWithDraftsType);

/** The name a repository's record keeps once the upgrade is applied. */
export const FUNCTION_CALL_DRAFTS = 'function-call-drafts';

/** Whether a stored call's header names a form's type; false for bytes whose
 *  header does not read. */
function isForm(bytes: Uint8Array, type: EastTypeValue): boolean {
  try {
    return isTypeValueEqual(readBeast2Type(bytes), type);
  } catch {
    return false;
  }
}

/** A kept call in the form before this upgrade, or null for bytes of any
 *  other form, or that do not decode. */
function beforeDrafts(bytes: Uint8Array): JobBeforeDrafts | null {
  if (!isForm(bytes, BEFORE_TYPE)) return null;
  try {
    return decodeBefore(bytes);
  } catch {
    return null;
  }
}

/** A call of the form before this upgrade, in the form it writes: it passed
 *  no draft, so it holds none, and its run lays none. */
function withDrafts(job: JobBeforeDrafts): JobWithDrafts {
  return { ...job, call: { ...job.call, drafts: [] }, drafted: [] };
}

/**
 * Rewrites every function call a repository keeps in the form in which a call
 * holds its drafts: one an earlier release filed holds none.
 *
 * @remarks
 * Every call is read as it is stored, through the repository's call store
 * (`StorageBackend.calls`, `FunctionCallStore.readStored`), so the upgrade goes
 * through every backend's store alike, and written back through the stored
 * call's own `replace`. A call past its lifetime is carried too: its store
 * forgets it at its next read, as it would have. A call already in the form
 * this upgrade writes is left as it is; and so is one in neither form, which a
 * crash or a failing disk left, and which a read refuses as it did before.
 *
 * A unit of the step is a call. The units go in the order of their keys,
 * `<workspace>/<id>`, {@link OBJECT_CONCURRENCY} at once, and a part stops
 * between batches once its time is up, with the key of the last call it
 * carried as its cursor.
 */
export const functionCallDrafts: RepositoryUpgrade = {
  name: FUNCTION_CALL_DRAFTS,
  async apply(storage, repo, at, until) {
    const units = (await storage.calls.readStored(repo)).map((stored) => ({ key: `${stored.workspace}/${stored.id}`, unit: stored }));
    return workInParts(units, at, until, OBJECT_CONCURRENCY, async (stored) => {
      const bytes = await stored.read();
      if (bytes === null || isForm(bytes, WITH_TYPE)) return;
      const earlier = beforeDrafts(bytes);
      if (earlier !== null) await stored.replace(encodeWith(withDrafts(earlier)));
    });
  },
};

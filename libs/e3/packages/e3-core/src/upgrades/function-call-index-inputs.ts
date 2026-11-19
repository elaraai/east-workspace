/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The repository upgrade that carries kept function calls into the form in
 * which a call's input names the index it read (east-workspace#1617): each of
 * a call's `inputs` gained `index`, the index of the record at its path the
 * input read, by name; `none` for the dataset itself.
 *
 * A kept call's beast2 header names its whole type, and a decode refuses a
 * header whose type differs, so every call an earlier release filed is
 * rewritten, whatever its state: no input of it was an index, and each names
 * none.
 *
 * Both forms are frozen. The one it reads is the one `function-call-drafts`
 * writes, as that step froze it; the one it writes is that form with its
 * inputs' entries widened, frozen here. Nothing but an upgrade reads either:
 * the step reads what the releases before it wrote and writes what it shipped,
 * however the kept call changes after.
 *
 * @packageDocumentation
 */

import { ArrayType, OptionType, StringType, StructType, VariantType, encodeBeast2For, none, toEastTypeValue, type ValueTypeOf } from '@elaraai/east';
import { OBJECT_CONCURRENCY } from '../concurrency.js';
import type { RepositoryUpgrade } from '../storage/interfaces.js';
import { FunctionCallJobWithDraftsType } from './function-call-drafts.js';
import { isStoredForm, storedFormReader } from './forms.js';
import { workInParts } from './parts.js';

/** A dataset a call read, as this upgrade's form holds it: its path, the index
 *  of the record there that was read, and the hash the dataset was pinned at. */
const FrozenInputReadType = StructType({
  path:  ArrayType(VariantType({ field: StringType })),
  index: OptionType(StringType),
  hash:  StringType,
});

/**
 * A kept call as this upgrade writes it, frozen: the form the releases before
 * it stored, each of its inputs naming the index it read.
 *
 * @internal
 */
export const FunctionCallJobWithIndexInputsType = StructType({
  ...FunctionCallJobWithDraftsType.fields,
  call: StructType({ ...FunctionCallJobWithDraftsType.fields.call.fields, inputs: ArrayType(FrozenInputReadType) }),
});

/** A kept call in the form before this upgrade. */
type JobBeforeIndexInputs = ValueTypeOf<typeof FunctionCallJobWithDraftsType>;
/** A kept call in the form this upgrade writes. */
type JobWithIndexInputs = ValueTypeOf<typeof FunctionCallJobWithIndexInputsType>;

const WITH_TYPE = toEastTypeValue(FunctionCallJobWithIndexInputsType);
const encodeWith = encodeBeast2For(FunctionCallJobWithIndexInputsType);

/** The name a repository's record keeps once the upgrade is applied. */
export const FUNCTION_CALL_INDEX_INPUTS = 'function-call-index-inputs';

/** A kept call in the form before this upgrade, or null for bytes of any
 *  other form, or that do not decode. */
const beforeIndexInputs = storedFormReader(FunctionCallJobWithDraftsType);

/** A call of the form before this upgrade, in the form it writes: each of its
 *  inputs was a dataset itself, and names no index. */
function withIndexInputs(job: JobBeforeIndexInputs): JobWithIndexInputs {
  return { ...job, call: { ...job.call, inputs: job.call.inputs.map(({ path, hash }) => ({ path, index: none, hash })) } };
}

/**
 * Rewrites every function call a repository keeps in the form in which a
 * call's input names the index it read: one an earlier release filed read
 * datasets alone.
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
export const functionCallIndexInputs: RepositoryUpgrade = {
  name: FUNCTION_CALL_INDEX_INPUTS,
  async apply(storage, repo, at, until) {
    const units = (await storage.calls.readStored(repo)).map((stored) => ({ key: `${stored.workspace}/${stored.id}`, unit: stored }));
    return workInParts(units, at, until, OBJECT_CONCURRENCY, async (stored) => {
      const bytes = await stored.read();
      if (bytes === null || isStoredForm(bytes, WITH_TYPE)) return;
      const earlier = beforeIndexInputs(bytes);
      if (earlier !== null) await stored.replace(encodeWith(withIndexInputs(earlier)));
    });
  },
};

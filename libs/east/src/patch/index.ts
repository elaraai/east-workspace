/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Patch system for computing and applying differences between East values.
 *
 * Provides core operations:
 * - `diffFor(type)` — Compute the difference between two values
 * - `applyFor(type)` — Apply a patch to a value
 * - `composeFor(type)` — Combine two sequential patches
 * - `invertFor(type)` — Invert a patch
 *
 * Plus 3-way merge primitives:
 * - `detectConflictsFor(type)` — Identify overlapping leaves between two patches
 * - `mergePatchFor(type)`     — Merge two patches; throws on conflict
 * - `mergeWithResolutionsFor(type)` — Merge with caller-supplied conflict resolutions
 *
 * @module
 */

// Re-export types for public API
export {
  type PatchTypeOf,
  type Conflict,
  type Resolution,
  ConflictError,
} from "./types.js";

// Re-export PatchType constructor
export { PatchType } from "./type_of_patch.js";

// Re-export merge primitives
export {
  mergeFor,
  detectConflictsFor,
  mergeWithResolutionsFor,
} from "./merge.js";

// Re-export path utilities — typed segments + bidirectional string conversion
// for the documented `Conflict.path` format.
export {
  type PatchPathSegment,
  type PatchPath,
  field,
  index,
  dictKey,
  variantTag,
  pathToString,
  pathFromString,
  pathDisplay,
} from "./path.js";

// Re-export walk visitor — type-driven traversal of a PatchTypeOf<T> tree
// with re-diffing of container `replace` ops so consumers see leaf-level
// changes everywhere.
export {
  type PatchVisitor,
  type PatchLeafOp,
  type PatchContainerKind,
  walkPatch,
} from "./walk.js";

// Re-export prune utility — drop leaves from a patch by path predicate,
// cascading empty-container collapse up the tree.
export {
  type PrunePredicate,
  prunePatchFor,
} from "./prune.js";

// Promote core patch operations to public — long available via
// `@elaraai/east/internal`, the diff/apply/compose/invert primitives are
// stable and useful directly (e.g. for building diff-review UIs).
export { diffFor }    from "./diff.js";
export { applyFor }   from "./apply.js";
export { composeFor } from "./compose.js";
export { invertFor }  from "./invert.js";

// `validatePatchFor` — non-throwing variant of apply that returns per-leaf
// disagreements as data. Sits beside `applyFor` (strict, throws) for UI
// flows that need to preview a patch's compatibility before commit.
export { validatePatchFor, type PatchConflict } from "./validate.js";

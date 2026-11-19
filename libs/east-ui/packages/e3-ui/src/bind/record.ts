/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Reactive record binding for e3 UI tasks — read an `e3.record`'s current
 * state and apply its typed mutations from East UI code.
 *
 * `Record.bind` is the record-shaped sibling of `Data.bind` / `Func.bind`,
 * adapting the TanStack query/mutation split to East's reactive,
 * fire-and-forget model: `read` / `status` / `history` observe the record (the
 * read side, served from the shared dataset cache), while `mutate.<name>(…)`
 * launches a typed mutation fire-and-forget (the write side), with
 * `mutate.pending` / `status` / `error` / `cancel` tracking the shared,
 * latest-wins mutation lifecycle. A record's mutations serialize server-side
 * under compare-and-swap, so one shared channel per record is the honest model.
 *
 * `commit.<name>(…)` is the same write awaited: an async closure that resolves
 * to the server's terminal outcome. `Record.onApply` builds on it — an
 * editable collection's `onApply` that commits each batch to the record
 * through its patch door, as one commit.
 *
 * `draft.<name>(…)` is the same write not made: the mutation's call as a
 * draft (`FuncDraftType`), which a bound function that lists the record in
 * its `drafts` takes with its call and reads laid over the record.
 * `Record.toDraft` builds on it as `Record.onApply` builds on `commit` — the
 * batch a Save would commit, as the draft of that commit, its patch built by
 * the Save's own code.
 *
 * @packageDocumentation
 */

import { bindRecord } from './record-handle.js';
import { applyToRecord, draftOfRecord } from './record-apply.js';

export {
    RecordMutateStatusType,
    RecordErrorType,
    RecordBindingType,
    RecordOutcomeType,
    RecordBindHandleType,
    recordBindPlatformFn,
    RecordBindPrimitives,
    type BoundRecord,
    type MutationNameOf,
    type MutationsNamed,
} from './record-handle.js';
export {
    RecordToDraftResultType,
    RecordSaveTypeFor,
    type RecordApplyOptions,
    type RecordApplyInsideOptions,
} from './record-apply.js';

/**
 * The Record namespace — reactive record (read + mutate + history) binding for
 * e3 UI tasks, the Apply that commits an editable collection to a record, and
 * the draft of that Apply.
 *
 * @remarks
 * `Record.bind` binds an `e3.record` and its mutations to a handle: `read` /
 * `status` / `history` observe the record's current state (served from the
 * shared dataset cache), and `mutate.<name>` applies a typed mutation
 * fire-and-forget under compare-and-swap, refreshing `read()` on commit;
 * `commit.<name>` is the same write awaited, and `draft.<name>` the same write
 * not made. `Record.onApply` commits a Sheet's, a Plan's or a SnapGrid's
 * batches to the record, each Apply one commit through its patch door, and
 * what it answers carries the draft form of that Save beside it;
 * `Record.toDraft` answers the same batch as the draft of that commit alone,
 * for a bound function's call.
 *
 * Use inside `Reactive.Root` for reactive re-rendering as the record and the
 * mutation lifecycle change.
 */
export const Record = {
    bind: bindRecord,
    onApply: applyToRecord,
    toDraft: draftOfRecord,
} as const;

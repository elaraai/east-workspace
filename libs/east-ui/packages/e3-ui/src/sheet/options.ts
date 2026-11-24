/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The sheet's own options (`Sheet Spec.md` §3) — what an author passes
 * `<Sheet>` beside its rows and its columns: over a flat sheet, a grouped one
 * (#740), one with loose rows between its groups (#846), and an index's
 * window — and the form the root reads them in, erased. The root (`root.ts`)
 * builds the grid from them.
 *
 * @packageDocumentation
 */

import type {
    ArrayType,
    AsyncFunctionType,
    BooleanType,
    EastType,
    ExprType,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    SetType,
    StringType,
    StructType,
    SubtypeExprOrValue,
} from "@elaraai/east";

import type { DensityLiteral, DensityType, StatusValueLiteral, StatusValueType } from "@elaraai/east-ui";
import type {
    SheetAnyContextOf,
    SheetEntryOf,
    SheetLineOf,
    SheetLinesField,
    SheetPatchOf,
    SheetProposalOf,
    SheetRecordViewType,
    SheetSelectionType, SheetRowClickOf,
} from "./types.js";
import type { SheetFieldKey } from "./columns.js";
import type { SheetDriverValue, SheetRegisterValue } from "./registers.js";
import type { SheetGroupValue } from "./group.js";
import type { SheetSubRowsValue } from "./sub-rows.js";
import type { SheetEditsInput } from "./edits.js";
import type { SheetApplyResultType, SheetChangeSetTypeFor, SheetDraftOf, SheetNewGroupType, SheetNewRowType, SheetReadinessType } from "./transactions.js";
import type { SheetDraftEntryOf, SheetPatchEventTypeFor } from "./drafts.js";
import type { RecordSaveTypeFor } from "../bind/record.js";

/** The keys of a row struct whose field is a `String` — what `id` may name. */
export type SheetStringField<R extends StructType> = {
    [K in SheetFieldKey<R>]: R["fields"][K] extends StringType ? K : never
}[SheetFieldKey<R>];

/**
 * One row proposer — a synchronous or asynchronous East function over
 * `Sheet.Types.Context(R, D)` to `Array<Sheet.Types.Proposal(R)>` (§3.6).
 * The driver type is checked at build time against the sheet's driver.
 *
 * @typeParam R - The host's row type (a grouped sheet: the line type)
 */
export type SheetProposerInput<R extends StructType> =
    | SubtypeExprOrValue<FunctionType<[SheetAnyContextOf<R>], ArrayType<SheetProposalOf<R>>>>
    | SubtypeExprOrValue<AsyncFunctionType<[SheetAnyContextOf<R>], ArrayType<SheetProposalOf<R>>>>;

/**
 * The copilot's row-proposal declaration (B§5.2).
 *
 * @typeParam R - The host's row type
 * @property ahead - At most this many proposed rows below the anchor (default 2)
 * @property triggers - Column keys whose commit re-asks the proposers (default: every editable column)
 * @property ghost - Draw proposed rows as hatched ghosts (default `true`)
 * @property propose - The proposers; the first that returns rows wins
 */
export interface SheetSuggestInput<R extends StructType> {
    /** At most this many proposed rows below the anchor. */
    ahead?: SubtypeExprOrValue<IntegerType> | number;
    /** Column keys whose commit re-asks the proposers. */
    triggers?: SheetFieldKey<R>[];
    /** Draw proposed rows as hatched ghosts. */
    ghost?: boolean;
    /** The proposers; the first that returns rows wins. */
    propose: SheetProposerInput<R>[];
}

/** Business readiness checks add requirements without bypassing structural validity.
 * @typeParam R - The row struct (a grouped sheet's child struct)
 * @typeParam G - The group draft schema, when grouping is enabled
 */
export interface SheetReadyInput<R extends StructType, G extends EastType = never> {
    /**
     * Check a row draft and its current draft-aware context. Every check of
     * one evaluation runs in one call over the same `rows` (#882): read
     * them, never sort or edit them in place, or the checks after it see the
     * change. A check that throws marks its own row invalid.
     */
    row?: SubtypeExprOrValue<FunctionType<[SheetDraftOf<R>, SheetAnyContextOf<R>], typeof SheetReadinessType>>;
    /** Check the group's own draft fields; child issues are checked separately. */
    group?: [G] extends [never] ? never : SubtypeExprOrValue<FunctionType<[G], typeof SheetReadinessType>>;
}

/**
 * A sheet's `onApply` over its batch: an East function of the batch, sync or
 * async, or the Save with its draft form that `Record.onApply` answers — a
 * sheet handed that can hand its pending Save over as a draft.
 *
 * @typeParam B - The batch the sheet hands: `Sheet.Types.ChangeSet(R)`, or `ChangeSet(R, K)` by original primary key
 */
export type SheetApplyInput<B extends EastType> =
    | SubtypeExprOrValue<FunctionType<[B], typeof SheetApplyResultType>>
    | SubtypeExprOrValue<AsyncFunctionType<[B], typeof SheetApplyResultType>>
    | ExprType<ReturnType<typeof RecordSaveTypeFor<B>>>;

/**
 * The sheet's own options (§3) — `<Sheet>`'s props beside its rows (`record`
 * or `data`, or its `slice`'s `rows` source), its `columns`, its panes, its
 * narrowing, its views and its name.
 *
 * @typeParam R - The host's row type
 * @typeParam K - The rows' key type: a record's own, else `String` — the keys `newKey` takes and gives
 * @property id - The `String` field that identifies a row of `data` (required on a positional source; a keyed paged source's key is its id)
 * @property owned - Rows the upstream system owns: no copilot, stamped columns read-only — an accessor
 * @property driver - The driver declaration (`Sheet.driver`)
 * @property registers - Register name → members (`Sheet.register.*`)
 * @property suggest - The row-proposal declaration
 * @property activeView - The active view's id
 * @property onUpdate - The whole collection with the edit applied (inline arm only)
 * @property onSelect - The ring moved
 * @property onRowClick - A pointer click on a row: its key, typed, its place in its group and the column clicked (`Sheet.Types.RowClick(K)`)
 * @property selection - Controlled selection (§3.14)
 * @property newKey - A new row's key, the app's: given the keys taken, one that is not
 * @property group - Never on a flat sheet — grouped rows take {@link SheetGroupedOptions}
 * @property subRows - Read-only sub rows under each row, from its array fields (`Sheet.subRows`, #844)
 * @property readOnly - The whole sheet is read-only
 * @property blanks - Padding rows below the last real one (default 18)
 * @property density - Row rhythm
 * @property footer - Footer items
 * @property style - The gutter width
 * @property narrow - On a phone: any column it pins at the left, and how many it shows at once ({@link SheetNarrowInput})
 */
export interface SheetOptions<R extends StructType, K extends EastType = StringType> {
    /** Structural capabilities; defaults depend on grouping and source ordering. */
    edits?: SheetEditsInput;
    /** The `String` field that identifies a row. */
    id?: SheetStringField<R>;
    /** Rows the upstream system owns — an accessor. */
    owned?: (row: ExprType<R>) => SubtypeExprOrValue<BooleanType>;
    /** The driver declaration. */
    driver?: SheetDriverValue;
    /** Register name → members. */
    registers?: Record<string, SheetRegisterValue>;
    /** The row-proposal declaration. */
    suggest?: SheetSuggestInput<R>;
    /** The active view's id. */
    activeView?: SubtypeExprOrValue<OptionType<StringType>>;
    /** The whole collection with the edit applied (inline arm only). */
    onUpdate?: SubtypeExprOrValue<FunctionType<[ArrayType<R>], NullType>>;
    /** Observe one gesture's draft and domain patches; this does not authorize writes. */
    onPatch?: SubtypeExprOrValue<FunctionType<[ReturnType<typeof SheetPatchEventTypeFor<R>>], NullType>>;
    /** Submit one checked, idempotent batch to the authoritative source. */
    onApply?: SheetApplyInput<ReturnType<typeof SheetChangeSetTypeFor<R>>>;
    /** The ring moved. */
    onSelect?: SubtypeExprOrValue<FunctionType<[SheetSelectionType], NullType>>;
    /**
     * A pointer click on a row (east-workspace#1727), heard as `Sheet.Types.RowClick(K)`: the row's key at the rows' key
     * type, its place in its group, and the column clicked. Each press and release on a row fires it, on a row already
     * selected too — never a key, nor a press that ticks the row, steps a cell in place, drags or takes an action; a double
     * click fires it once. Passed through untouched, never called at build: an East function over the click, or a bare
     * lambda, which is built at that type.
     */
    onRowClick?: SubtypeExprOrValue<FunctionType<[SheetRowClickOf<K>], NullType>>;
    /** Controlled selection. */
    selection?: SubtypeExprOrValue<OptionType<SheetSelectionType>>;
    /** Additional author requirements; structural completeness always remains mandatory. */
    ready?: SheetReadyInput<R>;
    /** Explicit defaults for new rows, including required fields without columns. */
    newRow?: SubtypeExprOrValue<FunctionType<[typeof SheetNewRowType], SheetPatchOf<R>>>;
    /**
     * A new row's key, in the app's own scheme: given the keys taken — every key the sheet has read, and every one its
     * batch has drafted — one that is not. Without it a String key is a UUID, and an Integer one one past the largest
     * (#1549): of the keys taken, and of the last key a source paging the record's own entries serves, once it is read.
     * Any other key needs it, and so does an Integer key read through an index's window or a narrowing, which can't say
     * the record's largest — or, over a record, `rowKey`, which builds a row's key from the row. Never beside `rowKey`.
     */
    newKey?: SubtypeExprOrValue<FunctionType<[SetType<K>], K>>;
    /** Never on a flat sheet — grouped rows take {@link SheetGroupedOptions}. */
    group?: never;
    /** Read-only sub rows under each row, from its array fields. */
    subRows?: SheetSubRowsValue<R>;
    /** The whole sheet is read-only. */
    readOnly?: SubtypeExprOrValue<BooleanType> | boolean;
    /** Padding rows below the last real one. */
    blanks?: SubtypeExprOrValue<IntegerType> | number;
    /** Row rhythm. */
    density?: DensityLiteral | SubtypeExprOrValue<DensityType>;
    /** Footer items. */
    footer?: {
        /** The footer text. */
        text: SubtypeExprOrValue<StringType>;
        /** Optional status tint. */
        tone?: StatusValueLiteral | SubtypeExprOrValue<StatusValueType>;
    }[];
    /** The gutter width. The sheet fills the box it is given, and scrolls its own rows there. */
    style?: {
        /** The gutter width, a CSS px size. */
        gutterWidth?: SubtypeExprOrValue<StringType>;
    };
    /** On a phone: any column it pins at the left, and how many it shows at once. */
    narrow?: SheetNarrowInput<SheetFieldKey<R>>;
}

/**
 * The Sheet on a phone (`Mobile Sheet Spec.md` §9): a frame 560 px wide or
 * narrower shows a window of its columns, which its pager pages, and pins no
 * column unless `pin` names one (ruled 3 Nov 2026) — then that column leads
 * the row at the left, 150 wide, beside the window of the others. Above
 * 560 px it does nothing.
 *
 * @typeParam K - The columns' keys
 * @property pin - The column the phone pins at the left (default: none pinned)
 * @property columns - How many columns the window shows at once beside any pinned one, 1 to 3 (default 2)
 */
export interface SheetNarrowInput<K extends string = string> {
    /** The column the phone pins at the left; none is pinned without it. */
    pin?: K;
    /** How many columns the window shows at once beside any pinned one, 1 to 3. */
    columns?: 1 | 2 | 3;
}

/** A secondary-index view edits by original primary identity. */
export interface SheetIndexedOptions<K extends EastType, R extends StructType> extends Omit<SheetOptions<R, K>, "onApply"> {
    /** Checked keyed batch, usually Record.onApply(record, { keyed: true }). */
    onApply?: SheetApplyInput<ReturnType<typeof SheetChangeSetTypeFor<R, K>>>;
}

/**
 * The options of a GROUPED sheet (#740) — `<Sheet data={plans}
 * group={Sheet.group(P, "lines", …)} …>`: the group `P` is the row,
 * `columns` are declared over the line type its lines field holds, and the
 * edit channel addresses lines within their group.
 *
 * @typeParam P - The group's row type
 * @typeParam F - The lines field
 * @typeParam K - The groups' key type: a record's own, else `String` — the keys `newKey` takes and gives
 * @property group - The group declaration (`Sheet.group`)
 * @property suggest - The row-proposal declaration, over the LINE type
 * @property onUpdate - The whole collection of groups with the edit applied (inline arm only)
 * @property subRows - Read-only sub rows under each LINE, declared over the line type (#844)
 */
export interface SheetGroupedOptions<P extends StructType, F extends SheetLinesField<P>, K extends EastType = StringType>
    extends Omit<SheetOptions<P, K>, "group" | "suggest" | "onPatch" | "newRow" | "ready" | "subRows" | "narrow"> {
    /** On a phone: any line column it pins at the left, and how many it shows at once. */
    narrow?: SheetNarrowInput<SheetFieldKey<SheetLineOf<P, F>>>;
    /** Additional row and group requirements over complete field drafts. */
    ready?: SheetReadyInput<SheetLineOf<P, F>, SheetDraftEntryOf<P, F>>;
    /** Explicit defaults for each new child row. */
    newRow?: SubtypeExprOrValue<FunctionType<[typeof SheetNewRowType], SheetPatchOf<SheetLineOf<P, F>>>>;
    /** Explicit defaults for a new group. */
    newGroup?: SubtypeExprOrValue<FunctionType<[typeof SheetNewGroupType], SheetPatchOf<P>>>;
    /** The group declaration. */
    group: SheetGroupValue<P, F>;
    /** The row-proposal declaration, over the line type. */
    suggest?: SheetSuggestInput<SheetLineOf<P, F>>;
    /** Observe a gesture with drafts over this group's child array. */
    onPatch?: SubtypeExprOrValue<FunctionType<[ReturnType<typeof SheetPatchEventTypeFor<P, F>>], NullType>>;
    /** Read-only sub rows under each line, declared over the line type. */
    subRows?: SheetSubRowsValue<SheetLineOf<P, F>>;
}

/**
 * The options of a sheet with LOOSE rows between its groups (#846) —
 * `<Sheet data={entries} group={Sheet.group(P, "lines", …)} …>` over
 * entries `Sheet.Types.Entry(P, "lines")`: each entry a group, or a row
 * of the line type standing between the groups. Everything a grouped sheet
 * takes, with `id`, `owned` and the write-back over the entry.
 *
 * @typeParam P - The group's row type
 * @typeParam F - The lines field
 * @property id - The `String` field that identifies an entry — a field of both the group type and the line type (a keyed paged source needs none: its key is the id)
 * @property owned - Entries the upstream system owns — an accessor over the entry
 * @property onUpdate - The whole collection of entries with the batch applied (inline arm only)
 * @property onPatch - Observe one gesture's draft and domain patches over the entries
 * @property onApply - Submit one checked, idempotent batch of entries
 */
export interface SheetEntriesOptions<P extends StructType, F extends SheetLinesField<P>> extends Omit<SheetGroupedOptions<P, F>, "id" | "owned" | "onUpdate" | "onPatch" | "onApply"> {
    /** The `String` field that identifies an entry — a field of both the group type and the line type. */
    id?: SheetStringField<P> & SheetStringField<SheetLineOf<P, F>>;
    /** Entries the upstream system owns — an accessor over the entry. */
    owned?: (entry: ExprType<SheetEntryOf<P, F>>) => SubtypeExprOrValue<BooleanType>;
    /** The whole collection of entries with the batch applied (inline arm only). */
    onUpdate?: SubtypeExprOrValue<FunctionType<[ArrayType<SheetEntryOf<P, F>>], NullType>>;
    /** Observe one gesture's draft and domain patches over the entries; this does not authorize writes. */
    onPatch?: SubtypeExprOrValue<FunctionType<[ReturnType<typeof SheetPatchEventTypeFor<SheetEntryOf<P, F>>>], NullType>>;
    /** Submit one checked, idempotent batch of entries to the authoritative source. */
    onApply?: SheetApplyInput<ReturnType<typeof SheetChangeSetTypeFor<SheetEntryOf<P, F>>>>;
}

/**
 * Either arm's options, erased — what the implementation reads: the sheet's
 * own, and its views and their write-back, which `<Sheet>` reads off its
 * `views` handle (`views.ts`).
 *
 * @internal
 */
export type SheetAnyOptions = Omit<SheetOptions<StructType>, "group" | "suggest" | "onPatch" | "newRow" | "ready" | "subRows" | "narrow"> & {
    narrow?: SheetNarrowInput;
    subRows?: SheetSubRowsValue<StructType>;
    ready?: { row?: unknown; group?: unknown };
    group?: SheetGroupValue<StructType, string>;
    suggest?: SheetSuggestInput<StructType>;
    onPatch?: unknown;
    newRow?: unknown;
    newGroup?: unknown;
    views?: SubtypeExprOrValue<ArrayType<SheetRecordViewType>>;
    onViewsChange?: SubtypeExprOrValue<FunctionType<[ArrayType<SheetRecordViewType>], NullType>>;
};

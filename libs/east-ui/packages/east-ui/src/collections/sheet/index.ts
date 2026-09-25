/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Sheet` — the planning spreadsheet (`libs/east-ui/docs/proposals/Sheet
 * Spec.md`): a sheet whose rows are the host's records, whose columns are
 * TYPED (a date, a quantity with a unit, a register lookup, a directed link
 * between register members, a stamped read-only code), whose blank tail
 * invites the next row, and whose copilot fills cells and proposes whole
 * rows from rules the author writes as East functions.
 *
 * The module is the namespace assembler over the split sources:
 * `types.ts` (the closed wire types + the typed constructors) ·
 * `columns.ts` (`Sheet.column.*`) · `registers.ts` (`Sheet.register.*`,
 * `Sheet.driver`) · `link.ts` (`Sheet.link.*`) · `group.ts` (`Sheet.group`,
 * `Sheet.group.cell.*`) · `sub-rows.ts` (`Sheet.subRows` / `Sheet.subRow`) ·
 * `transactions.ts` (`Sheet.apply` and the checked batch types) · `drafts.ts`
 * (the draft entry types and the `onPatch` event) · `edits.ts` (the `edits`
 * capabilities) · `bridge.ts` (the typed bridge) · `context-bridge.ts`,
 * `draft-bridge.ts` and `seed-bridge.ts` (draft-aware contexts, draft
 * decoding and the `newRow` / `newGroup` defaults) · `editing-bridge.ts` and
 * `editing-types.ts` (the editing session's callbacks and their closed
 * transport) · `apply-adapter.ts` and `request-store.ts` (the inline
 * `onUpdate` adapter and its request ledger) · `root.ts` (`Sheet.Root`).
 *
 * One namespace object per category, the `Plan.series` / `Plan.at` /
 * `Plan.Types` split, so categories never mix as they grow.
 *
 * @packageDocumentation
 */

import {
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
    East,
    type StructType,
    some,
    none,
} from "@elaraai/east";

import {
    SheetMemberType,
    SheetLinkType,
    SheetCellType,
    SheetRowType,
    SheetLineType,
    SheetBandType,
    SheetGroupCellType,
    SheetGroupType,
    SheetRowsCollectionType,
    SheetRowsType,
    SheetRegisterMemberType,
    SheetRegisterType,
    SheetDriverType,
    SheetHalfType,
    SheetSidesValueType,
    SheetStoreType,
    SheetMemberKindType,
    SheetMultipleType,
    SheetSideLockType,
    SheetSidesType,
    SheetCountedType,
    SheetContextType,
    SheetFillType,
    SheetProposalType,
    SheetProviderType,
    SheetProposerType,
    SheetSuggestType,
    SheetCheckContextType,
    SheetCheckType,
    SheetArityType,
    SheetColumnKindType,
    SheetColumnType,
    SheetViewType,
    SheetEditType,
    SheetSelectionType,
    SheetFooterItemType,
    SheetStyleType,
    SheetRootType,
    SheetFillTypeFor,
    SheetPatchTypeFor,
    SheetProposalTypeFor,
    SheetFacetType,
    SheetSubRowType,
    SheetDateLevelType,
    SheetOptionsRuleType,
    SheetNounType,
    sheetContextType,
    sheetCheckContextType,
    type SheetPatchInput,
    type SheetPatchOf,
} from "./types.js";
import { text, date, quantity, integer, lookup, reference, enumColumn, set, link, stamped, custom } from "./columns.js";
import { createMembers, concatMembers, createDriver } from "./registers.js";
import { createArity, check, parseLink, printLink, SheetMembersType, SheetRegisterMembersType } from "./link.js";
import { createSheet } from "./root.js";
import { createSubRows, createSubRow } from "./sub-rows.js";
import {
    createGroup,
    text as groupText,
    date as groupDate,
    quantity as groupQuantity,
    integer as groupInteger,
    reference as groupReference,
    enumCell as groupEnum,
    stamped as groupStamped,
} from "./group.js";

import { applySheet, SheetPositionType, SheetEntryPlacementType, SheetRowDestinationType, SheetFieldIssueType, SheetReadinessType, SheetIssueType, SheetBatchReadinessType, SheetOriginType, SheetApplyResultType, SheetNewRowType, SheetNewGroupType, SheetDraftTypeFor, SheetBaseTypeFor, SheetChangeTypeFor, SheetChangeSetTypeFor, SheetAppliedTypeFor } from "./transactions.js";
export * from "./transactions.js";
import { SheetEntryTypeFor, SheetDraftGroupTypeFor, SheetDraftEntryTypeFor, SheetDraftChangeTypeFor, SheetPatchEventTypeFor } from "./drafts.js";
export * from "./drafts.js";
export * from "./editing-types.js";
export { SheetRequestStore } from "./request-store.js";
export { buildInlineApply } from "./apply-adapter.js";

// Re-export the UIComp-free types so consumers reach everything via this barrel.
export {
    SheetMemberType,
    SheetLinkType,
    SheetCellType,
    SheetRowType,
    SheetLineType,
    SheetBandType,
    SheetFacetType,
    SheetSubRowType,
    SheetDateLevelType,
    type SheetDateLevelLiteral,
    SheetOptionsRuleType,
    SheetNounType,
    SHEET_TITLE_CELL,
    sheetRuleCell,
    SheetGroupCellType,
    SheetGroupType,
    SheetRowsCollectionType,
    SheetRowsType,
    SheetRegisterMemberType,
    SheetRegisterType,
    SheetDriverType,
    SheetHalfType,
    type SheetHalfLiteral,
    SheetSidesValueType,
    type SheetSidesLiteral,
    SheetStoreType,
    type SheetStoreLiteral,
    SheetMemberKindType,
    SheetMultipleType,
    SheetSideLockType,
    SheetSidesType,
    SheetCountedType,
    SheetContextType,
    SheetFillType,
    SheetProposalType,
    SheetProviderType,
    SheetProposerType,
    SheetSuggestType,
    SheetCheckContextType,
    SheetCheckType,
    SheetArityType,
    SheetColumnKindType,
    type SheetColumnKindLiteral,
    SheetColumnType,
    SheetViewType,
    SheetEditType,
    SheetSelectionType,
    SheetFooterItemType,
    SheetStyleType,
    SheetRootType,
    SheetContextTypeFor,
    SheetFillTypeFor,
    SheetPatchTypeFor,
    SheetProposalTypeFor,
    SheetCheckContextTypeFor,
    SheetGroupContextTypeFor,
    SheetGroupCheckContextTypeFor,
    sheetContextType,
    sheetCheckContextType,
    sheetLinesOf,
    type SheetContextOf,
    type SheetFillOf,
    type SheetPatchOf,
    type SheetProposalOf,
    type SheetCheckContextOf,
    type SheetGroupContextOf,
    type SheetGroupCheckContextOf,
    type SheetAnyContextOf,
    type SheetAnyCheckContextOf,
    type SheetLinesField,
    type SheetLineOf,
    type SheetEntryOf,
    type SheetLineAddress,
    type SheetPatchInput,
    type SheetFieldsOf,
} from "./types.js";
export {
    type SheetColumn,
    type SheetColumnSpec,
    type SheetFieldKey,
    type SheetMemberArrayField,
    type SheetFillInput,
    type SheetOptionsInput,
    type SheetColumnBaseConfig,
    type SheetValueConfig,
    type SheetTextConfig,
    type SheetDateConfig,
    type SheetQuantityConfig,
    type SheetIntegerConfig,
    type SheetLookupConfig,
    type SheetReferenceConfig,
    type SheetEnumConfig,
    type SheetMemberKindInput,
    type SheetMultipleInput,
    type SheetSetConfig,
    type SheetSidesInput,
    type SheetLinkConfig,
    type SheetStampedConfig,
    type SheetCustomConfig,
} from "./columns.js";
export {
    type SheetRegisterValue,
    type SheetMembersConfig,
    type SheetDriverConfig,
    type SheetDriverValue,
} from "./registers.js";
export {
    type SheetArityInput,
    type SheetCheckInput,
    type SheetExistsCheck,
    type SheetLocksInput,
    SheetMembersType,
    SheetRegisterMembersType,
    printMember,
    linkKeys,
} from "./link.js";
export {
    type SheetOptions,
    type SheetReadyInput,
    type SheetGroupedOptions,
    type SheetEntriesOptions,
    type SheetSuggestInput,
    type SheetProposerInput,
    type SheetStringField,
    type SheetBindHandle,
    createSheet,
} from "./root.js";
export {
    type SheetGroupCell,
    type SheetGroupConfig,
    type SheetGroupValue,
    type SheetGroupCellBaseConfig,
    type SheetGroupValueConfig,
    type SheetGroupDateConfig,
    type SheetGroupQuantityConfig,
    type SheetGroupStampedConfig,
    type SheetFieldOf,
    createGroup,
} from "./group.js";
export {
    type SheetArrayField,
    type SheetElementOf,
    type SheetSubRowSources,
    type SheetSubRowsValue,
    type SheetSubRowInput,
    createSubRows,
    createSubRow,
} from "./sub-rows.js";
export { type SheetColumnMeta, type SheetRuleCellMeta, describeColumn, describeGroupCell, optionPayload, cellTagOf } from "./bridge.js";

// ============================================================================
// Sheet.patch
// ============================================================================

/**
 * Builds a row patch — `Sheet.patch(R, { … })`: the fields it sets, every
 * other field `none`. A proposer returns patches as its proposed rows
 * (§3.6), and `newRow` / `newGroup` return one as a new row's explicit
 * defaults, including required fields no column shows — a field it leaves
 * `none` starts missing. Takes the literal-record form of `R`'s fields, each
 * a literal or an expression of the FIELD's type.
 *
 * @typeParam R - The host's row type
 * @param rowType - The row type value
 * @param record - The fields to set
 * @returns An expression of `Sheet.Types.Patch(R)`
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { ArrayType, East, IntegerType, StringType, StructType } from "@elaraai/east";
 * import { Reactive, Sheet, State, Text, UIComponentType, VStack } from "@elaraai/east-ui";
 *
 * const sheet = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const RowType = StructType({ id: StringType, task: StringType, qty: IntegerType, createdBy: StringType });
 *         const jobs = $.const(State.bind([ArrayType(RowType)], "sheet_insertion_jobs", [
 *             { id: "rough", task: "Rough machining", qty: 120n, createdBy: "planner" },
 *             { id: "inspect", task: "Inspect lots", qty: 4n, createdBy: "planner" },
 *             { id: "finish", task: "Finish housings", qty: 120n, createdBy: "planner" },
 *         ]));
 *         const saved = $.const(jobs.read());
 *         return <VStack gap="3" align="stretch">
 *             <Text textStyle="caption" color="fg.muted">Hover or focus a gutter to insert before a row. Select a row marker for Insert above/below, or use Alt+Insert and Alt+Shift+Insert. Name the draft and Apply to save it.</Text>
 *             <Sheet data={jobs} id="id" columns={{ task: Sheet.column.text(RowType), qty: Sheet.column.integer(RowType) }}
 *                 edits={{ insertRows: true, removeRows: false, moveRows: "none" }}
 *                 newRow={East.function([Sheet.Types.NewRow], Sheet.Types.Patch(RowType), () => Sheet.patch(RowType, { qty: 1n, createdBy: "planner" }))}
 *                 onUpdate={jobs.write} blanks={2n} />
 *             <Text.MonoLabel>{East.str`SAVED · ${saved.map((_$, row) => row.task).stringJoin(" → ")}`}</Text.MonoLabel>
 *         </VStack>;
 *     }}</Reactive>
 * ));
 * ```
 */
export function createPatch<R extends StructType>(rowType: R, record: SheetPatchInput<R>): ExprType<SheetPatchOf<R>> {
    const patchType = SheetPatchTypeFor(rowType);
    const fields: Record<string, unknown> = {};
    const rec = record as Record<string, unknown>;
    for (const name of Object.keys(rowType.fields as Record<string, EastType>)) {
        fields[name] = rec[name] !== undefined ? some(rec[name] as SubtypeExprOrValue<EastType>) : none;
    }
    return East.value(fields as never, patchType) as ExprType<SheetPatchOf<R>>;
}

// ============================================================================
// Namespace
// ============================================================================

/**
 * The type of the {@link Sheet} namespace. Declared explicitly (rather than
 * inferred from `as const`) so the declaration emit stays within
 * TypeScript's serialization limit.
 */
export interface SheetNamespace {
    /** Creates the Sheet root (the `<Sheet>` tag's factory). */
    Root: typeof createSheet;
    /** The column builders — each takes the row type first (§3.2). */
    column: {
        /** Free text. */
        text: typeof text;
        /** A UTC-midnight date with the B§3 grammar. */
        date: typeof date;
        /** A float with a unit per driver member. */
        quantity: typeof quantity;
        /** A whole number. */
        integer: typeof integer;
        /** The driver column — scored candidates from the driver's register. */
        lookup: typeof lookup;
        /** A lookup over a flat member list. */
        reference: typeof reference;
        /** An upper-cased register word with a valence dot. */
        enum: typeof enumColumn;
        /** Comma members — the link grammar without an arrow. */
        set: typeof set;
        /** `from > to` — the split cell (§3.4). */
        link: typeof link;
        /** A read-only code an upstream system owns. */
        stamped: typeof stamped;
        /** An author parse / print pair over the field's payload (§3.9). */
        custom: typeof custom;
    };
    /** Registers — the grammar's vocabulary, projected from the host's rows (§3.3). */
    register: {
        /** Members from rows through accessors, reified once; duplicates fold by key. */
        members: typeof createMembers;
        /** Joins member sets of different kinds into one register. */
        concat: typeof concatMembers;
    };
    /** The driver declaration — the `lookup` column whose member decides what the row does. */
    driver: typeof createDriver;
    /** The link value's helpers (§3.4). */
    link: {
        /** A link column's arity rule. */
        arity: typeof createArity;
        /** The built-in member checks (`exists`). */
        check: typeof check;
        /** The grammar's parse — text and a register's members to a link value. */
        parse: typeof parseLink;
        /** The grammar's print — a link value to the planner's text. */
        print: typeof printLink;
    };
    /** A row patch — the fields a proposal or a new row's defaults set (§3.6). */
    patch: typeof createPatch;
    /** Sub rows (#844) — `Sheet.subRows(R, { field: (item, row) => Sheet.subRow({ … }) })`, keyed by `R`'s array fields. */
    subRows: typeof createSubRows;
    /** One sub row — `Sheet.subRow({ code?, name, chips?, facets?, id? })`. */
    subRow: typeof createSubRow;
    /** Applies a checked entry batch atomically to a collection. */
    apply: typeof applySheet;
    /**
     * Grouped rows (#740) — `Sheet.group(P, "lines", { title, sub?, cells?, folded?, noun? })`
     * declares the group's lines field (an `Array` of line structs) and its
     * band; `Sheet.group.cell.*` builds the band's cells over the group's
     * fields. Over `Types.Entry(P, "lines")` entries, rows of the line type
     * stand between the groups as loose rows (#846).
     */
    group: typeof createGroup & {
        /** The band cell builders — each takes the group's row type first. */
        cell: {
            /** Free text. */
            text: typeof groupText;
            /** A UTC-midnight date. */
            date: typeof groupDate;
            /** A float — no unit on a band. */
            quantity: typeof groupQuantity;
            /** A whole number. */
            integer: typeof groupInteger;
            /** A lookup over a flat member list. */
            reference: typeof groupReference;
            /** An upper-cased register word with a valence dot. */
            enum: typeof groupEnum;
            /** A read-only code an upstream system owns. */
            stamped: typeof groupStamped;
        };
    };
    /** The Sheet East types — the closed wire types and the typed constructors. */
    Types: {
        /** `Entry(G, "rows")` — the group-or-row union of a source holding groups beside ungrouped rows: as a sheet's `data`, loose rows between the groups (#846) ({@link SheetEntryTypeFor}). */
        Entry: typeof SheetEntryTypeFor;
        /** DraftGroup type for source-bound editing. */
        DraftGroup: typeof SheetDraftGroupTypeFor;
        /** DraftEntry type for source-bound editing. */
        DraftEntry: typeof SheetDraftEntryTypeFor;
        /** DraftChange type for source-bound editing. */
        DraftChange: typeof SheetDraftChangeTypeFor;
        /** PatchEvent type for source-bound editing. */
        PatchEvent: typeof SheetPatchEventTypeFor;
        /** Position contract for checked Sheet transactions. */
        Position: typeof SheetPositionType;
        /** EntryPlacement contract for checked Sheet transactions. */
        EntryPlacement: typeof SheetEntryPlacementType;
        /** RowDestination contract for checked Sheet transactions. */
        RowDestination: typeof SheetRowDestinationType;
        /** FieldIssue contract for checked Sheet transactions. */
        FieldIssue: typeof SheetFieldIssueType;
        /** Readiness contract for checked Sheet transactions. */
        Readiness: typeof SheetReadinessType;
        /** Issue contract for checked Sheet transactions. */
        Issue: typeof SheetIssueType;
        /** BatchReadiness contract for checked Sheet transactions. */
        BatchReadiness: typeof SheetBatchReadinessType;
        /** Origin contract for checked Sheet transactions. */
        Origin: typeof SheetOriginType;
        /** ApplyResult contract for checked Sheet transactions. */
        ApplyResult: typeof SheetApplyResultType;
        /** NewRow contract for checked Sheet transactions. */
        NewRow: typeof SheetNewRowType;
        /** NewGroup contract for checked Sheet transactions. */
        NewGroup: typeof SheetNewGroupType;
        /** Draft contract for checked Sheet transactions. */
        Draft: typeof SheetDraftTypeFor;
        /** Base contract for checked Sheet transactions. */
        Base: typeof SheetBaseTypeFor;
        /** Change contract for checked Sheet transactions. */
        Change: typeof SheetChangeTypeFor;
        /** ChangeSet contract for checked Sheet transactions. */
        ChangeSet: typeof SheetChangeSetTypeFor;
        /** Applied contract for checked Sheet transactions. */
        Applied: typeof SheetAppliedTypeFor;
        /** The Sheet root IR ({@link SheetRootType}). */
        Root: typeof SheetRootType;
        /** One wire row — id, `owned`, one cell per declared column, and on a grouped sheet its lines and band ({@link SheetRowType}). */
        Row: typeof SheetRowType;
        /** One line of a group row on the wire ({@link SheetLineType}). */
        Line: typeof SheetLineType;
        /** One sub row — a lead, a detail and an id ({@link SheetSubRowType}). */
        SubRow: typeof SheetSubRowType;
        /** One labelled fact of a sub row's detail ({@link SheetFacetType}). */
        Facet: typeof SheetFacetType;
        /** How deep a date column reads a row's date ({@link SheetDateLevelType}). */
        DateLevel: typeof SheetDateLevelType;
        /** A column's options rule on the wire ({@link SheetOptionsRuleType}). */
        OptionsRule: typeof SheetOptionsRuleType;
        /** The word the renderer prints for a group ({@link SheetNounType}). */
        Noun: typeof SheetNounType;
        /** The band a group row draws ({@link SheetBandType}). */
        Band: typeof SheetBandType;
        /** The group declaration on the wire ({@link SheetGroupType}). */
        Group: typeof SheetGroupType;
        /** One band cell on the wire ({@link SheetGroupCellType}). */
        GroupCell: typeof SheetGroupCellType;
        /** The sheet's row collection ({@link SheetRowsCollectionType}). */
        Rows: typeof SheetRowsCollectionType;
        /** How the rows arrive — inline or paged ({@link SheetRowsType}). */
        RowSource: typeof SheetRowsType;
        /** One cell — the literal cell plus the typed link ({@link SheetCellType}). */
        Cell: typeof SheetCellType;
        /** The typed link value — `{ from, to }` member lists ({@link SheetLinkType}). */
        Link: typeof SheetLinkType;
        /** One link member ({@link SheetMemberType}). */
        Member: typeof SheetMemberType;
        /** A list of link members. */
        Members: typeof SheetMembersType;
        /** A count of a countable member ({@link SheetCountedType}). */
        Counted: typeof SheetCountedType;
        /** Which halves a driver member makes live ({@link SheetSidesValueType}). */
        Sides: typeof SheetSidesValueType;
        /** One half of a link ({@link SheetHalfType}). */
        Half: typeof SheetHalfType;
        /** How a `String`-backed link writes back ({@link SheetStoreType}). */
        Store: typeof SheetStoreType;
        /** One register member ({@link SheetRegisterMemberType}). */
        RegisterMember: typeof SheetRegisterMemberType;
        /** A list of register members — what `Sheet.link.parse` resolves against. */
        RegisterMembers: typeof SheetRegisterMembersType;
        /** One register ({@link SheetRegisterType}). */
        Register: typeof SheetRegisterType;
        /** The driver ({@link SheetDriverType}). */
        Driver: typeof SheetDriverType;
        /** One member kind a link column accepts ({@link SheetMemberKindType}). */
        MemberKind: typeof SheetMemberKindType;
        /** The counted-member grammar ({@link SheetMultipleType}). */
        Multiple: typeof SheetMultipleType;
        /** One lock rule ({@link SheetSideLockType}). */
        SideLock: typeof SheetSideLockType;
        /** A link column's applied sides declaration ({@link SheetSidesType}). */
        SidesDeclaration: typeof SheetSidesType;
        /** One declared column ({@link SheetColumnType}). */
        Column: typeof SheetColumnType;
        /** The column kind ({@link SheetColumnKindType}). */
        ColumnKind: typeof SheetColumnKindType;
        /** The WIRE copilot context ({@link SheetContextType}); authors use `Context(R, D)`. */
        WireContext: typeof SheetContextType;
        /** The WIRE fill ({@link SheetFillType}); authors use `Fill(T)`. */
        WireFill: typeof SheetFillType;
        /** The WIRE proposal ({@link SheetProposalType}); authors use `Proposal(R)`. */
        WireProposal: typeof SheetProposalType;
        /** A fill provider on the wire — sync or async ({@link SheetProviderType}). */
        Provider: typeof SheetProviderType;
        /** A row proposer on the wire ({@link SheetProposerType}). */
        Proposer: typeof SheetProposerType;
        /** The row-proposal declaration ({@link SheetSuggestType}). */
        Suggest: typeof SheetSuggestType;
        /** The WIRE check context ({@link SheetCheckContextType}); authors use `CheckContext(R)`. */
        WireCheckContext: typeof SheetCheckContextType;
        /** One member check ({@link SheetCheckType}). */
        Check: typeof SheetCheckType;
        /** A link column's arity rule on the wire ({@link SheetArityType}). */
        Arity: typeof SheetArityType;
        /** One saved view ({@link SheetViewType}). */
        View: typeof SheetViewType;
        /** The WIRE edit event ({@link SheetEditType}); internal gesture transport. */
        WireEdit: typeof SheetEditType;
        /** The selection ring's position ({@link SheetSelectionType}). */
        Selection: typeof SheetSelectionType;
        /** One footer item ({@link SheetFooterItemType}). */
        FooterItem: typeof SheetFooterItemType;
        /** The Sheet style ({@link SheetStyleType}). */
        Style: typeof SheetStyleType;
        /** `Context(R, D)` — the copilot context typed over the host's row and the driver's; `Context(P, "lines", D)` on a grouped sheet ({@link SheetContextTypeFor}, {@link SheetGroupContextTypeFor}). */
        Context: typeof sheetContextType;
        /** Constructs the draft-aware row, neighbours, group and driver context. */
        DraftContext: typeof sheetContextType;
        /** `Fill(T)` — a proposed value of a column's payload ({@link SheetFillTypeFor}). */
        Fill: typeof SheetFillTypeFor;
        /** `Patch(R)` — a row patch, every field an `Option` ({@link SheetPatchTypeFor}). */
        Patch: typeof SheetPatchTypeFor;
        /** `Proposal(R)` — a patch plus its provenance ({@link SheetProposalTypeFor}). */
        Proposal: typeof SheetProposalTypeFor;
        /** `CheckContext(R)` — what an author's member check sees; `CheckContext(P, "lines")` on a grouped sheet ({@link SheetCheckContextTypeFor}, {@link SheetGroupCheckContextTypeFor}). */
        CheckContext: typeof sheetCheckContextType;
    };
}

/**
 * The `Sheet` namespace — the planning spreadsheet. Assemble a sheet with
 * `Sheet.Root` (the `<Sheet>` tag), declare columns with `Sheet.column.*`
 * (row type first), registers with `Sheet.register.members` / `.concat` and
 * the driver with `Sheet.driver`, link rules with `Sheet.link.*`, proposed
 * rows and new-row defaults with `Sheet.patch`, grouped rows with
 * `Sheet.group` (#740), sub rows with `Sheet.subRows` / `Sheet.subRow`
 * (#844), apply a checked batch to a collection with `Sheet.apply`, and
 * reach every East type — the closed wire types and the typed constructors
 * `DraftContext(R, D)` / `Fill(T)` / `Patch(R)` / `Proposal(R)` /
 * `PatchEvent(E)` / `ChangeSet(E)` / `Entry(G, "rows")` / `CheckContext(R)`
 * — via `Sheet.Types.*`. The `<Sheet>` tag carries every member but `Root`.
 */
export const Sheet: SheetNamespace = {
    Root: createSheet,
    column: { text, date, quantity, integer, lookup, reference, enum: enumColumn, set, link, stamped, custom },
    register: { members: createMembers, concat: concatMembers },
    driver: createDriver,
    link: { arity: createArity, check, parse: parseLink, print: printLink },
    patch: createPatch,
    subRows: createSubRows,
    subRow: createSubRow,
    apply: applySheet,
    group: Object.assign(createGroup, {
        cell: { text: groupText, date: groupDate, quantity: groupQuantity, integer: groupInteger, reference: groupReference, enum: groupEnum, stamped: groupStamped },
    }),
    Types: {
        Entry: SheetEntryTypeFor,
        DraftGroup: SheetDraftGroupTypeFor,
        DraftEntry: SheetDraftEntryTypeFor,
        DraftChange: SheetDraftChangeTypeFor,
        PatchEvent: SheetPatchEventTypeFor,
        Position: SheetPositionType,
        EntryPlacement: SheetEntryPlacementType,
        RowDestination: SheetRowDestinationType,
        FieldIssue: SheetFieldIssueType,
        Readiness: SheetReadinessType,
        Issue: SheetIssueType,
        BatchReadiness: SheetBatchReadinessType,
        Origin: SheetOriginType,
        ApplyResult: SheetApplyResultType,
        NewRow: SheetNewRowType,
        NewGroup: SheetNewGroupType,
        Draft: SheetDraftTypeFor,
        Base: SheetBaseTypeFor,
        Change: SheetChangeTypeFor,
        ChangeSet: SheetChangeSetTypeFor,
        Applied: SheetAppliedTypeFor,
        Root: SheetRootType,
        Row: SheetRowType,
        Line: SheetLineType,
        SubRow: SheetSubRowType,
        Facet: SheetFacetType,
        DateLevel: SheetDateLevelType,
        OptionsRule: SheetOptionsRuleType,
        Noun: SheetNounType,
        Band: SheetBandType,
        Group: SheetGroupType,
        GroupCell: SheetGroupCellType,
        Rows: SheetRowsCollectionType,
        RowSource: SheetRowsType,
        Cell: SheetCellType,
        Link: SheetLinkType,
        Member: SheetMemberType,
        Members: SheetMembersType,
        Counted: SheetCountedType,
        Sides: SheetSidesValueType,
        Half: SheetHalfType,
        Store: SheetStoreType,
        RegisterMember: SheetRegisterMemberType,
        RegisterMembers: SheetRegisterMembersType,
        Register: SheetRegisterType,
        Driver: SheetDriverType,
        MemberKind: SheetMemberKindType,
        Multiple: SheetMultipleType,
        SideLock: SheetSideLockType,
        SidesDeclaration: SheetSidesType,
        Column: SheetColumnType,
        ColumnKind: SheetColumnKindType,
        WireContext: SheetContextType,
        WireFill: SheetFillType,
        WireProposal: SheetProposalType,
        Provider: SheetProviderType,
        Proposer: SheetProposerType,
        Suggest: SheetSuggestType,
        WireCheckContext: SheetCheckContextType,
        Check: SheetCheckType,
        Arity: SheetArityType,
        View: SheetViewType,
        WireEdit: SheetEditType,
        Selection: SheetSelectionType,
        FooterItem: SheetFooterItemType,
        Style: SheetStyleType,
        Context: sheetContextType,
        DraftContext: sheetContextType,
        Fill: SheetFillTypeFor,
        Patch: SheetPatchTypeFor,
        Proposal: SheetProposalTypeFor,
        CheckContext: sheetCheckContextType,
    },
};

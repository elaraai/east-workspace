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
 * `Sheet.driver`) · `link.ts` (`Sheet.link.*`) · `bridge.ts` (the typed
 * bridge) · `root.ts` (`Sheet.Root`).
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
    SheetSourceType,
    SheetEditType,
    SheetSelectionType,
    SheetFooterItemType,
    SheetStyleType,
    SheetRootType,
    SheetContextTypeFor,
    SheetFillTypeFor,
    SheetPatchTypeFor,
    SheetProposalTypeFor,
    SheetEditTypeFor,
    SheetCheckContextTypeFor,
    type SheetPatchInput,
    type SheetPatchOf,
} from "./types.js";
import { text, date, quantity, integer, lookup, reference, enumColumn, set, link, stamped, custom } from "./columns.js";
import { createMembers, concatMembers, createDriver } from "./registers.js";
import { createArity, check, parseLink, printLink, SheetMembersType, SheetRegisterMembersType } from "./link.js";
import { createSheet } from "./root.js";

// Re-export the UIComp-free types so consumers reach everything via this barrel.
export {
    SheetMemberType,
    SheetLinkType,
    SheetCellType,
    SheetRowType,
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
    SheetSourceType,
    type SheetSourceLiteral,
    SheetEditType,
    SheetSelectionType,
    SheetFooterItemType,
    SheetStyleType,
    SheetRootType,
    SheetContextTypeFor,
    SheetFillTypeFor,
    SheetPatchTypeFor,
    SheetProposalTypeFor,
    SheetEditTypeFor,
    SheetCheckContextTypeFor,
    type SheetContextOf,
    type SheetFillOf,
    type SheetPatchOf,
    type SheetProposalOf,
    type SheetEditOf,
    type SheetCheckContextOf,
    type SheetPatchInput,
    type SheetFieldsOf,
} from "./types.js";
export {
    type SheetColumn,
    type SheetColumnSpec,
    type SheetFieldKey,
    type SheetMemberArrayField,
    type SheetFillInput,
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
    type SheetSuggestInput,
    type SheetProposerInput,
    type SheetStringField,
    type SheetBindHandle,
    createSheet,
} from "./root.js";
export { type SheetColumnMeta, describeColumn, optionPayload, cellTagOf } from "./bridge.js";

// ============================================================================
// Sheet.patch
// ============================================================================

/**
 * Builds a row patch — `Sheet.patch(R, { … })`: the fields a proposal sets,
 * every other field `none` (§3.6). Takes the literal-record form of `R`'s
 * fields, each a literal or an expression of the FIELD's type.
 *
 * @typeParam R - The host's row type
 * @param rowType - The row type value
 * @param record - The fields to set
 * @returns An expression of `Sheet.Types.Patch(R)`
 *
 * @example
 * ```ts
 * Sheet.patch(PlanRowType, { activity: "Machining", start: some(endAt.addDays(3n)), qty: ctx.row.qty })
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
    /** A row patch — the fields a proposal sets (§3.6). */
    patch: typeof createPatch;
    /** The Sheet East types — the closed wire types and the typed constructors. */
    Types: {
        /** The Sheet root IR ({@link SheetRootType}). */
        Root: typeof SheetRootType;
        /** One wire row — id, `owned`, one cell per declared column ({@link SheetRowType}). */
        Row: typeof SheetRowType;
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
        /** Where an edit came from ({@link SheetSourceType}). */
        Source: typeof SheetSourceType;
        /** The WIRE edit event ({@link SheetEditType}); authors use `Edit(R)`. */
        WireEdit: typeof SheetEditType;
        /** The selection ring's position ({@link SheetSelectionType}). */
        Selection: typeof SheetSelectionType;
        /** One footer item ({@link SheetFooterItemType}). */
        FooterItem: typeof SheetFooterItemType;
        /** The Sheet style ({@link SheetStyleType}). */
        Style: typeof SheetStyleType;
        /** `Context(R, D)` — the copilot context typed over the host's row and the driver's ({@link SheetContextTypeFor}). */
        Context: typeof SheetContextTypeFor;
        /** `Fill(T)` — a proposed value of a column's payload ({@link SheetFillTypeFor}). */
        Fill: typeof SheetFillTypeFor;
        /** `Patch(R)` — a row patch, every field an `Option` ({@link SheetPatchTypeFor}). */
        Patch: typeof SheetPatchTypeFor;
        /** `Proposal(R)` — a patch plus its provenance ({@link SheetProposalTypeFor}). */
        Proposal: typeof SheetProposalTypeFor;
        /** `Edit(R)` — the raw edit event typed over the row ({@link SheetEditTypeFor}). */
        Edit: typeof SheetEditTypeFor;
        /** `CheckContext(R)` — what an author's member check sees ({@link SheetCheckContextTypeFor}). */
        CheckContext: typeof SheetCheckContextTypeFor;
    };
}

/**
 * The `Sheet` namespace — the planning spreadsheet. Assemble a sheet with
 * `Sheet.Root` (the `<Sheet>` tag), declare columns with `Sheet.column.*`
 * (row type first), registers with `Sheet.register.members` / `.concat` and
 * the driver with `Sheet.driver`, link rules with `Sheet.link.*`, proposed
 * rows with `Sheet.patch`, and reach every East type — the closed wire types
 * and the typed constructors `Context(R, D)` / `Fill(T)` / `Patch(R)` /
 * `Proposal(R)` / `Edit(R)` / `CheckContext(R)` — via `Sheet.Types.*`.
 */
export const Sheet: SheetNamespace = {
    Root: createSheet,
    column: { text, date, quantity, integer, lookup, reference, enum: enumColumn, set, link, stamped, custom },
    register: { members: createMembers, concat: concatMembers },
    driver: createDriver,
    link: { arity: createArity, check, parse: parseLink, print: printLink },
    patch: createPatch,
    Types: {
        Root: SheetRootType,
        Row: SheetRowType,
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
        Source: SheetSourceType,
        WireEdit: SheetEditType,
        Selection: SheetSelectionType,
        FooterItem: SheetFooterItemType,
        Style: SheetStyleType,
        Context: SheetContextTypeFor,
        Fill: SheetFillTypeFor,
        Patch: SheetPatchTypeFor,
        Proposal: SheetProposalTypeFor,
        Edit: SheetEditTypeFor,
        CheckContext: SheetCheckContextTypeFor,
    },
};

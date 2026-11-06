/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Seed new entries and children at the single gesture boundary. @packageDocumentation */
import { decodeBeast2For, equalFor, variant, type EastType, type ValueTypeOf } from "@elaraai/east";
import { Sheet, type SheetEditingType } from "@elaraai/e3-ui/internal";
import type { SheetNotice } from "./sheet-types.js";
import type { EntryVersion, Placement } from "./transactions.js";
import type { SheetCellValue, SheetRowValue } from "./values.js";

/**
 * A gesture the sheet refuses, and why, in the footer's words (#1536): a new entry whose key the app's `newKey` gives
 * taken already, a `newKey` that throws, or a new entry the app left a field of empty that no person can set. Thrown
 * where the gesture is built, before anything is drafted, so the gesture drafts nothing; the sheet says the notice,
 * and logs nothing.
 */
export class SheetRefused extends Error {
    /** What the footer says. */
    readonly notice: SheetNotice;

    constructor(notice: SheetNotice) {
        super(notice.id);
        this.name = "SheetRefused";
        this.notice = notice;
    }
}

const decodeWire = decodeBeast2For(Sheet.Types.Row);
const sameCell = equalFor(Sheet.Types.Cell);
type Cells = SheetRowValue["cells"];
type Editing = ValueTypeOf<typeof SheetEditingType>;
type Prepared = { row: SheetRowValue; draft: unknown; previous: SheetRowValue | undefined };

/** Omitted fields remain missing, including hidden required fields. */
function emptyDraft(type: EastType): unknown {
    if (type.type === "Struct") return Object.fromEntries(Object.entries(type.fields).map(([field, child]) => [field, emptyDraft(child)]));
    if (type.type === "Array") return [];
    return variant("missing", null);
}

/** Preserve constructor values across successive wire events within one gesture. */
function cellsAfter(input: Cells, defaults: Cells | undefined, previousInput?: Cells): Cells {
    const cells = new Map(defaults);
    for (const [key, value] of input) {
        const previous = previousInput?.get(key);
        if (previous !== undefined && sameCell(previous, value)) continue;
        if (previousInput === undefined && value.type === "Null" && cells.has(key)) continue;
        cells.set(key, value);
    }
    return cells;
}

/**
 * Invoke constructors only for newly materialized values. The returned base
 * maps child drafts by internal key before the typed decoder consumes cells.
 * Undo/redo replay the saved value and never run a constructor again.
 *
 * On a source with LOOSE rows between its groups (#846) the draft is the
 * entry's — a variant: a wire row with no band is a loose row, seeded by
 * `newRow` at its entry placement; one with a band is a group. A new line
 * there gets its id field minted by `mint` unless `newRow` supplied one: it is
 * the same domain field a loose row is identified by, never the line's
 * identity.
 *
 * @param input - The gesture's wire row
 * @param current - The entry's version before this event
 * @param previousInput - The wire row an earlier event of the gesture left
 * @param place - The entry's placement
 * @param editing - The decoded editing declaration
 * @param draftType - The entry's draft type
 * @param mint - Mints a new line's id on a source with loose rows
 * @returns The wire row, its draft and the wire row the decoder reads child drafts by
 */
export function prepareCreation(
    input: SheetRowValue,
    current: EntryVersion,
    previousInput: SheetRowValue | undefined,
    place: Placement,
    editing: Editing,
    draftType: EastType,
    mint?: () => string,
): Prepared {
    const field = editing.children.type === "some" ? editing.children.value : undefined;
    if (draftType.type !== "Variant") return prepareOf(input, current, previousInput, place, editing, draftType, field, undefined);
    // An entry of groups and loose rows: prepare its arm, then wrap it.
    const arm = input.band.type === "none" ? "row" : "group";
    const armType = draftType.cases[arm];
    if (armType === undefined) throw new Error("Expected an entry draft of a group or a row");
    const inner = current.draft === undefined ? undefined : (current.draft as variant).value;
    const prepared = prepareOf(input, { ...current, draft: inner }, previousInput, place, editing, armType, arm === "group" ? field : undefined, mint);
    return { ...prepared, draft: prepared.draft === undefined ? undefined : variant(arm, prepared.draft) };
}

/**
 * What a gesture's new entry — a row, a group, or a line of one — lacks that no person can set in the sheet (#1536):
 * the first of the declaration's `unsettable` fields its draft leaves missing, read as the gesture leaves it, so a
 * duplicate has its source's values. A new entry is one the gesture made, its lines new with it; a new line, one its
 * group did not hold before the gesture — a line moved in from another group brings its own draft.
 *
 * @param before - The entry's version before the gesture
 * @param after - Its version after it
 * @param editing - The decoded editing declaration
 * @param draftType - The entry's draft type
 * @returns What the new entry would have been, and the field's label — `undefined` when it lacks none
 */
export function unsetField(before: EntryVersion, after: EntryVersion, editing: Editing, draftType: EastType): { what: "row" | "line" | "group"; label: string } | undefined {
    if (after.draft === undefined) return undefined;
    const created = before.draft === undefined;
    const missing = (draft: unknown, fields: Editing["unsettable"]["row"]) => fields.find(({ field }) => (draft as Record<string, variant | undefined>)[field]?.type === "missing");
    // An entry of groups and loose rows: its arm says which it is.
    const arm = draftType.type === "Variant" ? (after.draft as variant) : undefined;
    const draft = arm === undefined ? after.draft : arm.value;
    const field = editing.children.type === "some" && arm?.type !== "row" ? editing.children.value : undefined;
    if (field === undefined) {
        const unset = created ? missing(draft, editing.unsettable.row) : undefined;
        return unset === undefined ? undefined : { what: "row", label: unset.label };
    }
    const unset = created ? missing(draft, editing.unsettable.group) : undefined;
    if (unset !== undefined) return { what: "group", label: unset.label };
    const held = new Set(created ? [] : before.wire?.lines.map((line) => line.key));
    const children = (draft as Record<string, unknown>)[field] as readonly unknown[];
    for (const [i, line] of (after.wire?.lines ?? []).entries()) {
        const lacks = held.has(line.key) ? undefined : missing(children[i], editing.unsettable.row);
        if (lacks !== undefined) return { what: "line", label: lacks.label };
    }
    return undefined;
}

/** {@link prepareCreation} for one struct draft: a flat row, a loose row, or a group with its children. */
function prepareOf(
    input: SheetRowValue,
    current: EntryVersion,
    previousInput: SheetRowValue | undefined,
    place: Placement,
    editing: Editing,
    draftType: EastType,
    field: string | undefined,
    mint: (() => string) | undefined,
): Prepared {
    const decodeDraft = decodeBeast2For(draftType);
    let draft = current.draft;
    let baseWire = current.wire;
    let seeded = false;
    if (draft === undefined && place.type === "some") {
        const seed = field === undefined
            ? editing.newRow.type === "some" ? editing.newRow.value({ destination: variant("entry", place.value) }) : undefined
            : editing.newGroup.type === "some" ? editing.newGroup.value({ place: place.value }) : undefined;
        if (seed) { draft = decodeDraft(seed.draft); baseWire = decodeWire(seed.row); seeded = true; }
    }
    // Existing entries arrive as full projections. Only intra-gesture deltas
    // need merging; a new entry overlays its explicit input onto its defaults.
    const cells = seeded || previousInput !== undefined
        ? cellsAfter(input.cells, baseWire?.cells, previousInput?.cells) : input.cells;
    if (field === undefined) return { row: { ...input, cells }, draft, previous: baseWire };
    if (draftType.type !== "Struct") throw new Error("Expected a group draft struct");
    const childrenType = draftType.fields[field];
    if (childrenType?.type !== "Array") throw new Error("Expected child drafts");
    const childDraftType = childrenType.value;
    const decodeChild = decodeBeast2For(childDraftType);
    const idField = editing.idField.type === "some" ? editing.idField.value : undefined;
    const mintsId = mint !== undefined && idField !== undefined && childDraftType.type === "Struct" && childDraftType.fields[idField] !== undefined;
    const group = (draft ?? emptyDraft(draftType)) as Record<string, unknown>;
    const oldChildren = group[field] as unknown[];
    const byKey = new Map(baseWire?.lines.map((line, index) => [line.key, { line, draft: oldChildren[index] }]));
    const oldInput = new Map(previousInput?.lines.map(line => [line.key, line]));
    // The gesture's later wire events were created before these defaults.
    // Retain constructor children that none of those events has seen yet.
    const initialLines = seeded ? baseWire!.lines
        : previousInput === undefined ? [] : baseWire?.lines.filter(line => !oldInput.has(line.key)) ?? [];
    const incoming = [...initialLines, ...input.lines];
    const children: unknown[] = [];
    const lines = incoming.map((line, index) => {
        const previous = byKey.get(line.key);
        let childDraft = previous?.draft;
        let defaults: Map<string, SheetCellValue> | undefined;
        if (childDraft === undefined && editing.newRow.type === "some") {
            const seed = editing.newRow.value({ destination: variant("child", { group: input.id, index: BigInt(index) }) });
            childDraft = decodeChild(seed.draft);
            defaults = decodeWire(seed.row).cells;
        }
        let child = childDraft ?? emptyDraft(childDraftType);
        // A new line beside loose rows (#846): its id field — a loose row's identity — minted unless supplied.
        if (previous === undefined && mintsId && (child as Record<string, { type: string }>)[idField!]?.type === "missing") {
            child = { ...(child as Record<string, unknown>), [idField!]: variant("value", mint!()) };
        }
        children.push(child);
        const cells = defaults !== undefined || previousInput !== undefined
            ? cellsAfter(line.cells, defaults ?? previous?.line.cells, oldInput.get(line.key)?.cells) : line.cells;
        return { ...line, cells };
    });
    const row = { ...input, cells, lines };
    return { row, draft: { ...group, [field]: children }, previous: row };
}

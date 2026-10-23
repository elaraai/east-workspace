/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Schematic's inspector (#1391, `Schematic Builder Spec.md` §9, SC15,
 * SC16, D11, D32): its end pane, given `inspector` — opted into, as the
 * Plan's, the Roster's and the Calendar's are — its tabs Details and Issues,
 * Issues with its count; collapsed, a rail with its icon, the issues' count
 * and what is selected. It replaces the hover cards (D11).
 *
 * Details shows what is selected (`inspect.ts`), every field through the
 * shared `FieldForm` — the shared input its East type takes, by its kind's
 * form (`fields`: the `Fields` specs of the fields no role writes) — under the
 * shared inspector head: its kind's icon and name, its own name, where it
 * stands, its status, and a Pending or New chip while its drafts hold it
 * otherwise than its record:
 *
 * - **an item**: its kind's form — or its kind's own `inspector` in its place
 *   — its details record's form, or its details' own; its position, `x` and
 *   `y`, with Unplace where its kind has a backlog; Delete; and what it is
 *   joined to, each link and net a control that selects it;
 * - **a zone**: its form, or its own Details;
 * - **a link**: its ends, each a Chooser over the items of the slots its role
 *   names; its form; Delete;
 * - **a net**: its sides, each tags over the keys of its slot's items; its
 *   form; Delete; and **a net's leg** — the stub a tap selected — its item, a
 *   control that selects it, and Remove, which takes it off its side;
 * - **several**: how many of each kind, and Delete;
 * - **nothing**: the drawing — its counts, and each record's last save with
 *   who made it.
 *
 * A Chooser, a side's tags and what an item is joined to offer only what the
 * rail's narrowing shows (#1392, §10.2).
 *
 * Every edit is one step of the editing's history (`editing.ts`): a field
 * through its record's `set`, the row a kind's own Details hands back through
 * `update` whole, a position, ends or sides through the kind's `write`, and
 * Delete as the canvas's Del — refused, the footer says why. A field its
 * drafts changed is tinted against its record. Read only — a kind bound read
 * only, or the Schematic `readOnly` — Details shows every field and edits
 * none, an own Details giving way to the form; while a record takes no edit
 * (a Save in flight) its controls are off.
 *
 * Issues (SC16) lists the drawing's issues (`issues.ts`), each a control that
 * selects what it names and flies to it.
 *
 * Styles are the `schematicInspector` recipe's, the form's `fieldForm`'s and
 * the buttons the shared `button`'s; the pane — its tab row, its collapse
 * control and its rail — is the Dock's.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import { Box, chakra, useRecipe, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import {
    ArrayType, FloatType, StringType, StructType, encodeBeast2For, equalFor, fromEastTypeValue, none, some, variant,
    type EastType, type StructType as EastStructType,
} from "@elaraai/east";
import { Fields, type FieldSpecValue } from "@elaraai/east-ui/internal";
import {
    EastChakraComponent, FieldForm, getSomeorUndefined, useTrackedEvaluation, type BuilderFrameDock, type FieldOption, type Origin,
} from "@elaraai/east-ui-components";
import { ScheduleInspectorHead } from "../shared/schedule/inspector-head.js";
import { draftedRow, rowCodec } from "../shared/schedule/records.js";
import { entityId, refOfId, type DrawnItem, type DrawnLink, type DrawnNet, type DrawnZone, type SchematicDrawn, type SchematicRef } from "./canvas/drawn.js";
import type { SchematicCounts } from "./counts.js";
import type { SchematicValue } from "./data.js";
import { deleteEdits, editKinds, retargetEdits, type DeleteSelection, type EditRefusal, type NetLeg, type SchematicEdit, type SchematicFieldWrite } from "./edits.js";
import { detailsKey, type SchematicEditing } from "./editing.js";
import type { SchematicSavedRecord } from "./footer.js";
import { joinsOf, type SchematicDrawnEntity, type SchematicInspected } from "./inspect.js";
import type { SchematicInspectedRows, SchematicRowRead } from "./inspector-rows.js";
import type { SchematicIssue } from "./issues.js";
import type { SchematicWords } from "./messages.js";

type Styles = Record<string, SystemStyleObject>;
/** A kind of any sort, as the payload carries it. */
type AnyKind = SchematicValue["items"][number] | SchematicValue["zones"][number] | SchematicValue["links"][number] | SchematicValue["nets"][number];
/** A record's side as Details reads it: a kind's own, or its details'. */
type RecordSide = Pick<AnyKind, "editable" | "fields" | "inspector" | "rowType">;
/** An author's own Details, decoded: the row as bytes and its writer, to UI. */
type OwnDetails = Extract<AnyKind["inspector"], { type: "some" }>["value"];

/** The inspector open: the design system's 320px (§6), as the Plan's, the Sheet's and the Flowchart's are. */
const INSPECTOR_SIZE = "320px";

/** A form that takes no edit: read only. */
const NO_EDIT = (): void => {};
/** What a new row's form is tinted against: nothing — every field it has is a change. */
const NEW_ROW: Readonly<Record<string, unknown>> = {};

const stringEqual = equalFor(StringType);

/** An item's centre, as its form edits it. */
const PositionType = StructType({ x: FloatType, y: FloatType });
/** A link's ends, as their Choosers pick them: each item by its id. */
const EndsFormType = StructType({ from: StringType, to: StringType });
/** A net's sides, as their tags list them: each member by its key. */
const SidesFormType = StructType({ sources: ArrayType(StringType), destinations: ArrayType(StringType) });

/** What the inspector reads of the Schematic. */
export interface SchematicInspectorProps {
    /** The payload, decoded. */
    readonly value: SchematicValue;
    /** What Details shows. */
    readonly inspected: SchematicInspected;
    /** The inspected entity's stored rows: its own and its details'. */
    readonly rows: SchematicInspectedRows;
    /** What the canvas draws: the stored rows, the drafts in place. */
    readonly drawn: SchematicDrawn;
    /** The drawing as its lists show it, what the rail's narrowing leaves out left out (#1392): what a Chooser offers, and what an item is joined to. */
    readonly listed: SchematicDrawn;
    /** The editing: each record's session and drafts, and how an edit is recorded. */
    readonly editing: SchematicEditing;
    /** What the footer counts: the drawing's Details says it too. */
    readonly counts: SchematicCounts;
    /** The kinds' records whose commits say when each was last saved, and by whom. */
    readonly records: readonly SchematicSavedRecord[];
    /** The drawing's issues, and its sessions'. */
    readonly issues: readonly SchematicIssue[];
    /** The zone holding a point, by its name, as the Index files an item. */
    readonly zoneAt: (x: number, y: number) => string | undefined;
    /** Selects an entity, by its id — a net's leg with it — flying to it; `undefined` selects nothing. */
    readonly reveal: (id: string | undefined, leg?: NetLeg) => void;
    /** Says why an edit was refused, in the footer; `undefined` clears it. */
    readonly refuse: (words: string | undefined) => void;
    /** The open tab. */
    readonly tab: string;
    /** Opens a tab. */
    readonly onTab: (tab: string) => void;
    /** Where an own Details keeps its own state. */
    readonly storageKey: string;
    /** The Schematic's words. */
    readonly words: SchematicWords;
}

/** Each view's props: the inspector's, and the recipe's styles. */
interface ViewProps extends SchematicInspectorProps {
    readonly styles: Styles;
}

/** An entity's name, as the inspector says it: an item's or a zone's label, a link's ends, a net's label or its key. */
function nameOf(id: string, drawn: SchematicDrawn, words: SchematicWords): string {
    const item = drawn.items.find((i) => stringEqual(i.key, id));
    if (item !== undefined) return item.label;
    const zone = drawn.zones.find((z) => stringEqual(z.key, id));
    if (zone !== undefined) return zone.label;
    const end = (member: string) => drawn.items.find((i) => stringEqual(i.key, member))?.label ?? refOfId(member)?.key ?? member;
    const link = drawn.links.find((l) => stringEqual(l.key, id));
    if (link !== undefined) return words.m.linkEnds({ from: end(link.from), to: end(link.to) });
    const net = drawn.nets.find((n) => stringEqual(n.key, id));
    if (net !== undefined) return getSomeorUndefined(net.label) ?? net.ref.key;
    return refOfId(id)?.key ?? id;
}

/** What is selected, as the rail says it under its label. */
function whatOf(props: SchematicInspectorProps): string | undefined {
    const { inspected, drawn, words } = props;
    switch (inspected.view) {
        case "drawing": return undefined;
        case "several": return words.m.inspectorSeveral({ n: inspected.entities.length, count: words.number(inspected.entities.length) });
        case "entity":
        case "leg": return nameOf(inspected.id, drawn, words);
    }
}

/**
 * The inspector pane, as `BuilderFrame` draws it — see the module docs.
 *
 * @param props - What is selected and its rows, the drawing, the editing, the counts, the records, the issues, the tab and the words
 * @returns The pane — 320px wide, its collapsed state kept per viewer — or `undefined`, no pane, when the Schematic is given no inspector
 */
export function schematicInspectorPane(props: SchematicInspectorProps): BuilderFrameDock | undefined {
    if (!props.value.inspector) return undefined;
    const { words, issues } = props;
    const m = words.m;
    const n = issues.length;
    return {
        label: m.inspectorPane(),
        icon: "sliders",
        size: INSPECTOR_SIZE,
        persist: "local",
        // Collapsed, the rail counts the issues and names what is selected.
        badge: n > 0 ? n : undefined,
        detail: whatOf(props),
        tab: props.tab,
        onTabChange: props.onTab,
        tabs: [
            { key: "details", label: m.inspectorTab({ tab: "details" }), body: <SchematicInspectorDetails {...props} /> },
            { key: "issues", label: m.inspectorTab({ tab: "issues" }), count: n, body: <SchematicInspectorIssues {...props} /> },
        ],
    };
}

// ============================================================================
// The shared parts
// ============================================================================

/** One gesture's button: Delete, Unplace, Remove. */
function Action({ action, onClick, words }: { action: "delete" | "unplace" | "remove"; onClick: () => void; words: SchematicWords }) {
    const button = useRecipe({ key: "button" });
    return (
        <chakra.button type="button" css={button({ variant: "outline", size: "xs" })} data-inspector-action={action} onClick={onClick}>
            {words.m.inspectorAction({ action })}
        </chakra.button>
    );
}

/** A view's edits: its forms — or an own Details — and its gestures, in one fieldset, off while its record takes no edit. */
function Edits({ styles, available, children, actions }: { styles: Styles; available: boolean; children: ReactNode; actions: ReactNode | undefined }) {
    return (
        <chakra.fieldset css={styles.edits} disabled={!available} data-inspector-edits="">
            {children}
            {actions !== undefined && <Box css={styles.actions} data-inspector-actions="">{actions}</Box>}
        </chakra.fieldset>
    );
}

/** A form under its section's head — or, given none, an own Details in its place — remounted after a refused edit so it shows what the row holds again. */
function Form({ styles, head, section, specs, value, baseline, options, onChange, readOnly, refused }: {
    styles: Styles; head: string; section: string; specs: readonly FieldSpecValue[]; value: unknown; baseline: unknown;
    options?: Readonly<Record<string, readonly FieldOption[]>> | undefined;
    onChange: (path: readonly string[], value: unknown) => void; readOnly: boolean; refused?: number;
}) {
    if (specs.length === 0) return null;
    return (
        <Box css={styles.fields} data-inspector-fields={section}>
            <Box css={styles.sectionHead}>{head}</Box>
            <FieldForm key={refused ?? 0} specs={specs} value={value} baseline={baseline} options={options} onChange={onChange} readOnly={readOnly} />
        </Box>
    );
}

/** An own Details in its section: the author's UI for the row, its `update` writing the edited row back. */
function Custom({ styles, head, section, ui, storageKey }: { styles: Styles; head: string; section: string; ui: unknown; storageKey: string }) {
    return (
        <Box css={styles.custom} data-inspector-fields={section}>
            <Box css={styles.sectionHead}>{head}</Box>
            <EastChakraComponent value={ui as never} storageKey={storageKey} />
        </Box>
    );
}

/** A fact on a line of its own. */
function Fact({ styles, fact, children }: { styles: Styles; fact: string; children: ReactNode }) {
    return <Box css={styles.section}><Box css={styles.fact} data-inspector-fact={fact}>{children}</Box></Box>;
}

/** A remount counter for a form whose edit was refused: its input shows what the row holds again. */
function useRefused(): [number, () => void] {
    const [refused, setRefused] = useState(0);
    const bump = useCallback(() => setRefused((n) => n + 1), []);
    return [refused, bump];
}

/** A row as Details holds it: as its drafts hold it, else its record; what its form is tinted against; its chip. */
interface RowState {
    /** The row now, decoded: drafted, else as its record holds it; `undefined` while it is read, or for none. */
    readonly row: unknown;
    /** The row now, as bytes: what an own Details is handed. */
    readonly bytes: Uint8Array | undefined;
    /** What its form is tinted against: its record's row, or — a new row — nothing. */
    readonly baseline: unknown;
    /** New while its record holds none of it; Pending while its drafts hold it otherwise. */
    readonly chip: "pending" | "new" | undefined;
    /** Whether its stored row's read is in flight, and no draft stands in for it. */
    readonly reading: boolean;
}

/**
 * A record's row as Details holds it: drafted, its session's version; else as
 * its record holds it, from the reader's bytes.
 *
 * @param editing - The editing
 * @param record - The record's key in the history: a kind's slot, or its details'
 * @param side - The record's side: its row type
 * @param key - The row's key
 * @param read - Its stored row, as the reader read it
 * @returns The row's state
 */
function useRowState(editing: SchematicEditing, record: string, side: RecordSide | undefined, key: string, read: SchematicRowRead | undefined): RowState {
    const codec = useMemo(() => (side === undefined ? undefined : rowCodec(side.rowType)), [side]);
    const stored = useMemo(() => (read?.state === "held" && codec !== undefined ? codec.decode(read.row) : undefined), [read, codec]);
    const drafted = editing.schedule.draftsOf(record).has(key);
    const session = drafted ? editing.schedule.sessions.find((part) => stringEqual(part.kind, record))?.session : undefined;
    const draft = drafted ? draftedRow(session?.entries.get(key))?.row : undefined;
    const row = drafted ? draft : stored;
    const bytes = useMemo(() => {
        if (row === undefined || codec === undefined) return undefined;
        return !drafted && read?.state === "held" ? read.row : codec.encode(row);
    }, [row, codec, drafted, read]);
    return {
        row, bytes,
        baseline: stored ?? NEW_ROW,
        chip: drafted ? (read?.state === "held" ? "pending" : "new") : undefined,
        reading: !drafted && read?.state === "reading",
    };
}

/**
 * An own Details for a row: what the author's function returns for its bytes,
 * its `update` writing the edited row back — or, where it fails, nothing, and
 * the form shows.
 */
function useOwnDetails(author: OwnDetails | undefined, bytes: Uint8Array | undefined, update: (edited: Uint8Array) => null, what: string): unknown {
    return useMemo(() => {
        if (author === undefined || bytes === undefined) return undefined;
        try {
            return author(bytes, update);
        } catch (err) {
            console.error(`[Schematic] ${what}'s own Details failed; its form shows instead:`, err);
            return undefined;
        }
    }, [author, bytes, update, what]);
}

/**
 * A field of a form edited, as its record's `set` takes it: its path, and its
 * value as bytes at the field's type — its spec's, else the row's own field's.
 *
 * @param specs - The form's specs
 * @param rowType - The row type
 * @param path - The field's path
 * @param next - Its new value
 * @returns The write; `undefined` for a path no field is at
 */
function fieldWrite(specs: readonly FieldSpecValue[], rowType: RecordSide["rowType"], path: readonly string[], next: unknown): SchematicFieldWrite | undefined {
    const spec = specs.find((field) => field.path.length === path.length && field.path.every((part, i) => stringEqual(part, path[i]!)));
    const row = fromEastTypeValue(rowType) as EastStructType;
    const type = spec !== undefined ? fromEastTypeValue(spec.type) as EastType : path.length === 1 ? row.fields[path[0]!] : undefined;
    if (type === undefined) return undefined;
    return { path: [...path], value: encodeBeast2For(type)(next as never) };
}

/** A refusal's words, as the canvas says them. */
function refusalWords(refusal: EditRefusal, words: SchematicWords): string {
    return refusal.why === "end"
        ? words.m.endRefused({ kind: refusal.kind, end: refusal.end, item: refusal.item })
        : words.m.deleteRefused({ item: refusal.item, kind: refusal.kind, key: refusal.key });
}

/**
 * The edits a view records: each one step, a recorded one clearing the
 * footer's refusal — and Delete, as the canvas's Del, refused in its words.
 */
function useCommit(props: SchematicInspectorProps) {
    const { editing, refuse, value, drawn, words } = props;
    const commit = useCallback((edits: readonly SchematicEdit[], origin: Origin, label: string): boolean => {
        if (edits.length === 0) return false;
        const recorded = editing.record(edits, origin, label);
        if (recorded) refuse(undefined);
        return recorded;
    }, [editing, refuse]);
    const remove = useCallback((selection: DeleteSelection, label: string): boolean => {
        const result = deleteEdits(editKinds(value), drawn, selection);
        if ("refusal" in result) {
            refuse(refusalWords(result.refusal, words));
            return false;
        }
        return commit(result.edits, "remove", label);
    }, [value, drawn, words, refuse, commit]);
    return { commit, remove };
}

/** A kind of a sort, by its slot. */
function kindOf<K extends { readonly key: string }>(kinds: readonly K[], slot: string): K | undefined {
    return kinds.find((kind) => stringEqual(kind.key, slot));
}

/** A row whose read is in flight. */
const READING: SchematicRowRead = { state: "reading" };

/**
 * The reader's rows of an entity: its row and its details row — while the
 * reader still holds another entity's, the selection having just moved, each
 * in flight, so no row is ever read as another kind's.
 *
 * @param rows - What the reader read
 * @param ref - The entity Details shows
 * @returns Its row and its details row
 */
function rowsOf(rows: SchematicInspectedRows, ref: SchematicRef): { readonly row: SchematicRowRead; readonly details: SchematicRowRead | undefined } {
    const its = rows.ref !== undefined && stringEqual(rows.ref.kind, ref.kind) && stringEqual(rows.ref.key, ref.key);
    return its ? { row: rows.row, details: rows.details } : { row: READING, details: READING };
}

/** A coordinate as Details prints it: to the centimetre. */
function coordinate(n: number, words: SchematicWords): string {
    const digits = some(2n);
    return words.value(n, variant("number", { minimumFractionDigits: digits, maximumFractionDigits: digits, signDisplay: none }));
}

// ============================================================================
// Details
// ============================================================================

/** The Details tab: what is selected — an item, a zone, a link, a net, a net's leg, several — or the drawing. */
const SchematicInspectorDetails = memo(function SchematicInspectorDetails(props: SchematicInspectorProps) {
    const styles = useSlotRecipe({ key: "schematicInspector" })() as Styles;
    const view = { ...props, styles };
    const { inspected, value, drawn } = props;
    // Each selection its own view: what was typed for one never lands on the next.
    switch (inspected.view) {
        case "drawing": return <DrawingView key="drawing" {...view} />;
        case "several": return <SeveralView key="several" {...view} entities={inspected.entities} />;
        case "leg": {
            const net = drawn.nets.find((n) => stringEqual(n.key, inspected.id));
            const kind = kindOf(value.nets, inspected.ref.kind);
            if (net === undefined || kind === undefined) return null;
            return <LegView key={`leg:${inspected.id}:${inspected.leg.end}:${inspected.leg.item}`} {...view} net={net} kind={kind} leg={inspected.leg} />;
        }
        case "entity": {
            const at = `${inspected.sort}:${inspected.id}`;
            switch (inspected.sort) {
                case "item": {
                    const item = drawn.items.find((i) => stringEqual(i.key, inspected.id));
                    const kind = kindOf(value.items, inspected.ref.kind);
                    return item === undefined || kind === undefined ? null : <ItemView key={at} {...view} item={item} kind={kind} />;
                }
                case "zone": {
                    const zone = drawn.zones.find((z) => stringEqual(z.key, inspected.id));
                    const kind = kindOf(value.zones, inspected.ref.kind);
                    return zone === undefined || kind === undefined ? null : <ZoneView key={at} {...view} zone={zone} kind={kind} />;
                }
                case "link": {
                    const link = drawn.links.find((l) => stringEqual(l.key, inspected.id));
                    const kind = kindOf(value.links, inspected.ref.kind);
                    return link === undefined || kind === undefined ? null : <LinkView key={at} {...view} link={link} kind={kind} />;
                }
                case "net": {
                    const net = drawn.nets.find((n) => stringEqual(n.key, inspected.id));
                    const kind = kindOf(value.nets, inspected.ref.kind);
                    return net === undefined || kind === undefined ? null : <NetView key={at} {...view} net={net} kind={kind} />;
                }
            }
        }
    }
});

/**
 * A record's side of an entity as Details edits it: its form or its own
 * Details, over the row as its drafts and its record hold it; each field one
 * step through the record's `set`, the own Details' row one step whole.
 */
function useSide(props: ViewProps, ref: SchematicRef, name: string, side: RecordSide | undefined, details: boolean) {
    const { value, editing, rows, words } = props;
    const m = words.m;
    const record = details ? detailsKey(ref.kind) : ref.kind;
    const writes = side !== undefined && side.editable && !value.readOnly;
    const available = writes && editing.schedule.available(record);
    const its = rowsOf(rows, ref);
    const state = useRowState(editing, record, side, ref.key, details ? its.details : its.row);
    const { commit } = useCommit(props);
    const onField = useCallback((path: readonly string[], next: unknown) => {
        if (side === undefined) return;
        const write = fieldWrite(side.fields, side.rowType, path, next);
        if (write === undefined) return;
        commit([{ op: "set", ref, sets: [write], ...(details ? { details: true as const } : {}) }], "typed", m.inspectorStep({ edit: "edit", name }));
    }, [side, ref, details, commit, m, name]);
    const update = useCallback((edited: Uint8Array): null => {
        if (writes) commit([{ op: "row", ref, row: edited, ...(details ? { details: true as const } : {}) }], "typed", m.inspectorStep({ edit: "edit", name }));
        return null;
    }, [writes, ref, details, commit, m, name]);
    // Read only, the form shows every field: an own Details is for a record that takes its edits.
    const own = useOwnDetails(writes && side !== undefined ? getSomeorUndefined(side.inspector) : undefined, state.bytes, update, name);
    return { side, writes, available, state, onField, own };
}

/** A record's side drawn: its form, or its own Details, under its head; reading, or no row, said so. */
function SideBody({ styles, head, section, side, own, state, onField, writes, storageKey, empty, words }: {
    styles: Styles; head: string; section: string; side: RecordSide; own: unknown; state: RowState;
    onField: (path: readonly string[], value: unknown) => void; writes: boolean; storageKey: string; empty: string; words: SchematicWords;
}) {
    if (state.reading) return <Fact styles={styles} fact="reading">{words.m.inspectorReading()}</Fact>;
    if (state.row === undefined) return <Fact styles={styles} fact={`${section}-none`}>{empty}</Fact>;
    if (own !== undefined) return <Custom styles={styles} head={head} section={section} ui={own} storageKey={storageKey} />;
    return <Form styles={styles} head={head} section={section} specs={side.fields} value={state.row} baseline={state.baseline}
        onChange={writes ? onField : NO_EDIT} readOnly={!writes} />;
}

// ── An item ─────────────────────────────────────────────────────────────────

/** An item: its head, its form or own Details, its details', its position and Unplace, Delete, and what it is joined to. */
function ItemView(props: ViewProps & { readonly item: DrawnItem; readonly kind: SchematicValue["items"][number] }) {
    const { item, kind, styles, words, value, drawn, listed, rows, zoneAt, reveal, storageKey } = props;
    const m = words.m;
    const unit = getSomeorUndefined(value.scaleUnit);
    // The item's own row, and its details row: each its record's side.
    const self = useSide(props, item.ref, item.label, kind, false);
    const details = getSomeorUndefined(kind.details);
    const theirs = useSide(props, item.ref, item.label, details, true);
    const { commit, remove } = useCommit(props);
    // Its centre as its record holds it — what the position is tinted against; nothing for a new row.
    const stored = rowsOf(rows, item.ref).row;
    const heldAt = useMemo(() => {
        if (stored.state !== "held") return NEW_ROW;
        const at = getSomeorUndefined(kind.read(stored.row, item.ref.key).position);
        return at === undefined ? NEW_ROW : { x: at.x, y: at.y };
    }, [stored, kind, item.ref.key]);
    const positionSpecs = useMemo(() => Fields.specs(PositionType, {
        x: Fields.number<number>({ label: m.inspectorField({ field: "x" }), ...(unit === undefined ? {} : { unit }) }),
        y: Fields.number<number>({ label: m.inspectorField({ field: "y" }), ...(unit === undefined ? {} : { unit }) }),
    }), [m, unit]);
    const onPosition = useCallback((path: readonly string[], next: unknown) => {
        const n = next as number;
        const at = stringEqual(path[0]!, "x") ? { x: n, y: item.y } : { x: item.x, y: n };
        commit([{ op: "place", ref: item.ref, at: some(at) }], "move", m.inspectorStep({ edit: "edit", name: item.label }));
    }, [item, commit, m]);
    const joins = useMemo(() => joinsOf(item.key, listed), [item.key, listed]);
    const names = useMemo(() => new Map([...value.links, ...value.nets].map((k) => [k.key, k.name] as const)), [value.links, value.nets]);
    const actions = !self.writes ? undefined : (
        <>
            {kind.backlog && <Action action="unplace" words={words} onClick={() => {
                commit([{ op: "place", ref: item.ref, at: none }], "move", m.inspectorStep({ edit: "unplace", name: item.label }));
            }} />}
            <Action action="delete" words={words} onClick={() => {
                remove({ items: new Set([item.key]), link: null }, m.inspectorStep({ edit: "delete", name: item.label }));
            }} />
        </>
    );
    const icon = getSomeorUndefined(item.icon) ?? (kind.icon === "" ? "cube" : kind.icon);
    // Its status: as the canvas draws it, else as its details row — drafted, else read by its key — gives it.
    const detailsBytes = theirs.state.bytes;
    const status = useMemo(() => getSomeorUndefined(item.status)
        ?? (details === undefined || detailsBytes === undefined ? undefined : getSomeorUndefined(details.read(detailsBytes, item.ref.key).status)),
    [item.status, item.ref.key, details, detailsBytes]);
    return (
        <Box css={styles.root} data-schematic-inspector="item">
            <ScheduleInspectorHead styles={styles} kind={{ name: kind.name, icon }} title={item.label}
                when={m.inspectorAt({ zone: zoneAt(item.x, item.y), x: coordinate(item.x, words), y: coordinate(item.y, words), unit })}
                status={status} pending={self.state.chip} />
            <Edits styles={styles} available={self.available} actions={actions}>
                <SideBody styles={styles} head={m.inspectorSection({ section: "fields", name: kind.name })} section="row" side={kind} own={self.own}
                    state={self.state} onField={self.onField} writes={self.writes} storageKey={`${storageKey}.inspector.${kind.key}`} empty={m.inspectorNoRow()} words={words} />
                <Form styles={styles} head={m.inspectorSection({ section: "position", name: kind.name })} section="position" specs={positionSpecs}
                    value={{ x: item.x, y: item.y }} baseline={heldAt} onChange={self.writes ? onPosition : NO_EDIT} readOnly={!self.writes} />
            </Edits>
            {details !== undefined && (
                <Edits styles={styles} available={theirs.available} actions={undefined}>
                    <SideBody styles={styles} head={m.inspectorSection({ section: "details", name: kind.name })} section="details" side={details}
                        own={theirs.own} state={theirs.state} onField={theirs.onField} writes={theirs.writes}
                        storageKey={`${storageKey}.inspector.${kind.key}.details`} empty={m.inspectorNoDetails({ name: kind.name })} words={words} />
                </Edits>
            )}
            {(joins.links.length > 0 || joins.nets.length > 0) && (
                <Box css={styles.section} data-inspector-joins="">
                    <Box css={styles.sectionHead}>{m.inspectorSection({ section: "joins", name: kind.name })}</Box>
                    <Box as="ul" css={styles.links}>
                        {joins.links.map((link) => (
                            <Box as="li" key={link.key}>
                                <chakra.button type="button" css={styles.link} data-inspector-join={link.key} onClick={() => reveal(link.key)}>
                                    <Box as="span" css={styles.linkText}>{nameOf(link.key, drawn, words)}</Box>
                                    <Box as="span" css={styles.linkMeta}>{m.inspectorJoin({ kind: names.get(link.ref.kind) ?? link.ref.kind, end: undefined })}</Box>
                                </chakra.button>
                            </Box>
                        ))}
                        {joins.nets.map(({ net, end }) => (
                            <Box as="li" key={net.key}>
                                <chakra.button type="button" css={styles.link} data-inspector-join={net.key} onClick={() => reveal(net.key)}>
                                    <Box as="span" css={styles.linkText}>{nameOf(net.key, drawn, words)}</Box>
                                    <Box as="span" css={styles.linkMeta}>{m.inspectorJoin({ kind: names.get(net.ref.kind) ?? net.ref.kind, end })}</Box>
                                </chakra.button>
                            </Box>
                        ))}
                    </Box>
                </Box>
            )}
        </Box>
    );
}

// ── A zone ──────────────────────────────────────────────────────────────────

/** A zone: its head and its form, or its own Details. */
function ZoneView(props: ViewProps & { readonly zone: DrawnZone; readonly kind: SchematicValue["zones"][number] }) {
    const { zone, kind, styles, words, value, storageKey } = props;
    const m = words.m;
    const unit = getSomeorUndefined(value.scaleUnit);
    const own = useSide(props, zone.ref, zone.label, kind, false);
    return (
        <Box css={styles.root} data-schematic-inspector="zone">
            <ScheduleInspectorHead styles={styles} kind={{ name: kind.name, icon: kind.icon === "" ? "vector-square" : kind.icon }} title={zone.label}
                when={m.inspectorSize({ width: coordinate(zone.width, words), height: coordinate(zone.height, words), unit })} pending={own.state.chip} />
            <Edits styles={styles} available={own.available} actions={undefined}>
                <SideBody styles={styles} head={m.inspectorSection({ section: "fields", name: kind.name })} section="row" side={kind} own={own.own}
                    state={own.state} onField={own.onField} writes={own.writes} storageKey={`${storageKey}.inspector.${kind.key}`} empty={m.inspectorNoRow()} words={words} />
            </Edits>
        </Box>
    );
}

// ── A link ──────────────────────────────────────────────────────────────────

/** The items of some slots, as a Chooser offers them: each by its id, its label — with its kind's name, among several kinds. */
function itemChoices(drawn: SchematicDrawn, slots: readonly string[], names: ReadonlyMap<string, string>, also: readonly string[]): FieldOption[] {
    const out: FieldOption[] = drawn.items.filter((item) => slots.some((slot) => stringEqual(slot, item.ref.kind))).map((item) => ({
        key: item.key, label: slots.length > 1 ? `${item.label} · ${names.get(item.ref.kind) ?? item.ref.kind}` : item.label,
    }));
    // What the row names now, drawn or not: a Chooser always holds its own value.
    for (const id of also) if (!out.some((option) => stringEqual(option.key, id))) out.push({ key: id, label: refOfId(id)?.key ?? id });
    return out;
}

/** A link: its head, its ends as Choosers, its form or own Details, and Delete. */
function LinkView(props: ViewProps & { readonly link: DrawnLink; readonly kind: SchematicValue["links"][number] }) {
    const { link, kind, styles, words, value, drawn, listed, rows, storageKey } = props;
    const m = words.m;
    const name = nameOf(link.key, drawn, words);
    const own = useSide(props, link.ref, name, kind, false);
    const { commit, remove } = useCommit(props);
    const [refused, refuse] = useRefused();
    const names = useMemo(() => new Map(value.items.map((k) => [k.key, k.name] as const)), [value.items]);
    const options = useMemo(() => ({
        from: itemChoices(listed, kind.ends.from, names, [link.from]),
        to: itemChoices(listed, kind.ends.to, names, [link.to]),
    }), [listed, kind.ends, names, link.from, link.to]);
    const specs = useMemo(() => Fields.specs(EndsFormType, {
        from: Fields.reference({ of: "from", label: m.inspectorField({ field: "from" }) }),
        to: Fields.reference({ of: "to", label: m.inspectorField({ field: "to" }) }),
    }), [m]);
    // Its ends as its record holds them, each item by its id: what they are tinted against; nothing for a new row.
    const stored = rowsOf(rows, link.ref).row;
    const baseline = useMemo(() => {
        if (stored.state !== "held") return NEW_ROW;
        const roles = kind.read(stored.row, link.ref.key);
        return { from: entityId(roles.from), to: entityId(roles.to) };
    }, [stored, kind, link.ref.key]);
    const onEnd = useCallback((path: readonly string[], next: unknown) => {
        const from = refOfId(link.from), to = refOfId(link.to), target = refOfId(next as string);
        const end = stringEqual(path[0]!, "from") ? "from" as const : "to" as const;
        if (from === undefined || to === undefined || target === undefined) return;
        if (!commit(retargetEdits({ ref: link.ref, ends: { from, to } }, end, target), "move", m.inspectorStep({ edit: "edit", name }))) refuse();
    }, [link, commit, m, name, refuse]);
    const actions = !own.writes ? undefined : (
        <Action action="delete" words={words} onClick={() => {
            remove({ items: new Set(), link: { key: link.key, leg: null } }, m.inspectorStep({ edit: "delete", name }));
        }} />
    );
    return (
        <Box css={styles.root} data-schematic-inspector="link">
            <ScheduleInspectorHead styles={styles} kind={{ name: kind.name, icon: kind.icon === "" ? "link" : kind.icon }}
                title={getSomeorUndefined(link.label) ?? link.ref.key} when={name} pending={own.state.chip} />
            <Edits styles={styles} available={own.available} actions={actions}>
                <Form styles={styles} head={m.inspectorSection({ section: "ends", name: kind.name })} section="ends" specs={specs}
                    value={{ from: link.from, to: link.to }} baseline={baseline} options={options}
                    onChange={own.writes ? onEnd : NO_EDIT} readOnly={!own.writes} refused={refused} />
                <SideBody styles={styles} head={m.inspectorSection({ section: "fields", name: kind.name })} section="row" side={kind} own={own.own}
                    state={own.state} onField={own.onField} writes={own.writes} storageKey={`${storageKey}.inspector.${kind.key}`} empty={m.inspectorNoRow()} words={words} />
            </Edits>
        </Box>
    );
}

// ── A net, and its leg ──────────────────────────────────────────────────────

/** A net: its head, its sides as tags, its form or own Details, and Delete. */
function NetView(props: ViewProps & { readonly net: DrawnNet; readonly kind: SchematicValue["nets"][number] }) {
    const { net, kind, styles, words, drawn, listed, rows, storageKey, refuse: say } = props;
    const m = words.m;
    const name = nameOf(net.key, drawn, words);
    const own = useSide(props, net.ref, name, kind, false);
    const { commit, remove } = useCommit(props);
    const [refused, refuse] = useRefused();
    const keysOf = (ids: readonly string[]) => ids.map((id) => refOfId(id)?.key ?? id);
    const slotKeys = useCallback((slot: string) => listed.items.filter((item) => stringEqual(item.ref.kind, slot)).map((item) => item.ref.key), [listed.items]);
    const specs = useMemo(() => Fields.specs(SidesFormType, {
        sources: Fields.tags({ label: m.inspectorField({ field: "sources" }), options: slotKeys(kind.sides.sources) }),
        destinations: Fields.tags({ label: m.inspectorField({ field: "destinations" }), options: slotKeys(kind.sides.destinations) }),
    }), [m, slotKeys, kind.sides]);
    // Its sides as its record holds them: what they are tinted against; nothing for a new row.
    const stored = rowsOf(rows, net.ref).row;
    const baseline = useMemo(() => {
        if (stored.state !== "held") return NEW_ROW;
        const roles = kind.read(stored.row, net.ref.key);
        return { sources: roles.sources.map((r) => r.key), destinations: roles.destinations.map((r) => r.key) };
    }, [stored, kind, net.ref.key]);
    const onSide = useCallback((path: readonly string[], next: unknown) => {
        const side = stringEqual(path[0]!, "sources") ? "sources" as const : "destinations" as const;
        const keys = next as readonly string[];
        if (keys.length === 0) {
            // A net keeps a member on each side: its Delete takes it.
            say(m.inspectorSideEmpty({ side }));
            refuse();
            return;
        }
        const refs = (ids: readonly string[]) => ids.flatMap((id) => { const ref = refOfId(id); return ref === undefined ? [] : [ref]; });
        const slot = side === "sources" ? kind.sides.sources : kind.sides.destinations;
        const written = keys.map((key) => ({ kind: slot, key }));
        const sides = side === "sources" ? { sources: written, destinations: refs(net.destinations) } : { sources: refs(net.sources), destinations: written };
        if (!commit([{ op: "sides", ref: net.ref, sides }], "typed", m.inspectorStep({ edit: "edit", name }))) refuse();
    }, [net, kind.sides, commit, m, name, say, refuse]);
    const actions = !own.writes ? undefined : (
        <Action action="delete" words={words} onClick={() => {
            remove({ items: new Set(), link: { key: net.key, leg: null } }, m.inspectorStep({ edit: "delete", name }));
        }} />
    );
    const count = (n: number) => ({ n, count: words.number(n) });
    return (
        <Box css={styles.root} data-schematic-inspector="net">
            <ScheduleInspectorHead styles={styles} kind={{ name: kind.name, icon: kind.icon === "" ? "diagram-project" : kind.icon }} title={name}
                when={m.inspectorSides({ sources: count(net.sources.length), destinations: count(net.destinations.length) })} pending={own.state.chip} />
            <Edits styles={styles} available={own.available} actions={actions}>
                <Form styles={styles} head={m.inspectorSection({ section: "sides", name: kind.name })} section="sides" specs={specs}
                    value={{ sources: keysOf(net.sources), destinations: keysOf(net.destinations) }} baseline={baseline}
                    onChange={own.writes ? onSide : NO_EDIT} readOnly={!own.writes} refused={refused} />
                <SideBody styles={styles} head={m.inspectorSection({ section: "fields", name: kind.name })} section="row" side={kind} own={own.own}
                    state={own.state} onField={own.onField} writes={own.writes} storageKey={`${storageKey}.inspector.${kind.key}`} empty={m.inspectorNoRow()} words={words} />
            </Edits>
        </Box>
    );
}

/** A net's leg: its net's head, the item on it — a control that selects it — and Remove. */
function LegView(props: ViewProps & { readonly net: DrawnNet; readonly kind: SchematicValue["nets"][number]; readonly leg: NetLeg }) {
    const { net, kind, leg, styles, words, value, drawn, reveal } = props;
    const m = words.m;
    const name = nameOf(net.key, drawn, words);
    const member = nameOf(leg.item, drawn, words);
    const { remove } = useCommit(props);
    const writes = kind.editable && !value.readOnly;
    const available = writes && props.editing.schedule.available(kind.key);
    const actions = !writes ? undefined : (
        <Action action="remove" words={words} onClick={() => {
            if (remove({ items: new Set(), link: { key: net.key, leg } }, m.inspectorStep({ edit: "remove", name: member, from: name }))) reveal(net.key);
        }} />
    );
    return (
        <Box css={styles.root} data-schematic-inspector="leg">
            <ScheduleInspectorHead styles={styles} kind={{ name: kind.name, icon: kind.icon === "" ? "diagram-project" : kind.icon }} title={name}
                when={m.inspectorLeg({ end: leg.end })} />
            <Box css={styles.section} data-inspector-member="">
                <Box css={styles.sectionHead}>{m.inspectorSection({ section: "member", name: kind.name })}</Box>
                <chakra.button type="button" css={styles.link} data-inspector-join={leg.item} onClick={() => reveal(leg.item)}>
                    <Box as="span" css={styles.linkText}>{member}</Box>
                    <Box as="span" css={styles.linkMeta}>{m.inspectorLeg({ end: leg.end })}</Box>
                </chakra.button>
            </Box>
            <Edits styles={styles} available={available} actions={actions}>{null}</Edits>
        </Box>
    );
}

// ── Several ─────────────────────────────────────────────────────────────────

/** Several: how many, how many of each kind, and Delete. */
function SeveralView(props: ViewProps & { readonly entities: readonly (SchematicDrawnEntity & { readonly id: string })[] }) {
    const { entities, styles, words, value } = props;
    const m = words.m;
    const { remove } = useCommit(props);
    const kinds = [...value.items, ...value.zones, ...value.links, ...value.nets];
    const byKind = new Map<string, number>();
    for (const entity of entities) byKind.set(entity.ref.kind, (byKind.get(entity.ref.kind) ?? 0) + 1);
    const items = new Set(entities.filter((e) => e.sort === "item").map((e) => e.id));
    const edge = entities.find((e) => e.sort === "link" || e.sort === "net");
    const selection: DeleteSelection = { items, link: edge === undefined ? null : { key: edge.id, leg: null } };
    // Delete writes what is selected of the kinds that write: none, no Delete.
    const writes = !value.readOnly && entities.some((e) => kinds.find((k) => stringEqual(k.key, e.ref.kind))?.editable === true && e.sort !== "zone");
    const n = entities.length;
    return (
        <Box css={styles.root} data-schematic-inspector="several">
            <Box css={styles.head}>
                <Box css={styles.summary} data-inspector-several="">{m.inspectorSeveral({ n, count: words.number(n) })}</Box>
            </Box>
            <Box css={styles.section}>
                {[...byKind].map(([slot, count]) => (
                    <Box key={slot} css={styles.fact} data-inspector-count={slot}>
                        {m.inspectorKindCount({ n: count, count: words.number(count), name: (kinds.find((k) => stringEqual(k.key, slot))?.name ?? slot).toLocaleLowerCase(words.locale) })}
                    </Box>
                ))}
            </Box>
            {writes && (
                <Box css={styles.actions} data-inspector-actions="">
                    <Action action="delete" words={words} onClick={() => {
                        remove(selection, m.inspectorStep({ edit: "delete", name: m.inspectorSeveral({ n, count: words.number(n) }) }));
                    }} />
                </Box>
            )}
        </Box>
    );
}

// ── Nothing selected: the drawing ───────────────────────────────────────────

/** Nothing selected: the drawing's counts, and each record's last save with who made it. */
function DrawingView({ styles, words, counts, records }: ViewProps) {
    const m = words.m;
    // Each record's newest commit, read where its commits are tracked: one whose read fails says nothing.
    const read = useCallback(() => records.flatMap((record) => {
        try {
            const commits = record.history();
            const newest = commits.type === "some" ? commits.value[0] : undefined;
            return newest === undefined ? [] : [{ slot: record.slot, name: record.name, at: newest.at, by: newest.actor }];
        } catch {
            return [];
        }
    }), [records]);
    const { result } = useTrackedEvaluation(read);
    const saved = result.ok ? result.value : [];
    const today = words.date(new Date());
    const stats: { key: string; value: number; label: string }[] = [
        ...counts.kinds.map((kind) => ({ key: kind.slot, value: kind.drawn, label: kind.name })),
        ...(counts.zones === undefined ? [] : [{ key: "zones", value: counts.zones, label: m.inspectorCount({ what: "zones", n: counts.zones }) }]),
        ...(counts.links === undefined ? [] : [{ key: "links", value: counts.links, label: m.inspectorCount({ what: "links", n: counts.links }) }]),
        ...(counts.nets === undefined ? [] : [{ key: "nets", value: counts.nets, label: m.inspectorCount({ what: "nets", n: counts.nets }) }]),
    ];
    return (
        <Box css={styles.root} data-schematic-inspector="drawing">
            <Box css={styles.head}>
                <Box css={styles.eyebrow} data-inspector-what="">{m.inspectorDrawing()}</Box>
            </Box>
            <Box css={styles.stats} data-inspector-counts="">
                {stats.map((stat) => (
                    <Box key={stat.key} css={styles.stat} data-count={stat.key}>
                        <Box as="span" css={styles.statValue}>{words.number(stat.value)}</Box>
                        <Box as="span" css={styles.statLabel}>{stat.label}</Box>
                    </Box>
                ))}
            </Box>
            {saved.length > 0 && (
                <Box css={styles.section}>
                    {saved.map((save) => (
                        <Box key={save.slot} css={styles.fact} data-inspector-saved={save.slot}>
                            {m.inspectorSaved({ name: save.name, when: stringEqual(words.date(save.at), today) ? words.time(save.at) : words.dateTime(save.at), by: save.by })}
                        </Box>
                    ))}
                </Box>
            )}
        </Box>
    );
}

// ============================================================================
// Issues (SC16)
// ============================================================================

/** The Issues tab: every issue of the drawing, each a control that selects what it names. */
const SchematicInspectorIssues = memo(function SchematicInspectorIssues({ issues, reveal, words }: SchematicInspectorProps) {
    const styles = useSlotRecipe({ key: "schematicInspector" })() as Styles;
    const m = words.m;
    if (issues.length === 0) {
        return (
            <Box css={styles.empty} data-inspector-no-issues="">
                <Box as="span" css={styles.emptyTitle}>{m.inspectorNoIssues({ part: "title" })}</Box>
                <Box as="span" css={styles.emptyHint}>{m.inspectorNoIssues({ part: "hint" })}</Box>
            </Box>
        );
    }
    return (
        <Box as="ul" css={styles.issueList} data-inspector-issue-list="">
            {issues.map((issue, i) => (
                <Box as="li" key={i}>
                    <chakra.button type="button" css={styles.issueItem} data-inspector-issue={issue.word.issue} onClick={() => reveal(issue.at)}>
                        <Box as="span" css={styles.issueWhere}>{m.issueWhere(issue.where)}</Box>
                        <Box as="span" css={styles.issueMessage} data-kind={issue.blocking ? "invalid" : "warning"}>{m.issueText(issue.word)}</Box>
                    </chakra.button>
                </Box>
            ))}
        </Box>
    );
});

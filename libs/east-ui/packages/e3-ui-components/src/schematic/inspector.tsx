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
 * form (`fields`: the `Fields` specs of the fields no role writes, and of the
 * fields an item's or a zone's box is, which Details leaves out of it, a hint
 * holding them to their bounds (#1585)) — under the shared inspector head: its
 * kind's icon and name, its own name, where it stands, its status, and a
 * Pending or New chip while its drafts hold it otherwise than its record. Its
 * own name is the one the Schematic gives it everywhere (`inspect.ts`'
 * `entityNames`), which the collapsed rail says too: a link's ends, its caption
 * under them; a net's label, else its ends — never a key the Schematic minted
 * for a new link or net:
 *
 * - **an item**: its kind's form — or its kind's own `inspector` in its place
 *   — its details record's form, or its details' own; its position, `x` and
 *   `y` — held to the bounds a hint gives its centre, one it breaks said once,
 *   in its field's help line (#1585) — with Unplace where its kind has a
 *   backlog; Delete; and what it is joined to, each link and net a control
 *   that selects it;
 * - **a zone**: its form, or its own Details;
 * - **a link**: its ends, each a Chooser over the items of the slots its role
 *   names; its form; Delete;
 * - **a net**: its sides, each tags over the keys of its slot's items; its
 *   form; Delete; and **a net's leg** — the stub a tap selected — its item, a
 *   control that selects it, and Remove, which takes it off its side;
 * - **several**: how many of each kind, and Delete;
 * - **nothing**: the drawing — its counts, and each record's last save with
 *   who made it. A kind read by area is counted by its source, never by its
 *   window (`counts.ts`): a placeholder stands in its count's place while it
 *   is read, and a line names each count no read can say, and why.
 *
 * A Chooser, a side's tags and what an item is joined to offer only what the
 * rail's narrowing shows (#1392, §10.2).
 *
 * Below 480px of main (#1394, D15) Details gains the actions the canvas
 * doesn't take there: an item's Connect to… — a Chooser over the items a link
 * of a kind may run to from it, and the kind while several may, a choice
 * recording the link as a Connect drag does — and, for the Backlog's card
 * picked, an item with no position: its Place puts it at the canvas's centre,
 * as the card's ⏎ does, and selects it, its fields then Details' to edit. Its
 * Move is the position's `x` and `y`, its Delete the item's. A link's ends, a
 * net's sides and Connect to… are held to the host's veto as the gestures are
 * (`edits.ts`' `connectVeto`): a link's new pair, each pair a net's sides newly
 * join; refused, the field and the footer say why and nothing is recorded.
 *
 * A new item whose kind makes no key of its own (#1549) — keyed by a type the
 * viewer types, its record building none — shows its key field at the head of
 * Details while it is new: the form's own editor for the key type, its help
 * line under it, washed and taking the keyboard while the item waits under a
 * placeholder, which holds Save. A key of several parts — a struct's fields, a
 * variant's case and its value — is typed a part at a time and taken whole by
 * Set key (#1581, `shared/schedule/key-draft.tsx`). A key typed moves the item,
 * and its details row, under it — refused, its field and the footer saying why,
 * where a row of its kind stands under it already; a key whose row a draft deletes is free
 * (#1581). Until it is typed, no link's end or net's side names the item:
 * Connect to…, a link's ends and a net's sides refuse it, saying so.
 *
 * Every edit is one step of the editing's history (`editing.ts`): a field
 * through its record's `set`, the row a kind's own Details hands back through
 * `update` whole, a position, ends or sides through the kind's `write`, and
 * Delete as the canvas's Del — refused, the footer says why. A field's edit
 * refused leaves the field showing what its row holds: one the Schematic says
 * why of — a key another row holds, the host's veto, a side emptied — says so
 * under the field too, the keyboard where the edit left it (`FieldForm`'s
 * refusal); one refused with nothing to say — its kind's own `set` or `write`
 * refusing it — draws its form again. A field its
 * drafts changed is tinted against its record. Read only — a kind bound read
 * only, or the Schematic `readOnly` — Details shows every field and edits
 * none, an own Details giving way to the form; while a record takes no edit
 * — a Save in flight, or what the canvas draws standing in while a new
 * narrowing is read (#1398, CL8) — its controls are off. A number a row holds
 * outside its field's bounds is said in the tone the row's Save stands in
 * (#1585): a warning as stored, an error once its record's session refuses the
 * row's change, holding Save.
 *
 * Details keeps the keyboard (#1398): a control that goes with the view it was
 * pressed in — Delete and Unplace, which leave nothing selected, a leg's
 * Remove, Place, a join's link, a refused edit's form drawn again — leaves the
 * focus on the heading of the view drawn in its place (`../shared/focus-home.ts`),
 * never on the page's body. The heading, not the canvas: it names what Details
 * shows now, a screen reader saying where the keyboard is, and the next Tab
 * goes on through the controls under it; the canvas would move the keyboard
 * to a part the viewer did not press in, where an arrow steps the selection.
 *
 * While a row of what is selected is read — its own, or its details' — its
 * section shows its form's fields, each its real label over a placeholder in
 * its control's place, shaped as its editor's value (#1398): never a value it
 * has not read, and the form its own height when the row lands.
 *
 * Issues (SC16) lists the drawing's issues (`issues.ts`), each a control that
 * selects what it names and flies to it. A kind read by area is checked in the
 * rows read around the view, with every unsaved change, never by a read of its
 * other rows: while one is, a line over the list names it and says its rows out
 * of view are checked only as the view reaches them, as the drawing's counts
 * say what they don't count (ruled 27 Oct 2026, "Checked in view, said so").
 * An unsaved change the drawing leaves out — a draft waiting in its session,
 * the rail's filters leaving out the row it drafts — is checked as its draft
 * has it, and its issue says on a line of its own which choices hide it, each
 * as the rail words it — `hidden by the filters` until e3 has said — asked of
 * e3 through its kind's hidden pick, which the frame reads for every kind read
 * through its source (the shared hidden pick): Go to issue is the frame's
 * hidden pick, as Find's is — just those choices cleared, every choice of its
 * kind's source while e3 has not said, then flown to where its draft stands
 * and selected once the narrowing they leave draws it.
 *
 * Styles are the `schematicInspector` recipe's, the form's `fieldForm`'s and
 * the buttons the shared `button`'s; the pane — its tab row, its collapse
 * control and its rail — is the Dock's.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Box, chakra, useRecipe, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import {
    ArrayType, FloatType, StringType, StructType, encodeBeast2For, equalFor, fromEastTypeValue, none, some,
    type EastType, type StructType as EastStructType, type option,
} from "@elaraai/east";
import { Fields, type FieldSpecValue } from "@elaraai/east-ui/internal";
import {
    EastChakraComponent, FieldForm, getSomeorUndefined, useTrackedEvaluation, type BuilderFrameDock, type FieldOption, type Origin,
} from "@elaraai/east-ui-components";
import { PlaceholderShape, type PlaceholderKind } from "@elaraai/east-ui-components/internal";
import { FOCUS_HOME_PROPS, useFocusHome } from "../shared/focus-home.js";
import { KeySetButton, useKeyDraft } from "../shared/schedule/key-draft.js";
import { keyFieldSpecs, kindKeys } from "../shared/schedule/kind-keys.js";
import { askHiding, hiddenLine, hiddenOf, type RowHidden, type RowHiding, type SourceHiding } from "../shared/schedule/hidden.js";
import type { HiddenPicks } from "../shared/schedule/hidden-pick.js";
import { ScheduleInspectorHead } from "../shared/schedule/inspector-head.js";
import { draftedRow, rowCodec } from "../shared/schedule/records.js";
import { kindPlural } from "../shared/schedule/words.js";
import { authorOf } from "../shared/records/author.js";
import { entityId, refOfId, type DrawnItem, type DrawnLink, type DrawnNet, type DrawnZone, type SchematicDrawn, type SchematicRef } from "./canvas/drawn.js";
import type { SchematicCounts, SchematicDrawingCount, SchematicSavedRecord, SchematicUncounted } from "./counts.js";
import type { SchematicValue } from "./data.js";
import {
    NO_SESSION, connectStep, deleteEdits, editKinds, joinedPairs, linkRefusal, placeholderRefusal, retargetEdits, vetoOfPairs,
    type ConnectVetoOf, type DeleteSelection, type EditRefusal, type NetLeg, type SchematicEdit, type SchematicFieldWrite, type SchematicKeyRefusal,
} from "./edits.js";
import { detailsKey, type SchematicEditing } from "./editing.js";
import { joinsOf, nameOfEntity, type SchematicDrawnEntity, type SchematicInspected, type SchematicUnplaced } from "./inspect.js";
import { captionText } from "./canvas/paint.js";
import type { SchematicInspectedRows, SchematicRowRead } from "./inspector-rows.js";
import type { SchematicIssue } from "./issues.js";
import { coordinate, type SchematicWords } from "./messages.js";

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
/** Connect to…, below 480px of main (#1394): the link kind it records, by its slot, and the item it runs to, by its id. */
const ConnectFormType = StructType({ kind: StringType, to: StringType });

/**
 * The editing as Details records its edits: as every route's are (`index.tsx`), each row whose key its fields build
 * following them (#1549) — an edit refused handing back why, where the Schematic says.
 */
export interface SchematicInspectorEditing extends Omit<SchematicEditing, "record"> {
    /**
     * Records one edit as one step of the history.
     *
     * @param edits - The rows it changes, and how
     * @param origin - The gesture
     * @param label - Its label in the history
     * @returns `true` once recorded; refused, why — its key refused, as the footer says it — or `false` where nothing says
     */
    record(edits: readonly SchematicEdit[], origin: Origin, label: string): boolean | string;
}

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
    /**
     * Each entity's name, by its id, as the Schematic says it everywhere (`inspect.ts`' `entityNames`): what the head, the
     * collapsed rail and the lists name it — a link by its ends, a net by its label or its ends, never a key it minted.
     */
    readonly names: ReadonlyMap<string, string>;
    /** The drawing as its lists show it, what the rail's narrowing leaves out left out (#1392): what a Chooser offers, and what an item is joined to. */
    readonly listed: SchematicDrawn;
    /** The editing: each record's session and drafts, and how an edit is recorded. */
    readonly editing: SchematicInspectorEditing;
    /** What the drawing's Details counts, with nothing selected (`counts.ts`). */
    readonly counts: SchematicCounts;
    /** The kinds' records whose commits say when each was last saved, and by whom. */
    readonly records: readonly SchematicSavedRecord[];
    /** The drawing's issues, and its sessions'. */
    readonly issues: readonly SchematicIssue[];
    /**
     * The kinds read by area, each by its name as running text writes it in the plural (`racks`): Issues checks their rows
     * read around the view and says the others are checked only as the view reaches them; none, it says nothing of it.
     */
    readonly unchecked: readonly string[];
    /**
     * Each unsaved change the drawing leaves out — a drafted row waiting in its session, the narrowing leaving out the row
     * it drafts (`drafted.ts`' `waitingDrafts`) — its reference by its id: what Issues checks beside the drawing, and an
     * issue of which says which of the rail's choices hide it.
     */
    readonly waiting: ReadonlyMap<string, SchematicRef>;
    /**
     * Each kind's hidden pick, by its slot — every kind read through its source of the rail, read by the frame
     * (`hidden-pick.tsx`' `HideSources`): what an issue of an unsaved change the drawing leaves out asks e3 which of the
     * rail's choices hide the row it drafts.
     */
    readonly picks: HiddenPicks;
    /**
     * Goes to an unsaved change the drawing leaves out, by its id — the frame's hidden pick, as Find's is: the choices
     * hiding it cleared, flown to where its draft stands, and selected once the narrowing they leave draws it.
     *
     * @param id - The change's entity, by its id
     * @param hidden - What hides the row it drafts, as far as e3 has said; `undefined` where nothing does
     */
    readonly goToWaiting: (id: string, hidden: readonly SourceHiding[] | undefined) => void;
    /** The zone holding a point, by its name, as the Index files an item. */
    readonly zoneAt: (x: number, y: number) => string | undefined;
    /** Selects an entity, by its id — a net's leg with it — flying to it; `undefined` selects nothing. */
    readonly reveal: (id: string | undefined, leg?: NetLeg) => void;
    /** Says why an edit was refused, in the footer; `undefined` clears it. */
    readonly refuse: (words: string | undefined) => void;
    /** Says why an edit records nothing, its new row's key refused (#1549), in the footer, and hands back the words. */
    readonly keyRefused: (refusal: SchematicKeyRefusal) => string;
    /** Selects an entity alone, by its id, once the drawing draws it, the camera where it is: an item under the key typed for it (#1549). */
    readonly select: (id: string) => void;
    /** The open tab. */
    readonly tab: string;
    /** Opens a tab. */
    readonly onTab: (tab: string) => void;
    /** Where an own Details keeps its own state. */
    readonly storageKey: string;
    /** The Schematic's words. */
    readonly words: SchematicWords;
    /** Whether main is below 480px (#1394, D15): Details gains the actions the canvas doesn't take there — an item's Connect to…, an unplaced item's Place. */
    readonly narrow: boolean;
    /** The host's veto, as every route that connects two items asks it (`edits.ts`' `connectVeto`): what Connect to…, a link's ends and a net's sides are held to. */
    readonly veto: ConnectVetoOf;
    /** The link kind Connect draws, by its slot — the toolbar's Connect menu's choice: what Connect to… records, while it may run from the item. */
    readonly linkKind: string | undefined;
    /** Picks the link kind Connect draws: Connect to…'s choice of it, which the toolbar's Connect menu follows. */
    readonly onLinkKind: (slot: string) => void;
    /** What a new link takes its other fields from, by its kind's slot (§4.3): the values of the template of its kind the library has selected; `none`, their types' defaults. */
    readonly connectValues: (slot: string) => option<Uint8Array>;
    /** Places an item with no position at the canvas's centre, by its id, as its Backlog card's ⏎ does, and selects it (#1394). */
    readonly place: (id: string) => void;
}

/** Each view's props: the inspector's, and the recipe's styles. */
interface ViewProps extends SchematicInspectorProps {
    readonly styles: Styles;
}

/** What is selected, as the rail says it under its label: what the head titles it, by the one name the Schematic gives it. */
function whatOf(props: SchematicInspectorProps): string | undefined {
    const { inspected, names, words } = props;
    switch (inspected.view) {
        case "drawing": return undefined;
        case "several": return words.m.inspectorSeveral({ n: inspected.entities.length, count: words.number(inspected.entities.length) });
        case "entity":
        case "leg": return nameOfEntity(names, inspected.id);
        case "unplaced": return inspected.label;
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

/** One gesture's button: Delete, Unplace, Remove, and an item with no position's Place (#1394). */
function Action({ action, onClick, words }: { action: "delete" | "unplace" | "remove" | "place"; onClick: () => void; words: SchematicWords }) {
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

/** What a field's value is drawn as while its row is read (#1398): the shape of its editor's value. */
function placeholderOf(spec: FieldSpecValue): PlaceholderKind {
    switch (spec.editor.type) {
        case "number": return "number";
        case "checkbox": return "boolean";
        case "datetime": return "date";
        case "select": return "enum";
        case "tags": return "chip";
        default: return "text";
    }
}

/** A field's control while its row is read: a placeholder in its place, its length keyed to the field, so it never moves. */
const pendingControl = (spec: FieldSpecValue): ReactNode => <PlaceholderShape kind={placeholderOf(spec)} index={spec.path.join(".").length} />;

/**
 * A form under its section's head — a section with no head of its own, a new item's key field, has none: an edit
 * refused saying why (`onChange` handing back the words) puts its field back, saying so under it; one refused with
 * nothing to say remounts it (`refused`), so it shows what the row holds again. While its row is read (`pending`),
 * each field is its label over a placeholder (#1398). A field an issue names (`issues`) takes the warn wash, and the
 * field named (`focus`) the keyboard (#1549); a number outside its bounds is said in the tone its row's Save stands in
 * (`breaches`, #1585).
 */
function Form({ styles, head, section, specs, value, baseline, options, onChange, readOnly, refused, pending = false, issues, focus, breaches }: {
    styles: Styles; head: string | undefined; section: string; specs: readonly FieldSpecValue[]; value: unknown; baseline: unknown;
    options?: Readonly<Record<string, readonly FieldOption[]>> | undefined;
    onChange: (path: readonly string[], value: unknown) => string | void; readOnly: boolean; refused?: number; pending?: boolean;
    issues?: ReadonlySet<string> | undefined; focus?: string | undefined; breaches?: "warn" | "error" | undefined;
}) {
    if (specs.length === 0) return null;
    return (
        <Box css={styles.fields} data-inspector-fields={section} data-pending={pending ? "" : undefined}>
            {head !== undefined && <Box css={styles.sectionHead}>{head}</Box>}
            <FieldForm key={refused ?? 0} specs={specs} value={value} baseline={baseline} options={options} onChange={onChange} readOnly={readOnly}
                renderControl={pending ? pendingControl : undefined} issues={issues} focus={focus} breaches={breaches} />
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

/** A remount counter for a form whose edit was refused with nothing to say: its input shows what the row holds again. */
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
function useRowState(editing: SchematicInspectorEditing, record: string, side: RecordSide | undefined, key: string, read: SchematicRowRead | undefined): RowState {
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
    switch (refusal.why) {
        case "end": return words.m.endRefused({ kind: refusal.kind, end: refusal.end, item: refusal.item });
        case "named": return words.m.deleteRefused({ item: refusal.item, kind: refusal.kind, key: refusal.key });
        case "placeholder": return words.m.placeholderRefused({ kind: refusal.kind.toLocaleLowerCase(words.locale) });
    }
}

/**
 * The edits a view records: each one step, a recorded one clearing the
 * footer's refusal — refused, why, where the Schematic says (`false` where
 * nothing does) — and Delete, as the canvas's Del, refused in its words.
 */
function useCommit(props: SchematicInspectorProps) {
    const { editing, refuse, value, drawn, words } = props;
    const commit = useCallback((edits: readonly SchematicEdit[], origin: Origin, label: string): boolean | string => {
        if (edits.length === 0) return false;
        const recorded = editing.record(edits, origin, label);
        if (recorded === true) refuse(undefined);
        return recorded;
    }, [editing, refuse]);
    const remove = useCallback((selection: DeleteSelection, label: string): boolean => {
        const result = deleteEdits(editKinds(value), drawn, selection);
        if ("refusal" in result) {
            refuse(refusalWords(result.refusal, words));
            return false;
        }
        return commit(result.edits, "remove", label) === true;
    }, [value, drawn, words, refuse, commit]);
    return { commit, remove };
}

/** A kind of a sort, by its slot. */
function kindOf<K extends { readonly key: string }>(kinds: readonly K[], slot: string): K | undefined {
    return kinds.find((kind) => stringEqual(kind.key, slot));
}

/**
 * An item's or a zone's side as Details draws its form: its kind's, but the fields its box is, which its kind's form
 * holds so a hint holds them to their bounds (#1585) — Details draws an item's centre as its position, and its box nowhere.
 */
function formSide<K extends SchematicValue["items"][number] | SchematicValue["zones"][number]>(kind: K): K {
    const box = [kind.box.x, kind.box.y, getSomeorUndefined(kind.box.width), getSomeorUndefined(kind.box.height)];
    return { ...kind, fields: kind.fields.filter((spec) => !box.some((field) => field !== undefined && stringEqual(field, spec.path[0]!))) };
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

// ============================================================================
// Details
// ============================================================================

/**
 * The Details tab: what is selected — an item, a zone, a link, a net, a net's leg, several, an item with no position — or
 * the drawing; the keyboard kept as a control goes with the view it was in, on the heading of the view drawn in its place.
 */
const SchematicInspectorDetails = memo(function SchematicInspectorDetails(props: SchematicInspectorProps) {
    const styles = useSlotRecipe({ key: "schematicInspector" })() as Styles;
    const home = useFocusHome();
    return (
        <Box ref={home.ref} css={styles.home} onFocus={home.onFocus} onBlur={home.onBlur} data-inspector-home="">
            {detailsView({ ...props, styles })}
        </Box>
    );
});

/** What Details shows, a view a selection: what was typed for one never lands on the next. */
function detailsView(view: ViewProps): ReactNode {
    const { inspected, value, drawn } = view;
    switch (inspected.view) {
        case "drawing": return <DrawingView key="drawing" {...view} />;
        case "several": return <SeveralView key="several" {...view} entities={inspected.entities} />;
        case "unplaced": {
            const kind = kindOf(value.items, inspected.ref.kind);
            return kind === undefined ? null : <UnplacedView key={`unplaced:${inspected.id}`} {...view} item={inspected} kind={kind} />;
        }
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
}

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
    const available = writes && editing.available(record);
    const its = rowsOf(rows, ref);
    const state = useRowState(editing, record, side, ref.key, details ? its.details : its.row);
    const { commit } = useCommit(props);
    // A field's edit refused shows what the row holds again: one refused for the key the row's fields build — another
    // row's (#1549) — saying why under the field; one its record's `set` refuses, the form drawn again.
    const [refused, bump] = useRefused();
    const onField = useCallback((path: readonly string[], next: unknown): string | undefined => {
        if (side === undefined) return undefined;
        const write = fieldWrite(side.fields, side.rowType, path, next);
        if (write === undefined) return undefined;
        const recorded = commit([{ op: "set", ref, sets: [write], ...(details ? { details: true as const } : {}) }], "typed", m.inspectorStep({ edit: "edit", name }));
        if (recorded === false) bump();
        return recorded === true || recorded === false ? undefined : recorded;
    }, [side, ref, details, commit, m, name, bump]);
    const update = useCallback((edited: Uint8Array): null => {
        if (writes) commit([{ op: "row", ref, row: edited, ...(details ? { details: true as const } : {}) }], "typed", m.inspectorStep({ edit: "edit", name }));
        return null;
    }, [writes, ref, details, commit, m, name]);
    // Read only, the form shows every field: an own Details is for a record that takes its edits.
    const own = useOwnDetails(writes && side !== undefined ? getSomeorUndefined(side.inspector) : undefined, state.bytes, update, name);
    // A bound its row breaks (#1585), said in the tone its Save stands in: as stored it warns; its change refused by its
    // record's session, holding Save, it is an error.
    const readiness = editing.schedule.sessions.find((part) => stringEqual(part.kind, record))?.session.readiness;
    const breaches: "warn" | "error" = readiness !== undefined && readiness.type !== "ready" && readiness.value.some((issue) => stringEqual(issue.entry, ref.key))
        ? "error" : "warn";
    return { side, writes, available, state, onField, own, refused, breaches };
}

/** A record's side drawn: its form, or its own Details, under its head; while its row is read, its fields' placeholders; no row, said so. */
function SideBody({ styles, head, section, side, own, state, onField, writes, storageKey, empty, refused, breaches }: {
    styles: Styles; head: string; section: string; side: RecordSide; own: unknown; state: RowState;
    onField: (path: readonly string[], value: unknown) => string | void; writes: boolean; storageKey: string; empty: string; refused: number;
    breaches: "warn" | "error";
}) {
    // Read, its form's fields stand at their places, each a placeholder until the row lands (#1398): its head is real.
    if (state.reading) {
        return <Form styles={styles} head={head} section={section} specs={side.fields} value={undefined} baseline={undefined} onChange={NO_EDIT} readOnly={!writes} pending />;
    }
    if (state.row === undefined) return <Fact styles={styles} fact={`${section}-none`}>{empty}</Fact>;
    if (own !== undefined) return <Custom styles={styles} head={head} section={section} ui={own} storageKey={storageKey} />;
    return <Form styles={styles} head={head} section={section} specs={side.fields} value={state.row} baseline={state.baseline}
        onChange={writes ? onField : NO_EDIT} readOnly={!writes} refused={refused} breaches={breaches} />;
}

// ── An item ─────────────────────────────────────────────────────────────────

/** An item: its head, its form or own Details, its details', its position and Unplace, Delete, and what it is joined to. */
function ItemView(props: ViewProps & { readonly item: DrawnItem; readonly kind: SchematicValue["items"][number] }) {
    const { item, kind, styles, words, value, names: entityNames, listed, rows, zoneAt, reveal, storageKey, editing, refuse: say, select } = props;
    const m = words.m;
    const unit = getSomeorUndefined(value.scaleUnit);
    // The item's own row, and its details row: each its record's side — its own form but its box (#1585).
    const form = useMemo(() => formSide(kind), [kind]);
    const self = useSide(props, item.ref, item.label, form, false);
    const details = getSomeorUndefined(kind.details);
    const theirs = useSide(props, item.ref, item.label, details, true);
    const { commit, remove } = useCommit(props);
    // A new item whose key the viewer types (#1549): its key field, while it is new — washed, and taking the keyboard,
    // while it waits under a placeholder.
    const keys = kindKeys(kind.keyType);
    const waiting = !keys.isKey(item.ref.key);
    const keyed = self.state.chip === "new" && self.writes && editing.keysTyped(kind.key);
    const keySpecs = useMemo(() => (keyed
        ? keyFieldSpecs(keys, m.inspectorField({ field: "key" }), keys.specs.length > 1 ? m.inspectorKeyPartsHelp() : m.inspectorKeyHelp(), true) : []),
    [keyed, keys, m]);
    const keyIssues = useMemo(() => (waiting ? new Set(keySpecs.map((spec) => spec.path.join("."))) : undefined), [waiting, keySpecs]);
    const [keyRefused, bumpKey] = useRefused();
    // A key typed whole: refused where a row of its kind stands under it — one whose row a draft deletes is free (#1581) —
    // saying why, under the field of a key of one part as in the footer.
    const takeKey = useCallback((to: string): string | undefined => {
        const from = item.ref.key;
        if (stringEqual(to, from)) return undefined;
        if (editing.stands(kind.key, to)) {
            const said = m.inspectorKeyRefused({ name: kind.name.toLocaleLowerCase(words.locale), key: to });
            say(said);
            return said;
        }
        // The item under its key, its details row with it where they are edited, and the selection with it.
        const moved: SchematicEdit[] = [
            { op: "move", ref: item.ref, to },
            ...(editing.edited(detailsKey(kind.key)) ? [{ op: "move", ref: item.ref, to, details: true } as const] : []),
        ];
        const recorded = commit(moved, "typed", m.inspectorStep({ edit: "key", name: item.label }));
        if (recorded === true) select(entityId({ kind: kind.key, key: to }));
        else if (recorded === false) bumpKey();
        return recorded === true || recorded === false ? undefined : recorded;
    }, [item.ref, item.label, kind, editing, commit, say, select, m, words.locale, bumpKey]);
    const keyDraft = useKeyDraft(keys, item.ref.key, takeKey);
    // Its centre as its record holds it — what the position is tinted against; nothing for a new row.
    const stored = rowsOf(rows, item.ref).row;
    const heldAt = useMemo(() => {
        if (stored.state !== "held") return NEW_ROW;
        const at = getSomeorUndefined(kind.read(stored.row, item.ref.key).position);
        return at === undefined ? NEW_ROW : { x: at.x, y: at.y };
    }, [stored, kind, item.ref.key]);
    // Its centre held to the bounds a hint gives its fields in its kind's form (#1585): a coordinate they don't hold is
    // said under its field, as the form says one.
    const positionSpecs = useMemo(() => {
        const bounds = (field: string) => {
            const spec = kind.fields.find((s) => s.path.length === 1 && stringEqual(s.path[0]!, field));
            if (spec?.editor.type !== "number") return {};
            const min = getSomeorUndefined(spec.editor.value.min), max = getSomeorUndefined(spec.editor.value.max);
            return { ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) };
        };
        return Fields.specs(PositionType, {
            x: Fields.number<number>({ label: m.inspectorField({ field: "x" }), ...(unit === undefined ? {} : { unit }), ...bounds(kind.box.x) }),
            y: Fields.number<number>({ label: m.inspectorField({ field: "y" }), ...(unit === undefined ? {} : { unit }), ...bounds(kind.box.y) }),
        });
    }, [m, unit, kind]);
    // A position refused shows where the item stands again: one refused for the key its centre builds — another item's
    // (#1581) — saying why under the field; one its kind's `write` refuses, the form drawn again.
    const [positionRefused, bumpPosition] = useRefused();
    const onPosition = useCallback((path: readonly string[], next: unknown): string | undefined => {
        const n = next as number;
        const at = stringEqual(path[0]!, "x") ? { x: n, y: item.y } : { x: item.x, y: n };
        const recorded = commit([{ op: "place", ref: item.ref, at: some(at) }], "move", m.inspectorStep({ edit: "edit", name: item.label }));
        if (recorded === false) bumpPosition();
        return recorded === true || recorded === false ? undefined : recorded;
    }, [item, commit, m, bumpPosition]);
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
    // A row under a placeholder is read as keyed by its key type's default (#1549).
    const status = useMemo(() => getSomeorUndefined(item.status)
        ?? (details === undefined || detailsBytes === undefined ? undefined : getSomeorUndefined(details.read(detailsBytes, keys.readKey(item.ref.key)).status)),
    [item.status, item.ref.key, details, detailsBytes, keys]);
    return (
        <Box css={styles.root} data-schematic-inspector="item">
            <ScheduleInspectorHead styles={styles} kind={{ name: kind.name, icon }} title={item.label}
                when={m.inspectorAt({ zone: zoneAt(item.x, item.y), x: coordinate(item.x, words), y: coordinate(item.y, words), unit })}
                status={status} pending={self.state.chip} writes={self.writes} home />
            <Edits styles={styles} available={self.available} actions={actions}>
                {/* A placeholder's key holds no value: its field is Not set, with Set, until it is typed. */}
                <Form styles={styles} head={undefined} section="key" specs={keySpecs} value={{ key: keyDraft.value }} baseline={NEW_ROW}
                    onChange={keyDraft.onChange} readOnly={false} refused={keyRefused} issues={keyIssues} focus={waiting ? keySpecs[0]?.path.join(".") : undefined} />
                {keyed && keyDraft.parts && (
                    <Box css={styles.actions} data-inspector-actions="key"><KeySetButton draft={keyDraft} label={m.inspectorKeySet()} /></Box>
                )}
                <SideBody styles={styles} head={m.inspectorSection({ section: "fields", name: kind.name })} section="row" side={form} own={self.own}
                    state={self.state} onField={self.onField} writes={self.writes} storageKey={`${storageKey}.inspector.${kind.key}`} empty={m.inspectorNoRow()}
                    refused={self.refused} breaches={self.breaches} />
                <Form styles={styles} head={m.inspectorSection({ section: "position", name: kind.name })} section="position" specs={positionSpecs}
                    value={{ x: item.x, y: item.y }} baseline={heldAt} onChange={self.writes ? onPosition : NO_EDIT} readOnly={!self.writes} refused={positionRefused}
                    breaches={self.breaches} />
            </Edits>
            {/* Below 480px of main, what a Connect drag from it records (#1394, D15). */}
            {props.narrow && <ConnectTo {...props} item={item} />}
            {details !== undefined && (
                <Edits styles={styles} available={theirs.available} actions={undefined}>
                    <SideBody styles={styles} head={m.inspectorSection({ section: "details", name: kind.name })} section="details" side={details}
                        own={theirs.own} state={theirs.state} onField={theirs.onField} writes={theirs.writes}
                        storageKey={`${storageKey}.inspector.${kind.key}.details`} empty={m.inspectorNoDetails({ name: kind.name })} refused={theirs.refused}
                        breaches={theirs.breaches} />
                </Edits>
            )}
            {(joins.links.length > 0 || joins.nets.length > 0) && (
                <Box css={styles.section} data-inspector-joins="">
                    <Box css={styles.sectionHead}>{m.inspectorSection({ section: "joins", name: kind.name })}</Box>
                    <Box as="ul" css={styles.links}>
                        {joins.links.map((link) => (
                            <Box as="li" key={link.key}>
                                <chakra.button type="button" css={styles.link} data-inspector-join={link.key} onClick={() => reveal(link.key)}>
                                    <Box as="span" css={styles.linkText}>{nameOfEntity(entityNames, link.key)}</Box>
                                    <Box as="span" css={styles.linkMeta}>{m.inspectorJoin({ kind: names.get(link.ref.kind) ?? link.ref.kind, end: undefined })}</Box>
                                </chakra.button>
                            </Box>
                        ))}
                        {joins.nets.map(({ net, end }) => (
                            <Box as="li" key={net.key}>
                                <chakra.button type="button" css={styles.link} data-inspector-join={net.key} onClick={() => reveal(net.key)}>
                                    <Box as="span" css={styles.linkText}>{nameOfEntity(entityNames, net.key)}</Box>
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

/**
 * An item's Connect to…, below 480px of main (#1394, D15): a Chooser over the items a link of its kind may run to from
 * the item — what the rail's narrowing shows — and, while several link kinds may run from it, the kind, the toolbar's
 * Connect menu's choice. A choice records the link, one step, as a Connect drag from the item onto the one chosen does —
 * keyed as its kind makes one (#1549), its other fields the template of its kind the library has selected (§4.3) — and
 * the Chooser is clear again for the next; refused — its kind's end, an item waiting for its key to be typed, the key
 * its kind makes, or the host's veto — the footer says why, and nothing is recorded.
 */
function ConnectTo(props: ViewProps & { readonly item: DrawnItem }) {
    const { item, styles, words, value, listed, editing, veto, linkKind, onLinkKind, connectValues, refuse: say, keyRefused } = props;
    const m = words.m;
    const { commit } = useCommit(props);
    const [chosen, clear] = useRefused();
    const kinds = useMemo(() => editKinds(value), [value]);
    // The link kinds that write and may run from the item: its kind among their start's slots.
    const choices = useMemo(() => value.links.filter((kind) => kinds.links.get(kind.key)?.editable === true
        && kind.ends.from.some((slot) => stringEqual(slot, item.ref.kind))), [value.links, kinds, item.ref.kind]);
    const kind = choices.find((choice) => linkKind !== undefined && stringEqual(choice.key, linkKind)) ?? choices[0];
    const names = useMemo(() => new Map(value.items.map((k) => [k.key, k.name] as const)), [value.items]);
    const options = useMemo(() => ({
        kind: choices.map((choice) => ({ key: choice.key, label: choice.name })),
        // The items its end may hold, but the item itself: a link joins two.
        to: kind === undefined ? [] : itemChoices(listed, kind.ends.to, names, []).filter((choice) => !stringEqual(choice.key, item.key)),
    }), [choices, kind, listed, names, item.key]);
    const specs = useMemo(() => Fields.specs(ConnectFormType, {
        kind: Fields.reference({ of: "kind", label: m.inspectorField({ field: "kind" }) }),
        to: Fields.reference({ of: "to", label: m.inspectorField({ field: "to" }) }),
    }, choices.length > 1 ? [] : ["kind"]), [m, choices.length]);
    const onChange = useCallback((path: readonly string[], next: unknown): string | undefined => {
        if (kind === undefined) return undefined;
        if (stringEqual(path[0]!, "kind")) {
            onLinkKind(next as string);
            return undefined;
        }
        // Whatever it comes to, the Chooser is clear again, for the next — refused, saying why under it.
        const target = listed.items.find((i) => stringEqual(i.key, next as string));
        const link = kinds.links.get(kind.key);
        if (target === undefined || link === undefined) {
            clear();
            return undefined;
        }
        const from = { ref: item.ref, label: item.label }, to = { ref: target.ref, label: target.label };
        const refusal = placeholderRefusal(kinds, from) ?? placeholderRefusal(kinds, to) ?? linkRefusal(link, from, to);
        const said = refusal !== undefined ? refusalWords(refusal, words) : veto(kind.key, item.key, target.key);
        if (said !== undefined) {
            say(said);
            return said;
        }
        const step = connectStep(kinds, { session: undefined, shift: false, linkKind: kind.key, from, to, drawn: NO_SESSION, labelOf: (ref) => ref.key },
            (made) => editing.newKey(made), connectValues);
        if (step !== undefined && "refused" in step) return keyRefused(step.refused);
        const recorded = step === undefined ? false : commit(step.edits, "insert", m.step({ step: "connect", name: kind.name.toLocaleLowerCase(words.locale), n: 1 }));
        if (recorded !== true && recorded !== false) return recorded;
        clear();
        return undefined;
    }, [kind, kinds, listed.items, item, words, veto, say, keyRefused, editing, connectValues, commit, m, onLinkKind, clear]);
    if (kind === undefined) return null;
    return (
        <Edits styles={styles} available={editing.available(kind.key)} actions={undefined}>
            <Form styles={styles} head={m.inspectorSection({ section: "connect", name: kind.name })} section="connect" specs={specs}
                value={{ kind: kind.key, to: undefined }} baseline={undefined} options={options} onChange={onChange} readOnly={false} refused={chosen} />
        </Edits>
    );
}

/**
 * An item with no position, below 480px of main (#1394, D15) — the Backlog's card picked: its kind's head, and Place,
 * which puts it at the canvas's centre as the card's ⏎ does and selects it, its fields then Details' to edit. Its kind
 * read only, it has no Place; while its kind's session takes no edit, its Place is off.
 */
function UnplacedView(props: ViewProps & { readonly item: SchematicUnplaced; readonly kind: SchematicValue["items"][number] }) {
    const { item, kind, styles, words, value, editing, place } = props;
    const m = words.m;
    const writes = kind.editable && !value.readOnly;
    const actions = !writes ? undefined : <Action action="place" words={words} onClick={() => place(item.id)} />;
    return (
        <Box css={styles.root} data-schematic-inspector="unplaced">
            <ScheduleInspectorHead styles={styles} kind={{ name: kind.name, icon: item.icon ?? (kind.icon === "" ? "cube" : kind.icon) }} title={item.label}
                when={m.inspectorUnplaced()} home />
            <Edits styles={styles} available={writes && editing.available(kind.key)} actions={actions}>{null}</Edits>
        </Box>
    );
}

// ── A zone ──────────────────────────────────────────────────────────────────

/** A zone: its head and its form, or its own Details. */
function ZoneView(props: ViewProps & { readonly zone: DrawnZone; readonly kind: SchematicValue["zones"][number] }) {
    const { zone, kind, styles, words, value, storageKey } = props;
    const m = words.m;
    const unit = getSomeorUndefined(value.scaleUnit);
    // Its own form but its box (#1585).
    const form = useMemo(() => formSide(kind), [kind]);
    const own = useSide(props, zone.ref, zone.label, form, false);
    return (
        <Box css={styles.root} data-schematic-inspector="zone">
            <ScheduleInspectorHead styles={styles} kind={{ name: kind.name, icon: kind.icon === "" ? "vector-square" : kind.icon }} title={zone.label}
                when={m.inspectorSize({ width: coordinate(zone.width, words), height: coordinate(zone.height, words), unit })} pending={own.state.chip} writes={own.writes} home />
            <Edits styles={styles} available={own.available} actions={undefined}>
                <SideBody styles={styles} head={m.inspectorSection({ section: "fields", name: kind.name })} section="row" side={form} own={own.own}
                    state={own.state} onField={own.onField} writes={own.writes} storageKey={`${storageKey}.inspector.${kind.key}`} empty={m.inspectorNoRow()}
                    refused={own.refused} breaches={own.breaches} />
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

/**
 * A link: its head — titled by its ends, as the rail names it, its caption under them — its ends as Choosers, its form
 * or own Details, and Delete.
 */
function LinkView(props: ViewProps & { readonly link: DrawnLink; readonly kind: SchematicValue["links"][number] }) {
    const { link, kind, styles, words, value, names: entityNames, listed, rows, storageKey, veto, refuse: say } = props;
    const m = words.m;
    const name = nameOfEntity(entityNames, link.key);
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
    const kinds = useMemo(() => editKinds(value), [value]);
    const onEnd = useCallback((path: readonly string[], next: unknown): string | undefined => {
        const from = refOfId(link.from), to = refOfId(link.to), target = refOfId(next as string);
        const end = stringEqual(path[0]!, "from") ? "from" as const : "to" as const;
        if (from === undefined || to === undefined || target === undefined) return undefined;
        const edits = retargetEdits({ ref: link.ref, ends: { from, to } }, end, target);
        // An item waiting for its key to be typed is no end (#1549); the new pair is held to the host's veto in the link's
        // own direction, as a Retarget's drag is (#1394), and a key its ends build another link holds refuses it (#1549):
        // refused, the Chooser shows the end it has, saying why under it as the footer does.
        const waiting = edits.length === 0 ? undefined : placeholderRefusal(kinds, { ref: target, label: target.key });
        const said = waiting !== undefined ? refusalWords(waiting, words)
            : edits.length === 0 ? undefined : end === "from" ? veto(link.ref.kind, next as string, link.to) : veto(link.ref.kind, link.from, next as string);
        if (said !== undefined) {
            say(said);
            return said;
        }
        const recorded = commit(edits, "move", m.inspectorStep({ edit: "edit", name }));
        if (recorded === false) refuse();
        return recorded === true || recorded === false ? undefined : recorded;
    }, [link, kinds, words, commit, m, name, refuse, veto, say]);
    const actions = !own.writes ? undefined : (
        <Action action="delete" words={words} onClick={() => {
            remove({ items: new Set(), link: { key: link.key, leg: null } }, m.inspectorStep({ edit: "delete", name }));
        }} />
    );
    return (
        <Box css={styles.root} data-schematic-inspector="link">
            <ScheduleInspectorHead styles={styles} kind={{ name: kind.name, icon: kind.icon === "" ? "link" : kind.icon }}
                title={name} when={captionText(getSomeorUndefined(link.label), getSomeorUndefined(link.metric))} pending={own.state.chip} writes={own.writes} home />
            <Edits styles={styles} available={own.available} actions={actions}>
                <Form styles={styles} head={m.inspectorSection({ section: "ends", name: kind.name })} section="ends" specs={specs}
                    value={{ from: link.from, to: link.to }} baseline={baseline} options={options}
                    onChange={own.writes ? onEnd : NO_EDIT} readOnly={!own.writes} refused={refused} />
                <SideBody styles={styles} head={m.inspectorSection({ section: "fields", name: kind.name })} section="row" side={kind} own={own.own}
                    state={own.state} onField={own.onField} writes={own.writes} storageKey={`${storageKey}.inspector.${kind.key}`} empty={m.inspectorNoRow()}
                    refused={own.refused} breaches={own.breaches} />
            </Edits>
        </Box>
    );
}

// ── A net, and its leg ──────────────────────────────────────────────────────

/** A net: its head — titled by its label, else its ends, as the rail names it — its sides as tags, its form or own Details, and Delete. */
function NetView(props: ViewProps & { readonly net: DrawnNet; readonly kind: SchematicValue["nets"][number] }) {
    const { net, kind, styles, words, value, names: entityNames, listed, rows, storageKey, veto, refuse: say } = props;
    const m = words.m;
    const name = nameOfEntity(entityNames, net.key);
    const own = useSide(props, net.ref, name, kind, false);
    const { commit, remove } = useCommit(props);
    const [refused, refuse] = useRefused();
    const kinds = useMemo(() => editKinds(value), [value]);
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
    const onSide = useCallback((path: readonly string[], next: unknown): string | undefined => {
        const side = stringEqual(path[0]!, "sources") ? "sources" as const : "destinations" as const;
        const keys = next as readonly string[];
        if (keys.length === 0) {
            // A net keeps a member on each side: its Delete takes it.
            const said = m.inspectorSideEmpty({ side });
            say(said);
            return said;
        }
        const refs = (ids: readonly string[]) => ids.flatMap((id) => { const ref = refOfId(id); return ref === undefined ? [] : [ref]; });
        const slot = side === "sources" ? kind.sides.sources : kind.sides.destinations;
        const written = keys.map((key) => ({ kind: slot, key }));
        const sides = side === "sources" ? { sources: written, destinations: refs(net.destinations) } : { sources: refs(net.sources), destinations: written };
        // An item waiting for its key to be typed is no member (#1549); each pair the sides newly join is held to the host's
        // veto, as an Extend's is (#1394), and a key its sides build another net holds refuses them (#1549): refused, the
        // tags show the sides as they stand, saying why under them as the footer does.
        const waiting = written.reduce<EditRefusal | undefined>((found, ref) => found ?? placeholderRefusal(kinds, { ref, label: ref.key }), undefined);
        const said = waiting !== undefined ? refusalWords(waiting, words)
            : vetoOfPairs(veto, net.ref.kind, joinedPairs({ sources: refs(net.sources), destinations: refs(net.destinations) }, sides));
        if (said !== undefined) {
            say(said);
            return said;
        }
        const recorded = commit([{ op: "sides", ref: net.ref, sides }], "typed", m.inspectorStep({ edit: "edit", name }));
        if (recorded === false) refuse();
        return recorded === true || recorded === false ? undefined : recorded;
    }, [net, kind.sides, kinds, words, commit, m, name, say, refuse, veto]);
    const actions = !own.writes ? undefined : (
        <Action action="delete" words={words} onClick={() => {
            remove({ items: new Set(), link: { key: net.key, leg: null } }, m.inspectorStep({ edit: "delete", name }));
        }} />
    );
    const count = (n: number) => ({ n, count: words.number(n) });
    return (
        <Box css={styles.root} data-schematic-inspector="net">
            <ScheduleInspectorHead styles={styles} kind={{ name: kind.name, icon: kind.icon === "" ? "diagram-project" : kind.icon }} title={name}
                when={m.inspectorSides({ sources: count(net.sources.length), destinations: count(net.destinations.length) })} pending={own.state.chip} writes={own.writes} home />
            <Edits styles={styles} available={own.available} actions={actions}>
                <Form styles={styles} head={m.inspectorSection({ section: "sides", name: kind.name })} section="sides" specs={specs}
                    value={{ sources: keysOf(net.sources), destinations: keysOf(net.destinations) }} baseline={baseline}
                    onChange={own.writes ? onSide : NO_EDIT} readOnly={!own.writes} refused={refused} />
                <SideBody styles={styles} head={m.inspectorSection({ section: "fields", name: kind.name })} section="row" side={kind} own={own.own}
                    state={own.state} onField={own.onField} writes={own.writes} storageKey={`${storageKey}.inspector.${kind.key}`} empty={m.inspectorNoRow()}
                    refused={own.refused} breaches={own.breaches} />
            </Edits>
        </Box>
    );
}

/** A net's leg: its net's head, the item on it — a control that selects it — and Remove. */
function LegView(props: ViewProps & { readonly net: DrawnNet; readonly kind: SchematicValue["nets"][number]; readonly leg: NetLeg }) {
    const { net, kind, leg, styles, words, value, names: entityNames, reveal } = props;
    const m = words.m;
    const name = nameOfEntity(entityNames, net.key);
    const member = nameOfEntity(entityNames, leg.item);
    const { remove } = useCommit(props);
    const writes = kind.editable && !value.readOnly;
    const available = writes && props.editing.available(kind.key);
    const actions = !writes ? undefined : (
        <Action action="remove" words={words} onClick={() => {
            if (remove({ items: new Set(), link: { key: net.key, leg } }, m.inspectorStep({ edit: "remove", name: member, from: name }))) reveal(net.key);
        }} />
    );
    return (
        <Box css={styles.root} data-schematic-inspector="leg">
            <ScheduleInspectorHead styles={styles} kind={{ name: kind.name, icon: kind.icon === "" ? "diagram-project" : kind.icon }} title={name}
                when={m.inspectorLeg({ end: leg.end })} home />
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
            <Box css={styles.head} {...FOCUS_HOME_PROPS}>
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
            return newest === undefined ? [] : [{ slot: record.slot, name: record.name, at: newest.at, by: authorOf(newest.actor) }];
        } catch {
            return [];
        }
    }), [records]);
    const { result } = useTrackedEvaluation(read);
    const saved = result.ok ? result.value : [];
    const today = words.date(new Date());
    // Each count, its label and its name as running text writes it: a number, a placeholder while it is read, or — no
    // read can say it — a line naming it and why (#1393).
    const sorts = [
        ...counts.kinds.map((kind) => ({ key: kind.slot, count: kind.drawn, label: (n: number) => (n === 1 ? kind.name : kindPlural(kind.name)), noun: kindPlural(kind.name.toLocaleLowerCase(words.locale)) })),
        ...(["zones", "links", "nets"] as const).flatMap((what) => {
            const count = counts[what];
            return count === undefined ? [] : [{
                key: what, count, label: (n: number) => m.inspectorCount({ what, n }), noun: m.inspectorCount({ what, n: 2 }).toLocaleLowerCase(words.locale),
            }];
        }),
    ];
    const stats = sorts.flatMap((sort): { key: string; count: Exclude<SchematicDrawingCount, { kind: "uncounted" }>; label: string }[] =>
        (sort.count.kind === "uncounted" ? [] : [{ key: sort.key, count: sort.count, label: sort.label(sort.count.kind === "counted" ? sort.count.n : 2) }]));
    const notCounted = new Map<SchematicUncounted, string[]>();
    for (const sort of sorts) if (sort.count.kind === "uncounted") notCounted.set(sort.count.why, [...(notCounted.get(sort.count.why) ?? []), sort.noun]);
    return (
        <Box css={styles.root} data-schematic-inspector="drawing">
            <Box css={styles.head} {...FOCUS_HOME_PROPS}>
                <Box css={styles.eyebrow} data-inspector-what="">{m.inspectorDrawing()}</Box>
            </Box>
            <Box css={styles.stats} data-inspector-counts="">
                {stats.map((stat) => (
                    <Box key={stat.key} css={styles.stat} data-count={stat.key} data-pending={stat.count.kind === "reading" ? "" : undefined}>
                        <Box as="span" css={styles.statValue}>
                            {stat.count.kind === "counted" ? words.number(stat.count.n) : <PlaceholderShape kind="number" index={stat.key.length} />}
                        </Box>
                        <Box as="span" css={styles.statLabel}>{stat.label}</Box>
                    </Box>
                ))}
            </Box>
            {notCounted.size > 0 && (
                <Box css={styles.section}>
                    {[...notCounted].map(([why, names]) => (
                        <Box key={why} css={styles.fact} data-inspector-uncounted={why}>{m.inspectorNotCounted({ names, why })}</Box>
                    ))}
                </Box>
            )}
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

/**
 * The Issues tab: every issue of the drawing and of its unsaved changes, each a control that selects what it names and
 * flies to it — under a line, while a kind is read by area, saying its rows out of view are checked only as the view
 * reaches them (ruled 27 Oct 2026). An issue of an unsaved change the drawing leaves out says on a line of its own which
 * of the rail's choices hide the row it drafts, asked of e3 through its kind's hidden pick, and Go to issue on it is the
 * frame's hidden pick (`goToWaiting`): those choices cleared, then flown to and selected once it draws.
 */
const SchematicInspectorIssues = memo(function SchematicInspectorIssues({ issues, unchecked, reveal, words, waiting, picks, goToWaiting }: SchematicInspectorProps) {
    const styles = useSlotRecipe({ key: "schematicInspector" })() as Styles;
    const m = words.m;
    // Each issue's unsaved change the drawing leaves out: its kind's hidden pick, and the row it drafts.
    const hidingOf = (issue: SchematicIssue): RowHiding | undefined => {
        const ref = issue.at === undefined ? undefined : waiting.get(issue.at);
        const pick = ref === undefined ? undefined : picks.get(ref.kind);
        return ref === undefined || pick === undefined ? undefined : { pick, id: ref.key };
    };
    const hidings = issues.flatMap((issue) => { const hiding = hidingOf(issue); return hiding === undefined ? [] : [hiding]; });
    // The narrowing leaves each out, as the drawing knows: each says so at once while e3 is asked which choices do — each
    // asked once at its record's revision and its narrowing, so a render that moves neither asks nothing. Asked after every
    // render: the revision and the narrowing land in renders of their own.
    useEffect(() => {
        if (hidings.length > 0) askHiding(hidings, true);
    });
    // What hides an issue's row, as far as e3 has said: `undefined` for any other issue, and for one nothing hides.
    const hiddenOfIssue = (issue: SchematicIssue): readonly RowHidden[] | undefined => {
        const hiding = hidingOf(issue);
        return hiding === undefined ? undefined : hiddenOf([hiding]);
    };
    // Go to issue: what it names selected and flown to — an unsaved change the drawing leaves out through the frame's hidden
    // pick, the choices hiding it cleared first.
    const goTo = (issue: SchematicIssue) => {
        if (issue.at !== undefined && waiting.has(issue.at)) goToWaiting(issue.at, hiddenOfIssue(issue));
        else reveal(issue.at);
    };
    // What the list leaves unchecked, said before it: a reader hears it ahead of the issues, or of none.
    const scope = unchecked.length === 0 ? null : (
        <Box css={styles.section}>
            <Box css={styles.fact} data-inspector-unchecked="">{m.inspectorUnchecked({ names: unchecked })}</Box>
        </Box>
    );
    if (issues.length === 0) {
        return (
            <>
                {scope}
                <Box css={styles.empty} data-inspector-no-issues="">
                    <Box as="span" css={styles.emptyTitle}>{m.inspectorNoIssues({ part: "title" })}</Box>
                    <Box as="span" css={styles.emptyHint}>{m.inspectorNoIssues({ part: "hint" })}</Box>
                </Box>
            </>
        );
    }
    return (
        <>
            {scope}
            <Box as="ul" css={styles.issueList} data-inspector-issue-list="">
                {issues.map((issue, i) => {
                    const hiddenBy = hiddenOfIssue(issue);
                    const hidden = hiddenBy === undefined ? undefined : hiddenLine(hiddenBy, words, m);
                    return (
                        <Box as="li" key={i}>
                            <chakra.button type="button" css={styles.issueItem} data-inspector-issue={issue.word.issue} onClick={() => goTo(issue)}>
                                <Box as="span" css={styles.issueWhere}>{m.issueWhere(issue.where)}</Box>
                                <Box as="span" css={styles.issueMessage} data-kind={issue.blocking ? "invalid" : "warning"}>{m.issueText(issue.word)}</Box>
                                {hidden !== undefined && <Box as="span" css={styles.issueHidden} data-inspector-issue-hidden="">{hidden}</Box>}
                            </chakra.button>
                        </Box>
                    );
                })}
            </Box>
        </>
    );
});

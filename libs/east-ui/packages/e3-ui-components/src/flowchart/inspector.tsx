/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart's inspector (#1504, `Flowchart Records Spec.md` R13, R15–R17):
 * its end pane — on unless `inspector={false}` — its tabs Details and Issues,
 * Issues with its count; collapsed, a rail with its icon, the issues' count
 * and what is selected.
 *
 * Details shows what is selected: a row of the app's, under its head — its
 * kind's name and the name the Flowchart gives it everywhere (`State · SCN`,
 * `Transition · DSP → DLV`), and a Pending or New chip while its drafts hold
 * it otherwise than its record:
 *
 * - **a state**: its key, printed — a new state's the viewer's to change until
 *   Save, the transitions naming it following (R9) — its label and its lane,
 *   the lane chosen from the lanes, each written as the canvas's rename and
 *   move write them (R8); its kind's form over the fields no role writes, or
 *   its kind's own Details in the form's place; Duplicate and Delete; and its
 *   transitions, In, Out and In place, each with its volume and each a control
 *   that selects it. A key no state is keyed by — an unresolved end, its ghost
 *   — says so, with its transitions;
 * - **a transition**: its ends, each chosen from the states drawn, and its
 *   decision, chosen from the decisions, written as a retarget writes them;
 *   its kind's form or own Details; Delete; and its evidence, read only. Its
 *   key is minted and never drawn;
 * - **a decision**: its key, printed; its kind's form or own Details; Delete;
 *   and the transitions it governs;
 * - **a lane**, which a click on its header selects: its key — a new lane's the
 *   viewer's to change until Save, its states following — and its label; its
 *   kind's form or own Details; how many states it holds; and Delete, off
 *   while it holds any, saying why;
 * - **several states**: how many; a lane every one moves to; and Delete;
 * - **nothing**: the flowchart, as the Schematic's names its drawing (R15) —
 *   the lanes, states, transitions and decisions it holds, counted; its
 *   transitions planned · observed · unresolved; each record's last save and
 *   who made it; and its hints.
 *
 * Every edit is one step of the history, through the gestures the canvas
 * makes (`edits.ts`): a role through its kind's `write`, a field of the form
 * through its kind's `set`, and the row an own Details hands back, whole. A
 * field its drafts changed is tinted against its record. Read only — a kind
 * bound read only, or the Flowchart `readOnly` (R13) — Details prints every
 * field and edits none, an own Details giving way to the form; while a record
 * takes no edit — a Save in flight, or what the canvas draws standing in while
 * a new narrowing is read — its controls are off. A key typed that the
 * Flowchart holds already, or one left empty, is refused, the footer saying
 * why, and the field shows the key it has.
 *
 * Details keeps the keyboard (#1398): a control that goes with the view it
 * belongs to — Delete, which leaves nothing selected; Duplicate and a
 * transition's line, which select another; a refused edit's form drawn again
 * — leaves the focus on the heading of the view drawn in its place
 * (`../shared/focus-home.ts`), never on the page's body.
 *
 * Issues (R16) lists the Flowchart's issues (`issues.ts`), each a control that
 * selects what it names and brings it into view. An issue of an unsaved change
 * the narrowing hides says on a line of its own which of the rail's choices
 * hide it, asked of e3 through its source's hidden pick, and Go to issue on it
 * is the frame's hidden pick: those choices cleared, then selected once it is
 * drawn (R11).
 *
 * Its look is the `flowchartInspector` recipe's, the form's `fieldForm`'s and
 * the buttons the shared `button`'s; the pane — its tab row, its collapse
 * control and its rail — is the Dock's.
 *
 * @packageDocumentation
 */

import { Fragment, memo, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Box, chakra, useRecipe, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import {
    DateTimeType, IntegerType, OptionType, StringType, StructType, compareFor, encodeBeast2For, equalFor, fromEastTypeValue, none, some,
    type EastType, type StructType as EastStructType, type option,
} from "@elaraai/east";
import { Fields, type FieldSpecValue } from "@elaraai/east-ui/internal";
import {
    EastChakraComponent, FieldForm, fieldFormMessages, getSomeorUndefined, type BuilderFrameDock, type FieldFormWords, type FieldOption,
} from "@elaraai/east-ui-components";
import { FrameDrawer } from "@elaraai/east-ui-components/internal";
import { FOCUS_HOME_PROPS, useFocusHome } from "../shared/focus-home.js";
import { askHiding, hiddenLine, hiddenOf, type RowHidden, type RowHiding, type SourceHiding } from "../shared/schedule/hidden.js";
import type { HiddenPicks } from "../shared/schedule/hidden-pick.js";
import { draftedRow, rowCodec } from "../shared/schedule/records.js";
import { kindOf, type FlowchartEditing, type FlowchartFieldWrites } from "./editing.js";
import {
    deleteDecision, deleteLane, deleteLink, deleteStates, duplicateState, editLink, moveStates, rekey, renameLane, renameState, setFields, setRow,
    type FlowchartGesture, type FlowchartHolding, type GestureEdits,
} from "./edits.js";
import type { FlowchartLastSaves } from "./footer.js";
import type { FlowchartIssue } from "./issues.js";
import type { FlowchartWords } from "./messages.js";
import {
    evidenceBadge, type FlowchartModel, type FlowchartRow, type FlowchartRows, type FlowchartTransitionRoles, type FlowchartValue, type LinkClass,
} from "./model.js";
import type { FlowchartHeld, FlowchartSort } from "./read.js";
import type { FlowchartSelection } from "./selection.js";

type Styles = Record<string, SystemStyleObject>;
/** A kind of any sort, as the payload carries it. */
type AnyKind = NonNullable<ReturnType<typeof kindOf>>;
/** An author's own Details, decoded: the row as bytes and its writer, to UI. */
type OwnDetails = Extract<AnyKind["inspector"], { type: "some" }>["value"];
/** One field of the form written, as a kind's `set` takes it. */
type FieldWrite = FlowchartFieldWrites[number];

/** The inspector open: the design system's 320px, as the Schematic's, the Plan's and the Sheet's are. */
const INSPECTOR_SIZE = "320px";

/** A form that takes no edit: read only. */
const NO_EDIT = (): void => {};
/** What a new row's form is tinted against: nothing — every field it has is a change. */
const NEW_ROW: Readonly<Record<string, unknown>> = {};

const stringEqual = equalFor(StringType);
const compareKey = compareFor(StringType);

/** A state's roles as its form edits them: its key, its label and its lane. */
const StateRolesForm = StructType({ key: StringType, label: StringType, lane: StringType });
/** A transition's roles as its form edits them: its ends and its decision. */
const TransitionRolesForm = StructType({ from: StringType, to: StringType, decision: OptionType(StringType) });
/** A lane's roles as its form edits them: its key and its label. */
const LaneRolesForm = StructType({ key: StringType, label: StringType });
/** A decision's key, as its form prints it. */
const DecisionKeyForm = StructType({ key: StringType });
/** A transition's evidence as its form prints it: the volume with its unit, the count, and when it was measured. */
const EvidenceForm = StructType({ volume: OptionType(StringType), count: OptionType(IntegerType), measured: OptionType(DateTimeType) });
/** Several states as the form moves them: the lane each goes to. */
const MoveForm = StructType({ lane: StringType });

/** A chip in a view's head: drafted since the record held it, new, a key no state is keyed by, a transition naming one. */
type Chip = "pending" | "new" | "noRow" | "unresolved";

/** What the inspector reads of the Flowchart. */
export interface FlowchartInspectorProps {
    /** The payload, decoded: each kind's name, form, own Details and row type. */
    readonly value: FlowchartValue;
    /** What the canvas draws, the drafts in place. */
    readonly model: FlowchartModel;
    /** The rows it draws, the drafts in place. */
    readonly rows: FlowchartRows;
    /** Each kind's stored rows the read holds: what a form is tinted against. */
    readonly held: FlowchartHeld;
    /** What is selected, as the canvas draws it. */
    readonly selection: FlowchartSelection | null;
    /** The editing: each record's session and drafts, and which kinds take an edit. */
    readonly editing: FlowchartEditing;
    /**
     * Records a gesture's edits as one step, as the canvas's are — what the gesture reads the latest the frame holds —
     * clearing the footer's refusal.
     *
     * @param gesture - The gesture
     * @param edits - Its edits, over what it reads; `undefined` where it makes none
     * @returns The edits recorded; `undefined` where nothing was
     */
    readonly act: (gesture: FlowchartGesture, edits: (holding: FlowchartHolding) => GestureEdits | undefined) => GestureEdits | undefined;
    /** Says why an edit was refused, in the footer. */
    readonly refuse: (words: string) => void;
    /** Selects something, or nothing — a transition in a state's Details, an issue's row — bringing it into view unless `scroll` is `false`. */
    readonly reveal: (selection: FlowchartSelection | null, scroll?: boolean) => void;
    /** The Flowchart's issues, and its sessions'. */
    readonly issues: readonly FlowchartIssue[];
    /** Each source's hidden pick, by its kind: what an issue of a change the narrowing hides asks e3 which choices hide its row through. */
    readonly picks: HiddenPicks;
    /**
     * Goes to a change the narrowing hides — the frame's hidden pick, as Find's is: the choices hiding it cleared, and
     * selected once the narrowing they leave draws it.
     *
     * @param at - What the issue names
     * @param hidden - What hides it, as far as e3 has said; `undefined` where nothing does
     */
    readonly goToWaiting: (at: FlowchartSelection, hidden: readonly SourceHiding[] | undefined) => void;
    /** Each record's last save, and who made it. */
    readonly saves: FlowchartLastSaves;
    /** Where an own Details keeps its own state. */
    readonly storageKey: string;
    /** The Flowchart's words. */
    readonly words: FlowchartWords;
}

/** Every view's props: the inspector's, and the recipe's styles. */
interface ViewProps extends FlowchartInspectorProps {
    readonly styles: Styles;
}

/** A row's view: the inspector's, and the key of what it shows. */
interface RowViewProps extends ViewProps {
    readonly at: string;
}

/** A kind's name, as the payload gives it: what one is called. */
function kindName(value: FlowchartValue, sort: FlowchartSort): string {
    return kindOf(value, sort)?.name ?? "";
}

/** A transition the canvas draws, by its key, its drafts in place. */
function transitionAt(rows: FlowchartRows, key: string): FlowchartRow<FlowchartTransitionRoles> | undefined {
    return rows.transitions.find((transition) => stringEqual(transition.key, key));
}

/** A transition named by its ends' keys, as the Flowchart names it everywhere. */
function endsOf(roles: FlowchartTransitionRoles): string {
    return `${roles.from} → ${roles.to}`;
}

/** A lane's header, by its key; its key where the canvas draws no lane of it. */
function laneLabel(model: FlowchartModel, key: string): string {
    return model.lanes.find((lane) => lane.band === "lane" && stringEqual(lane.key, key))?.label ?? key;
}

/** A state's name on its card: its label, else its key. */
function stateName(model: FlowchartModel, key: string): string {
    const node = model.nodesByKey.get(key);
    return node === undefined || node.ghost || node.label === undefined ? key : node.label;
}

/**
 * What is selected, as the head and the collapsed rail name it — `State · SCN`,
 * `Transition · DSP → DLV`, `Decision · R`, `Lane · Sort`, `3 states` — by the
 * name Issues gives it too.
 *
 * @param props - The inspector's props
 * @param selection - What is selected
 * @returns Its name
 */
function whatOf(props: FlowchartInspectorProps, selection: FlowchartSelection): string {
    const { value, model, rows, words } = props;
    const m = words.m;
    switch (selection.kind) {
        case "state": return m.inspectorWhat({ what: "row", kind: value.states.name, name: selection.key });
        case "link": {
            const roles = transitionAt(rows, selection.key)?.roles;
            return m.inspectorWhat({ what: "row", kind: kindName(value, "transitions"), name: roles === undefined ? selection.key : endsOf(roles) });
        }
        case "trigger": return m.inspectorWhat({ what: "row", kind: kindName(value, "decisions"), name: model.triggers.get(selection.key)?.letter ?? selection.key });
        case "lane": return m.inspectorWhat({ what: "row", kind: kindName(value, "lanes"), name: laneLabel(model, selection.key) });
        case "states": {
            const n = selection.keys.length;
            return m.inspectorWhat({ what: "several", n, count: words.number(n), name: value.states.name.toLocaleLowerCase(words.locale) });
        }
    }
}

/**
 * The inspector pane, as `BuilderFrame` draws it — see the module docs.
 *
 * @param props - The payload, what the canvas draws, what is selected, the editing, the issues, the saves and the words
 * @returns The pane — 320px wide, its collapsed state kept per viewer — or `undefined`, no pane, given `inspector={false}`
 */
export function flowchartInspectorPane(props: FlowchartInspectorProps): BuilderFrameDock | undefined {
    if (!props.value.inspector) return undefined;
    const { words, issues, selection } = props;
    const m = words.m;
    const n = issues.length;
    return {
        label: m.inspectorPane(),
        icon: "sliders",
        size: INSPECTOR_SIZE,
        persist: "local",
        // Collapsed, the rail counts the issues and names what is selected.
        badge: n > 0 ? n : undefined,
        detail: selection === null ? undefined : whatOf(props, selection),
        tabs: [
            { key: "details", label: m.inspectorTab({ tab: "details" }), body: <FlowchartInspectorDetails {...props} /> },
            { key: "issues", label: m.inspectorTab({ tab: "issues" }), count: n, body: <FlowchartInspectorIssues {...props} /> },
        ],
    };
}

// ============================================================================
// The shared parts
// ============================================================================

/** A view's head: what it shows, its name under that, and its chips — its view's home, where the keyboard lands as a control goes with the view. */
function Head({ styles, what, name, chips, words }: { styles: Styles; what: string; name: string | undefined; chips: readonly Chip[]; words: FlowchartWords }) {
    return (
        <Box css={styles.head} {...FOCUS_HOME_PROPS}>
            <Box css={styles.eyebrow} data-inspector-what="">{what}</Box>
            {name !== undefined && <Box css={styles.name} data-inspector-name="">{name}</Box>}
            <Box css={styles.marks}>
                {chips.map((chip) => (
                    <Box as="span" key={chip} css={styles.chip} data-inspector-chip="" data-state={chip}>{words.m.inspectorChip({ state: chip })}</Box>
                ))}
            </Box>
        </Box>
    );
}

/** One gesture's button: Duplicate, Delete. */
function Action({ action, onClick, disabled, words }: { action: "duplicate" | "delete"; onClick: () => void; disabled?: boolean; words: FlowchartWords }) {
    const button = useRecipe({ key: "button" });
    return (
        <chakra.button type="button" css={button({ variant: "outline", size: "xs" })} disabled={disabled} data-inspector-action={action} onClick={onClick}>
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

/** A fact on a line of its own. */
function Fact({ styles, fact, children }: { styles: Styles; fact: string; children: ReactNode }) {
    return <Box css={styles.section}><Box css={styles.fact} data-inspector-fact={fact}>{children}</Box></Box>;
}

/** A remount counter for a form whose edit was refused: its inputs show what the row holds again. */
function useRefused(): [number, () => void] {
    const [refused, setRefused] = useState(0);
    const bump = useCallback(() => setRefused((n) => n + 1), []);
    return [refused, bump];
}

/** The form's words where it chooses a decision: the field form's, its reference with no key the Flowchart's no decision. */
function useDecisionWords(words: FlowchartWords): FieldFormWords {
    return useMemo(() => ({ ...words, m: { ...fieldFormMessages, unassigned: words.m.noDecision } }), [words]);
}

/**
 * An own Details for a row: what the author's function returns for its bytes,
 * its `update` writing the edited row back — or, where it fails, nothing, and
 * the form shows.
 *
 * @param author - The kind's own Details; `undefined` for none, or a kind read only
 * @param bytes - The row, as bytes
 * @param update - The writer of the edited row's bytes
 * @param what - What the row is, for the console
 * @returns The UI it returns, or `undefined`
 */
function useOwnDetails(author: OwnDetails | undefined, bytes: Uint8Array | undefined, update: (edited: Uint8Array) => null, what: string): unknown {
    return useMemo(() => {
        if (author === undefined || bytes === undefined) return undefined;
        try {
            return author(bytes, update);
        } catch (err) {
            console.error(`[Flowchart] ${what}'s own Details failed; its form shows instead:`, err);
            return undefined;
        }
    }, [author, bytes, update, what]);
}

/**
 * A field of the form edited, as its kind's `set` takes it: its path, and its
 * value as bytes at the field's type — its spec's, else the row's own field's.
 *
 * @param specs - The form's specs
 * @param rowType - The row type
 * @param path - The field's path
 * @param next - Its new value
 * @returns The write; `undefined` for a path no field is at
 */
function fieldWrite(specs: readonly FieldSpecValue[], rowType: AnyKind["rowType"], path: readonly string[], next: unknown): FieldWrite | undefined {
    const spec = specs.find((field) => field.path.length === path.length && field.path.every((part, i) => stringEqual(part, path[i]!)));
    const row = fromEastTypeValue(rowType) as EastStructType;
    const type = spec !== undefined ? fromEastTypeValue(spec.type) as EastType : path.length === 1 ? row.fields[path[0]!] : undefined;
    if (type === undefined) return undefined;
    return { path: [...path], value: encodeBeast2For(type)(next as never) };
}

/** A row as Details holds it: as its drafts hold it, else its record; what its form is tinted against; its chip. */
interface RowState {
    /** The app's row now, decoded: drafted, else as its record holds it; `undefined` for none. */
    readonly row: unknown;
    /** The row now, as bytes: what an own Details is handed. */
    readonly bytes: Uint8Array | undefined;
    /** What its form is tinted against: its record's row, or — a new row — nothing. */
    readonly baseline: unknown;
    /** New while its record holds none of it; Pending while its drafts hold it otherwise. */
    readonly chip: "pending" | "new" | undefined;
    /** Whether a gesture made it, unsaved: its key is the viewer's to change. */
    readonly created: boolean;
}

/**
 * A record's row as Details holds it: drafted, its session's version; else as
 * its record holds it, from the read's bytes.
 *
 * @param editing - The editing
 * @param sort - The row's kind
 * @param kind - The kind: its row type
 * @param key - The row's key
 * @param stored - Its stored row's bytes, as the read holds them
 * @returns The row's state
 */
function useRowState(editing: FlowchartEditing, sort: FlowchartSort, kind: AnyKind | undefined, key: string, stored: Uint8Array | undefined): RowState {
    const codec = useMemo(() => (kind === undefined ? undefined : rowCodec(kind.rowType)), [kind]);
    const decoded = useMemo(() => (stored === undefined || codec === undefined ? undefined : codec.decode(stored)), [stored, codec]);
    const drafted = editing.schedule.draftsOf(sort).has(key);
    const session = drafted ? editing.schedule.sessions.find((part) => stringEqual(part.kind, sort))?.session : undefined;
    const draft = drafted ? draftedRow(session?.entries.get(key))?.row : undefined;
    const row = drafted ? draft : decoded;
    const bytes = useMemo(() => {
        if (row === undefined || codec === undefined) return undefined;
        return !drafted && stored !== undefined ? stored : codec.encode(row);
    }, [row, codec, drafted, stored]);
    const kindDrafts: ReadonlyMap<string, { readonly created: boolean } | undefined> = editing.drafts[sort];
    const created = kindDrafts.get(key)?.created === true;
    return { row, bytes, baseline: decoded ?? NEW_ROW, chip: drafted ? (created ? "new" : "pending") : undefined, created };
}

/**
 * A row's side of its record, as Details edits it: its kind's form or its own
 * Details over the row as its drafts and its record hold it; each field one
 * step through the kind's `set`, the own Details' row one step whole.
 *
 * @param props - The view's props
 * @param sort - The row's kind
 * @param key - Its key
 * @param what - What it is, for the console
 * @returns The kind, whether it writes and takes an edit now, the row's state, the form's edit, and the own Details
 */
function useSide(props: ViewProps, sort: FlowchartSort, key: string, what: string) {
    const { value, editing, held, act } = props;
    const kind = kindOf(value, sort);
    const writes = kind !== undefined && editing.editable(sort);
    const available = writes && editing.available(sort);
    const rows: ReadonlyMap<string, { readonly row: Uint8Array }> | undefined = held[sort];
    const state = useRowState(editing, sort, kind, key, rows?.get(key)?.row);
    const [refused, bump] = useRefused();
    const onField = useCallback((path: readonly string[], next: unknown) => {
        if (kind === undefined) return;
        const write = fieldWrite(kind.fields, kind.rowType, path, next);
        if (write === undefined || act("form", (holding) => setFields(holding, sort, key, [write])) === undefined) bump();
    }, [kind, sort, key, act, bump]);
    const update = useCallback((edited: Uint8Array): null => {
        if (writes) act("details", (holding) => setRow(holding, sort, key, edited));
        return null;
    }, [writes, sort, key, act]);
    // Read only, the form prints every field: an own Details is for a record that takes its edits.
    const own = useOwnDetails(writes && kind !== undefined ? getSomeorUndefined(kind.inspector) : undefined, state.bytes, update, what);
    return { kind, writes, available, state, onField, own, refused, bump };
}

/**
 * A row's fields: its roles' form, then its kind's form over the fields no
 * role writes — or its kind's own Details in that form's place.
 */
function RowFields({ styles, roles, side, storageKey }: {
    styles: Styles; roles: ReactNode; side: ReturnType<typeof useSide>; storageKey: string;
}) {
    const { kind, writes, state, onField, own, refused } = side;
    const specs = kind?.fields ?? [];
    return (
        <>
            <Box css={styles.rowForms} data-inspector-fields="row">
                {roles}
                {own === undefined && specs.length > 0 && (
                    <Box data-inspector-form="fields">
                        <FieldForm key={refused} specs={specs} value={state.row} baseline={state.baseline} onChange={writes ? onField : NO_EDIT} readOnly={!writes} />
                    </Box>
                )}
            </Box>
            {own !== undefined && (
                <Box css={styles.custom} data-inspector-fields="custom">
                    <EastChakraComponent value={own as never} storageKey={storageKey} />
                </Box>
            )}
        </>
    );
}

/** A transition as a list shows it: its key, its ends, and under them its kind, its decision and its badge. */
interface LinkLine {
    readonly key: string;
    readonly from: string;
    readonly to: string;
    readonly meta: string;
}

/**
 * Transitions as a list shows them, in key order: each its ends' keys, and
 * under them its kind — unresolved where an end is no state's — its decision
 * and its evidence's badge. What the narrowing draws as context is left out.
 *
 * @param props - The inspector's props: what the canvas draws
 * @param pick - Which of its transitions
 * @returns The lines
 */
function linkLines(props: FlowchartInspectorProps, pick: (roles: FlowchartTransitionRoles) => boolean): LinkLine[] {
    const { model, rows, words } = props;
    const unresolved = (key: string): boolean => model.nodesByKey.get(key)?.ghost !== false;
    return rows.transitions
        .filter((transition) => !transition.dimmed && pick(transition.roles))
        .sort((a, b) => compareKey(a.key, b.key))
        .map((transition) => {
            const { from, to } = transition.roles;
            const kind: LinkClass = unresolved(from) || unresolved(to) ? "unresolved" : transition.roles.kind.type;
            const decision = getSomeorUndefined(transition.roles.decision);
            const trigger = decision === undefined ? undefined : model.triggers.get(decision);
            return {
                key: transition.key, from, to,
                meta: words.m.inspectorLinkKind({
                    kind,
                    decision: decision === undefined ? undefined : trigger === undefined || trigger.label.length === 0 ? decision : trigger.label,
                    badge: evidenceBadge(getSomeorUndefined(transition.roles.evidence), words),
                }),
            };
        });
}

/** One group of a list of transitions: its head — `In · 2` — and its lines. */
interface LinkGroup {
    readonly key: string;
    readonly head: string | undefined;
    readonly lines: readonly LinkLine[];
}

/** A list of transitions under its head, in groups, each line a control that selects its transition and brings it into view. */
function Transitions({ styles, title, groups, reveal }: { styles: Styles; title: string; groups: readonly LinkGroup[]; reveal: FlowchartInspectorProps["reveal"] }) {
    const shown = groups.filter((group) => group.lines.length > 0);
    if (shown.length === 0) return null;
    return (
        <Box css={styles.section} data-inspector-links="">
            <Box css={styles.sectionHead}>{title}</Box>
            {shown.map((group) => (
                <Fragment key={group.key}>
                    {group.head !== undefined && <Box css={styles.linkGroup} data-inspector-link-group={group.key}>{group.head}</Box>}
                    <Box as="ul" css={styles.links} data-inspector-link-list={group.key}>
                        {group.lines.map((line) => (
                            <Box as="li" key={line.key}>
                                <chakra.button type="button" css={styles.link} data-inspector-link={line.key} onClick={() => reveal({ kind: "link", key: line.key })}>
                                    <Box as="span" css={styles.linkText}>{`${line.from} → ${line.to}`}</Box>
                                    <Box as="span" css={styles.linkMeta}>{line.meta}</Box>
                                </chakra.button>
                            </Box>
                        ))}
                    </Box>
                </Fragment>
            ))}
        </Box>
    );
}

/**
 * A state's transitions in their groups: In, Out and In place.
 *
 * @param props - The inspector's props
 * @param key - The state's key
 * @returns Its transitions' count, and the groups
 */
function stateGroups(props: FlowchartInspectorProps, key: string): { n: number; groups: LinkGroup[] } {
    const m = props.words.m;
    const lines = linkLines(props, (roles) => stringEqual(roles.from, key) || stringEqual(roles.to, key));
    const into = lines.filter((line) => stringEqual(line.to, key) && !stringEqual(line.from, key));
    const out = lines.filter((line) => stringEqual(line.from, key) && !stringEqual(line.to, key));
    const inPlace = lines.filter((line) => stringEqual(line.from, key) && stringEqual(line.to, key));
    const head = (section: "in" | "out" | "inPlace", group: readonly LinkLine[]) =>
        m.inspectorSection({ section, n: group.length, count: props.words.number(group.length), name: "" });
    return {
        n: lines.length,
        groups: [
            { key: "in", head: head("in", into), lines: into },
            { key: "out", head: head("out", out), lines: out },
            { key: "inPlace", head: head("inPlace", inPlace), lines: inPlace },
        ],
    };
}

// ============================================================================
// Details
// ============================================================================

/**
 * The Details tab: what is selected — a state, a transition, a decision, a lane, several states — or the flowchart; the
 * keyboard kept as a control goes with the view it belongs to, on the heading of the view drawn in its place.
 */
const FlowchartInspectorDetails = memo(function FlowchartInspectorDetails(props: FlowchartInspectorProps) {
    const styles = useSlotRecipe({ key: "flowchartInspector" })() as Styles;
    const home = useFocusHome();
    return (
        <Box ref={home.ref} css={styles.home} onFocus={home.onFocus} onBlur={home.onBlur} data-inspector-home="">
            {detailsView({ ...props, styles })}
        </Box>
    );
});

/** What Details shows, a view a selection: what was typed for one never lands on the next. */
function detailsView(view: ViewProps): ReactNode {
    const { selection, model } = view;
    if (selection === null) return <FlowchartView key="flowchart" {...view} />;
    switch (selection.kind) {
        case "state": return model.nodesByKey.get(selection.key)?.ghost === true
            ? <GhostView key={`ghost:${selection.key}`} {...view} at={selection.key} />
            : <StateView key={`state:${selection.key}`} {...view} at={selection.key} />;
        case "link": return <LinkView key={`link:${selection.key}`} {...view} at={selection.key} />;
        case "trigger": return <DecisionView key={`trigger:${selection.key}`} {...view} at={selection.key} />;
        case "lane": return <LaneView key={`lane:${selection.key}`} {...view} at={selection.key} />;
        case "states": return <SeveralView key="states" {...view} picked={selection.keys} />;
    }
}

/**
 * A key typed for a new row (R9): refused — the footer saying why, the field
 * showing the key it has — when it is empty or the Flowchart holds it already;
 * else the row under it, the rows naming it following, and the selection with
 * it.
 *
 * @param props - The view's props
 * @param sort - The row's kind: a state's or a lane's
 * @param from - Its key
 * @param typed - The key typed
 * @param bump - Draws the form again, showing the key it has
 */
function typedKey(props: RowViewProps, sort: "states" | "lanes", from: string, typed: string, bump: () => void): void {
    const { value, editing, act, refuse, reveal, words } = props;
    const to = typed.trim();
    if (stringEqual(to, from)) {
        bump();
        return;
    }
    const why = to.length === 0 ? "empty" as const : editing.taken(sort, to) ? "taken" as const : undefined;
    if (why !== undefined) {
        refuse(words.m.inspectorKeyRefused({ name: kindName(value, sort).toLocaleLowerCase(words.locale), key: to, why }));
        bump();
        return;
    }
    if (act("rekey", (holding) => rekey(holding, sort, from, to)) === undefined) bump();
    else reveal(sort === "states" ? { kind: "state", key: to } : { kind: "lane", key: to }, false);
}

// ── A state ─────────────────────────────────────────────────────────────────

/** A state: its head, its roles and its kind's form — or own Details — Duplicate and Delete, and its transitions. */
function StateView(props: RowViewProps) {
    const { at, styles, words, value, model, rows, held, act, reveal, storageKey } = props;
    const m = words.m;
    const side = useSide(props, "states", at, value.states.name);
    const { created } = side.state;
    const lanes = getSomeorUndefined(value.lanes);
    const keyed = created && side.writes;
    const specs = useMemo(() => Fields.specs(StateRolesForm, {
        key: keyed ? Fields.text({ label: m.inspectorField({ field: "key" }), help: m.inspectorKeyHelp() }) : Fields.readonly({ label: m.inspectorField({ field: "key" }) }),
        label: Fields.text({ label: m.inspectorField({ field: "label" }) }),
        lane: Fields.reference({ of: "lanes", label: lanes?.name ?? "" }),
    }, lanes === undefined ? ["lane"] : []), [m, keyed, lanes]);
    const options = useMemo(() => ({
        lanes: model.lanes.filter((lane) => lane.band === "lane").map((lane): FieldOption => ({ key: lane.key, label: lane.label })),
    }), [model.lanes]);
    const roles = rows.states.find((state) => stringEqual(state.key, at))?.roles;
    const stored = held.states.get(at)?.roles;
    const { bump, refused } = side;
    const onRole = useCallback((path: readonly string[], next: unknown) => {
        const field = path[0]!;
        if (stringEqual(field, "key")) typedKey(props, "states", at, next as string, bump);
        else if (stringEqual(field, "label")) {
            if (act("renameState", (holding) => renameState(holding, at, next as string)) === undefined) bump();
        } else if (act("moveStates", (holding) => moveStates(holding, [at], next as string)) === undefined) bump();
    }, [props, at, act, bump]);
    if (roles === undefined) return null;
    const transitions = stateGroups(props, at);
    const actions = !side.writes ? undefined : (
        <>
            <Action action="duplicate" words={words} onClick={() => {
                const copy = act("duplicateState", (holding) => duplicateState(holding, at));
                if (copy?.key !== undefined) reveal({ kind: "state", key: copy.key });
            }} />
            <Action action="delete" words={words} onClick={() => {
                if (act("deleteStates", (holding) => deleteStates(holding, [at])) !== undefined) reveal(null);
            }} />
        </>
    );
    const label = roles.label.length === 0 ? undefined : roles.label;
    return (
        <Box css={styles.root} data-flowchart-inspector="state">
            <Head styles={styles} words={words} what={m.inspectorWhat({ what: "row", kind: value.states.name, name: at })} name={label}
                chips={side.state.chip === undefined ? [] : [side.state.chip]} />
            <Edits styles={styles} available={side.available} actions={actions}>
                <RowFields styles={styles} side={side} storageKey={`${storageKey}.inspector.states`} roles={(
                    <Box data-inspector-form="roles">
                        <FieldForm key={refused} specs={specs} value={{ key: at, label: roles.label, lane: getSomeorUndefined(roles.lane) }}
                            baseline={created || stored === undefined ? NEW_ROW : { key: at, label: stored.label, lane: getSomeorUndefined(stored.lane) }}
                            options={options} onChange={side.writes ? onRole : NO_EDIT} readOnly={!side.writes} />
                    </Box>
                )} />
            </Edits>
            <Transitions styles={styles} reveal={reveal} groups={transitions.groups}
                title={m.inspectorSection({ section: "transitions", n: transitions.n, count: words.number(transitions.n), name: kindName(value, "transitions") })} />
        </Box>
    );
}

/** A key no state is keyed by — an unresolved end, its ghost: says so, with its transitions; Delete takes them away. */
function GhostView(props: RowViewProps) {
    const { at, styles, words, value, editing, act, reveal } = props;
    const m = words.m;
    const transitions = stateGroups(props, at);
    const writes = editing.editable("transitions");
    const actions = !writes ? undefined : (
        <Action action="delete" words={words} onClick={() => {
            if (act("deleteStates", (holding) => deleteStates(holding, [at])) !== undefined) reveal(null);
        }} />
    );
    const n = transitions.n;
    const lower = (sort: FlowchartSort) => kindName(value, sort).toLocaleLowerCase(words.locale);
    return (
        <Box css={styles.root} data-flowchart-inspector="ghost">
            <Head styles={styles} words={words} what={m.inspectorWhat({ what: "row", kind: value.states.name, name: at })} name={at} chips={["noRow"]} />
            <Fact styles={styles} fact="ghost">
                {m.inspectorNoRow({ n, count: words.number(n), key: at, state: lower("states"), transition: lower("transitions") })}
            </Fact>
            <Transitions styles={styles} reveal={reveal} groups={transitions.groups}
                title={m.inspectorSection({ section: "transitions", n, count: words.number(n), name: kindName(value, "transitions") })} />
            {actions !== undefined && <Edits styles={styles} available={editing.available("transitions")} actions={actions}>{null}</Edits>}
        </Box>
    );
}

// ── A transition ────────────────────────────────────────────────────────────

/** A transition: its head, its ends and its decision, its kind's form — or own Details — Delete, and its evidence. */
function LinkView(props: RowViewProps) {
    const { at, styles, words, value, model, rows, held, act, reveal, storageKey } = props;
    const m = words.m;
    const name = kindName(value, "transitions");
    const side = useSide(props, "transitions", at, name);
    const decisions = getSomeorUndefined(value.decisions);
    const decisionWords = useDecisionWords(words);
    const specs = useMemo(() => Fields.specs(TransitionRolesForm, {
        from: Fields.reference({ of: "states", label: m.inspectorField({ field: "from" }) }),
        to: Fields.reference({ of: "states", label: m.inspectorField({ field: "to" }) }),
        decision: Fields.reference({ of: "decisions", label: decisions?.name ?? "" }),
    }, decisions === undefined ? ["decision"] : []), [m, decisions]);
    // The states the canvas draws as themselves, and the decisions: a choice always holds its own value, shown as itself.
    const options = useMemo(() => ({
        states: model.nodes.filter((node) => !node.ghost && !node.dimmed)
            .map((node): FieldOption => ({ key: node.key, label: node.label === undefined ? node.key : m.inspectorChoice({ key: node.key, label: node.label }) })),
        decisions: [...model.triggers.values()].map((trigger): FieldOption => ({ key: trigger.key, label: trigger.label.length === 0 ? trigger.key : trigger.label })),
    }), [model, m]);
    const { bump, refused } = side;
    const onRole = useCallback((path: readonly string[], next: unknown) => {
        const field = path[0]!;
        const write = stringEqual(field, "from") ? { from: some(next as string), to: none, decision: none }
            : stringEqual(field, "to") ? { from: none, to: some(next as string), decision: none }
                : { from: none, to: none, decision: some(next as option<string>) };
        if (act("editLink", (holding) => editLink(holding, at, write)) === undefined) bump();
    }, [at, act, bump]);
    const transition = transitionAt(rows, at);
    if (transition === undefined) return null;
    const roles = transition.roles;
    const stored = held.transitions?.get(at)?.roles;
    const unresolved = [roles.from, roles.to].some((end) => model.nodesByKey.get(end)?.ghost !== false);
    const chips: Chip[] = [...(side.state.chip === undefined ? [] : [side.state.chip]), ...(unresolved ? ["unresolved" as const] : [])];
    const evidence = getSomeorUndefined(roles.evidence);
    const volume = evidence === undefined ? undefined : getSomeorUndefined(evidence.volume);
    const unit = evidence === undefined ? undefined : getSomeorUndefined(evidence.unit);
    const actions = !side.writes ? undefined : (
        <Action action="delete" words={words} onClick={() => {
            if (act("deleteLink", (holding) => deleteLink(holding, at)) !== undefined) reveal(null);
        }} />
    );
    return (
        <Box css={styles.root} data-flowchart-inspector="transition">
            <Head styles={styles} words={words} what={m.inspectorWhat({ what: "row", kind: name, name: endsOf(roles) })}
                name={`${stateName(model, roles.from)} → ${stateName(model, roles.to)}`} chips={chips} />
            <Edits styles={styles} available={side.available} actions={actions}>
                <RowFields styles={styles} side={side} storageKey={`${storageKey}.inspector.transitions`} roles={(
                    <Box data-inspector-form="roles">
                        <FieldForm key={refused} specs={specs} value={{ from: roles.from, to: roles.to, decision: roles.decision }}
                            baseline={side.state.created || stored === undefined ? NEW_ROW : { from: stored.from, to: stored.to, decision: stored.decision }}
                            options={options} onChange={side.writes ? onRole : NO_EDIT} readOnly={!side.writes} words={decisionWords} />
                    </Box>
                )} />
            </Edits>
            {evidence !== undefined && (
                <Box css={styles.section} data-inspector-evidence="">
                    <Box css={styles.sectionHead}>{m.inspectorSection({ section: "evidence", n: 0, count: "", name })}</Box>
                    <FieldForm specs={EVIDENCE_SPECS(m)} onChange={NO_EDIT} readOnly value={{
                        volume: volume === undefined ? none : some(unit === undefined ? words.number(volume) : `${words.number(volume)} ${unit}`),
                        count: evidence.count,
                        measured: evidence.measuredAt,
                    }} />
                </Box>
            )}
        </Box>
    );
}

/** The evidence's form, read only: its specs, made once for a message table. */
const evidenceSpecs = new WeakMap<FlowchartWords["m"], readonly FieldSpecValue[]>();

/**
 * The evidence's specs for a message table, made once.
 *
 * @param m - The message table
 * @returns The specs
 */
function EVIDENCE_SPECS(m: FlowchartWords["m"]): readonly FieldSpecValue[] {
    let specs = evidenceSpecs.get(m);
    if (specs === undefined) {
        specs = Fields.specs(EvidenceForm, {
            volume: Fields.readonly({ label: m.inspectorField({ field: "volume" }) }),
            count: Fields.readonly({ label: m.inspectorField({ field: "count" }) }),
            measured: Fields.readonly({ label: m.inspectorField({ field: "measured" }) }),
        });
        evidenceSpecs.set(m, specs);
    }
    return specs;
}

// ── A decision ──────────────────────────────────────────────────────────────

/** A decision: its head, its key and its kind's form — or own Details — Delete, and the transitions it governs. */
function DecisionView(props: RowViewProps) {
    const { at, styles, words, value, model, act, reveal, storageKey } = props;
    const m = words.m;
    const name = kindName(value, "decisions");
    const side = useSide(props, "decisions", at, name);
    const specs = useMemo(() => Fields.specs(DecisionKeyForm, { key: Fields.readonly({ label: m.inspectorField({ field: "key" }) }) }), [m]);
    const trigger = model.triggers.get(at);
    if (trigger === undefined) return null;
    const lines = linkLines(props, (roles) => roles.decision.type === "some" && stringEqual(roles.decision.value, at));
    const actions = !side.writes ? undefined : (
        <Action action="delete" words={words} onClick={() => {
            if (act("deleteDecision", (holding) => deleteDecision(holding, at)) !== undefined) reveal(null);
        }} />
    );
    return (
        <Box css={styles.root} data-flowchart-inspector="decision">
            <Head styles={styles} words={words} what={m.inspectorWhat({ what: "row", kind: name, name: trigger.letter })}
                name={trigger.label.length === 0 ? undefined : trigger.label} chips={side.state.chip === undefined ? [] : [side.state.chip]} />
            <Edits styles={styles} available={side.available} actions={actions}>
                <RowFields styles={styles} side={side} storageKey={`${storageKey}.inspector.decisions`} roles={(
                    <Box data-inspector-form="roles">
                        <FieldForm specs={specs} value={{ key: at }} onChange={NO_EDIT} readOnly />
                    </Box>
                )} />
            </Edits>
            <Transitions styles={styles} reveal={reveal} groups={[{ key: "governs", head: undefined, lines }]}
                title={m.inspectorSection({ section: "governs", n: lines.length, count: words.number(lines.length), name: kindName(value, "transitions") })} />
        </Box>
    );
}

// ── A lane ──────────────────────────────────────────────────────────────────

/** A lane: its head, its key and its label, its kind's form — or own Details — how many states it holds, and Delete. */
function LaneView(props: RowViewProps) {
    const { at, styles, words, value, model, rows, held, act, reveal, storageKey } = props;
    const m = words.m;
    const name = kindName(value, "lanes");
    const side = useSide(props, "lanes", at, name);
    const { created } = side.state;
    const keyed = created && side.writes;
    const specs = useMemo(() => Fields.specs(LaneRolesForm, {
        key: keyed ? Fields.text({ label: m.inspectorField({ field: "key" }), help: m.inspectorKeyHelp() }) : Fields.readonly({ label: m.inspectorField({ field: "key" }) }),
        label: Fields.text({ label: m.inspectorField({ field: "label" }) }),
    }), [m, keyed]);
    const { bump, refused } = side;
    const onRole = useCallback((path: readonly string[], next: unknown) => {
        if (stringEqual(path[0]!, "key")) typedKey(props, "lanes", at, next as string, bump);
        else if (act("renameLane", (holding) => renameLane(holding, at, next as string)) === undefined) bump();
    }, [props, at, act, bump]);
    const lane = rows.lanes?.find((row) => stringEqual(row.key, at));
    if (lane === undefined) return null;
    const stored = held.lanes?.get(at)?.roles;
    const holds = model.laneStates.get(at) ?? 0;
    const states = value.states.name.toLocaleLowerCase(words.locale);
    const actions = !side.writes ? undefined : (
        <>
            <Action action="delete" words={words} disabled={holds > 0} onClick={() => {
                if (act("deleteLane", (holding) => deleteLane(holding, at)) !== undefined) reveal(null);
            }} />
            {holds > 0 && <Box css={styles.why} data-inspector-why="">{m.laneHoldsStates({ n: holds, count: words.number(holds), name: states })}</Box>}
        </>
    );
    return (
        <Box css={styles.root} data-flowchart-inspector="lane">
            <Head styles={styles} words={words} what={m.inspectorWhat({ what: "row", kind: name, name: laneLabel(model, at) })} name={undefined}
                chips={side.state.chip === undefined ? [] : [side.state.chip]} />
            <Edits styles={styles} available={side.available} actions={actions}>
                <RowFields styles={styles} side={side} storageKey={`${storageKey}.inspector.lanes`} roles={(
                    <Box data-inspector-form="roles">
                        <FieldForm key={refused} specs={specs} value={{ key: at, label: lane.roles.label }}
                            baseline={created || stored === undefined ? NEW_ROW : { key: at, label: stored.label }}
                            onChange={side.writes ? onRole : NO_EDIT} readOnly={!side.writes} />
                    </Box>
                )} />
            </Edits>
            <Fact styles={styles} fact="lane">{m.inspectorLaneStates({ n: holds, count: words.number(holds), name: states })}</Fact>
        </Box>
    );
}

// ── Several states ──────────────────────────────────────────────────────────

/** Several states: how many; the lane every one moves to; and Delete. */
function SeveralView(props: ViewProps & { readonly picked: readonly string[] }) {
    const { picked, styles, words, value, model, editing, act, reveal } = props;
    const m = words.m;
    const lanes = getSomeorUndefined(value.lanes);
    const writes = editing.editable("states");
    const specs = useMemo(() => Fields.specs(MoveForm, {
        lane: Fields.reference({ of: "lanes", label: m.inspectorField({ field: "moveTo", name: (lanes?.name ?? "").toLocaleLowerCase(words.locale) }) }),
    }), [m, lanes, words.locale]);
    const options = useMemo(() => ({
        lanes: model.lanes.filter((lane) => lane.band === "lane").map((lane): FieldOption => ({ key: lane.key, label: lane.label })),
    }), [model.lanes]);
    const [refused, bump] = useRefused();
    const onChange = useCallback((_path: readonly string[], next: unknown) => {
        if (act("moveStates", (holding) => moveStates(holding, picked, next as string)) === undefined) bump();
    }, [act, picked, bump]);
    // The lane they share, when they do.
    const held = picked.map((key) => model.nodesByKey.get(key)?.lane);
    const first = held[0];
    const shared = first !== undefined && held.every((lane) => lane !== undefined && stringEqual(lane, first)) ? first : undefined;
    const n = picked.length;
    const actions = !writes ? undefined : (
        <Action action="delete" words={words} onClick={() => {
            if (act("deleteStates", (holding) => deleteStates(holding, picked)) !== undefined) reveal(null);
        }} />
    );
    return (
        <Box css={styles.root} data-flowchart-inspector="several">
            <Box css={styles.head} {...FOCUS_HOME_PROPS}>
                <Box css={styles.summary} data-inspector-several="">
                    {m.inspectorWhat({ what: "several", n, count: words.number(n), name: value.states.name.toLocaleLowerCase(words.locale) })}
                </Box>
            </Box>
            {(lanes !== undefined || actions !== undefined) && (
                <Edits styles={styles} available={writes && editing.available("states")} actions={actions}>
                    {lanes !== undefined && (
                        <Box css={styles.bulk} data-inspector-fields="move">
                            <FieldForm key={refused} specs={specs} value={{ lane: shared }} options={options}
                                onChange={writes ? onChange : NO_EDIT} readOnly={!writes} />
                        </Box>
                    )}
                </Edits>
            )}
        </Box>
    );
}

// ── Nothing selected: the flowchart ─────────────────────────────────────────

/** Nothing selected: the flowchart's counts, its transitions' split, each record's last save with who made it, and its hints. */
function FlowchartView({ styles, words, value, model, saves, editing }: ViewProps) {
    const m = words.m;
    // In a phone's pane, the hint is a tap's: no several selected or renamed in place there.
    const touch = useContext(FrameDrawer);
    const counts = model.counts;
    const stats = [
        ...(value.lanes.type === "some" ? [{ key: "lanes", name: value.lanes.value.name, n: counts.lanes }] : []),
        { key: "states", name: value.states.name, n: counts.states },
        ...(value.transitions.type === "some" ? [{ key: "transitions", name: value.transitions.value.name, n: counts.transitions }] : []),
        ...(value.decisions.type === "some" ? [{ key: "decisions", name: value.decisions.value.name, n: counts.decisions }] : []),
    ];
    const hints = editing.edits ? [1, 2, 3] as const : [1, 2] as const;
    return (
        <Box css={styles.root} data-flowchart-inspector="flowchart">
            <Box css={styles.head} {...FOCUS_HOME_PROPS}>
                <Box css={styles.eyebrow} data-inspector-what="">{m.inspectorWhat({ what: "flowchart" })}</Box>
            </Box>
            <Box css={styles.stats} data-inspector-counts="">
                {stats.map((stat) => (
                    <Box key={stat.key} css={styles.stat} data-count={stat.key}>
                        <Box as="span" css={styles.statValue}>{words.number(stat.n)}</Box>
                        <Box as="span" css={styles.statLabel}>{m.inspectorCount({ name: stat.name, n: stat.n })}</Box>
                    </Box>
                ))}
            </Box>
            {value.transitions.type === "some" && (
                <Fact styles={styles} fact="split">
                    {m.inspectorSplit({ planned: words.number(counts.planned), observed: words.number(counts.observed), unresolved: words.number(counts.unresolved) })}
                </Fact>
            )}
            {saves.records.length > 0 && (
                <Box css={styles.section}>
                    {saves.records.map((save) => (
                        <Box key={save.sort} css={styles.fact} data-inspector-saved={save.sort}>{m.inspectorSaved({ name: save.name, when: save.when, by: save.by })}</Box>
                    ))}
                </Box>
            )}
            <Box as="ul" css={styles.hints}>
                {touch ? <Box as="li" css={styles.hint}>{m.inspectorHintTouch()}</Box>
                    : hints.map((n) => <Box as="li" key={n} css={styles.hint}>{m.inspectorHint({ n, edits: editing.edits })}</Box>)}
            </Box>
        </Box>
    );
}

// ============================================================================
// Issues (R16)
// ============================================================================

/**
 * The Issues tab: every issue of the Flowchart and of its unsaved changes, each a control that selects what it names and
 * brings it into view. An issue of a change the narrowing hides says on a line of its own which of the rail's choices
 * hide its row, asked of e3 through its source's hidden pick, and Go to issue on it is the frame's hidden pick
 * (`goToWaiting`): those choices cleared, then selected once it is drawn.
 */
const FlowchartInspectorIssues = memo(function FlowchartInspectorIssues({ issues, value, picks, reveal, goToWaiting, words }: FlowchartInspectorProps) {
    const styles = useSlotRecipe({ key: "flowchartInspector" })() as Styles;
    const m = words.m;
    // Each issue's rows of the rail's sources whose narrowing hides what it names: each source's hidden pick, and the row.
    const hidingsOf = (issue: FlowchartIssue): RowHiding[] => issue.hiding.flatMap((hiding) => {
        const pick = picks.get(hiding.sort);
        return pick === undefined ? [] : [{ pick, id: hiding.key }];
    });
    const hidings = issues.flatMap(hidingsOf);
    // The narrowing hides each, as the Flowchart knows: each says so at once while e3 is asked which choices do — asked
    // once at its record's revision and its narrowing, so a render that moves neither asks nothing. Asked after every
    // render: the revision and the narrowing land in renders of their own.
    useEffect(() => {
        if (hidings.length > 0) askHiding(hidings, true);
    });
    // What hides an issue's row, as far as e3 has said: `undefined` for any other issue, and for one nothing hides.
    const hiddenOfIssue = (issue: FlowchartIssue): readonly RowHidden[] | undefined => {
        const of = hidingsOf(issue);
        return of.length === 0 ? undefined : hiddenOf(of);
    };
    // Go to issue: what it names selected and brought into view — a change the narrowing hides through the frame's hidden
    // pick, the choices hiding it cleared first.
    const goTo = (issue: FlowchartIssue) => {
        if (issue.at !== null && issue.hiding.length > 0) goToWaiting(issue.at, hiddenOfIssue(issue));
        else reveal(issue.at);
    };
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
            {issues.map((issue, i) => {
                const hiddenBy = hiddenOfIssue(issue);
                const hidden = hiddenBy === undefined ? undefined : hiddenLine(hiddenBy, words, m);
                const sort = issue.where.sort;
                return (
                    <Box as="li" key={i}>
                        <chakra.button type="button" css={styles.issueItem} data-inspector-issue={issue.word.issue} onClick={() => goTo(issue)}>
                            <Box as="span" css={styles.issueWhere}>{m.issueWhere({ kind: sort === undefined ? undefined : kindName(value, sort), name: issue.where.name })}</Box>
                            <Box as="span" css={styles.issueMessage} data-kind={issue.blocking ? "invalid" : "warning"}>{m.issueText(issue.word)}</Box>
                            {hidden !== undefined && <Box as="span" css={styles.issueHidden} data-inspector-issue-hidden="">{hidden}</Box>}
                        </chakra.button>
                    </Box>
                );
            })}
        </Box>
    );
});

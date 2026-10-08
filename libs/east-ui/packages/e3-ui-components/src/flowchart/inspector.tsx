/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The inspector pane (#1250, `Flowchart Builder Spec.md` §5.3, §8, §9.9,
 * FB35–FB38, FB44, FB45): the Flowchart's end pane — on by default, as the
 * user ruled on 2026-10-08, unless `inspector={false}` — its tabs Details and
 * Issues, Issues with its count; collapsed, a rail with its icon, the issue
 * count and what is selected.
 *
 * Details shows §5.3's view of what is selected, every field through the
 * shared `FieldForm` — the shared input each field's East type takes, by
 * `Fields` over the Flowchart's own types — its head naming what it shows
 * (`STATE · SRT`) with a Pending or New chip while the drafts hold it
 * otherwise than the record:
 *
 * - **a state**: its key — a new key rekeying its transitions' ends and the
 *   decisions' queues — label, lane (a select over the flow's lanes), members
 *   (a number, Set and Clear) and notes; its transitions in and out, each a
 *   link that selects it; Duplicate and Delete. A key no row stands for —
 *   an unresolved transition's end — says so, with its transitions;
 * - **a transition**: its ends (selects over the flow's states), its kind
 *   (Planned · Observed), its decision (a select over the flow's decisions,
 *   and none) and its key; its evidence read only — volume and unit, count,
 *   when measured; Delete;
 * - **a decision**: its key, label, letter, owner, queue (tags over the
 *   flow's states) and outcomes; the transitions it governs, each a link;
 *   Delete, which clears it from them;
 * - **a lane**, which a click on its header selects: its key — a new key
 *   moving its states with it — and its label; how many states it holds;
 *   Delete, off while it holds any, saying why;
 * - **several states**: how many; a lane every one moves to; Delete;
 * - **nothing**: the open flow — over many flows its name (a new name renames
 *   it, one transaction) and its description, Duplicate and Delete; over one,
 *   its description — its counts, over a record its last save and who made
 *   it, and three hints. A flow its drafts delete says so.
 *
 * Every edit is one transaction of the open flow's session, made by the
 * frame's `edit`; a field the drafts changed is tinted against the record. A
 * key or a name left empty, or a name the flowchart holds, is refused — the
 * footer saying why — and the field shows what it held. Read only (FB38) —
 * over the host's data without `onApply`, or with `readOnly` — Details shows
 * every field and edits none; while the session takes no edit (a Save in
 * flight, drafts out of date) its controls are off. A state's or a
 * transition's own Details, the author's (FB45), show in place of its form:
 * the row as bytes, and its `update`, the edited row back as one transaction.
 *
 * Issues (FB37) lists the open flow's issues — two of one key, which holds
 * Save off; a state naming a missing lane; a transition naming a missing
 * state; a decision's queue naming one; a Save's conflict or refusal — each
 * a control that selects what it names and brings it into view.
 *
 * Styles are the `flowchartInspector` recipe's, the form's `fieldForm`'s and
 * the buttons the shared `button`'s; the pane — its tab row, its collapse
 * control and its rail — is the Dock's.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import { Box, chakra, useRecipe, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import {
    DateTimeType, IntegerType, OptionType, StringType, StructType, decodeBeast2For, encodeBeast2For, equalFor, none, some, variant,
    type ValueTypeOf, type option,
} from "@elaraai/east";
import { Fields, type FieldSpecValue } from "@elaraai/east-ui/internal";
import { Flowchart, type FlowchartInspectorType, type flowchartKeys } from "@elaraai/e3-ui/internal";
import {
    EastChakraComponent, EmptyStateView, FieldForm, fieldFormMessages, getSomeorUndefined, useDataStable,
    type BuilderFrameDock, type FieldFormWords, type FieldOption,
} from "@elaraai/east-ui-components";
import {
    deleteDecision, deleteLane, deleteLink, deleteState, deleteStates, describeFlow, duplicateState, laneStates, linkKeyOf, linkRow, moveStates,
    setDecisionRow, setLaneRow, setLinkRow, setStateRow, stateRow, type FlowchartEdit,
} from "./edits.js";
import type { FlowchartLastSave } from "./footer.js";
import type { FlowchartIssue } from "./issues.js";
import type { FlowchartInspectWord, FlowchartRefusedWord, FlowchartWords } from "./messages.js";
import type { FlowchartFlowValue, FlowchartLinkValue, FlowchartModel, FlowchartStateValue, FlowchartTriggerValue } from "./model.js";
import type { FlowchartSelection } from "./selection.js";

type Styles = Record<string, SystemStyleObject>;
/** The names a flowchart keeps its viewer's state under. */
type FlowchartKeys = ReturnType<typeof flowchartKeys>;
/** The inspector pane on the wire, decoded: each kind's own Details. */
export type FlowchartInspectorValue = ValueTypeOf<typeof FlowchartInspectorType>;
/** An author's own Details, decoded: the row as bytes and its writer, to UI. */
type OwnDetails = Extract<FlowchartInspectorValue["state"], { type: "some" }>["value"];

/** The inspector open: the design system's 320px (§8), as the Sheet's and the Plan's are. */
const INSPECTOR_SIZE = "320px";

const keyEqual = equalFor(StringType);
const flowEqual = equalFor(Flowchart.Types.Flow);
const stateEqual = equalFor(Flowchart.Types.State);
const linkEqual = equalFor(Flowchart.Types.Link);
const triggerEqual = equalFor(Flowchart.Types.Trigger);
const laneEqual = equalFor(Flowchart.Types.Lane);
const encodeState = encodeBeast2For(Flowchart.Types.State);
const decodeState = decodeBeast2For(Flowchart.Types.State);
const encodeLink = encodeBeast2For(Flowchart.Types.Link);
const decodeLink = decodeBeast2For(Flowchart.Types.Link);

/** A transition as its form edits it: its ends, its kind — planned when it names none — its decision and its own key. */
const LinkFormType = StructType({
    from: StringType,
    to: StringType,
    kind: Flowchart.Types.Kind,
    trigger: OptionType(StringType),
    key: OptionType(StringType),
});
/** A transition's evidence as its form prints it: the volume with its unit, the count, and when it was measured. */
const EvidenceFormType = StructType({
    volume: OptionType(StringType),
    count: OptionType(IntegerType),
    measured: OptionType(DateTimeType),
});
/** The open flow as its form edits it: its name, and its description. */
const FlowFormType = StructType({ name: StringType, description: OptionType(StringType) });
/** Several states as the form moves them: the lane each goes to. */
const MoveFormType = StructType({ lane: StringType });

/** A form that takes no edit: read only. */
const NO_EDIT = (): void => {};
/** What a new row's form is tinted against: nothing — every field it has is a change. */
const NEW_ROW: Readonly<Record<string, unknown>> = {};

/** The edits Details makes (#1250), each one transaction of the open flow's session, through the frame. */
export interface FlowchartInspectorEdit {
    /** The open flow as its session holds it now — never a render's copy. */
    readonly now: () => FlowchartFlowValue | undefined;
    /** Records the flow an edit leaves, as one transaction; whether it was recorded. */
    readonly record: (flow: FlowchartFlowValue, edit: FlowchartEdit) => boolean;
    /** Renames the open flow — refused, the footer saying why, for an empty name or one the flowchart holds; whether it was recorded. */
    readonly rename: (name: string) => boolean;
    /** Duplicates the open flow into a new flow, which opens. */
    readonly duplicate: () => void;
    /** Deletes the open flow. */
    readonly remove: () => void;
    /** Says why an edit was refused, in the footer. */
    readonly refuse: (why: FlowchartRefusedWord) => void;
}

/** What the inspector reads of the flowchart. */
export interface FlowchartInspectorProps {
    /** The payload's inspector pane: each kind's own Details. */
    readonly pane: FlowchartInspectorValue;
    /** The open flow, as its drafts stand; `undefined` while no flow is open, or its drafts delete it. */
    readonly flow: FlowchartFlowValue | undefined;
    /** The open flow as its source holds it — what a field the drafts changed is tinted against; `undefined` for a new flow. */
    readonly held: FlowchartFlowValue | undefined;
    /** The open flow's view model: its ghosts, its decisions' letters, its transitions' split. */
    readonly model: FlowchartModel;
    /** The name the open flow's drafts give it, over many flows; `undefined` over one. */
    readonly name: string | undefined;
    /** The name its source holds it under; `undefined` for a new flow, or over one. */
    readonly heldName: string | undefined;
    /** Whether the open flow's drafts delete it. */
    readonly deleted: boolean;
    /** What is selected, as the open flow holds it. */
    readonly selection: FlowchartSelection | null;
    /** Selects something, or nothing — a transition in a state's Details, an issue's row — bringing it into view unless `scroll` is `false`. */
    readonly reveal: (selection: FlowchartSelection | null, scroll?: boolean) => void;
    /** The open flow's issues, and its Save's. */
    readonly issues: readonly FlowchartIssue[];
    /** The edits Details makes; `undefined` where the flowchart edits nothing — read only (FB38). */
    readonly edit: FlowchartInspectorEdit | undefined;
    /** Whether the open flow's session takes an edit now: off while a Save is in flight, or its drafts are out of date. */
    readonly available: boolean;
    /** Whether the flows are a record's: its last save is said. */
    readonly record: boolean;
    /** The record's last save, when it has one. */
    readonly saved: FlowchartLastSave | undefined;
    /** The names the flowchart keeps its state under. */
    readonly keys: FlowchartKeys;
    /** The flowchart's words. */
    readonly words: FlowchartWords;
}

/**
 * What a selection is, as the inspector names it — in its head, on its rail
 * and where an issue is.
 *
 * @param selection - What is selected
 * @param flow - The open flow
 * @param model - Its view model: its decisions' letters, its lanes' labels
 * @param words - The flowchart's words
 * @returns What it is, in words
 */
function whatOf(selection: FlowchartSelection, flow: FlowchartFlowValue, model: FlowchartModel, words: FlowchartWords): FlowchartInspectWord {
    switch (selection.kind) {
        case "state": return { what: "state", key: selection.key };
        case "states": return { what: "states", n: selection.keys.length, count: words.number(selection.keys.length) };
        case "link": {
            const at = linkRow(flow, selection.key);
            return { what: "transition", from: at?.link.from ?? selection.key, to: at?.link.to ?? selection.key };
        }
        case "trigger": return { what: "decision", letter: model.triggers.get(selection.key)?.letter ?? selection.key };
        case "lane": {
            const lane = flow.lanes.find((l) => keyEqual(l.key, selection.key));
            return { what: "lane", label: (lane === undefined ? undefined : getSomeorUndefined(lane.label)) ?? selection.key };
        }
    }
}

/**
 * The inspector pane, as `BuilderFrame` draws it — see the module docs.
 *
 * @param props - The pane, the open flow as its drafts and its source hold it, what is selected, the issues, the edits and the words
 * @returns The pane: its tabs Details and Issues, 320px wide, its collapsed state kept per viewer
 */
export function inspectorPane(props: FlowchartInspectorProps): BuilderFrameDock {
    const { words, issues, selection, flow, model } = props;
    const m = words.m;
    const n = issues.length;
    return {
        label: m.inspectorPane(),
        icon: "sliders",
        size: INSPECTOR_SIZE,
        persist: "local",
        // Collapsed, the rail counts the issues (FB35) and names what is selected.
        badge: n > 0 ? words.number(n) : undefined,
        detail: selection === null || flow === undefined ? undefined : m.inspectorWhat(whatOf(selection, flow, model, words)),
        tabs: [
            { key: "details", label: m.inspectorTab({ tab: "details" }), body: <FlowchartInspectorDetails {...props} /> },
            { key: "issues", label: m.inspectorTab({ tab: "issues" }), count: words.number(n), body: <FlowchartInspectorIssues {...props} /> },
        ],
    };
}

// ============================================================================
// The shared parts
// ============================================================================

/** A view's head: what it shows, its name under that, and its chip. */
function Head({ styles, what, name, chip, words }: {
    styles: Styles; what: string; name: string | undefined; chip: "pending" | "new" | "deleted" | "noRow" | undefined; words: FlowchartWords;
}) {
    return (
        <Box css={styles.head}>
            <Box css={styles.eyebrow} data-inspector-what="">{what}</Box>
            {name !== undefined && <Box css={styles.name} data-inspector-name="">{name}</Box>}
            <Box css={styles.marks}>
                {chip !== undefined && <Box as="span" css={styles.chip} data-inspector-chip="" data-state={chip}>{words.m.inspectorChip({ state: chip })}</Box>}
            </Box>
        </Box>
    );
}

/** A row's chip: New while the record holds none of it, Pending while the drafts hold it otherwise. */
function chipOf<R>(row: R, was: R | undefined, equal: (a: R, b: R) => boolean): "pending" | "new" | undefined {
    if (was === undefined) return "new";
    return equal(was, row) ? undefined : "pending";
}

/**
 * The record's row a drafted one began as — what its form is tinted against:
 * the record's row of its key, the last as the canvas draws it; or, its key
 * drafted anew, the record's row at its place, whose key the drafts no longer
 * hold.
 *
 * @param held - The record's rows of the kind; `undefined` for a new flow
 * @param drafted - The drafts' rows of the kind
 * @param keyOf - A row's key, by its place: a transition's the one it goes by
 * @param at - The drafted row's key
 * @returns The row it began as, or `undefined` for a row the record holds none of
 */
function heldRow<R>(held: readonly R[] | undefined, drafted: readonly R[], keyOf: (row: R, index: number) => string, at: string): R | undefined {
    if (held === undefined) return undefined;
    let found: R | undefined;
    held.forEach((row, i) => { if (keyEqual(keyOf(row, i), at)) found = row; });
    if (found !== undefined) return found;
    let index = -1;
    drafted.forEach((row, i) => { if (keyEqual(keyOf(row, i), at)) index = i; });
    const there = index < 0 ? undefined : held[index];
    if (there === undefined) return undefined;
    const thereKey = keyOf(there, index);
    return drafted.some((row, i) => keyEqual(keyOf(row, i), thereKey)) ? undefined : there;
}

/** The transitions a list shows, each its key, its ends, and its kind in words. */
interface LinkLine {
    readonly key: string;
    readonly from: string;
    readonly to: string;
    readonly meta: string;
}

/**
 * Transitions as a list shows them: each its ends, and under them its kind —
 * unresolved where an end has no state — and its decision.
 *
 * @param flow - The open flow
 * @param pick - Which of its transitions
 * @param words - The flowchart's words
 * @returns The lines, in the flow's order
 */
function linkLines(flow: FlowchartFlowValue, pick: (link: FlowchartLinkValue) => boolean, words: FlowchartWords): LinkLine[] {
    const hasState = (key: string): boolean => flow.states.some((s) => keyEqual(s.key, key));
    return flow.links.flatMap((link, i): LinkLine[] => {
        if (!pick(link)) return [];
        const kind = !hasState(link.from) || !hasState(link.to) ? "unresolved" : getSomeorUndefined(link.kind)?.type ?? "planned";
        return [{ key: linkKeyOf(link, i), from: link.from, to: link.to, meta: words.m.inspectorLinkKind({ kind, decision: getSomeorUndefined(link.trigger) }) }];
    });
}

/** A list of transitions under its head, each a control that selects it and brings it into view. */
function Links({ styles, title, lines, reveal }: { styles: Styles; title: string; lines: readonly LinkLine[]; reveal: FlowchartInspectorProps["reveal"] }) {
    if (lines.length === 0) return null;
    return (
        <Box css={styles.section} data-inspector-links="">
            <Box css={styles.sectionHead}>{title}</Box>
            <Box as="ul" css={styles.links}>
                {lines.map((line) => (
                    <Box as="li" key={line.key}>
                        <chakra.button type="button" css={styles.link} data-inspector-link={line.key} onClick={() => reveal({ kind: "link", key: line.key })}>
                            <Box as="span" css={styles.linkText}>{`${line.from} → ${line.to}`}</Box>
                            <Box as="span" css={styles.linkMeta}>{line.meta}</Box>
                        </chakra.button>
                    </Box>
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

/**
 * A view's edits: its form — or the author's own Details — and its gestures,
 * in one fieldset, off while the session takes no edit. Read only, there are
 * no gestures.
 */
function Edits({ styles, available, children, actions }: { styles: Styles; available: boolean; children: ReactNode; actions: ReactNode | undefined }) {
    return (
        <chakra.fieldset css={styles.edits} disabled={!available} data-inspector-edits="">
            {children}
            {actions !== undefined && <Box css={styles.actions} data-inspector-actions="">{actions}</Box>}
        </chakra.fieldset>
    );
}

/**
 * A view's form, remounted after a refused edit so its input shows what the
 * row holds again — or, read only, every field printed.
 */
function Form({ styles, specs, value, baseline, options, onChange, readOnly, words, refused }: {
    styles: Styles; specs: readonly FieldSpecValue[]; value: unknown; baseline: unknown;
    options?: Readonly<Record<string, readonly FieldOption[]>> | undefined;
    onChange: (path: readonly string[], value: unknown) => void; readOnly: boolean; words: FieldFormWords; refused: number;
}) {
    return (
        <Box css={styles.fields} data-inspector-fields="form">
            <FieldForm key={refused} specs={specs} value={value} baseline={baseline} options={options} onChange={onChange} readOnly={readOnly} words={words} />
        </Box>
    );
}

/**
 * An author's own Details for a row (FB45): what their function returns for
 * the row, its `update` writing the edited row back — or, where it fails,
 * nothing, and the form shows.
 *
 * @param author - The author's function, decoded; `undefined` for none
 * @param bytes - The row, encoded
 * @param update - The writer of the edited row's bytes
 * @param kind - What the row is, for the console
 * @returns The UI it returns, or `undefined`
 */
function useOwnDetails(author: OwnDetails | undefined, bytes: Uint8Array | undefined, update: (edited: Uint8Array) => null, kind: string) {
    return useMemo(() => {
        if (author === undefined || bytes === undefined) return undefined;
        try {
            return author(bytes, update);
        } catch (err) {
            console.error(`[Flowchart] the ${kind}'s own Details failed; its form shows instead:`, err);
            return undefined;
        }
    }, [author, bytes, update, kind]);
}

/** The form's words: the field form's, its reference with no key a transition's decision's none. */
function useFormWords(words: FlowchartWords): FieldFormWords {
    return useMemo(() => ({ ...words, m: { ...fieldFormMessages, unassigned: words.m.noDecision } }), [words]);
}

/** A remount counter for a form whose edit was refused: its input shows what the row holds again. */
function useRefused(): [number, () => void] {
    const [refused, setRefused] = useState(0);
    const bump = useCallback(() => setRefused((n) => n + 1), []);
    return [refused, bump];
}

/** Every view's props: the inspector's, and the recipe's styles. */
interface ViewProps extends FlowchartInspectorProps {
    readonly styles: Styles;
}

// ============================================================================
// Details
// ============================================================================

/** The Details tab: what is selected — a state, a transition, a decision, a lane, several states — or the open flow. */
const FlowchartInspectorDetails = memo(function FlowchartInspectorDetails(props: FlowchartInspectorProps) {
    const styles = useSlotRecipe({ key: "flowchartInspector" })() as Styles;
    const { flow, selection, deleted } = props;
    if (flow === undefined) {
        return deleted ? <DeletedFlow {...props} styles={styles} /> : <NoFlow {...props} styles={styles} />;
    }
    const view = { ...props, styles };
    // Each selection its own view: what was typed for one never lands on the next.
    if (selection === null) return <FlowView key="flow" {...view} flow={flow} />;
    switch (selection.kind) {
        case "state": return <StateView key={`state:${selection.key}`} {...view} flow={flow} at={selection.key} />;
        case "link": return <LinkView key={`link:${selection.key}`} {...view} flow={flow} at={selection.key} />;
        case "trigger": return <DecisionView key={`trigger:${selection.key}`} {...view} flow={flow} at={selection.key} />;
        case "lane": return <LaneView key={`lane:${selection.key}`} {...view} flow={flow} at={selection.key} />;
        case "states": return <SeveralView key="states" {...view} flow={flow} picked={selection.keys} />;
    }
});

/** A row's view: the open flow, and the key of what it shows. */
interface RowProps extends ViewProps {
    readonly flow: FlowchartFlowValue;
    readonly at: string;
}

// ── A state ─────────────────────────────────────────────────────────────────

/** A state: its head, its fields — or its author's own Details — its transitions, Duplicate and Delete. */
function StateView(props: RowProps) {
    const { flow, held, at, styles, words, edit, available, pane, keys, reveal } = props;
    const m = words.m;
    const formWords = useFormWords(words);
    const [refused, refuse] = useRefused();
    const state = stateRow(flow, at);
    const was = heldRow(held?.states, flow.states, (s) => s.key, at);
    const specs = useMemo(() => Fields.specs(Flowchart.Types.State, {
        key: Fields.text({ label: m.inspectorField({ field: "key" }), help: m.inspectorHelp({ help: "stateKey" }) }),
        label: Fields.text({ label: m.inspectorField({ field: "label" }) }),
        lane: Fields.reference({ of: "lanes", label: m.inspectorField({ field: "lane" }) }),
        members: Fields.number<bigint>({ label: m.inspectorField({ field: "members" }), min: 1n }),
        notes: Fields.text({ label: m.inspectorField({ field: "notes" }) }),
    }), [m]);
    const options = useMemo(() => ({
        lanes: flow.lanes.map((l): FieldOption => ({ key: l.key, label: getSomeorUndefined(l.label) ?? l.key })),
    }), [flow.lanes]);
    // A state as the edit leaves it, recorded over the state as the session holds it now: its new key, followed.
    const write = useCallback((next: FlowchartStateValue): void => {
        const now = edit?.now();
        if (edit === undefined || now === undefined || stateRow(now, at) === undefined) return;
        if (keyEqual(next.key.trim(), "")) {
            edit.refuse({ why: "emptyKey", what: "state" });
            refuse();
            return;
        }
        const keyed = { ...next, key: next.key.trim() };
        if (edit.record(setStateRow(now, at, keyed), "editState") && !keyEqual(keyed.key, at)) reveal({ kind: "state", key: keyed.key }, false);
    }, [edit, at, refuse, reveal]);
    const onChange = useCallback((path: readonly string[], value: unknown) => {
        const now = edit?.now();
        const current = now === undefined ? undefined : stateRow(now, at);
        if (current === undefined) return;
        write({ ...current, [path[0]!]: value } as FlowchartStateValue);
    }, [edit, at, write]);
    // The author's own Details (FB45): the state as bytes, held by its data; its update, the edited state back.
    const stable = useDataStable(state, (a, b) => (a === undefined || b === undefined ? a === undefined && b === undefined : stateEqual(a, b)));
    const bytes = useMemo(() => (stable === undefined ? undefined : encodeState(stable)), [stable]);
    const update = useCallback((edited: Uint8Array): null => { write(decodeState(edited)); return null; }, [write]);
    const own = useOwnDetails(getSomeorUndefined(pane.state), bytes, update, "state");

    if (state === undefined) return <GhostView {...props} />;
    const lines = linkLines(flow, (l) => keyEqual(l.from, at) || keyEqual(l.to, at), words);
    const actions = edit === undefined ? undefined : (
        <>
            <Action action="duplicate" words={words} onClick={() => {
                const now = edit.now();
                const copy = now === undefined ? undefined : duplicateState(now, at);
                if (copy !== undefined && edit.record(copy.flow, "duplicateState")) reveal({ kind: "state", key: copy.key });
            }} />
            <Action action="delete" words={words} onClick={() => {
                const now = edit.now();
                if (now !== undefined && edit.record(deleteState(now, at), "deleteState")) reveal(null);
            }} />
        </>
    );
    return (
        <Box css={styles.root} data-flowchart-inspector="state">
            <Head styles={styles} words={words} what={m.inspectorWhat({ what: "state", key: state.key })} name={getSomeorUndefined(state.label)}
                chip={chipOf(state, was, stateEqual)} />
            <Edits styles={styles} available={available} actions={actions}>
                {own !== undefined ? (
                    <Box css={styles.custom} data-inspector-fields="custom">
                        <EastChakraComponent value={own} storageKey={`${keys.frame}.inspector.state`} />
                    </Box>
                ) : (
                    <Form styles={styles} specs={specs} value={state} baseline={was ?? NEW_ROW} options={options} words={formWords}
                        onChange={edit === undefined ? NO_EDIT : onChange} readOnly={edit === undefined} refused={refused} />
                )}
            </Edits>
            <Links styles={styles} reveal={reveal} lines={lines} title={m.inspectorSection({ section: "transitions", n: lines.length, count: words.number(lines.length) })} />
        </Box>
    );
}

/** A state no row stands for — an unresolved transition's end: says so, with its transitions, and Delete takes them away. */
function GhostView({ flow, at, styles, words, edit, available, reveal }: RowProps) {
    const m = words.m;
    const lines = linkLines(flow, (l) => keyEqual(l.from, at) || keyEqual(l.to, at), words);
    const actions = edit === undefined ? undefined : (
        <Action action="delete" words={words} onClick={() => {
            const now = edit.now();
            if (now !== undefined && edit.record(deleteState(now, at), "deleteState")) reveal(null);
        }} />
    );
    return (
        <Box css={styles.root} data-flowchart-inspector="ghost">
            <Head styles={styles} words={words} what={m.inspectorWhat({ what: "state", key: at })} name={undefined} chip="noRow" />
            <Box css={styles.section}>
                <Box css={styles.fact} data-inspector-fact="ghost">{m.inspectorNoRow({ n: lines.length, count: words.number(lines.length) })}</Box>
            </Box>
            <Links styles={styles} reveal={reveal} lines={lines} title={m.inspectorSection({ section: "transitions", n: lines.length, count: words.number(lines.length) })} />
            {actions !== undefined && <Edits styles={styles} available={available} actions={actions}>{null}</Edits>}
        </Box>
    );
}

// ── A transition ────────────────────────────────────────────────────────────

/** A transition as its form edits it. */
function linkForm(link: FlowchartLinkValue): ValueTypeOf<typeof LinkFormType> {
    return { from: link.from, to: link.to, kind: getSomeorUndefined(link.kind) ?? variant("planned", null), trigger: link.trigger, key: link.key };
}

/** A transition: its head, its fields — or its author's own Details — its evidence read only, and Delete. */
function LinkView({ flow, held, at, styles, words, edit, available, pane, keys, reveal }: RowProps) {
    const m = words.m;
    const formWords = useFormWords(words);
    const found = linkRow(flow, at);
    const was = heldRow(held?.links, flow.links, linkKeyOf, at);
    const specs = useMemo(() => Fields.specs(LinkFormType, {
        from: Fields.reference({ of: "states", label: m.inspectorField({ field: "from" }) }),
        to: Fields.reference({ of: "states", label: m.inspectorField({ field: "to" }) }),
        kind: Fields.select<"planned" | "observed">({ label: m.inspectorField({ field: "kind" }), labels: { planned: m.kindLabel({ kind: "planned" }), observed: m.kindLabel({ kind: "observed" }) } }),
        trigger: Fields.reference({ of: "decisions", label: m.inspectorField({ field: "trigger" }) }),
        key: Fields.text({ label: m.inspectorField({ field: "key" }), help: m.inspectorHelp({ help: "linkKey" }) }),
    }), [m]);
    const evidenceSpecs = useMemo(() => Fields.specs(EvidenceFormType, {
        volume: Fields.readonly({ label: m.inspectorField({ field: "volume" }) }),
        count: Fields.readonly({ label: m.inspectorField({ field: "count" }) }),
        measured: Fields.readonly({ label: m.inspectorField({ field: "measured" }) }),
    }), [m]);
    const options = useMemo(() => {
        const seen = new Set<string>();
        const states = flow.states.flatMap((s): FieldOption[] => {
            if (seen.has(s.key)) return [];
            seen.add(s.key);
            const label = getSomeorUndefined(s.label);
            return [{ key: s.key, label: label === undefined ? s.key : `${s.key} · ${label}` }];
        });
        return { states, decisions: flow.triggers.map((t): FieldOption => ({ key: t.key, label: t.label })) };
    }, [flow.states, flow.triggers]);
    // A transition as the edit leaves it, recorded over it as the session holds it now: the key it goes by after, followed.
    const write = useCallback((next: FlowchartLinkValue): void => {
        const now = edit?.now();
        const before = now === undefined ? undefined : linkRow(now, at);
        if (edit === undefined || now === undefined || before === undefined) return;
        const own = getSomeorUndefined(next.key);
        const keyed = { ...next, key: own === undefined || keyEqual(own.trim(), "") ? none : some(own.trim()) };
        const after = linkKeyOf(keyed, before.index);
        if (edit.record(setLinkRow(now, at, keyed), "editTransition") && !keyEqual(after, at)) reveal({ kind: "link", key: after }, false);
    }, [edit, at, reveal]);
    const onChange = useCallback((path: readonly string[], value: unknown) => {
        const now = edit?.now();
        const current = now === undefined ? undefined : linkRow(now, at)?.link;
        if (current === undefined) return;
        const field = path[0]!;
        // The kind its form shows is never none: a pick of it is the transition's kind.
        write({ ...current, [field]: keyEqual(field, "kind") ? some(value) : value } as FlowchartLinkValue);
    }, [edit, at, write]);
    const stable = useDataStable(found?.link, (a, b) => (a === undefined || b === undefined ? a === undefined && b === undefined : linkEqual(a, b)));
    const bytes = useMemo(() => (stable === undefined ? undefined : encodeLink(stable)), [stable]);
    const update = useCallback((edited: Uint8Array): null => { write(decodeLink(edited)); return null; }, [write]);
    const own = useOwnDetails(getSomeorUndefined(pane.transition), bytes, update, "transition");

    if (found === undefined) return null;
    const link = found.link;
    const evidence = getSomeorUndefined(link.evidence);
    const evidenceValue = evidence === undefined ? undefined : (() => {
        const volume = getSomeorUndefined(evidence.volume);
        const unit = getSomeorUndefined(evidence.unit);
        return {
            volume: volume === undefined ? none : some(unit === undefined ? words.number(volume) : `${words.number(volume)} ${unit}`),
            count: evidence.count,
            measured: evidence.measuredAt,
        };
    })();
    const actions = edit === undefined ? undefined : (
        <Action action="delete" words={words} onClick={() => {
            const now = edit.now();
            if (now !== undefined && edit.record(deleteLink(now, at), "deleteLink")) reveal(null);
        }} />
    );
    const from = stateRow(flow, link.from);
    const to = stateRow(flow, link.to);
    const ends = `${(from === undefined ? undefined : getSomeorUndefined(from.label)) ?? link.from} → ${(to === undefined ? undefined : getSomeorUndefined(to.label)) ?? link.to}`;
    return (
        <Box css={styles.root} data-flowchart-inspector="transition">
            <Head styles={styles} words={words} what={m.inspectorWhat({ what: "transition", from: link.from, to: link.to })} name={ends}
                chip={chipOf(link, was, linkEqual)} />
            <Edits styles={styles} available={available} actions={actions}>
                {own !== undefined ? (
                    <Box css={styles.custom} data-inspector-fields="custom">
                        <EastChakraComponent value={own} storageKey={`${keys.frame}.inspector.transition`} />
                    </Box>
                ) : (
                    <>
                        {/* Never refused — an emptied key is the transition going by its ends — so never remounted. */}
                        <Form styles={styles} specs={specs} value={linkForm(link)} baseline={was === undefined ? NEW_ROW : linkForm(was)} options={options} words={formWords}
                            onChange={edit === undefined ? NO_EDIT : onChange} readOnly={edit === undefined} refused={0} />
                        {evidenceValue !== undefined && (
                            <Box css={styles.section} data-inspector-evidence="">
                                <Box css={styles.sectionHead}>{m.inspectorSection({ section: "evidence", n: 0, count: "" })}</Box>
                                <FieldForm specs={evidenceSpecs} value={evidenceValue} onChange={NO_EDIT} readOnly words={formWords} />
                            </Box>
                        )}
                    </>
                )}
            </Edits>
        </Box>
    );
}

// ── A decision ──────────────────────────────────────────────────────────────

/** A decision: its head, its fields, the transitions it governs, and Delete. */
function DecisionView({ flow, held, at, styles, words, edit, available, reveal, model }: RowProps) {
    const m = words.m;
    const formWords = useFormWords(words);
    const [refused, refuse] = useRefused();
    const trigger = flow.triggers.find((t) => keyEqual(t.key, at));
    const was = heldRow(held?.triggers, flow.triggers, (t) => t.key, at);
    const stateKeys = useMemo(() => [...new Set(flow.states.map((s) => s.key))], [flow.states]);
    const specs = useMemo(() => Fields.specs(Flowchart.Types.Trigger, {
        key: Fields.text({ label: m.inspectorField({ field: "key" }), help: m.inspectorHelp({ help: "decisionKey" }) }),
        label: Fields.text({ label: m.inspectorField({ field: "label" }) }),
        letter: Fields.text({ label: m.inspectorField({ field: "letter" }) }),
        owner: Fields.text({ label: m.inspectorField({ field: "owner" }) }),
        queue: Fields.tags({ label: m.inspectorField({ field: "queue" }), options: stateKeys }),
        outcomes: Fields.text({ label: m.inspectorField({ field: "outcomes" }) }),
    }), [m, stateKeys]);
    const onChange = useCallback((path: readonly string[], value: unknown) => {
        const now = edit?.now();
        const current = now === undefined ? undefined : now.triggers.find((t) => keyEqual(t.key, at));
        if (edit === undefined || now === undefined || current === undefined) return;
        const next = { ...current, [path[0]!]: value } as FlowchartTriggerValue;
        if (keyEqual(next.key.trim(), "")) {
            edit.refuse({ why: "emptyKey", what: "decision" });
            refuse();
            return;
        }
        const keyed = { ...next, key: next.key.trim() };
        if (edit.record(setDecisionRow(now, at, keyed), "editDecision") && !keyEqual(keyed.key, at)) reveal({ kind: "trigger", key: keyed.key }, false);
    }, [edit, at, refuse, reveal]);
    if (trigger === undefined) return null;
    const lines = linkLines(flow, (l) => l.trigger.type === "some" && keyEqual(l.trigger.value, at), words);
    const actions = edit === undefined ? undefined : (
        <Action action="delete" words={words} onClick={() => {
            const now = edit.now();
            if (now !== undefined && edit.record(deleteDecision(now, at), "deleteDecision")) reveal(null);
        }} />
    );
    return (
        <Box css={styles.root} data-flowchart-inspector="decision">
            <Head styles={styles} words={words} what={m.inspectorWhat({ what: "decision", letter: model.triggers.get(at)?.letter ?? at })} name={trigger.label}
                chip={chipOf(trigger, was, triggerEqual)} />
            <Edits styles={styles} available={available} actions={actions}>
                <Form styles={styles} specs={specs} value={trigger} baseline={was ?? NEW_ROW} words={formWords}
                    onChange={edit === undefined ? NO_EDIT : onChange} readOnly={edit === undefined} refused={refused} />
            </Edits>
            <Links styles={styles} reveal={reveal} lines={lines} title={m.inspectorSection({ section: "governs", n: lines.length, count: words.number(lines.length) })} />
        </Box>
    );
}

// ── A lane ──────────────────────────────────────────────────────────────────

/** A lane: its head, its fields, how many states it holds, and Delete — off while it holds any, saying why. */
function LaneView({ flow, held, at, styles, words, edit, available, reveal }: RowProps) {
    const m = words.m;
    const formWords = useFormWords(words);
    const [refused, refuse] = useRefused();
    const lane = flow.lanes.find((l) => keyEqual(l.key, at));
    const was = heldRow(held?.lanes, flow.lanes, (l) => l.key, at);
    const specs = useMemo(() => Fields.specs(Flowchart.Types.Lane, {
        key: Fields.text({ label: m.inspectorField({ field: "key" }), help: m.inspectorHelp({ help: "laneKey" }) }),
        label: Fields.text({ label: m.inspectorField({ field: "label" }) }),
    }), [m]);
    const onChange = useCallback((path: readonly string[], value: unknown) => {
        const now = edit?.now();
        const current = now === undefined ? undefined : now.lanes.find((l) => keyEqual(l.key, at));
        if (edit === undefined || now === undefined || current === undefined) return;
        const next = { ...current, [path[0]!]: value } as typeof current;
        if (keyEqual(next.key.trim(), "")) {
            edit.refuse({ why: "emptyKey", what: "lane" });
            refuse();
            return;
        }
        const keyed = { ...next, key: next.key.trim() };
        if (edit.record(setLaneRow(now, at, keyed), "editLane") && !keyEqual(keyed.key, at)) reveal({ kind: "lane", key: keyed.key }, false);
    }, [edit, at, refuse, reveal]);
    if (lane === undefined) return null;
    const holds = laneStates(flow, at);
    const actions = edit === undefined ? undefined : (
        <>
            <Action action="delete" words={words} disabled={holds > 0} onClick={() => {
                const now = edit.now();
                const next = now === undefined ? undefined : deleteLane(now, at);
                if (next !== undefined && edit.record(next, "deleteLane")) reveal(null);
            }} />
            {holds > 0 && <Box css={styles.why} data-inspector-why="">{m.laneHoldsStates({ n: holds, count: words.number(holds) })}</Box>}
        </>
    );
    return (
        <Box css={styles.root} data-flowchart-inspector="lane">
            <Head styles={styles} words={words} what={m.inspectorWhat({ what: "lane", label: getSomeorUndefined(lane.label) ?? lane.key })}
                name={undefined} chip={chipOf(lane, was, laneEqual)} />
            <Edits styles={styles} available={available} actions={actions}>
                <Form styles={styles} specs={specs} value={lane} baseline={was ?? NEW_ROW} words={formWords}
                    onChange={edit === undefined ? NO_EDIT : onChange} readOnly={edit === undefined} refused={refused} />
            </Edits>
            <Box css={styles.section}>
                <Box css={styles.fact} data-inspector-fact="lane">{m.inspectorLaneStates({ n: holds, count: words.number(holds) })}</Box>
            </Box>
        </Box>
    );
}

// ── Several states ──────────────────────────────────────────────────────────

/** Several states: how many; the lane every one moves to; and Delete. */
function SeveralView({ flow, picked, styles, words, edit, available, reveal }: ViewProps & { readonly flow: FlowchartFlowValue; readonly picked: readonly string[] }) {
    const m = words.m;
    const formWords = useFormWords(words);
    const specs = useMemo(() => Fields.specs(MoveFormType, {
        lane: Fields.reference({ of: "lanes", label: m.inspectorField({ field: "moveTo" }), help: m.inspectorHelp({ help: "moveTo" }) }),
    }), [m]);
    const options = useMemo(() => ({
        lanes: flow.lanes.map((l): FieldOption => ({ key: l.key, label: getSomeorUndefined(l.label) ?? l.key })),
    }), [flow.lanes]);
    // The lane they share, when they do.
    const lanes = picked.map((key) => stateRow(flow, key)?.lane);
    const first = lanes[0];
    const shared = first !== undefined && lanes.every((lane) => lane !== undefined && keyEqual(lane, first)) ? first : undefined;
    const onChange = useCallback((_path: readonly string[], value: unknown) => {
        const now = edit?.now();
        if (edit !== undefined && now !== undefined) edit.record(moveStates(now, picked, value as string), "moveStates");
    }, [edit, picked]);
    const actions = edit === undefined ? undefined : (
        <Action action="delete" words={words} onClick={() => {
            const now = edit.now();
            if (now !== undefined && edit.record(deleteStates(now, picked), "deleteStates")) reveal(null);
        }} />
    );
    return (
        <Box css={styles.root} data-flowchart-inspector="several">
            <Box css={styles.head}>
                <Box css={styles.summary} data-inspector-several="">{m.inspectorWhat({ what: "states", n: picked.length, count: words.number(picked.length) })}</Box>
            </Box>
            <Edits styles={styles} available={available} actions={actions}>
                <Form styles={styles} specs={specs} value={{ lane: shared }} baseline={undefined} options={options} words={formWords}
                    onChange={edit === undefined ? NO_EDIT : onChange} readOnly={edit === undefined} refused={0} />
            </Edits>
        </Box>
    );
}

// ── Nothing selected: the open flow ─────────────────────────────────────────

/** Nothing selected: the open flow — its name and description, Duplicate and Delete over many flows — its counts, its last save and three hints. */
function FlowView({ flow, held, name, heldName, styles, words, edit, available, record, saved, model }: ViewProps & { readonly flow: FlowchartFlowValue }) {
    const m = words.m;
    const formWords = useFormWords(words);
    const many = name !== undefined;
    const specs = useMemo(() => Fields.specs(FlowFormType, {
        name: Fields.text({ label: m.inspectorField({ field: "name" }), help: m.inspectorHelp({ help: "flowName" }) }),
        description: Fields.text({ label: m.inspectorField({ field: "description" }) }),
    }, many ? [] : ["name"]), [m, many]);
    const [refused, refuse] = useRefused();
    const onChange = useCallback((path: readonly string[], value: unknown) => {
        if (edit === undefined) return;
        if (keyEqual(path[0]!, "name")) {
            // A rename refused leaves the name as it was: the field shows it again.
            if (!edit.rename(value as string)) refuse();
            return;
        }
        const now = edit.now();
        if (now !== undefined) edit.record(describeFlow(now, value as option<string>), "describeFlow");
    }, [edit, refuse]);
    const counts = model.counts;
    const stats: [what: "lanes" | "states" | "transitions" | "decisions", n: number][] = [
        ["lanes", flow.lanes.length], ["states", flow.states.length], ["transitions", flow.links.length], ["decisions", flow.triggers.length],
    ];
    const actions = edit === undefined || !many ? undefined : (
        <>
            <Action action="duplicate" words={words} onClick={edit.duplicate} />
            <Action action="delete" words={words} onClick={edit.remove} />
        </>
    );
    // New while the source holds none of it; Pending while its drafts change it, or its name.
    const renamed = name !== undefined && heldName !== undefined && !keyEqual(name, heldName);
    const chip = held === undefined ? (edit !== undefined ? "new" : undefined) : renamed || !flowEqual(held, flow) ? "pending" : undefined;
    return (
        <Box css={styles.root} data-flowchart-inspector="flow">
            <Head styles={styles} words={words} what={m.inspectorWhat({ what: "flow" })} name={name} chip={chip} />
            <Edits styles={styles} available={available} actions={actions}>
                <Form styles={styles} specs={specs} value={{ name: name ?? "", description: flow.description }}
                    baseline={held === undefined ? NEW_ROW : { name: heldName ?? name ?? "", description: held.description }} words={formWords}
                    onChange={edit === undefined ? NO_EDIT : onChange} readOnly={edit === undefined} refused={refused} />
            </Edits>
            <Box css={styles.stats} data-inspector-counts="">
                {stats.map(([what, n]) => (
                    <Box key={what} css={styles.stat} data-count={what}>
                        <Box as="span" css={styles.statValue}>{words.number(n)}</Box>
                        <Box as="span" css={styles.statLabel}>{m.inspectorCount({ what, n })}</Box>
                    </Box>
                ))}
            </Box>
            <Box css={styles.section}>
                <Box css={styles.fact} data-inspector-split="">
                    {m.inspectorSplit({ planned: words.number(counts.planned), observed: words.number(counts.observed), unresolved: words.number(counts.unresolved) })}
                </Box>
                {record && <Box css={styles.fact} data-inspector-saved="">{m.inspectorSaved({ when: saved?.when, by: saved?.by })}</Box>}
            </Box>
            <Box as="ul" css={styles.hints}>
                {([1, 2, 3] as const).map((n) => <Box as="li" key={n} css={styles.hint}>{m.inspectorHint({ n })}</Box>)}
            </Box>
        </Box>
    );
}

/** A flow its drafts delete: says so, and how to keep it. */
function DeletedFlow({ name, styles, words }: ViewProps) {
    const m = words.m;
    return (
        <Box css={styles.root} data-flowchart-inspector="deleted">
            <Head styles={styles} words={words} what={m.inspectorWhat({ what: "flow" })} name={name} chip="deleted" />
            <Box css={styles.section}>
                <Box css={styles.fact} data-inspector-fact="deleted">{m.flowDeleted({ part: "hint", name: name ?? "" })}</Box>
            </Box>
        </Box>
    );
}

/** No flow open: the shared empty state saying so. */
function NoFlow({ styles, words }: ViewProps) {
    const m = words.m;
    return (
        <Box css={styles.empty} data-flowchart-inspector="none">
            <EmptyStateView icon={{ prefix: "fas", name: "diagram-project" }} title={m.inspectorNoFlow({ part: "title" })} description={m.inspectorNoFlow({ part: "hint" })} />
        </Box>
    );
}

// ============================================================================
// Issues (FB37)
// ============================================================================

/** The Issues tab: every issue of the open flow, each a control that selects what it names. */
const FlowchartInspectorIssues = memo(function FlowchartInspectorIssues({ issues, flow, model, name, reveal, words }: FlowchartInspectorProps) {
    const styles = useSlotRecipe({ key: "flowchartInspector" })() as Styles;
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
                    <chakra.button type="button" css={styles.issueItem} data-inspector-issue="" onClick={() => reveal(issue.at)}>
                        <Box as="span" css={styles.issueWhere}>
                            {issue.at === null || flow === undefined ? (name ?? m.inspectorWhat({ what: "flow" })) : m.inspectorWhat(whatOf(issue.at, flow, model, words))}
                        </Box>
                        <Box as="span" css={styles.issueMessage} data-kind={issue.blocking ? "invalid" : "warning"}>{m.issueText(issue.word)}</Box>
                    </chakra.button>
                </Box>
            ))}
        </Box>
    );
});

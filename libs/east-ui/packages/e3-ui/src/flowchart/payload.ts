/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart's payload (#1500, `Flowchart Records Spec.md` §3, R1–R4): what
 * `<Flowchart>` hands the renderer through its `Flowchart` carrier — its
 * canvas, its kinds, its narrowing and how a narrowed-out row draws, its
 * library's tabs, whether it has an inspector, the app's own words for a
 * transition's kinds (#1516), whether it is read only, whether its Autosave
 * begins on, and its name — and every refusal of its props, made when the
 * surface is built. A kind's noun
 * is its own `name`, wherever the Flowchart says it.
 *
 * Its kinds are the app's records (R1, `kinds.ts`): `states`, and beside them
 * `transitions`, `lanes` and `decisions`, each closed over its record behind
 * East functions over beast2 bytes, so the payload is one type whatever the
 * rows hold. A record may be keyed by any type a Dict takes (#1549), and a
 * role naming another kind's row holds that kind's key: the payload checks
 * each against the kind it names, and a mismatch is refused naming the role,
 * the field, both kinds and both types.
 *
 * Its narrowing is one `Slice.bindRecords` (R4): a source named `states` or
 * `transitions` narrows that kind, read complete through it — or, under
 * `narrowed="dim"`, every row read through it and what the narrowing leaves
 * out drawn as context — and each other source the cards list, the author's
 * tab or the details whose picks it weighs name (#1522). Each may narrow a
 * record keyed by any type, its shown keys their text (#1549). A source named
 * `lanes` or `decisions` is
 * refused: they are read whole. The payload's block binds each source once
 * (`recordSources(…).bind($)`), and each kind reads its own source inside its
 * functions; none reads a source's state, so a choice builds the Flowchart no
 * more.
 *
 * Its inspector is on unless `inspector={false}`, and a kind's own Details is
 * its kind's `inspector`. The props the records replace are refused when the
 * surface is built, each naming the form that replaces it.
 *
 * @packageDocumentation
 */

import {
    ArrayType, BooleanType, DictType, East, Expr, OptionType, StringType, StructType, isTypeEqual, none, some, variant,
    type EastType, type ExprType, type SubtypeExprOrValue, type ValueTypeOf,
} from "@elaraai/east";
import { EastUI, RowSourceType } from "@elaraai/east-ui";
import { RecordSlicesChromeType, isRecordSlices, type RecordSlicesChromeOptions } from "@elaraai/east-ui/internal";
import { optionOf, typeText } from "../schedule/window.js";
import { recordSources, sliceSourceNames, templatesSource } from "../utils/record-sources.js";
import { vocabularyWord } from "../utils/vocabulary.js";
import { FlowchartCanvasType, buildCanvas, type FlowchartCanvasOptions } from "./canvas.js";
import { flowchartIndexedRows } from "./details.js";
import {
    isFlowchartKind, type FlowchartDecisions, type FlowchartKindSort, type FlowchartLanes, type FlowchartStates, type FlowchartTransitions,
} from "./kinds.js";
import { FlowchartLibraryTabType, buildFlowchartLibrary, flowchartTabSources, type FlowchartLibraryKind, type FlowchartLibraryTab } from "./library.js";
import {
    FlowchartDecisionKindType, FlowchartLaneKindType, FlowchartNarrowedType, FlowchartStateKindType, FlowchartTransitionKindType,
} from "./types.js";

// ============================================================================
// The payload
// ============================================================================

/** Each source's shown keys on the wire, by the source's name. */
const ShownType = DictType(StringType, RowSourceType(ArrayType(StringType)));

/**
 * The app's own words for what the Flowchart draws of its own (#1516), every one resolved: a transition's kinds. A
 * kind's noun is its own `name` (ruled 5 Nov 2026), so these are the words no kind names.
 *
 * @property planned - A transition as it was designed (`Planned`)
 * @property observed - A transition as it was seen to run (`Observed`)
 */
export const FlowchartVocabularyType = StructType({ planned: StringType, observed: StringType });

/**
 * The `Flowchart` renderer's payload: the Flowchart's interface (§3).
 *
 * @property canvas - What the canvas draws with besides its kinds ({@link FlowchartCanvasType})
 * @property states - The states, each a card in its lane
 * @property transitions - The transitions between them; `none`, no transitions
 * @property lanes - The lanes, the canvas's columns; `none`, one column
 * @property decisions - The decisions, each a lettered diamond on the transitions that name it; `none`, no decisions
 * @property library - The library pane's tabs, in the order `library` lists them; none, no library pane
 * @property slice - The rail's chrome over the one `Slice.bindRecords`; `none`, no rail
 * @property shown - Each source's shown keys, paged through its own data, by the source's name: what a cards list's and a tab's cards follow, and what dims a narrowed-out row
 * @property narrowed - How a narrowed-out row draws: hidden, or dimmed as context
 * @property inspector - Whether the inspector pane shows: on unless `inspector={false}`
 * @property vocabulary - The app's words for a transition's kinds (#1516)
 * @property readOnly - No gesture, drop or inspector edit; selection stays
 * @property autosave - Whether its Autosave begins on
 * @property name - Keeps the Flowchart's state apart, when a surface holds two
 */
export const FlowchartPayloadType = StructType({
    canvas: FlowchartCanvasType,
    states: FlowchartStateKindType,
    transitions: OptionType(FlowchartTransitionKindType),
    lanes: OptionType(FlowchartLaneKindType),
    decisions: OptionType(FlowchartDecisionKindType),
    library: ArrayType(FlowchartLibraryTabType),
    slice: OptionType(RecordSlicesChromeType),
    shown: ShownType,
    narrowed: FlowchartNarrowedType,
    inspector: BooleanType,
    vocabulary: FlowchartVocabularyType,
    readOnly: BooleanType,
    autosave: BooleanType,
    name: OptionType(StringType),
});

/** Type representing the `Flowchart` renderer's payload. */
export type FlowchartPayloadType = typeof FlowchartPayloadType;

/**
 * The `Flowchart` carrier: `<Flowchart>` builds a {@link FlowchartPayloadType}
 * and returns it through this {@link EastUI.component}. The React renderer
 * registers against it in `@elaraai/e3-ui-components` via
 * `implementUIComponent`.
 */
export const FlowchartComponent = EastUI.component("Flowchart", FlowchartPayloadType, { optional: true });

// ============================================================================
// The Flowchart's shared keys
// ============================================================================

/**
 * The names a Flowchart keeps its viewer's state under, by its `name`: its
 * frame's panes — their open tab and collapsed state — its library's id, LR ·
 * TD, and its drop surface, where its library's cards land.
 *
 * @remarks
 * As the Plan's `planKeys` and the Schematic's `schematicKeys`: two
 * Flowcharts on one surface keep apart only when each is named.
 *
 * @param name - The Flowchart's name, when a surface holds more than one; omitted, the one Flowchart
 * @returns The keys
 */
export function flowchartKeys(name: string | undefined): {
    /** The frame's storage key: each pane's open tab and collapsed state. */
    frame: string;
    /** The library's id: what its tabs' cards are drawn from. */
    library: string;
    /** LR · TD's UI store key: the orientation the viewer picked, so a remount keeps it. */
    orientation: string;
    /** The Flowchart's drop surface: where its canvas takes its library's cards. */
    surface: string;
} {
    const suffix = name === undefined ? "" : `.${name}`;
    return {
        frame: `flowchart${suffix}.frame`,
        library: `flowchart.library${suffix}`,
        orientation: `flowchart${suffix}.orientation`,
        surface: `flowchart${suffix}.surface`,
    };
}

// ============================================================================
// <Flowchart>'s props
// ============================================================================

/** The app's words for a transition's kinds (#1516): either left out keeps its default. A kind's noun is its own `name`. */
export interface FlowchartVocabularyProp {
    /** A transition as it was designed: `Planned` unless given. */
    planned?: string;
    /** A transition as it was seen to run: `Observed` unless given. */
    observed?: string;
}

/** `<Flowchart>`'s props (§3). */
export interface FlowchartProps extends FlowchartCanvasOptions {
    /** The states, over the app's record: `Flowchart.states(Record.bind(steps), { label, lane?, order? })`. */
    states: FlowchartStates;
    /** The transitions between them, over the app's record: `Flowchart.transitions(Record.bind(moves), { from, to, decision? })`. */
    transitions?: FlowchartTransitions;
    /** The lanes, the canvas's columns, over a small record of the app's, read whole: `Flowchart.lanes(Data.bind(phases), { label, order? })`. */
    lanes?: FlowchartLanes;
    /** The decisions, over a small record of the app's, read whole: `Flowchart.decisions(Record.bind(rules), { label, owner?, queue? })`. */
    decisions?: FlowchartDecisions;
    /**
     * The narrowing (R4): slice={{ slice: Slice.bindRecords(key, { … }), affordances?, persist? }}, one rail on the
     * toolbar. Its sources named `states` and `transitions` — each `Data.bindPaged(record, { indexes })` over that
     * kind's own record — narrow that kind; each other source the cards list or the author's tab that names it.
     */
    slice?: RecordSlicesChromeOptions;
    /** How a narrowed-out row draws: `"hide"` (the default), or `"dim"`, drawn as context. */
    narrowed?: "hide" | "dim";
    /** The library pane's tabs, in order, each a `Flowchart.library.*` call; left out, or empty, no library pane. */
    library?: readonly FlowchartLibraryTab[];
    /** The inspector pane — Details and Issues: on unless `false`. A kind's own Details is its kind's `inspector`. */
    inspector?: boolean;
    /**
     * The app's own words for a transition's kinds, `planned` and `observed`, each keeping its default where left out
     * (#1516). A kind's noun is its own `name` — `Flowchart.states(record, { label, name: "Stop" })` — wherever the
     * Flowchart says it.
     */
    vocabulary?: FlowchartVocabularyProp;
    /** No gesture, drop or inspector edit; selection stays. */
    readOnly?: SubtypeExprOrValue<BooleanType> | boolean;
    /**
     * Whether Autosave — the switch in Save's menu — begins on; off by default. On, the Flowchart's changes are saved by
     * themselves a pause after the viewer's last act: never an Undo or a Redo, which wait for a press of Save. A
     * literal, or an expression data drives. The viewer's own choice, once made, is kept in their browser for the data
     * set and the Flowchart, and stands over it.
     */
    autosave?: SubtypeExprOrValue<BooleanType> | boolean;
    /** Keeps this Flowchart's panes, library and orientation apart when one surface holds two (`flowchartKeys(name)`). */
    name?: string;
}

/** The props, erased: what the implementation reads. */
type FlowchartAnyProps = { [K in keyof FlowchartProps]?: unknown } & Record<string, unknown>;

/** The refusal of the flows: the kinds over the app's records replace them (R1). */
const RECORDS = "the Flowchart takes no `record`, `data`, `flow` or `onApply` — its records are its kinds: " +
    "states={Flowchart.states(Record.bind(steps), { label, lane, order })}, transitions={Flowchart.transitions(Record.bind(moves), { from, to })}, " +
    "lanes={Flowchart.lanes(Data.bind(phases), { label })} and decisions={Flowchart.decisions(Data.bind(rules), { label })}";

/** The refusal of a row mapper: a kind maps its record's fields to its roles (R2). */
const MAPPERS = "a kind maps its record's fields to its roles — Flowchart.states(record, { label, lane, order }), " +
    "Flowchart.transitions(record, { from, to, decision }), Flowchart.lanes(record, { label, order }) and Flowchart.decisions(record, { label })";

/** The refusal of a callback for an edit: the editing session's gestures replace them. */
const SESSION = "every gesture is a transaction of the Flowchart's editing session, and Save writes each record through its patch door — " +
    "bind a kind with Record.bind(record), its record declaring patch: mutation.patch(), to edit it";

/** The refusal of a hover card: the inspector replaces them. */
const HOVER = "the inspector shows what is selected, and a kind's own Details is its kind's `inspector`: " +
    "Flowchart.states(record, { …, inspector: East.function([RowType, FunctionType([RowType], NullType)], UIComponentType, ($, row, update) => …) })";

/** The refusal of a size: the Flowchart fills the box it is given. */
const SIZE = "the Flowchart fills the box it is given — give it a box of its own height: <Box height=\"560px\"><Flowchart … /></Box>";

/** Each prop the records and the editing session replace, with the form that replaces it. */
const REMOVED: Readonly<Record<string, string>> = {
    record: RECORDS,
    data: RECORDS,
    flow: RECORDS,
    onApply: RECORDS,
    window: "the states and the transitions read through their sources of the slice, `states` and `transitions` — " +
        "slice={{ slice: Slice.bindRecords(key, { states: { source: Data.bindPaged(steps, { indexes }) } }) }}",
    links: "the transitions are `transitions`: transitions={Flowchart.transitions(record, { from, to })}",
    triggers: "the decisions are `decisions`: decisions={Flowchart.decisions(record, { label })}",
    state: MAPPERS,
    link: MAPPERS,
    lane: MAPPERS,
    trigger: MAPPERS,
    height: SIZE,
    maxHeight: SIZE,
    density: "the canvas draws at one rhythm — leave `density` out",
    linkMode: SESSION,
    onCreateLink: SESSION,
    onDeleteLink: SESSION,
    onAddLane: SESSION,
    onRenameLane: SESSION,
    onDeleteLane: SESSION,
    onAddState: SESSION,
    onEditState: SESSION,
    onMoveState: SESSION,
    stateHover: HOVER,
    linkHover: HOVER,
    triggerHover: HOVER,
    affordances: "it moved into `slice`: slice={{ slice: Slice.bindRecords(key, { … }), affordances }}",
};

/** Every prop `<Flowchart>` takes. */
const PROPS: ReadonlySet<string> = new Set([
    "states", "transitions", "lanes", "decisions", "slice", "narrowed", "library", "inspector", "vocabulary", "readOnly", "autosave", "name",
    "orientation", "freshness", "minimap", "legend", "onSelectState", "onSelectLink", "onSelectTrigger", "onTracePath", "canConnect", "narrow",
]);

/** The canvas's props, which the payload's `canvas` carries. */
const CANVAS: readonly (keyof FlowchartCanvasOptions)[] = [
    "orientation", "freshness", "minimap", "legend", "onSelectState", "onSelectLink", "onSelectTrigger", "onTracePath", "canConnect", "narrow",
];

/** The declaration each kind's prop takes, as a refusal names it. */
const DECLARE: { readonly [K in FlowchartKindSort]: string } = {
    states: "Flowchart.states(record, { label, lane?, order? })",
    transitions: "Flowchart.transitions(record, { from, to, decision? })",
    lanes: "Flowchart.lanes(record, { label, order? })",
    decisions: "Flowchart.decisions(record, { label, owner?, queue? })",
};

/**
 * Reads one kind's prop, checked to hold a kind of its sort.
 *
 * @param sort - The prop
 * @param given - What it was given
 * @returns The kind; `undefined` when it is left out
 * @throws {Error} When it holds anything but a kind of its sort, naming the declaration it takes — and the prop the kind it holds belongs under
 */
function kindOf<K>(sort: FlowchartKindSort, given: unknown): K | undefined {
    if (given === undefined) return undefined;
    if (isFlowchartKind(given, sort)) return given as K;
    const other = (["states", "transitions", "lanes", "decisions"] as const).find((s) => isFlowchartKind(given, s));
    throw new Error(`Flowchart: \`${sort}\` is ${DECLARE[sort]} over the app's record` + (other === undefined ? "" : ` — and this is ${DECLARE[other]}: give it as \`${other}\``));
}

/**
 * How a narrowed-out row draws, on the wire; and whether it is dimmed, when
 * each kind read through its source reads every row and the renderer draws
 * what the narrowing leaves out as context.
 *
 * @param narrowed - The Flowchart's `narrowed`
 * @returns It on the wire, and whether a narrowed-out row is dimmed
 * @throws {Error} For a `narrowed` of another form, naming the forms it takes
 */
function narrowedOf(narrowed: unknown): { wire: ExprType<FlowchartNarrowedType>; dim: boolean } {
    if (narrowed !== undefined && narrowed !== "hide" && narrowed !== "dim") {
        throw new Error("Flowchart: `narrowed` is \"hide\" (the default), which leaves what the narrowing leaves out off the canvas, or \"dim\", which draws it as context");
    }
    const dim = narrowed === "dim";
    return { wire: East.value(variant(dim ? "dim" : "hide", null), FlowchartNarrowedType), dim };
}

/**
 * The inspector pane: on unless `false`.
 *
 * @param inspector - The Flowchart's `inspector`
 * @returns Whether the pane shows
 * @throws {Error} For an `inspector` that is no Boolean — the `{ state, transition }` the Flowchart took before among
 *   them — naming the kind's own `inspector`, the one way to give it Details
 */
function inspectorOf(inspector: unknown): boolean {
    if (inspector === undefined || inspector === true) return true;
    if (inspector === false) return false;
    throw new Error("Flowchart: `inspector` is true or false — on unless false — and a kind's own Details is its kind's `inspector`: " +
        "Flowchart.states(record, { …, inspector: East.function([RowType, FunctionType([RowType], NullType)], UIComponentType, ($, row, update) => …) })");
}

/** Each kind's noun as the vocabulary would give it, by the kind its own `name` names instead. */
const KIND_WORDS: ReadonlyMap<string, FlowchartKindSort> = new Map([["state", "states"], ["transition", "transitions"], ["lane", "lanes"], ["decision", "decisions"]]);

/** Each kind's declaration, its `name` among its options, as a refusal of a kind's noun in the vocabulary shows it. */
const NAMED: { readonly [K in FlowchartKindSort]: string } = {
    states: "Flowchart.states(record, { label, name })",
    transitions: "Flowchart.transitions(record, { from, to, name })",
    lanes: "Flowchart.lanes(record, { label, name })",
    decisions: "Flowchart.decisions(record, { label, name })",
};

/**
 * The Flowchart's words, resolved: a transition's kinds, each the app's or its default.
 *
 * @param given - The Flowchart's `vocabulary`
 * @returns Both words
 * @throws {Error} For a `vocabulary` that is no object; an entry naming a kind's noun, naming the kind's `name` that
 *   gives it; an entry the Flowchart has no word for; and an entry given empty
 * @internal
 */
export function flowchartVocabulary(given: unknown): ValueTypeOf<typeof FlowchartVocabularyType> {
    if (given !== undefined && (typeof given !== "object" || given === null || given instanceof Expr)) {
        throw new Error("Flowchart: `vocabulary` takes the app's words for a transition's kinds — vocabulary={{ planned?, observed? }}");
    }
    const words = (given ?? {}) as FlowchartVocabularyProp;
    for (const entry of Object.keys(words)) {
        const kind = KIND_WORDS.get(entry);
        if (kind !== undefined) {
            throw new Error(`Flowchart: \`vocabulary.${entry}\` is not one of its words — a kind's noun is its own \`name\`: ${NAMED[kind]}`);
        }
        if (entry !== "planned" && entry !== "observed") {
            throw new Error(`Flowchart: \`vocabulary.${entry}\` is not one of its words — it takes \`planned\` and \`observed\`, a transition's kinds, and a kind's noun is its own \`name\``);
        }
    }
    return {
        planned: vocabularyWord("Flowchart", "planned", words.planned, "Planned"),
        observed: vocabularyWord("Flowchart", "observed", words.observed, "Observed"),
    };
}

/**
 * The rows a source of the slice narrows (#1522): its binding's joined row,
 * from the type of the binding its part holds.
 *
 * @param narrowing - The Flowchart's `slice`, a `Slice.bindRecords`
 * @param source - The source
 * @returns The row's struct; `undefined` where the part's binding pages no such rows
 */
function sliceSourceRows(narrowing: RecordSlicesChromeOptions, source: string): StructType | undefined {
    const handle = East.value(narrowing.slice) as unknown as Expr;
    const sources = (Expr.type(handle) as StructType).fields["sources"] as EastType | undefined;
    const part = sources?.type === "Struct" ? (sources.fields as Record<string, EastType>)[source] : undefined;
    const binding = part?.type === "Struct" ? (part.fields as Record<string, EastType>)["source"] : undefined;
    return binding === undefined ? undefined : flowchartIndexedRows(binding)?.row;
}

/**
 * Creates the Flowchart's payload alone — what `<Flowchart>` returns through
 * the `Flowchart` carrier — for the tests and the renderer's fixtures, which
 * read it whole.
 *
 * @param props - The Flowchart's props ({@link FlowchartProps})
 * @returns An East expression of {@link FlowchartPayloadType}
 * @throws {Error} Naming the prop and the remedy (§3): `record`, `data`, `flow` and `onApply`, which its kinds replace;
 *   `window`; the tables and row mappers; `height` and `maxHeight`; `density`; a callback for an edit and `linkMode`;
 *   a hover card's builder; `affordances` outside `slice`; a prop the Flowchart doesn't take; no states; a kind's prop
 *   holding no kind of its sort; a state's lane with no lanes, and lanes beside states that name none; a transition's
 *   decision with no decisions; a `slice` that is not `{ slice }`, or not `Slice.bindRecords`, or holding a source
 *   nothing names, a `lanes` or `decisions` source, or the brush; a cards list naming no source of the slice, or its
 *   kind's own; details naming no source of the slice, a kind's own, or one over rows of another type than theirs
 *   (#1522); a `narrowed` of another form; an `inspector` that is no Boolean, and `inspector={false}` beside a
 *   details' read shown in the inspector alone; each of `vocabulary`'s refusals ({@link flowchartVocabulary}); a
 *   `name` that is no string; each of the library's refusals (`library.ts`); each kind's refusals of its binding and
 *   its details (`kinds.ts`, `details.ts`); and a role naming another kind's row holding another type than that kind's
 *   key (#1549) — a state's lane, a transition's ends and its decision, a decision's queue — naming the role, the field,
 *   both kinds and both types
 * @internal
 */
export function createFlowchartPayload(props: object): ExprType<FlowchartPayloadType> {
    const given = props as FlowchartAnyProps;
    for (const [prop, remedy] of Object.entries(REMOVED)) {
        if (prop in given) throw new Error(`Flowchart: \`${prop}\` is gone — ${remedy}`);
    }
    for (const prop of Object.keys(given)) {
        if (!PROPS.has(prop) && !(prop === "children" && given[prop] === undefined)) {
            throw new Error(`Flowchart: \`${prop}\` is not a prop of <Flowchart> — it takes ${[...PROPS].join(", ")}`);
        }
    }

    // The kinds (R1): the states, and beside them the transitions, the lanes and the decisions.
    const states = kindOf<FlowchartStates>("states", given.states);
    if (states === undefined) throw new Error(`Flowchart: needs its states — states={${DECLARE.states}}, over the app's record`);
    const transitions = kindOf<FlowchartTransitions>("transitions", given.transitions);
    const lanes = kindOf<FlowchartLanes>("lanes", given.lanes);
    const decisions = kindOf<FlowchartDecisions>("decisions", given.decisions);
    // A role naming another kind's key needs that kind (R3).
    if (states.lane !== undefined && lanes === undefined) {
        throw new Error("Flowchart: a state's lane names a lane — give lanes={Flowchart.lanes(…)}, or drop lane");
    }
    if (lanes !== undefined && states.lane === undefined) {
        throw new Error("Flowchart: the lanes are columns: give the states their lane — Flowchart.states(record, { label, lane })");
    }
    if (transitions?.decision !== undefined && decisions === undefined) {
        throw new Error("Flowchart: a transition's decision names a decision — give decisions={Flowchart.decisions(…)}, or drop decision");
    }
    // A role naming another kind's row holds that kind's key (#1549): each checked against the kind it names.
    if (states.lane !== undefined && lanes !== undefined && !isTypeEqual(states.lane.type, lanes.keyType)) {
        throw new Error(`Flowchart: a state's lane, "${states.lane.field}", holds ${typeText(states.lane.type)} — and the lanes are keyed by ` +
            `${typeText(lanes.keyType)}: key the lanes by ${typeText(states.lane.type)}, or name a field holding ${typeText(lanes.keyType)}`);
    }
    if (transitions !== undefined && !isTypeEqual(transitions.ends.type, states.keyType)) {
        const { from, to, type } = transitions.ends;
        throw new Error(`Flowchart: a transition's ends, "${from}" and "${to}", hold ${typeText(type)} — and the states are keyed by ` +
            `${typeText(states.keyType)}: key the states by ${typeText(type)}, or name fields holding ${typeText(states.keyType)}`);
    }
    const decision = transitions?.decision;
    if (decision !== undefined && decisions !== undefined) {
        // An Option of the decisions' key; a String, empty for none, where they are keyed by String.
        const fits = isTypeEqual(decision.type, OptionType(decisions.keyType))
            || (isTypeEqual(decision.type, StringType) && isTypeEqual(decisions.keyType, StringType));
        if (!fits) {
            throw new Error(`Flowchart: a transition's decision, "${decision.field}", holds ${typeText(decision.type)} — and the decisions are keyed by ` +
                `${typeText(decisions.keyType)}: key the decisions by ${typeText(optionOf(decision.type) ?? decision.type)}, or name a field holding ` +
                `${typeText(OptionType(decisions.keyType))}`);
        }
    }
    const queue = decisions?.queue;
    if (queue !== undefined && !isTypeEqual(queue.type, states.keyType)) {
        throw new Error(`Flowchart: a decision's queue, "${queue.field}", holds the states' keys as ${typeText(queue.type)} — and the states are keyed by ` +
            `${typeText(states.keyType)}: key the states by ${typeText(queue.type)}, or name an Array or a Set field of ${typeText(states.keyType)}`);
    }
    const kinds = [
        { sort: "states" as const, kind: states },
        ...(transitions === undefined ? [] : [{ sort: "transitions" as const, kind: transitions }]),
        ...(lanes === undefined ? [] : [{ sort: "lanes" as const, kind: lanes }]),
        ...(decisions === undefined ? [] : [{ sort: "decisions" as const, kind: decisions }]),
    ];

    // The narrowing (R4): one Slice.bindRecords, its states and transitions sources each named after its kind.
    const slice = given.slice;
    if (slice !== undefined && (slice instanceof Expr || typeof slice !== "object" || slice === null || !("slice" in slice))) {
        throw new Error("Flowchart: `slice` takes { slice } — slice={{ slice: Slice.bindRecords(key, { … }), affordances?, persist? }}, " +
            "its sources `states` and `transitions` each named after the kind it narrows");
    }
    const narrowing = slice as RecordSlicesChromeOptions | undefined;
    if (narrowing?.affordances?.includes("brush") === true) {
        throw new Error("Flowchart: `slice`'s affordances list \"brush\", and a flowchart has no continuous axis to brush along — mount fields, search, presets or summary");
    }
    const sliceNames = sliceSourceNames(narrowing);
    for (const whole of ["lanes", "decisions"] as const) {
        if (sliceNames.includes(whole)) throw new Error(`Flowchart: the ${whole} are read whole: drop the ${whole} source`);
    }
    // Each kind's cards are a record of their own, their list naming its source of the slice — refused with the change
    // to make before a source no list names is.
    const cardSources: string[] = [];
    if (narrowing === undefined || isRecordSlices(narrowing.slice)) {
        for (const { sort, kind } of kinds) {
            if (!kind.hasTemplates) continue;
            const source = templatesSource("Flowchart", "Flowchart.templates(rows, { …, source })", kind.templatesSource, sliceNames);
            if (source === "states" || source === "transitions") {
                throw new Error(`Flowchart: the ${sort}' cards name the source '${source}', which narrows the ${source} — ` +
                    "a kind's cards are a record of their own, and their own source of the slice");
            }
            cardSources.push(source);
        }
    }
    // The details the rail's picks weigh (#1522, R44): each names a source of the slice over the details' own record.
    const weighing: string[] = [];
    if (narrowing === undefined || isRecordSlices(narrowing.slice)) {
        for (const { sort, kind } of kinds) {
            const by = sort === "states" || sort === "transitions" ? (kind as FlowchartStates | FlowchartTransitions).weighedBy : undefined;
            if (by === undefined) continue;
            if (by.source === "states" || by.source === "transitions") {
                throw new Error(`Flowchart: the ${sort}' details name the source '${by.source}', which narrows the ${by.source} — the picks that ` +
                    "weigh details are a source of the slice over the details' own record");
            }
            if (narrowing === undefined || !sliceNames.includes(by.source)) {
                throw new Error(`Flowchart: the ${sort}' details name the source '${by.source}', ` +
                    `${narrowing === undefined ? "and the Flowchart has no slice" : `which is none of the slice's sources (${sliceNames.join(", ")})`} — ` +
                    `slice={{ slice: Slice.bindRecords(key, { …, ${by.source}: { source: Data.bindPaged(record, { indexes }), fields } }) }}`);
            }
            const rows = sliceSourceRows(narrowing, by.source);
            if (rows !== undefined && !isTypeEqual(rows, by.rowType)) {
                throw new Error(`Flowchart: the ${sort}' details name the source '${by.source}', whose rows are ${typeText(rows)} — and the details' ` +
                    `are ${typeText(by.rowType)}: name the source over the details' record`);
            }
            weighing.push(by.source);
        }
    }
    const tabSources = flowchartTabSources(given.library);
    const names = [...new Set(["states", ...(transitions === undefined ? [] : ["transitions"]), ...cardSources, ...tabSources, ...weighing])];
    // Each source may narrow a record keyed by any type, its shown keys their text (#1549).
    const sources = recordSources(narrowing, {
        builder: "Flowchart", names, anyKey: true,
        what: "its states and its transitions, each by the source named after it, and the cards lists, tabs and details that name a source",
    });
    const library = buildFlowchartLibrary(given.library, {
        kinds: kinds.map(({ sort, kind }): FlowchartLibraryKind => ({ sort, rowType: kind.rowType, templates: kind.hasTemplates })),
        sources: sources.names,
    });
    const inspector = inspectorOf(given.inspector);
    // A details' read shown in the inspector alone is drawn nowhere without its pane (#1507).
    if (!inspector && (states.inspectorReads || transitions?.inspectorReads === true)) {
        throw new Error("Flowchart: the inspector's reads have no pane — drop inspector={false}, or show them on the canvas");
    }
    const vocabulary = flowchartVocabulary(given.vocabulary);
    const narrowed = narrowedOf(given.narrowed);
    const name = given.name;
    if (name !== undefined && (typeof name !== "string" || name === "")) {
        throw new Error("Flowchart: `name` keeps the Flowchart's state apart — a string, needed only when one surface holds two");
    }
    const canvas = buildCanvas(Object.fromEntries(CANVAS.filter((prop) => given[prop] !== undefined).map((prop) => [prop, given[prop]])) as FlowchartCanvasOptions);

    return Expr.block(($) => {
        // Each source bound once: a kind reads its own source inside its functions.
        const bound = sources.bind($);
        const shown = East.value(new Map(Object.entries(bound.keys)) as never, ShownType) as ExprType<typeof ShownType>;
        // Dimmed, a kind read through its source reads every row: the renderer draws what the narrowing leaves out as context.
        return East.value({
            canvas,
            states: states.build(bound.parts["states"], narrowed.dim),
            transitions: transitions === undefined ? none : some(transitions.build(bound.parts["transitions"], narrowed.dim)),
            lanes: lanes === undefined ? none : some(lanes.build(undefined, false)),
            decisions: decisions === undefined ? none : some(decisions.build(undefined, false)),
            library,
            slice: sources.chrome,
            shown,
            narrowed: narrowed.wire,
            inspector,
            vocabulary,
            readOnly: given.readOnly ?? false,
            autosave: given.autosave ?? false,
            name: name === undefined ? none : some(name),
        } as never, FlowchartPayloadType);
    });
}

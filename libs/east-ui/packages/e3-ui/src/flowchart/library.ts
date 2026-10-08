/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Flowchart.library` — the flowchart's library pane (#1246, #1248,
 * `Flowchart Builder Spec.md` decisions 5–8, §4.2, §4.4, FB13, FB25–FB29):
 * `library` lists the pane's tabs, in order, each a `Flowchart.library.*`
 * call. Left out, or empty, the flowchart has no library pane.
 *
 * - `Flowchart.library.flows()` (#1246) — the Flows tab: every flow the
 *   flowchart holds by name, a click opening one on the canvas, and "+ New
 *   flow" naming another. Over one flow there is none to list, so one flow's
 *   library takes every tab but it.
 * - `Flowchart.library.states(rows, { … })` — state templates: one card per
 *   row, its `drop` the fields of the state a card dropped on a lane adds.
 * - `Flowchart.library.transitions(rows, { … })` — transition templates: one
 *   card per row, its `drop` the fields a card sets on the transition it lands
 *   on.
 * - `Flowchart.library.tab(rows, { … })` — the author's own cards; given a
 *   `drop`, its patch's type names what a card lands on: a state, a
 *   transition, a lane's header or a decision's diamond.
 *
 * Each data tab takes its own bound data (the user, 2026-10-08), apart from
 * the flows and from the other tabs: its rows are an `Array<T>` or a
 * `Dict<String, T>` the app binds — a value, or an expression such as a
 * binding's `read()` — read as `Sheet.library.tab` reads its rows: its
 * accessors `(row, key) => …` reified once into a describe function the rows'
 * map then calls, a Dict's key the second argument and an Array's index,
 * printed, in its place; a key that repeats keeps its first card. A card
 * crosses the closed payload as the fields its drop sets, typed by the row it
 * lands on — a flow's rows are the flowchart's own types. Dropped on the
 * canvas (#1249), a state template adds a state where it lands on a lane, a
 * transition template retypes the transition it lands on, and an author's card
 * sets its fields on what its drop's type names; ⏎ on a card drops it on the
 * canvas's selection.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    DictType,
    East,
    Expr,
    NullType,
    OptionType,
    SetType,
    StringType,
    StructType,
    VariantType,
    isTypeEqual,
    none,
    printType,
    some,
    variant,
    type BlockBuilder,
    type EastType,
    type ExprType,
    type FunctionType,
    type SubtypeExprOrValue,
} from "@elaraai/east";
import { FlowchartPatchTypeFor, type FlowchartPatchOf } from "./patch.js";
import { FlowchartLaneType, FlowchartLinkType, FlowchartStateType, FlowchartTriggerType } from "./types.js";

// ============================================================================
// The wire
// ============================================================================

/**
 * A card a library tab lists that drops nothing: an author's card read, never
 * dragged.
 *
 * @property key - Its identity in its tab
 * @property label - Its title
 * @property meta - A line under its title
 * @property group - The group its tab lists it under
 */
export const FlowchartCardType = StructType({
    key: StringType,
    label: StringType,
    meta: OptionType(StringType),
    group: OptionType(StringType),
});

/** Type representing {@link FlowchartCardType}. */
export type FlowchartCardType = typeof FlowchartCardType;

/**
 * A state template's card: what it shows, and the fields of the state it
 * adds, over a state's defaults — the `Flowchart.patch(Flowchart.Types.State, …)`
 * its drop returns.
 */
export const FlowchartStateCardType = StructType({
    ...FlowchartCardType.fields,
    sets: FlowchartPatchTypeFor(FlowchartStateType),
});

/** Type representing {@link FlowchartStateCardType}. */
export type FlowchartStateCardType = typeof FlowchartStateCardType;

/**
 * A transition template's card: what it shows, and the fields it sets on the
 * transition it lands on — the `Flowchart.patch(Flowchart.Types.Link, …)` its
 * drop returns.
 */
export const FlowchartTransitionCardType = StructType({
    ...FlowchartCardType.fields,
    sets: FlowchartPatchTypeFor(FlowchartLinkType),
});

/** Type representing {@link FlowchartTransitionCardType}. */
export type FlowchartTransitionCardType = typeof FlowchartTransitionCardType;

/** An author's card that lands on a lane's header, and the lane's fields it sets. */
export const FlowchartLaneCardType = StructType({
    ...FlowchartCardType.fields,
    sets: FlowchartPatchTypeFor(FlowchartLaneType),
});

/** Type representing {@link FlowchartLaneCardType}. */
export type FlowchartLaneCardType = typeof FlowchartLaneCardType;

/** An author's card that lands on a decision's diamond, and the decision's fields it sets. */
export const FlowchartDecisionCardType = StructType({
    ...FlowchartCardType.fields,
    sets: FlowchartPatchTypeFor(FlowchartTriggerType),
});

/** Type representing {@link FlowchartDecisionCardType}. */
export type FlowchartDecisionCardType = typeof FlowchartDecisionCardType;

/**
 * An author's tab's cards, by what they land on — the type of the patch its
 * `drop` returns — each card with the fields it sets there.
 *
 * @property none - The tab declares no `drop`: its cards are read, never dragged
 * @property state - Its cards land on a state
 * @property transition - Its cards land on a transition
 * @property lane - Its cards land on a lane's header
 * @property decision - Its cards land on a decision's diamond
 */
export const FlowchartLandsType = VariantType({
    none: ArrayType(FlowchartCardType),
    state: ArrayType(FlowchartStateCardType),
    transition: ArrayType(FlowchartTransitionCardType),
    lane: ArrayType(FlowchartLaneCardType),
    decision: ArrayType(FlowchartDecisionCardType),
});

/** Type representing {@link FlowchartLandsType}. */
export type FlowchartLandsType = typeof FlowchartLandsType;

/**
 * One tab of the library pane, as `library` lists it (`Flowchart Builder
 * Spec.md` §4.2).
 *
 * @remarks
 * A card crosses the closed payload as the fields its drop sets, typed by the
 * row it lands on — a flow's rows are the flowchart's own types. A template
 * tab's name is the author's when given; left out, the renderer names it in
 * its words (`States`, `Transitions`), so a host translates it.
 *
 * @property flows - Every flow in the record; a click opens one
 * @property states - State templates from the tab's own rows: its name, its icon and its cards
 * @property transitions - Transition templates from the tab's own rows: its name, its icon and its cards
 * @property tab - The author's own cards: its name, its icon, and its cards by what they land on
 */
export const FlowchartLibraryTabType = VariantType({
    flows: NullType,
    states: StructType({ name: OptionType(StringType), icon: OptionType(StringType), cards: ArrayType(FlowchartStateCardType) }),
    transitions: StructType({ name: OptionType(StringType), icon: OptionType(StringType), cards: ArrayType(FlowchartTransitionCardType) }),
    tab: StructType({ name: StringType, icon: OptionType(StringType), lands: FlowchartLandsType }),
});

/** Type representing {@link FlowchartLibraryTabType}. */
export type FlowchartLibraryTabType = typeof FlowchartLibraryTabType;

// ============================================================================
// The author's surface
// ============================================================================

/**
 * What a data tab's card shows, read off one of its rows — its value and its
 * key: a Dict's key, or an Array's index, printed — as `Sheet.library.tab`'s
 * accessors read them.
 *
 * @typeParam T - The rows' element type
 */
export interface FlowchartCardAccessors<T extends EastType> {
    /** The card's key — unique within the tab; a key that repeats keeps its first card. */
    key: (row: ExprType<T>, key: ExprType<StringType>) => SubtypeExprOrValue<StringType>;
    /** The card's name. */
    label: (row: ExprType<T>, key: ExprType<StringType>) => SubtypeExprOrValue<StringType>;
    /** The line under it — return the field's `Option`. */
    meta?: (row: ExprType<T>, key: ExprType<StringType>) => SubtypeExprOrValue<OptionType<StringType>>;
    /** The tab's group the card sits under. */
    group?: (row: ExprType<T>, key: ExprType<StringType>) => SubtypeExprOrValue<StringType>;
}

/**
 * A state template tab — `Flowchart.library.states(rows, { … })`: its name
 * and icon, what each card shows, and the fields of the state it adds.
 *
 * @typeParam T - The rows' element type
 */
export interface FlowchartStatesConfig<T extends EastType> extends FlowchartCardAccessors<T> {
    /** The tab's name; left out, `States`, in the flowchart's words. */
    name?: string;
    /** A Font Awesome solid icon name for the tab's cards. */
    icon?: string;
    /** The fields of the state a card dropped on a lane adds, over a state's defaults: `Flowchart.patch(Flowchart.Types.State, { … })`. */
    drop: (row: ExprType<T>, key: ExprType<StringType>) => ExprType<FlowchartPatchOf<FlowchartStateType>>;
}

/**
 * A transition template tab — `Flowchart.library.transitions(rows, { … })`:
 * its name and icon, what each card shows, and the fields it sets on the
 * transition it lands on.
 *
 * @typeParam T - The rows' element type
 */
export interface FlowchartTransitionsConfig<T extends EastType> extends FlowchartCardAccessors<T> {
    /** The tab's name; left out, `Transitions`, in the flowchart's words. */
    name?: string;
    /** A Font Awesome solid icon name for the tab's cards. */
    icon?: string;
    /**
     * The fields a card sets on the transition it lands on —
     * `Flowchart.patch(Flowchart.Types.Link, { … })`: its kind, its decision
     * and its other fields, never its `key`, `from` or `to`.
     */
    drop: (row: ExprType<T>, key: ExprType<StringType>) => ExprType<FlowchartPatchOf<FlowchartLinkType>>;
}

/**
 * An author's tab — `Flowchart.library.tab(rows, { … })`: its name and icon,
 * what each card shows, and, given a `drop`, the fields a card sets where it
 * lands.
 *
 * @typeParam T - The rows' element type
 * @typeParam P - The patch `drop` returns: `Flowchart.Types.Patch` of a flow's row type
 */
export interface FlowchartTabConfig<T extends EastType, P extends EastType = EastType> extends FlowchartCardAccessors<T> {
    /** The tab's name: its label in the tab row, and its identity in `library`. */
    name: string;
    /** A Font Awesome solid icon name for the tab's cards. */
    icon?: string;
    /**
     * What a dropped card sets: `Flowchart.patch(R, { … })` over a flow's row
     * type, whose type names what it lands on — `State` a state, `Link` a
     * transition, `Lane` a lane's header, `Trigger` a decision's diamond.
     * Without one, the cards are read, never dragged.
     */
    drop?: (row: ExprType<T>, key: ExprType<StringType>) => ExprType<P>;
}

/** The Flows tab, as `Flowchart.library.flows()` returns it. */
export interface FlowchartFlowsTab {
    readonly kind: "flows";
}

/** The state templates' tab, as `Flowchart.library.states(…)` returns it: its rows and how it reads them. */
export interface FlowchartStatesTab {
    readonly kind: "states";
    readonly rows: unknown;
    readonly config: FlowchartStatesConfig<EastType>;
}

/** The transition templates' tab, as `Flowchart.library.transitions(…)` returns it: its rows and how it reads them. */
export interface FlowchartTransitionsTab {
    readonly kind: "transitions";
    readonly rows: unknown;
    readonly config: FlowchartTransitionsConfig<EastType>;
}

/** An author's tab, as `Flowchart.library.tab(…)` returns it: its rows and how it reads them. */
export interface FlowchartAuthorTab {
    readonly kind: "tab";
    readonly rows: unknown;
    readonly config: FlowchartTabConfig<EastType>;
}

/** One tab of the library pane — what each `Flowchart.library.*` call returns, and `library` lists. */
export type FlowchartLibraryTab = FlowchartFlowsTab | FlowchartStatesTab | FlowchartTransitionsTab | FlowchartAuthorTab;

/**
 * The tabs a flowchart over one flow may list: every tab but the Flows tab,
 * which lists flows by name — one flow has none to list (FB16).
 */
export type FlowchartOneFlowLibraryTab = FlowchartStatesTab | FlowchartTransitionsTab | FlowchartAuthorTab;

/** The rows a data tab reads: an Array, or a Dict by String keys. */
export type FlowchartLibraryRows<T extends EastType> = SubtypeExprOrValue<ArrayType<T>> | SubtypeExprOrValue<DictType<StringType, T>>;

/**
 * The Flows tab — `Flowchart.library.flows()` (FB13, FB14): every flow the
 * flowchart holds, by name, each card its name and its description — or, with
 * none, its counts — the open flow placed, and a flow whose drafts are not
 * yet saved marked Pending. A click opens a flow on the canvas, and the
 * tab's search reads names and descriptions. Where the flowchart edits — a
 * record, or the host's flows given `onApply`, and not read only — "+ New
 * flow" names another, refusing a name the flowchart holds, and opens it
 * empty, one lane, as a draft the history item saves or discards.
 *
 * @remarks
 * Over a record of flows, or the host's flows by name. Over one flow (`data`
 * of `Flowchart.Types.Flow`) it is refused, when the surface is built and by
 * the tag's types.
 *
 * @returns The tab
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/e3-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Box, Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Flowchart, Record } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * export const depotFlows = e3.record("flowchart_depot_flows", Flowchart.Types.Flows, Flowchart.values({
 *     "Inbound parcels": {
 *         description: "From the trailer to the van",
 *         lanes: [{ key: "intake", label: "Intake" }, { key: "sort", label: "Sort" }, { key: "load", label: "Load" }],
 *         states: [
 *             { key: "ARV", label: "Arrived", lane: "intake" },
 *             { key: "SCN", label: "Scanned", lane: "intake" },
 *             { key: "CH*", label: "Sort chutes", lane: "sort", members: 12n },
 *             { key: "LDD", label: "Loaded", lane: "load" },
 *         ],
 *         links: [
 *             { from: "ARV", to: "SCN" },
 *             { from: "SCN", to: "CH*", trigger: "route" },
 *             { from: "CH*", to: "LDD" },
 *             { from: "SCN", to: "SCN", kind: "observed" },
 *         ],
 *         triggers: [{ key: "route", label: "route", owner: "sort-planner" }],
 *     },
 *     "Returns": {
 *         description: "From the counter back to the sender",
 *         lanes: [{ key: "counter", label: "Counter" }, { key: "check", label: "Check" }, { key: "out", label: "Out" }],
 *         states: [
 *             { key: "RCV", label: "Received", lane: "counter" },
 *             { key: "INS", label: "Inspected", lane: "check" },
 *             { key: "RSD", label: "Resent", lane: "out" },
 *         ],
 *         links: [{ from: "RCV", to: "INS" }, { from: "INS", to: "RSD" }, { from: "INS", to: "BIN", kind: "observed" }],
 *     },
 * }));
 * export const depotFlowsPatch = e3.mutation.patch(depotFlows);
 *
 * const flowchart = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const flows = $.let(Record.bind(depotFlows, [depotFlowsPatch]));
 *         return (
 *             <Box height="500px">
 *                 <Flowchart record={flows} flow="Inbound parcels" library={[Flowchart.library.flows()]} />
 *             </Box>
 *         );
 *     }}</Reactive>
 * ));
 * ```
 */
export function libraryFlows(): FlowchartFlowsTab {
    return { kind: "flows" };
}

/**
 * The state templates — `Flowchart.library.states(rows, { … })` (FB26,
 * decisions 6 and 7): one card per row of the tab's own rows — its label, the
 * line under it, the tab's icon — grouped by its `group` and searched by its
 * key, label and line. Each card is a drag source, and a click selects it, a
 * click on the selected card letting it go. A card dropped on a lane adds a
 * state there, seeded with the fields its `drop` sets over a state's defaults
 * (#1249).
 *
 * @remarks
 * The rows are the app's own — an input or a record the app binds, apart from
 * the flows and from the other tabs — read as `Sheet.library.tab` reads its
 * rows: an `Array<T>` or a `Dict<String, T>`, each accessor taking a row and
 * its key, a Dict's key or an Array's index, printed. A key that repeats keeps
 * its first card. Left out, the tab's name is `States`, in the flowchart's
 * words. Refused when the surface is built: rows that are neither an Array
 * nor a `Dict<String, T>`, a `drop` over another type than
 * `Flowchart.Types.State`, and the tab listed twice.
 *
 * @typeParam T - The rows' element type
 * @param rows - The rows — an `Array<T>` or a `Dict<String, T>` value or expression, such as a binding's `read()`
 * @param config - The tab's name and icon, what each card shows, and its `drop` ({@link FlowchartStatesConfig})
 * @returns The tab
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/e3-ui` pragma
 * import { ArrayType, DictType, East, IntegerType, OptionType, StringType, StructType, none, some, variant } from "@elaraai/east";
 * import { Box, Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Data, Flowchart, Record } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * export const depotFlows = e3.record("flowchart_depot_flows", Flowchart.Types.Flows, Flowchart.values({
 *     "Inbound parcels": {
 *         description: "From the trailer to the van",
 *         lanes: [{ key: "intake", label: "Intake" }, { key: "sort", label: "Sort" }, { key: "load", label: "Load" }],
 *         states: [
 *             { key: "ARV", label: "Arrived", lane: "intake" },
 *             { key: "SCN", label: "Scanned", lane: "intake" },
 *             { key: "CH*", label: "Sort chutes", lane: "sort", members: 12n },
 *             { key: "LDD", label: "Loaded", lane: "load" },
 *         ],
 *         links: [
 *             { from: "ARV", to: "SCN" },
 *             { from: "SCN", to: "CH*", trigger: "route" },
 *             { from: "CH*", to: "LDD" },
 *             { from: "SCN", to: "SCN", kind: "observed" },
 *         ],
 *         triggers: [{ key: "route", label: "route", owner: "sort-planner" }],
 *     },
 *     "Returns": {
 *         description: "From the counter back to the sender",
 *         lanes: [{ key: "counter", label: "Counter" }, { key: "check", label: "Check" }, { key: "out", label: "Out" }],
 *         states: [
 *             { key: "RCV", label: "Received", lane: "counter" },
 *             { key: "INS", label: "Inspected", lane: "check" },
 *             { key: "RSD", label: "Resent", lane: "out" },
 *         ],
 *         links: [{ from: "RCV", to: "INS" }, { from: "INS", to: "RSD" }, { from: "INS", to: "BIN", kind: "observed" }],
 *     },
 * }));
 * export const depotFlowsPatch = e3.mutation.patch(depotFlows);
 * export const StepTemplate = StructType({ code: StringType, name: StringType, kind: StringType, slots: OptionType(IntegerType) });
 * export const stepTemplates = e3.input("flowchart_step_templates", ArrayType(StepTemplate), variant("value", [
 *     { code: "ARV", name: "Arrived", kind: "Intake", slots: none },
 *     { code: "SCN", name: "Scanned", kind: "Intake", slots: none },
 *     { code: "CH*", name: "Sort chutes", kind: "Sort", slots: some(12n) },
 *     { code: "HLD", name: "Held", kind: "Hold", slots: none },
 *     { code: "LDD", name: "Loaded", kind: "Load", slots: none },
 * ]));
 * export const MoveTemplate = StructType({ kind: Flowchart.Types.Kind, decision: OptionType(StringType), note: StringType });
 * export const moveTemplates = e3.record("flowchart_move_templates", DictType(StringType, MoveTemplate), new Map([
 *     ["Observed", { kind: variant("observed", null), decision: none, note: "Mined from the scans" }],
 *     ["Planned", { kind: variant("planned", null), decision: none, note: "The designed path" }],
 *     ["Routed", { kind: variant("planned", null), decision: some("route"), note: "Governed by the route decision" }],
 * ]));
 * export const DecisionOwner = StructType({ role: StringType, name: StringType, desk: StringType });
 * export const decisionOwners = e3.input("flowchart_decision_owners", ArrayType(DecisionOwner), variant("value", [
 *     { role: "sort-planner", name: "Sort planner", desk: "Sort hall" },
 *     { role: "customs-desk", name: "Customs desk", desk: "Hold bay" },
 * ]));
 *
 * const flowchart = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const flows = $.let(Record.bind(depotFlows, [depotFlowsPatch]));
 *         const steps = $.let(Data.bind(stepTemplates));
 *         const moves = $.let(Record.bind(moveTemplates, []));
 *         const owners = $.let(Data.bind(decisionOwners));
 *         return (
 *             <Box height="560px">
 *                 <Flowchart
 *                     record={flows}
 *                     flow="Inbound parcels"
 *                     name="depot"
 *                     library={[
 *                         Flowchart.library.flows(),
 *                         // Step types, an input's rows: a card dropped on a lane adds a state seeded with what its drop sets.
 *                         Flowchart.library.states(steps.read(), {
 *                             name: "Steps", icon: "box",
 *                             key: s => s.code, label: s => s.name, meta: s => some(s.code), group: s => s.kind,
 *                             drop: s => Flowchart.patch(Flowchart.Types.State, { key: s.code, label: some(s.name), members: s.slots }),
 *                         }),
 *                         // Transition types, a record's rows by name: a card dropped on a transition retypes it.
 *                         Flowchart.library.transitions(moves.read(), {
 *                             icon: "arrow-right",
 *                             key: (_m, name) => name, label: (_m, name) => name, meta: m => some(m.note),
 *                             drop: m => Flowchart.patch(Flowchart.Types.Link, { kind: some(m.kind), trigger: m.decision }),
 *                         }),
 *                         // The author's own cards: a role dropped on a decision owns it.
 *                         Flowchart.library.tab(owners.read(), {
 *                             name: "Owners", icon: "user-tie",
 *                             key: o => o.role, label: o => o.name, meta: o => some(o.desk),
 *                             drop: o => Flowchart.patch(Flowchart.Types.Trigger, { owner: some(o.role) }),
 *                         }),
 *                     ]}
 *                 />
 *             </Box>
 *         );
 *     }}</Reactive>
 * ));
 * ```
 */
export function libraryStates<T extends EastType>(rows: FlowchartLibraryRows<T>, config: FlowchartStatesConfig<T>): FlowchartStatesTab {
    return { kind: "states", rows, config: config as unknown as FlowchartStatesConfig<EastType> };
}

/**
 * The transition templates — `Flowchart.library.transitions(rows, { … })`
 * (FB26, decision 8): one card per row of the tab's own rows, as
 * {@link libraryStates}' are, each a drag source that a click selects and a
 * second click lets go. A card dropped on a transition sets the fields its
 * `drop` sets on it — its kind, its decision and its other fields (#1249): a
 * connection makes a transition of the default type, and a card retypes it.
 *
 * @remarks
 * The rows are read as {@link libraryStates}' are. Left out, the tab's name is
 * `Transitions`, in the flowchart's words. Refused when the surface is built:
 * rows that are neither an Array nor a `Dict<String, T>`, a `drop` over
 * another type than `Flowchart.Types.Link`, and the tab listed twice; and,
 * when the tab's cards are read, a card whose `drop` sets the transition's
 * `key`, `from` or `to` — the fields a patch sets are values its rows give,
 * which the build cannot see.
 *
 * @typeParam T - The rows' element type
 * @param rows - The rows — an `Array<T>` or a `Dict<String, T>` value or expression, such as a binding's `read()`
 * @param config - The tab's name and icon, what each card shows, and its `drop` ({@link FlowchartTransitionsConfig})
 * @returns The tab
 */
export function libraryTransitions<T extends EastType>(rows: FlowchartLibraryRows<T>, config: FlowchartTransitionsConfig<T>): FlowchartTransitionsTab {
    return { kind: "transitions", rows, config: config as unknown as FlowchartTransitionsConfig<EastType> };
}

/**
 * A tab of the author's own cards — `Flowchart.library.tab(rows, { … })`
 * (FB27): one card per row of the tab's own rows, as {@link libraryStates}'
 * are, a click selecting a card and a second click letting it go. Given a
 * `drop`, each card is a drag source, which lands where its patch's type says
 * — a state, a transition, a lane's header or a decision's diamond — and sets
 * its fields there (#1249); without one, the cards are read, never dragged.
 *
 * @remarks
 * The rows are read as {@link libraryStates}' are. A tab's name is its
 * identity in `library`. Refused when the surface is built: rows that are
 * neither an Array nor a `Dict<String, T>`, a `drop` over none of a flow's
 * row types, and two tabs of one name.
 *
 * @typeParam T - The rows' element type
 * @typeParam P - The patch `drop` returns
 * @param rows - The rows — an `Array<T>` or a `Dict<String, T>` value or expression, such as a binding's `read()`
 * @param config - The tab's name and icon, what each card shows, and its `drop` ({@link FlowchartTabConfig})
 * @returns The tab
 */
export function libraryTab<T extends EastType, P extends EastType = EastType>(rows: FlowchartLibraryRows<T>, config: FlowchartTabConfig<T, P>): FlowchartAuthorTab {
    return { kind: "tab", rows, config: config as unknown as FlowchartTabConfig<EastType> };
}

/** The library pane's tabs — `Flowchart.library`. */
export interface FlowchartLibrary {
    /** The Flows tab: every flow by name, a click opening one, and "+ New flow" ({@link libraryFlows}). */
    flows: typeof libraryFlows;
    /** State templates from the tab's own rows, each card adding a state where it is dropped ({@link libraryStates}). */
    states: typeof libraryStates;
    /** Transition templates from the tab's own rows, each card retyping the transition it is dropped on ({@link libraryTransitions}). */
    transitions: typeof libraryTransitions;
    /** The author's own cards from the tab's own rows ({@link libraryTab}). */
    tab: typeof libraryTab;
}

/** The library pane's tabs, each a factory (`Flowchart.library`). */
export const FlowchartLibraryFactories: FlowchartLibrary = {
    flows: libraryFlows,
    states: libraryStates,
    transitions: libraryTransitions,
    tab: libraryTab,
};

// ============================================================================
// The build
// ============================================================================

/** A tab that reads rows of its own. */
type FlowchartDataTab = FlowchartStatesTab | FlowchartTransitionsTab | FlowchartAuthorTab;

/** A card's type: what it shows, and what it sets, when it sets anything. */
type FlowchartAnyCardType = StructType;

/** The cards a key repeats on, folded: the first kept, in the rows' order — as a register's members fold. */
function keepFirst(cardType: FlowchartAnyCardType): ExprType<FunctionType<[ArrayType<FlowchartAnyCardType>], ArrayType<FlowchartAnyCardType>>> {
    return East.function([ArrayType(cardType)], ArrayType(cardType), ($, cards) => {
        const out = $.let([], ArrayType(cardType));
        const seen = $.let(new Set<string>(), SetType(StringType));
        $.for(cards, ($2, card) => {
            const key = $2.let((card as unknown as { readonly key: ExprType<StringType> }).key, StringType);
            $2.if(seen.has(key).not(), ($3) => {
                $3(seen.insert(key));
                $3(out.pushLast(card));
            });
        });
        return out;
    }) as unknown as ExprType<FunctionType<[ArrayType<FlowchartAnyCardType>], ArrayType<FlowchartAnyCardType>>>;
}

/** Each card type's fold, once. */
const KEEP_FIRST: ReadonlyMap<FlowchartAnyCardType, ReturnType<typeof keepFirst>> = new Map([
    FlowchartCardType, FlowchartStateCardType, FlowchartTransitionCardType, FlowchartLaneCardType, FlowchartDecisionCardType,
].map((cardType) => [cardType as FlowchartAnyCardType, keepFirst(cardType)]));

/** The arm of {@link FlowchartLandsType} an author's cards ride: what they land on, or nowhere. */
type FlowchartLandsArm = "none" | "state" | "transition" | "lane" | "decision";

/** What an author's card lands on, by its drop's row type: the arm its cards ride, and their type. */
const LANDINGS: readonly (readonly [Exclude<FlowchartLandsArm, "none">, EastType, FlowchartAnyCardType])[] = [
    ["state", FlowchartStateType, FlowchartStateCardType],
    ["transition", FlowchartLinkType, FlowchartTransitionCardType],
    ["lane", FlowchartLaneType, FlowchartLaneCardType],
    ["decision", FlowchartTriggerType, FlowchartDecisionCardType],
];

/** How a tab names itself in a refusal. */
function tabName(tab: FlowchartLibraryTab): string {
    return tab.kind === "tab" ? `the "${tab.config.name}" tab` : `Flowchart.library.${tab.kind}()`;
}

/** A data tab's rows, as East reads them, and the type of each. */
interface FlowchartRows {
    /** The rows. */
    readonly expr: ExprType<EastType>;
    /** A Dict's rows are keyed by their key; an Array's by their index, printed. */
    readonly dict: boolean;
    /** Each row's type. */
    readonly row: EastType;
}

/**
 * A data tab's rows: an Array, or a Dict by String keys.
 *
 * @param tab - The tab
 * @returns The rows, as East reads them
 * @throws {Error} Naming the tab: rows that are neither an Array nor a `Dict<String, T>`
 */
function rowsOf(tab: FlowchartDataTab): FlowchartRows {
    const expr = East.value(tab.rows as SubtypeExprOrValue<EastType>) as ExprType<EastType>;
    const type = Expr.type(expr as unknown as Expr) as EastType;
    if (type.type === "Array") return { expr, dict: false, row: type.value };
    if (type.type === "Dict" && (type.key as EastType).type === "String") return { expr, dict: true, row: type.value };
    throw new Error(`Flowchart: ${tabName(tab)} reads its rows as an Array<T> or a Dict<String, T> — a value, or an expression such as a binding's read(), its own apart from the flows and the other tabs — and these are ${printType(type)}`);
}

/**
 * A data tab's drop, reified once over its rows' type: the function a card's
 * fields are set by, and the type of the patch it returns.
 */
function dropOf(rows: FlowchartRows, drop: (row: ExprType<EastType>, key: ExprType<StringType>) => ExprType<EastType>): { readonly fn: ExprType<FunctionType<[EastType, StringType], EastType>>; readonly patch: EastType } {
    const fn = East.function([rows.row, StringType], undefined, (_$, row, key) => drop(row, key)) as unknown as ExprType<FunctionType<[EastType, StringType], EastType>>;
    return { fn, patch: (Expr.type(fn as unknown as Expr) as FunctionType).output as EastType };
}

/**
 * A data tab's cards: one per row, read through its accessors, each with what
 * its drop sets, when the tab's cards set anything, and a key that repeats
 * keeping its first card.
 *
 * @param rows - The tab's rows
 * @param config - What each card shows
 * @param cardType - The cards' type
 * @param sets - What a card sets, from its row and its key, checked as it is read; `undefined` for cards that set nothing
 * @returns The cards, in the rows' order
 */
function cardsOf(
    rows: FlowchartRows,
    config: FlowchartCardAccessors<EastType>,
    cardType: FlowchartAnyCardType,
    sets: (($: BlockBuilder<FlowchartAnyCardType>, row: ExprType<EastType>, key: ExprType<StringType>, card: ExprType<StringType>) => ExprType<EastType>) | undefined,
): ExprType<ArrayType<FlowchartAnyCardType>> {
    const describe = East.function([rows.row, StringType], cardType, ($, row, key) => {
        const card = $.let(config.key(row, key), StringType);
        return {
            key: card,
            label: config.label(row, key),
            meta: config.meta !== undefined ? config.meta(row, key) : East.value(none, OptionType(StringType)),
            group: config.group !== undefined ? some(config.group(row, key)) : East.value(none, OptionType(StringType)),
            ...(sets === undefined ? {} : { sets: sets($, row, key, card) }),
        } as never;
    }) as unknown as ExprType<FunctionType<[EastType, StringType], FlowchartAnyCardType>>;
    const list = rows.dict
        ? (rows.expr as unknown as ExprType<DictType<StringType, EastType>>).toArray(($, row, key) => {
            const read = $.const(describe);
            return read(row, key);
        })
        : (rows.expr as unknown as ExprType<ArrayType<EastType>>).map(($, row, index) => {
            const read = $.const(describe);
            return read(row, East.print(index));
        });
    const fold = KEEP_FIRST.get(cardType)!;
    return fold(list as unknown as ExprType<ArrayType<FlowchartAnyCardType>>);
}

/**
 * The state templates on the wire: the tab's name and icon, and its cards,
 * each with the state its drop seeds.
 *
 * @param tab - The tab
 * @returns The tab's wire value
 * @throws {Error} Naming the tab: rows that are neither an Array nor a `Dict<String, T>`, or a `drop` over another type than a state's patch
 */
function statesTab(tab: FlowchartStatesTab): ExprType<FlowchartLibraryTabType> {
    const rows = rowsOf(tab);
    const drop = dropOf(rows, tab.config.drop as unknown as (row: ExprType<EastType>, key: ExprType<StringType>) => ExprType<EastType>);
    if (!isTypeEqual(drop.patch, FlowchartPatchTypeFor(FlowchartStateType))) {
        throw new Error(`Flowchart: ${tabName(tab)}'s \`drop\` returns the fields of the state a card adds — Flowchart.patch(Flowchart.Types.State, { … }) — and this one returns ${printType(drop.patch)}`);
    }
    const cards = cardsOf(rows, tab.config, FlowchartStateCardType, ($, row, key) => {
        const seed = $.const(drop.fn);
        return seed(row, key);
    });
    // The cards' expression is typed loosely here; East checks it against the tab's type.
    return East.value(variant("states", {
        name: tab.config.name === undefined ? none : some(tab.config.name),
        icon: tab.config.icon === undefined ? none : some(tab.config.icon),
        cards,
    }) as never, FlowchartLibraryTabType) as ExprType<FlowchartLibraryTabType>;
}

/**
 * The transition templates on the wire: the tab's name and icon, and its
 * cards, each with what it sets on the transition it lands on — refused, as
 * the card is read, when that is the transition's `key`, `from` or `to`.
 *
 * @param tab - The tab
 * @returns The tab's wire value
 * @throws {Error} Naming the tab: rows that are neither an Array nor a `Dict<String, T>`, or a `drop` over another type than a transition's patch
 */
function transitionsTab(tab: FlowchartTransitionsTab): ExprType<FlowchartLibraryTabType> {
    const rows = rowsOf(tab);
    const drop = dropOf(rows, tab.config.drop as unknown as (row: ExprType<EastType>, key: ExprType<StringType>) => ExprType<EastType>);
    if (!isTypeEqual(drop.patch, FlowchartPatchTypeFor(FlowchartLinkType))) {
        throw new Error(`Flowchart: ${tabName(tab)}'s \`drop\` returns the fields a card sets on the transition it lands on — Flowchart.patch(Flowchart.Types.Link, { … }) — and this one returns ${printType(drop.patch)}`);
    }
    const name = tabName(tab);
    const cards = cardsOf(rows, tab.config, FlowchartTransitionCardType, ($, row, key, card) => {
        const retype = $.const(drop.fn);
        const patched = $.let(retype(row, key));
        const sets = patched as unknown as { readonly key: ExprType<OptionType<StringType>>; readonly from: ExprType<OptionType<StringType>>; readonly to: ExprType<OptionType<StringType>> };
        // A transition card retypes the transition it lands on: never its key, nor its ends.
        const refusal = (field: string) => East.str`Flowchart: ${name}'s card "${card}" sets a transition's \`${field}\` — a transition card retypes the transition it lands on, its kind, its decision and its other fields, never its key or its ends: leave \`key\`, \`from\` and \`to\` out of its Flowchart.patch`;
        $.if(sets.key.hasTag("some"), ($2) => { $2.error(refusal("key")); });
        $.if(sets.from.hasTag("some"), ($2) => { $2.error(refusal("from")); });
        $.if(sets.to.hasTag("some"), ($2) => { $2.error(refusal("to")); });
        return patched as unknown as ExprType<EastType>;
    });
    return East.value(variant("transitions", {
        name: tab.config.name === undefined ? none : some(tab.config.name),
        icon: tab.config.icon === undefined ? none : some(tab.config.icon),
        cards,
    }) as never, FlowchartLibraryTabType) as ExprType<FlowchartLibraryTabType>;
}

/**
 * An author's tab on the wire: its name and icon, and its cards by what they
 * land on — the row type of the patch its `drop` returns — or read, never
 * dragged, without one.
 *
 * @param tab - The tab
 * @returns The tab's wire value
 * @throws {Error} Naming the tab: rows that are neither an Array nor a `Dict<String, T>`, or a `drop` over none of a flow's row types
 */
function authorTab(tab: FlowchartAuthorTab): ExprType<FlowchartLibraryTabType> {
    const rows = rowsOf(tab);
    const config = tab.config;
    // Without a drop, its cards are read, never dragged: they land nowhere.
    let arm: FlowchartLandsArm = "none";
    let cardType: FlowchartAnyCardType = FlowchartCardType;
    let sets: Parameters<typeof cardsOf>[3] = undefined;
    if (config.drop !== undefined) {
        const drop = dropOf(rows, config.drop as unknown as (row: ExprType<EastType>, key: ExprType<StringType>) => ExprType<EastType>);
        const landing = LANDINGS.find(([, rowType]) => isTypeEqual(drop.patch, FlowchartPatchTypeFor(rowType as never)));
        if (landing === undefined) {
            throw new Error(`Flowchart: ${tabName(tab)}'s \`drop\` returns a patch over one of a flow's rows, its type naming what a card lands on — Flowchart.patch(Flowchart.Types.State, Link, Lane or Trigger, { … }) — and this one returns ${printType(drop.patch)}`);
        }
        [arm, , cardType] = landing;
        sets = ($, row, key) => {
            const setsOf = $.const(drop.fn);
            return setsOf(row, key);
        };
    }
    const lands = East.value(variant(arm, cardsOf(rows, config, cardType, sets)) as never, FlowchartLandsType) as ExprType<FlowchartLandsType>;
    return East.value(variant("tab", {
        name: config.name,
        icon: config.icon === undefined ? none : some(config.icon),
        lands,
    }), FlowchartLibraryTabType) as ExprType<FlowchartLibraryTabType>;
}

/** The kinds of tab `library` lists. */
const KINDS: ReadonlySet<string> = new Set(["flows", "states", "transitions", "tab"]);

/**
 * The library pane on the wire (`Flowchart Builder Spec.md` §4.2, §4.4, FB16,
 * FB25–FB29): its tabs in the order `library` lists them; none when it is
 * left out, or empty.
 *
 * @param library - The tabs, each a `Flowchart.library.*` call
 * @param many - Whether the flowchart holds flows by name, rather than one flow
 * @returns The tabs on the wire
 * @throws {Error} Naming the tab and the remedy: a `library` that is no list
 *   of `Flowchart.library.*` calls; a tab listed twice — the Flows tab, the
 *   state templates or the transition templates, or two of the author's tabs
 *   of one name; the Flows tab over one flow; and each of a data tab's
 *   refusals — rows that are neither an Array nor a `Dict<String, T>`, and a
 *   `drop` of another type than its tab's
 * @internal
 */
export function buildLibrary(library: unknown, many: boolean): ExprType<ArrayType<FlowchartLibraryTabType>> {
    if (library === undefined) return East.value([], ArrayType(FlowchartLibraryTabType));
    const LIST = "Flowchart: `library` lists the library pane's tabs, each a Flowchart.library.* call — library={[Flowchart.library.flows()]}";
    if (!Array.isArray(library)) throw new Error(LIST);
    const seen = new Set<string>();
    const wires = (library as unknown[]).map((given): ExprType<FlowchartLibraryTabType> => {
        const tab = given as FlowchartLibraryTab | null | undefined;
        if (tab === null || tab === undefined || typeof tab !== "object" || !KINDS.has(tab.kind)
            || (tab.kind !== "flows" && (typeof tab.config !== "object" || tab.config === null))) {
            throw new Error(LIST);
        }
        // A tab once: the Flows tab and the templates by kind, an author's tab by its name.
        const id = tab.kind === "tab" ? `tab:${tab.config.name}` : tab.kind;
        if (seen.has(id)) {
            throw new Error(tab.kind === "tab"
                ? `Flowchart: the library lists two tabs named "${tab.config.name}" — each tab's name is its own`
                : `Flowchart: the library lists ${tabName(tab)} twice — each tab once`);
        }
        seen.add(id);
        switch (tab.kind) {
            case "flows":
                if (!many) {
                    throw new Error(`Flowchart: ${tabName(tab)} lists flows by name, and this \`data\` is one flow, Flowchart.Types.Flow — leave the Flows tab out of \`library\`, or pass the flows by name`);
                }
                return East.value(variant("flows", null), FlowchartLibraryTabType) as ExprType<FlowchartLibraryTabType>;
            case "states": return statesTab(tab);
            case "transitions": return transitionsTab(tab);
            case "tab": return authorTab(tab);
        }
    });
    return East.value(wires, ArrayType(FlowchartLibraryTabType)) as ExprType<ArrayType<FlowchartLibraryTabType>>;
}

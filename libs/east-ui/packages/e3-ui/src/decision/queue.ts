/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<DecisionQueue>` (#1447, `Decision Queue Spec.md`): the cases a model
 * leaves to a person, one card open at a time — what each option changes,
 * drawn as the builder that edits it draws it; Apply writing the change
 * through its record's own patch door, and every verdict into the case's own
 * row — in the renderer's BuilderFrame, with no side panes.
 *
 * Its cases are one record of the app's, whatever kinds of decision it holds,
 * each row carrying its verdict (`DecisionQueue.decisions`), read whole or
 * through the slice's `decisions` source a page at a time (#1458); and each
 * kind of decision draws in a target (`DecisionQueue.change.*`) built from the
 * consts the app hands its builders. It stores nothing in a shape of its own.
 *
 * The tag validates and assembles the closed payload; it composes no East UI
 * component and emits no layout, session or gesture program. The app's rows
 * cross as beast2 bytes behind East functions reified over the app's row
 * types, so the payload is one type whatever the app's records hold. The
 * `DecisionQueue` renderer in `@elaraai/e3-ui-components` draws it.
 *
 * @packageDocumentation
 */

import {
    ArrayType, BooleanType, DateTimeType, East, Expr, FunctionType, NullType, OptionType, StringType, StructType, none, some,
    type ExprType, type SubtypeExprOrValue,
} from "@elaraai/east";
import { EastUI, type UIElement } from "@elaraai/east-ui";
import { RecordSlicesChromeType, type RecordSlicesChromeOptions } from "@elaraai/east-ui/internal";
import { recordSources } from "../utils/record-sources.js";
import {
    decisionQueueAllocationTarget, decisionQueueCalendarTarget, decisionQueuePlanTarget, decisionQueueRosterTarget, decisionQueueSheetTarget,
} from "./builder-targets.js";
import { DECISIONS_SOURCE, decisionQueueDecisions, isDecisionQueueDecisions, type DecisionQueueDecisions } from "./decisions.js";
import { decisionQueueProjectionTarget, decisionQueueRecordTarget, decisionQueueZonesTarget } from "./targets.js";
import {
    DecisionCaseType, DecisionOptionType, DecisionPointType, DecisionTargetType, DecisionVerdictType, DecisionZoneType, DecisionsKindType,
} from "./types.js";

// ============================================================================
// The payload
// ============================================================================

/**
 * The `DecisionQueue` renderer's payload: the queue's interface (§5.4).
 *
 * @property decisions - The cases' kind: their reads — whole, or the slice's `decisions` source a page at a time — each row
 *   read through the roles into a case, its verdict among its parts; the session over their record; and how a verdict is
 *   written into a case's row
 * @property targets - Each target and the tags it serves, in the order the change role's variant names them
 * @property slice - The rail's chrome: the slice's `decisions` source over the cases' record; `none`, no rail
 * @property onSelect - Hears the open case's key, `none` when none is open; `none`, no host follows it
 * @property readOnly - Every card opens and shows everything, and takes no answer and no action
 * @property now - The time the due words count from; `none`, the clock
 * @property id - The name the queue's state is kept under: the open card, each card's choices and the session's drafts
 */
export const DecisionQueuePayloadType = StructType({
    decisions: DecisionsKindType,
    targets: ArrayType(DecisionTargetType),
    slice: OptionType(RecordSlicesChromeType),
    onSelect: OptionType(FunctionType([OptionType(StringType)], NullType)),
    readOnly: BooleanType,
    now: OptionType(DateTimeType),
    id: StringType,
});

/** Type representing {@link DecisionQueuePayloadType}. */
export type DecisionQueuePayloadType = typeof DecisionQueuePayloadType;

/**
 * The `DecisionQueue` carrier: `<DecisionQueue>` builds a
 * {@link DecisionQueuePayloadType} and returns it through this
 * {@link EastUI.component}. The React renderer registers against it in
 * `@elaraai/e3-ui-components` via `implementUIComponent`.
 */
export const DecisionQueueComponent = EastUI.component("DecisionQueue", DecisionQueuePayloadType, { optional: true });

// ============================================================================
// The props
// ============================================================================

/** `<DecisionQueue>`'s props (§4). */
export interface DecisionQueueProps {
    /** Names the queue's state: the open card, each card's choices (D12) and the session's drafts (D3). */
    id: string;
    /**
     * The cases: `DecisionQueue.decisions(Record.bind(record), roles)` — one record, every kind of decision, each row its
     * verdict; the change role a target for each of its tags, and the verdict's roles the fields the queue writes (§5.1–§5.3).
     */
    decisions: DecisionQueueDecisions;
    /**
     * The rail: `{ slice: Slice.bindRecords(key, { decisions: { source, … } }) }`, one source over the cases' record, its
     * cases read through it a page at a time (D4), `entries` given beside it; the app's indexes are its fields (D18). A
     * `Slice.bind` or a single `Slice.bindRecord` is refused, as every builder refuses them. Without it the cases are read whole.
     */
    slice?: RecordSlicesChromeOptions;
    /** Hears the open case's key, `none` when none is open: the host's to follow, as a builder's `onSelect` hears its selection. */
    onSelect?: SubtypeExprOrValue<FunctionType<[OptionType<StringType>], NullType>>;
    /** Every card opens and shows everything, and takes no answer and no action; no history item. `false` by default. */
    readOnly?: SubtypeExprOrValue<BooleanType>;
    /** The time the due words count from; the clock by default. Examples and tests pin it. */
    now?: SubtypeExprOrValue<DateTimeType>;
}

/** The props §13 removed, each refused by name with what replaces it. */
const REMOVED: readonly (readonly [string, string])[] = [
    ["handle", "`handle` is gone — the queue reads the app's record of cases and writes each verdict into its case's row: " +
        "decisions={DecisionQueue.decisions(Record.bind(cases), { …, verdict: { field, waiting, applied, overridden, deferred, handedOff } })}"],
    ["heading", "`heading` is gone — the queue fills the box its host gives it, and a heading over it is the host's own"],
    ["modify", "`modify` is gone — Modify edits a row in its target's own form: the builder's, for a builder's target, and a record's " +
        "`fields`, `ready` and `inspector` (DecisionQueue.change.*)"],
    ["evidence", "`evidence` is gone — the open card draws where its option's change lands, its target's preview (DecisionQueue.change.*), " +
        "and Why from the case's `model` and `why` roles"],
    ["defaultExpanded", "`defaultExpanded` is gone — the open case is the queue's own, kept under its `id`; the host hears it with `onSelect`"],
    ["defaultFacet", "`defaultFacet` is gone — the open card shows its change, its options, Why and Your call together"],
    ["facets", "`facets` is gone — the open card shows its change, its options, Why and Your call together; a role left out turns off what it drives"],
    ["onApply", "`onApply` is gone — Apply writes the option's change through its target's patch door and the verdict into the case's row " +
        "through `decisions`' verdict roles; the host follows the open case with `onSelect`"],
    ["onReject", "`onReject` is gone — Override, Defer and Hand off each write a verdict into the case's row through `decisions`' verdict roles; " +
        "the host follows the open case with `onSelect`"],
    ["affordances", "`affordances` is gone — the rail is the slice's: slice={{ slice: Slice.bindRecords(key, { decisions: { source, … } }) }}"],
    ["maxHeight", "`maxHeight` is gone — the queue fills the box its host gives it, which the host sizes"],
    ["density", "`density` is gone — the queue's cards keep one spacing, and its narrow layout follows its own width"],
    ["groups", "`groups` is gone — the cases stand in their source's order (D5); narrow them by the app's own indexes, the fields of the " +
        "slice's `decisions` source"],
    ["groupBy", "`groupBy` is gone — the cases stand in their source's order (D5); narrow them by the app's own indexes, the fields of the " +
        "slice's `decisions` source"],
    ["collapsible", "`collapsible` is gone — the queue folds nothing: each case stands where its source places it, a waiting one its card and a " +
        "decided one its receipt"],
];

/** What the queue's slice narrows, as the refusal of a source nothing names says it. */
const NARROWS = "its cases, through one source over the cases' record";

/**
 * Validates the declarations and assembles the queue's interface. View and
 * interaction behaviour belong to the renderer, not this factory.
 *
 * @param props - The queue's props
 * @returns The closed payload
 * @throws {Error} Naming the change to make: a removed prop (§13) — `handle`, `heading`, `modify`, `evidence`,
 *   `defaultExpanded`, `defaultFacet`, `facets`, `onApply`, `onReject`, `affordances`, `maxHeight`, `density`,
 *   `groups`, `groupBy` or `collapsible` — each naming what replaces it; an `id` that is no text; `decisions` that is
 *   no `DecisionQueue.decisions`; a `slice` that is not `{ slice: Slice.bindRecords(…) }`, or names a source other than
 *   `decisions`, or one paging another record; the slice's source with no `entries` beside it, or `entries` with no
 *   slice; and as each target refuses what it was given as the queue builds it
 * @internal
 */
export function createDecisionQueuePayload(props: DecisionQueueProps): ExprType<DecisionQueuePayloadType> {
    const given = (props ?? {}) as unknown as Readonly<Record<string, unknown>>;
    for (const [prop, refusal] of REMOVED) {
        if (given[prop] !== undefined) throw new Error(`DecisionQueue: ${refusal}`);
    }
    const id = given["id"];
    if (typeof id !== "string" || id === "") {
        throw new Error("DecisionQueue: `id` names the queue's state — the open card, each card's choices and the session's drafts: id=\"opsQueue\"");
    }
    const decisions = given["decisions"];
    if (!isDecisionQueueDecisions(decisions)) {
        throw new Error("DecisionQueue: `decisions` is DecisionQueue.decisions(Record.bind(record), roles) — the app's record of cases with its patch " +
            "door, the roles that read each part of a card from it, and the verdict's fields the queue writes");
    }
    const slice = given["slice"];
    if (slice instanceof Expr || (slice !== undefined && (typeof slice !== "object" || slice === null || !("slice" in slice)))) {
        throw new Error("DecisionQueue: `slice` takes { slice } — slice={{ slice: Slice.bindRecords(key, { decisions: { source, … } }) }}: " +
            "the bare handle is not taken");
    }
    const sources = recordSources(slice as RecordSlicesChromeOptions | undefined, { builder: "DecisionQueue", names: [DECISIONS_SOURCE], what: NARROWS });
    // Each target on the wire, its own state kept under the queue's id and the first tag it serves.
    const targets = [...decisions.targets].map(([target, tags]) => target.build(tags, `${id}.target.${tags[0]}`));
    return Expr.block(($) => {
        const bound = sources.bind($);
        return East.value({
            // The cases read through the slice's `decisions` source a page at a time, when it has one; whole, when it has none.
            decisions: decisions.build(bound.data[DECISIONS_SOURCE]),
            targets,
            slice: sources.chrome,
            onSelect: props.onSelect === undefined ? none : some(props.onSelect),
            readOnly: props.readOnly ?? false,
            now: props.now === undefined ? none : some(props.now),
            id,
        } as never, DecisionQueuePayloadType);
    }) as ExprType<DecisionQueuePayloadType>;
}

// ============================================================================
// The namespace
// ============================================================================

/** The tag, its declaration of the cases, its targets, and its types. */
export interface DecisionQueueNamespace {
    /** Renders the queue over the app's cases and its targets. */
    (props: DecisionQueueProps): UIElement;
    /**
     * Declares the cases: the app's record of them with its patch door, the roles that read each part of a card, and the
     * verdict's fields the queue writes (§5.1, §5.2).
     */
    decisions: typeof decisionQueueDecisions;
    /** Where each kind of decision draws (§5.3): a target per builder, taking that builder's own props, and over a record no builder draws. */
    change: {
        /** The duties the Roster draws: `<Roster>`'s props, by people or by cost. */
        roster: typeof decisionQueueRosterTarget;
        /** The events a Plan draws: `<Plan>`'s kinds. */
        plan: typeof decisionQueuePlanTarget;
        /** The events a Calendar draws: `<Calendar>`'s kinds and week. */
        calendar: typeof decisionQueueCalendarTarget;
        /** The bins an Allocation draws: `<Allocation>`'s kinds, arrivals, rules, check and nouns. */
        allocation: typeof decisionQueueAllocationTarget;
        /** A record the Sheet draws: `<Sheet>`'s columns. */
        sheet: typeof decisionQueueSheetTarget;
        /** A record no builder draws: its rows' changed fields, its mix or its groups, and its own form. */
        record: typeof decisionQueueRecordTarget;
        /** Areas on a grid, each in a zone. */
        zones: typeof decisionQueueZonesTarget;
        /** A series each option gives. */
        projection: typeof decisionQueueProjectionTarget;
    };
    /** The queue's East types. */
    Types: {
        /** The renderer's payload. */
        Payload: DecisionQueuePayloadType;
        /** One target, closed: the tags it serves, its names, how a change reads against its record, and where it draws. */
        Target: typeof DecisionTargetType;
        /** A case, as its roles read it. */
        Case: typeof DecisionCaseType;
        /** One way to decide a case, as its roles read it. */
        Option: typeof DecisionOptionType;
        /** A verdict, as the queue writes it into a case's row through the verdict's roles. */
        Verdict: typeof DecisionVerdictType;
        /** One zone of a zones target. */
        Zone: typeof DecisionZoneType;
        /** A point of a projection's series. */
        Point: typeof DecisionPointType;
    };
}

/**
 * The cases a model leaves to a person, one card open at a time, over the
 * app's own records, in an internal BuilderFrame with no side panes.
 *
 * @param props - The queue's `id` and its cases, and the optional slice, `onSelect`, `readOnly` and `now`
 * @returns The DecisionQueue extension
 * @remarks Apply writes the option's change through its target's patch door and the verdict into the case's row; every
 *   answer is a step of the shared editing history, saved with Save. The cases stand in their source's order, read a
 *   page at a time through the slice's source. Below 480px of its own width the cards stack.
 *
 * @example
 * ```tsx
 * <Reactive>{$ => {
 *     const cases = $.let(Record.bind(proposals));
 *     const priceList = $.let(Record.bind(listPrices));
 *     return <DecisionQueue
 *         id="proposals"
 *         decisions={DecisionQueue.decisions(cases, {
 *             scope: p => p.site, due: p => p.deadline, unit: p => p.metric, model: p => p.run, why: p => p.rationale,
 *             title: p => p.headline, summary: p => p.brief, detail: p => p.description, value: p => p.saving,
 *             change: { from: p => p.details, of: {
 *                 pricing: DecisionQueue.change.record(priceList, { name: "Pricing", icon: "tag", label: r => r.region }),
 *             } },
 *             verdict: { field: "verdict", waiting: "waiting", applied: "applied", overridden: "overridden", deferred: "deferred", handedOff: "handedOff" },
 *         })}
 *     />;
 * }}</Reactive>
 * ```
 */
export const DecisionQueue: DecisionQueueNamespace = Object.assign(
    (props: DecisionQueueProps): UIElement => DecisionQueueComponent.Root(createDecisionQueuePayload(props)),
    {
        decisions: decisionQueueDecisions,
        change: {
            roster: decisionQueueRosterTarget, plan: decisionQueuePlanTarget, calendar: decisionQueueCalendarTarget,
            allocation: decisionQueueAllocationTarget, sheet: decisionQueueSheetTarget, record: decisionQueueRecordTarget,
            zones: decisionQueueZonesTarget, projection: decisionQueueProjectionTarget,
        },
        Types: {
            Payload: DecisionQueuePayloadType, Target: DecisionTargetType, Case: DecisionCaseType, Option: DecisionOptionType,
            Verdict: DecisionVerdictType, Zone: DecisionZoneType, Point: DecisionPointType,
        },
    },
);

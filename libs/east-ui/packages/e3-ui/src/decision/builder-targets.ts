/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The builders' targets (#1450, `Decision Queue Spec.md` §5.3): a kind of
 * decision that lands in a record a builder edits draws as that builder does.
 * Each takes the props of the builder's own tag — the same values, typed as
 * that tag types them, the consts the app hands its `<Roster>`, `<Plan>`,
 * `<Calendar>`, `<Allocation>` or `<Sheet>` — and carries the builder's closed
 * kinds and lists as its payload does, so Modify edits a row in the builder's
 * own form (D9) and Apply writes through the kind's own write (Q1).
 *
 * A target over an event kind reads the kind's events through its `source` —
 * the read the builder's slice names for the kind, an interval index from its
 * start to its end — which the queue binds as a slice of the target's own,
 * under the target's key, one source named after the kind's slot. Nothing
 * narrows it: the preview's reads pass the span they draw. Without a `source`
 * the kind reads as it is bound.
 *
 * @packageDocumentation
 */

import {
    BooleanType, East, Expr, none, some, variant,
    type BlockBuilder, type DictType, type EastType, type ExprType, type StructType, type SubtypeExprOrValue,
} from "@elaraai/east";
import { Slice } from "@elaraai/east-ui";
import type { RecordSliceConfigType, RecordSlicesChromeOptions } from "@elaraai/east-ui/internal";
import { allocationArrivalsOf, allocationLanesOf, allocationResourcesOf, isAllocationArrivals } from "../allocation/adapters.js";
import { allocationCheckOf, allocationKinds, allocationLabels, type AllocationProps } from "../allocation/index.js";
import { createCalendarPaged, type CalendarProps } from "../calendar/index.js";
import { checkEventRows, type PlanProps } from "../plan/plan.js";
import { createRosterPayload, type RosterProps } from "../roster/index.js";
import { scheduleCheck, scheduleTitled } from "../schedule/index.js";
import { checkSchedulePagedEventKinds, checkSchedulePagedKinds, checkedScheduleTilings } from "../schedule/cell-checks.js";
import type { ScheduleEventKind } from "../schedule/events.js";
import type { ScheduleResourceKind } from "../schedule/resources.js";
import { scheduleRecordSession } from "../schedule/session.js";
import { checkEntries, typeText } from "../schedule/window.js";
import type { SheetColumnSpec } from "../sheet/columns.js";
import { createSheetPayload, type SheetRecordHandle } from "../sheet/sheet.js";
import { recordSources } from "../utils/record-sources.js";
import { decisionTarget, decisionTargetRole, type DecisionQueueTarget, type DecisionTargetNames } from "./targets.js";
import { DecisionTargetKindType } from "./types.js";

/** How a refusal names the binding a target's record takes. */
const PATCH_DOOR = "Record.bind(record), its record declaring patch: mutation.patch()";

// ============================================================================
// What the builders' targets share
// ============================================================================

/** Event kinds by slot, as a builder's `events` takes them. */
type EventKinds = Readonly<Record<string, ScheduleEventKind<EastType, EastType>>>;

/** Resource kinds by slot, as a builder's `resources` takes them. */
type ResourceKinds = Readonly<Record<string, ScheduleResourceKind<EastType, EastType>>>;

/** An event kind's key type. */
type KindKey<T> = T extends { readonly keyType: infer K extends EastType } ? K : never;

/** An event kind's row type. */
type KindRow<T> = T extends { readonly rowType: infer R extends EastType } ? R : never;

/** The record an event kind is over, `DictType(K, R)`: the record its target's tags patch. */
type KindRecord<T> = DictType<KindKey<T>, KindRow<T>>;

/** The Locked mark's read: an East function over a row of the kind the tags patch and its key. */
type LockedRole<K extends EastType, R extends EastType> = (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<BooleanType>;

/**
 * Builds a target's part as its builder does: what the builder refuses of the
 * props it was given, it refuses as the queue builds the target, in its own
 * words, named for the target.
 *
 * @param where - The target, as a refusal names it
 * @param build - The builder's build
 * @returns What it builds
 * @throws {Error} The builder's refusal, after the target's name
 */
function asTarget<T>(where: string, build: () => T): T {
    try {
        return build();
    } catch (error) {
        throw new Error(`${where}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
}

/**
 * An event kind's `source`, bound as a slice of the target's own (see the
 * module docs): one source, named after the kind's slot, its range the kind's
 * start field.
 *
 * @param $ - The block the target is built in
 * @param where - The target, as a refusal names it
 * @param key - The key the target's state is kept under
 * @param slot - The kind's slot
 * @param kind - The event kind
 * @param source - The `source` given; `undefined` for none
 * @returns The slice as a builder's `slice` takes it; `undefined` with no `source`
 * @throws {Error} As `Slice.bindRecords` refuses the source, named for the target
 */
function kindSlice<T extends EastType>(
    $: BlockBuilder<T>, where: string, key: string, slot: string, kind: ScheduleEventKind<EastType, EastType>, source: unknown,
): RecordSlicesChromeOptions | undefined {
    if (source === undefined) return undefined;
    const handle = asTarget(where, () => Slice.bindRecords(key, { [slot]: { source, range: kind.times.start } } as never));
    const slice = $.let(handle);
    return { slice: slice as never };
}

/**
 * The event kind a Plan's or a Calendar's target's tags patch: `event`, or the
 * one kind `events` holds.
 *
 * @param where - The target, as a refusal names it
 * @param events - The event kinds, by slot
 * @param event - The `event` given
 * @returns Its slot and the kind
 * @throws {Error} When `events` holds none, or more than one and `event` names none of them
 */
function patchedKind(where: string, events: EventKinds, event: unknown): readonly [string, ScheduleEventKind<EastType, EastType>] {
    const slots = Object.keys(events);
    if (slots.length === 0) {
        throw new Error(`${where}: \`events\` holds the event kinds, as the builder takes them — at least one, the kind the tags patch: ` +
            "events: { job: Schedule.events(Record.bind(jobs), { … }) }");
    }
    if (event === undefined) {
        if (slots.length > 1) {
            throw new Error(`${where}: \`event\` names the kind the tags patch, one of \`events\` (${slots.join(", ")}) — needed with more than ` +
                "one kind, the others drawn as context");
        }
        return [slots[0]!, events[slots[0]!]!];
    }
    if (typeof event !== "string" || events[event] === undefined) {
        throw new Error(`${where}: \`event\` names the kind the tags patch, one of \`events\` (${slots.join(", ")}) — and it is ${String(event)}`);
    }
    return [event, events[event]];
}

/**
 * The Locked mark of a target over an event kind, read from the kind's row.
 *
 * @param where - The target, as a refusal names it
 * @param kind - The kind the tags patch
 * @param locked - The `locked` given
 * @returns `(bytes, id)` → whether the row is locked; `undefined` with no `locked`
 * @throws {Error} When `locked` is no function, or returns no Boolean
 */
function lockedOf(where: string, kind: ScheduleEventKind<EastType, EastType>, locked: unknown) {
    return decisionTargetRole(kind.keyType, kind.rowType as StructType, where, "locked", BooleanType, "a Boolean", locked, false);
}

// ============================================================================
// The Roster's
// ============================================================================

/** What a Roster target takes as `<Roster>` takes it, beside the duty kind. */
type RosterTaken = "resources" | "shifts" | "groups" | "positions" | "activities" | "rules" | "check" | "pay" | "currency" | "week";

/**
 * A Roster target's own (§5.3): its names, the Roster's props as `<Roster>`
 * takes them — the duty kind, the people and agencies, the shifts, groups,
 * positions and activities, the rules, the app's check and pay — how its map
 * reads, the duties' source and the Locked mark.
 *
 * @typeParam K - The duties' key type
 * @typeParam R - The duty row type
 */
export interface DecisionRosterTargetConfig<K extends EastType, R extends StructType> extends Pick<RosterProps<R>, RosterTaken>, DecisionTargetNames {
    /** The duty kind, as `<Roster>` takes it — `{ duty: Schedule.events(Record.bind(duties), { start, end, resource, shift, group, … }) }` — its record the one the tags patch. */
    events: RosterProps<R>["events"] & Readonly<Record<string, ScheduleEventKind<K, R>>>;
    /** How the map reads: a row per person (`"people"`, the default), or a row per pay code (`"cost"`), which takes `pay` (P7). */
    map?: "people" | "cost";
    /** The duties read through an interval index from their start to their end, `Data.bindPaged(duties, { indexes: ["by_time"] })` — the read the Roster's slice names for its duty kind; without it, the duties as the kind is bound. */
    source?: unknown;
    /** Whether a duty is locked: the Locked mark. */
    locked?: LockedRole<K, R>;
}

/**
 * Declares a target over the duties the Roster draws (§5.3): the touched
 * people's duties over the change's week, as the Roster draws them — the crop,
 * each person's row with their hours before → after; the map by people, or
 * with `map: "cost"` by pay code, the Roster's own pay over the week before
 * and after. Modify edits a duty in the Roster's form for one duty; Apply
 * writes the change through the duty kind's own write.
 *
 * @typeParam K - The duties' key type, from the duty kind
 * @typeParam R - The duty row type, from the duty kind
 * @param config - Its names, the Roster's props as `<Roster>` takes them, its map, the duties' source and the Locked mark
 * @returns The target, for the change role's `of`
 * @throws {Error} Naming what to give: `events` holding other than one kind, a `map` other than "people" or "cost",
 *   `map: "cost"` without `pay`, a `locked` that is no function or returns no Boolean, and `name` or `icon` no text — and,
 *   as the queue builds the target, everything `<Roster>` refuses of the same props, and a `source` `Slice.bindRecords`
 *   refuses
 *
 * @example
 * ```tsx
 * const rotaChange = DecisionQueue.change.roster({ name: "Roster", icon: "users",
 *     events: { duty }, resources: { people, agencies }, shifts, groups, week: { start: "sunday" }, source: dutyWeek });
 * ```
 */
export function decisionQueueRosterTarget<K extends EastType, R extends StructType>(
    config: DecisionRosterTargetConfig<K, R>,
): DecisionQueueTarget<DictType<K, R>> {
    const where = "DecisionQueue.change.roster";
    const given = (config ?? {}) as unknown as Partial<DecisionRosterTargetConfig<EastType, StructType>>;
    const kinds = Object.entries(given.events ?? {});
    if (kinds.length !== 1) {
        throw new Error(kinds.length === 0
            ? `${where}: \`events\` holds the duty kind, as <Roster> takes it — events: { duty: Schedule.events(Record.bind(duties), { start, end, resource, shift, group }) }`
            : `${where}: \`events\` holds one kind, the duties, as <Roster> takes it — and it holds ${kinds.length} (${kinds.map(([slot]) => slot).join(", ")})`);
    }
    const [slot, kind] = kinds[0]!;
    const map = given.map ?? "people";
    if (map !== "people" && map !== "cost") {
        throw new Error(`${where}: \`map\` is "people", a row per person, or "cost", a row per pay code — and it is ${String(given.map)}`);
    }
    if (map === "cost" && given.pay === undefined) {
        throw new Error(`${where}: \`map: "cost"\` reads the change by what it costs, a row per pay code — give \`pay\`, the Roster's own, ` +
            "with its `currency` (P7)");
    }
    const locked = lockedOf(where, kind, given.locked);
    const { name: _name, icon: _icon, map: _map, source, locked: _locked, ...roster } = given;
    return decisionTarget(where, given, kind.keyType, kind.rowType as StructType, locked, undefined, (key) => Expr.block(($) => {
        const slice = kindSlice($, where, key, slot, kind, source);
        // The Roster over the same props, its inspector the form Modify edits a duty in; named for the queue's state,
        // apart from a <Roster> beside it.
        const payload = asTarget(where, () => createRosterPayload({
            ...roster, ...(slice === undefined ? {} : { slice }), inspector: true, id: key,
        } as RosterProps<EastType>));
        return East.value(variant("roster", { roster: payload, slot, map: variant(map, null) }) as never, DecisionTargetKindType);
    }) as ExprType<typeof DecisionTargetKindType>);
}

// ============================================================================
// The Plan's
// ============================================================================

/**
 * A Plan target's own (§5.3): its names, the Plan's event kinds and resource
 * kinds as `<Plan>` takes them, the kind the tags patch, its source and the
 * Locked mark.
 *
 * @typeParam E - The event kinds, by slot
 * @typeParam V - The slot of the kind the tags patch
 */
export interface DecisionPlanTargetConfig<E extends NonNullable<PlanProps["events"]>, V extends keyof E & string>
    extends Pick<PlanProps, "resources">, DecisionTargetNames {
    /** The event kinds, as `<Plan>` takes them — `{ job: Schedule.events(Record.bind(jobs), { … }) }`: the kind the tags patch, and any drawn as context. */
    events: E;
    /** The slot of the kind the tags patch, a key of `events`: needed with more than one, the others drawn as context. */
    event?: V;
    /** The kind's events read through an interval index from their start to their end, `Data.bindPaged(jobs, { indexes: ["by_time"] })` — the read the Plan's slice names for the kind; without it, its events as the kind is bound. */
    source?: unknown;
    /** Whether an event of the kind is locked: the Locked mark. */
    locked?: LockedRole<KindKey<E[V]>, KindRow<E[V]>>;
}

/**
 * Declares a target over the events a Plan draws (§5.3): the touched
 * resources' events over the change's span, padded to whole hours, as the
 * Plan draws them — the crop, each lane's resource and its booked share before
 * → after; the map, the resources as tiles by their kind's `group`. Modify
 * edits an event in the Plan's form for one event; Apply writes the change
 * through the kind's own write.
 *
 * @typeParam E - The event kinds, by slot, as `events` gives them
 * @typeParam V - The slot of the kind the tags patch
 * @param config - Its names, the kinds as `<Plan>` takes them, the kind the tags patch, its source and the Locked mark
 * @returns The target, for the change role's `of`
 * @throws {Error} Naming what to give: no event kind, more than one with no `event`, an `event` naming none of them, a
 *   `locked` that is no function or returns no Boolean, `name` or `icon` no text, and the kinds as `<Plan>` refuses them —
 *   a resource naming a slot `resources` has not, a kind with no `title`, a resource kind with no event kind on it and no
 *   measures, more than one paged resource kind, and an event kind on a paged one read but through its source's series
 *   and summary indexes — and, as the queue builds the target, a `source` `Slice.bindRecords` refuses and the indexes it
 *   lists as `<Plan>` refuses them
 *
 * @example
 * ```tsx
 * const printChange = DecisionQueue.change.plan({ name: "Plan", icon: "bars-progress", events: { job }, resources: { presses: pressRows } });
 * ```
 */
export function decisionQueuePlanTarget<E extends NonNullable<PlanProps["events"]>, V extends keyof E & string = keyof E & string>(
    config: DecisionPlanTargetConfig<E, V>,
): DecisionQueueTarget<KindRecord<E[V]>> {
    const where = "DecisionQueue.change.plan";
    const given = (config ?? {}) as unknown as Partial<DecisionPlanTargetConfig<EventKinds, string>>;
    const events = (given.events ?? {}) as EventKinds;
    const [slot, kind] = patchedKind(where, events, given.event);
    const resources = (given.resources ?? {}) as ResourceKinds;
    // The kinds, as <Plan> refuses them.
    scheduleCheck(resources, events, where);
    scheduleTitled(events, where);
    const resourceKinds = Object.entries(resources);
    const eventKinds = Object.entries(events);
    checkSchedulePagedKinds(resourceKinds, where, "a target");
    const source = given.source;
    checkSchedulePagedEventKinds(resourceKinds, eventKinds, source === undefined ? [] : [slot], where);
    asTarget(where, () => checkEventRows(resourceKinds, eventKinds, undefined, undefined));
    const locked = lockedOf(where, kind, given.locked);
    return decisionTarget(where, given, kind.keyType, kind.rowType as StructType, locked, undefined, (key) => Expr.block(($) => {
        const bound = recordSources(kindSlice($, where, key, slot, kind, source), { builder: where, names: [slot], what: `its event kind (${slot})` }).bind($);
        const part = bound.parts[slot];
        // The series and summary indexes the source lists, as the Plan reads them.
        if (part !== undefined) $(checkedScheduleTilings(slot, kind, resourceKinds, (part as unknown as { config: ExprType<RecordSliceConfigType> }).config, where));
        return East.value(variant("plan", {
            // The kind the tags patch read through its source, when it has one; the others as they are bound.
            events: eventKinds.map(([s, k]) => k.buildPlan(s, s === slot ? part : undefined)),
            resources: resourceKinds.map(([s, k]) => k.buildPlan(s)),
            event: slot,
        }) as never, DecisionTargetKindType);
    }) as ExprType<typeof DecisionTargetKindType>);
}

// ============================================================================
// The Calendar's
// ============================================================================

/**
 * A Calendar target's own (§5.3): its names, the Calendar's event kinds,
 * resource kinds and week as `<Calendar>` takes them, the kind the tags patch
 * and its source.
 *
 * @typeParam E - The event kinds, by slot
 * @typeParam V - The slot of the kind the tags patch
 */
export interface DecisionCalendarTargetConfig<E extends CalendarProps["events"], V extends keyof E & string>
    extends Pick<CalendarProps, "resources" | "week">, DecisionTargetNames {
    /** The event kinds, as `<Calendar>` takes them — `{ job: Calendar.events(Record.bind(jobs), { … }) }`: the kind the tags patch, and any drawn as context. */
    events: E;
    /** The slot of the kind the tags patch, a key of `events`: needed with more than one, the others drawn as context. */
    event?: V;
    /** The kind's events read through an interval index from their start to their end, `Data.bindPaged(jobs, { indexes: ["by_time"] })` — the read the Calendar's slice names for the kind; without it, its events as the kind is bound. */
    source?: unknown;
}

/**
 * Declares a target over the events a Calendar draws (§5.3): the touched
 * days' events on the change's resources, as the Calendar draws them — the
 * crop, a lane a day with its overlaps before → after; the map, as the
 * Plan's. Modify edits an event in the Calendar's form for one event; Apply
 * writes the change through the kind's own write.
 *
 * @typeParam E - The event kinds, by slot, as `events` gives them
 * @typeParam V - The slot of the kind the tags patch
 * @param config - Its names, the kinds and the week as `<Calendar>` takes them, the kind the tags patch and its source
 * @returns The target, for the change role's `of`
 * @throws {Error} Naming what to give: no event kind, more than one with no `event`, an `event` naming none of them,
 *   `name` or `icon` no text, and the kinds as `<Calendar>` refuses them — a resource naming a slot `resources` has not,
 *   a kind with no `title`, more than one paged resource kind, and an event kind on a paged one read but through its
 *   source's series and summary indexes — and, as the queue builds the target, a `source` `Slice.bindRecords` refuses and
 *   the indexes it lists as `<Calendar>` refuses them
 *
 * @example
 * ```tsx
 * const workshopChange = DecisionQueue.change.calendar({ name: "Calendar", icon: "calendar-days",
 *     events: { job: machineJob }, resources: { machines: machineRows } });
 * ```
 */
export function decisionQueueCalendarTarget<E extends CalendarProps["events"], V extends keyof E & string = keyof E & string>(
    config: DecisionCalendarTargetConfig<E, V>,
): DecisionQueueTarget<KindRecord<E[V]>> {
    const where = "DecisionQueue.change.calendar";
    const given = (config ?? {}) as unknown as Partial<DecisionCalendarTargetConfig<EventKinds, string>>;
    const events = (given.events ?? {}) as EventKinds;
    const [slot, kind] = patchedKind(where, events, given.event);
    const resources = (given.resources ?? {}) as ResourceKinds;
    // The kinds, as <Calendar> refuses them.
    scheduleCheck(resources, events, where);
    scheduleTitled(events, where);
    const resourceKinds = Object.entries(resources);
    const eventKinds = Object.entries(events);
    checkSchedulePagedKinds(resourceKinds, where, "a target");
    const source = given.source;
    checkSchedulePagedEventKinds(resourceKinds, eventKinds, source === undefined ? [] : [slot], where);
    const weekStart = given.week?.start ?? "monday";
    return decisionTarget(where, given, kind.keyType, kind.rowType as StructType, undefined, undefined, (key) => Expr.block(($) => {
        const bound = recordSources(kindSlice($, where, key, slot, kind, source), { builder: where, names: [slot], what: `its event kind (${slot})` }).bind($);
        const part = bound.parts[slot];
        // The series and summary indexes the source lists, as the Calendar reads them.
        if (part !== undefined) $(checkedScheduleTilings(slot, kind, resourceKinds, (part as unknown as { config: ExprType<RecordSliceConfigType> }).config, where));
        // A paged resource kind's resources come a window at a time, one by its key where an event names it.
        const paged = createCalendarPaged(resourceKinds);
        return East.value(variant("calendar", {
            // The kind the tags patch read through its source, when it has one; the others as they are bound.
            events: eventKinds.map(([s, k]) => k.build(s, s === slot ? part : undefined)),
            resources: resourceKinds.map(([s, k]) => k.build(s)),
            paged: paged === undefined ? none : some(paged),
            weekStart: variant(weekStart, null),
            event: slot,
        }) as never, DecisionTargetKindType);
    }) as ExprType<typeof DecisionTargetKindType>);
}

// ============================================================================
// The Allocation's
// ============================================================================

/** What an Allocation target takes as `<Allocation>` takes it, beside the bin kind and its arrivals. */
type AllocationTaken = "resources" | "rules" | "check" | "labels" | "every";

/**
 * An Allocation target's own (§5.3): its names, the Allocation's props as
 * `<Allocation>` takes them — the bin kind, the lanes' and the resources'
 * kinds, and its arrivals, rules, check, nouns and slot spacing, optional here
 * — and the bins' source.
 *
 * @typeParam K - The bins' key type
 * @typeParam R - The bin row type
 */
export interface DecisionAllocationTargetConfig<K extends EastType, R extends StructType>
    extends Pick<AllocationProps<R>, AllocationTaken>, Partial<Pick<AllocationProps<R>, "arrivals">>, DecisionTargetNames {
    /** The bin kind, as `<Allocation>` takes it — `{ bin: Schedule.events(Record.bind(bins), { at, resource, arrival, quantity, parts, hold }) }` — its record the one the tags patch. */
    events: AllocationProps<R>["events"] & Readonly<Record<string, ScheduleEventKind<K, R>>>;
    /** The bins read through an interval index from `at` to `at`, `Data.bindPaged(bins, { indexes: ["by_time"] })` — the read the Allocation's slice names for its bin kind; without it, the bins as the kind is bound. */
    source?: unknown;
}

/**
 * Declares a target over the bins an Allocation draws (§5.3): the touched
 * resources' bins over the change's days, as the Allocation draws them — the
 * crop, a lane a resource with its load before → after and a breach by
 * `check`, and with `arrivals` a Waiting lane; the map, the resources as tiles
 * by group. Modify edits a bin in the Allocation's form for one bin; Apply
 * writes the change through the bin kind's own write.
 *
 * @typeParam K - The bins' key type, from the bin kind
 * @typeParam R - The bin row type, from the bin kind
 * @param config - Its names, the Allocation's props as `<Allocation>` takes them, and the bins' source
 * @returns The target, for the change role's `of`
 * @throws {Error} Naming what to give: the bin kind and the resource kinds as `<Allocation>` refuses them, `arrivals`
 *   that are no `Allocation.arrivals`, a `check` over another type, an empty noun, and `name` or `icon` no text — and, as
 *   the queue builds the target, a `source` `Slice.bindRecords` refuses and the bin kind's read as `<Allocation>` refuses it
 *
 * @example
 * ```tsx
 * const yardChange = DecisionQueue.change.allocation({ name: "Allocation", icon: "fire-flame-curved",
 *     events: { bin }, resources: { bays: bayRows, kilns: kilnRows }, source: yardDayBins });
 * ```
 */
export function decisionQueueAllocationTarget<K extends EastType, R extends StructType>(
    config: DecisionAllocationTargetConfig<K, R>,
): DecisionQueueTarget<DictType<K, R>> {
    const where = "DecisionQueue.change.allocation";
    const given = (config ?? {}) as unknown as Partial<DecisionAllocationTargetConfig<EastType, StructType>>;
    // The kinds and the app's functions, as <Allocation> refuses them.
    const { slot, kind, lanesKind, resourcesKind } = asTarget(where, () => allocationKinds(given as Pick<AllocationProps, "events" | "resources">));
    const arrivals = given.arrivals;
    if (arrivals !== undefined && !isAllocationArrivals(arrivals)) {
        throw new Error(`${where}: \`arrivals\` is Allocation.arrivals(rows, { label, quantity, hold, … }) over the app's rows, as <Allocation> takes it — ` +
            "the Waiting lane's");
    }
    const rowType = kind.rowType as StructType;
    const check = given.check === undefined ? undefined : asTarget(where, () => allocationCheckOf(given.check, rowType));
    const labels = asTarget(where, () => allocationLabels(given.labels));
    const under = given.rules?.under ?? true;
    const every = given.every ?? variant("hours", 1.0);
    const source = given.source;
    return decisionTarget(where, given, kind.keyType, rowType, undefined, undefined, (key) => Expr.block(($) => {
        const bound = recordSources(kindSlice($, where, key, slot, kind, source), { builder: where, names: [slot], what: `its bins (${slot})` }).bind($);
        return East.value(variant("allocation", {
            // The bins read through their source, when they have one; the lanes, the resources and the arrivals whole.
            bin: asTarget(where, () => kind.buildAllocation(slot, bound.parts[slot])),
            lanes: allocationLanesOf(lanesKind),
            resources: allocationResourcesOf(resourcesKind),
            arrivals: arrivals === undefined ? none : some(allocationArrivalsOf(arrivals)),
            every,
            check: check === undefined ? none : some(check),
            rules: { under },
            labels,
        }) as never, DecisionTargetKindType);
    }) as ExprType<typeof DecisionTargetKindType>);
}

// ============================================================================
// The Sheet's
// ============================================================================

/**
 * A Sheet target's own (§5.3): its names, the Sheet's columns as `<Sheet>`
 * takes them, and a paged read of the record to read the touched rows by key.
 *
 * @typeParam R - The record's row type
 */
export interface DecisionSheetTargetConfig<R extends StructType> extends DecisionTargetNames {
    /** The columns, built with `Sheet.column.*` as `<Sheet>` takes them: the preview's columns after the first, those the change touches. */
    columns: NoInfer<SheetColumnSpec<R>>;
    /** A paged read of the record's own entries, `Data.bindPaged(record)`: the touched rows read by key, never the record whole. */
    entries?: unknown;
}

/**
 * Declares a target over a record the Sheet draws (§5.3): the first three
 * changed rows in the Sheet's columns, a guessed row's changed cells with the
 * dot (P26). Modify edits a row in the Sheet's Details; Apply writes the
 * change through the record's patch door.
 *
 * @typeParam K - The record's key type
 * @typeParam R - The record's row type, from the binding
 * @param binding - The record, `Record.bind(record), its record declaring patch: mutation.patch()`, as `<Sheet record>` takes it
 * @param config - Its names, the columns, and `entries` to read the touched rows by key
 * @returns The target, for the change role's `of`
 * @throws {Error} Naming what to give: a record bound read only or without its patch door, rows that are no structs,
 *   `entries` that are no paged read of the record's own entries, and — as the queue builds the target — the columns as
 *   `<Sheet>` refuses them
 *
 * @example
 * ```tsx
 * const workOrders = $.let(Record.bind(optimiseWorkOrders));
 * const orderChange = DecisionQueue.change.sheet(workOrders, { name: "Sheet", icon: "table-cells", columns: {
 *     reference: Sheet.column.text(OptimiseWorkOrder, { header: "Reference" }),
 *     due: Sheet.column.date(OptimiseWorkOrder, { header: "Due" }),
 * } });
 * ```
 */
export function decisionQueueSheetTarget<K extends EastType, R extends StructType>(
    binding: SheetRecordHandle<K, R>, config: DecisionSheetTargetConfig<R>,
): DecisionQueueTarget<DictType<K, R>> {
    const where = "DecisionQueue.change.sheet";
    const given = (config ?? {}) as Partial<DecisionSheetTargetConfig<StructType>>;
    const type = binding instanceof Expr ? Expr.type(binding) as EastType : undefined;
    const fields = type?.type === "Struct" ? type.fields as Record<string, EastType> : undefined;
    const read = fields?.["read"];
    if (fields === undefined || read === undefined || read.type !== "Function" || fields["binding"] === undefined) {
        throw new Error(`${where}: the record is the app's record the Sheet draws, bound with its patch door — ${PATCH_DOOR}`);
    }
    if (fields["mutate"] === undefined) {
        throw new Error(`${where}: the record is bound read only — Apply writes a change through its patch door: bind it ${PATCH_DOOR}`);
    }
    const recordType = read.output as EastType;
    if (recordType.type !== "Dict" || (recordType.value as EastType).type !== "Struct") {
        throw new Error(`${where}: the Sheet's rows are the record's entries, each a struct — and this record holds ${typeText(recordType)}`);
    }
    const keyType = recordType.key as EastType;
    const rowType = recordType.value as StructType;
    const entries = given.entries === undefined ? undefined : checkEntries(given.entries, keyType, rowType, `${where}: \`entries\``);
    // The queue's own session over the record — whole rows, as a record target's side holds it — which Apply drafts a
    // change's rows into: the Sheet's own drafts a field at a time. Read by key through `entries`, or whole.
    const session = asTarget(where, () => scheduleRecordSession(binding, keyType, rowType, entries).build());
    return decisionTarget(where, given, keyType, rowType, undefined, undefined, (key) => East.value(variant("sheet", {
        // The Sheet over the record, its Details the form Modify edits a row in; named for the queue's state, apart from
        // a <Sheet> beside it.
        sheet: asTarget(where, () => createSheetPayload({
            record: binding, ...(entries === undefined ? {} : { window: entries }), columns: given.columns, inspector: true, name: key,
        })),
        editing: session.editing,
        entries: session.entries,
    }) as never, DecisionTargetKindType) as ExprType<typeof DecisionTargetKindType>);
}

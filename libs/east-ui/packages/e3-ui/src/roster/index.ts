/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Roster>` (#1368, `Builder Interfaces Spec.md` §5): staffing over the
 * app's own records, in the renderer's BuilderFrame. It writes the app's
 * duties through the duty kind's roles (`Schedule.events`), reads its people
 * and agencies (`Schedule.resources`), publishes its weeks
 * (`Schedule.periods`) and writes its targets (`Roster.targets`), with the
 * lists it reads over the app's rows (`Roster.shifts`, `groups`, `positions`,
 * `activities`, `proposals`). It stores nothing in a shape of its own.
 *
 * The tag validates, builds the people and agencies from their kinds'
 * accessors, and assembles the closed payload; it composes no East UI
 * component and emits no layout, session or gesture program. The app's duty
 * row type `R` crosses the payload as beast2 bytes, as Schedule's kinds' rows
 * do: the app's `pay` and `check` over bytes at `PayRequest(R)` and
 * `CheckContext(R)`, and the fit's binding checked against `FitRequest(R)`.
 * The renderer compiles the Roster's functions over `R`, the duty kind's
 * `rowType`.
 *
 * @packageDocumentation
 */

import {
    ArrayType, BlobType, BooleanType, DateTimeType, East, Expr, FunctionType, NullType, OptionType, SetType, StringType, StructType, VariantType,
    isTypeEqual, none, printType, some, variant,
    type EastType, type ExprType, type SubtypeExprOrValue,
} from "@elaraai/east";
import { EastUI, type UIElement } from "@elaraai/east-ui";
import { RecordSlicesChromeType, RowSourceType, type RecordSlicesChromeOptions } from "@elaraai/east-ui/internal";
import { FuncBindingType, boundFuncSignature, type BoundFunc } from "../bind/func.js";
import { scheduleCheck } from "../schedule/index.js";
import type { ScheduleEventKind } from "../schedule/events.js";
import { ScheduleAuthorTabType, buildScheduleTab } from "../schedule/library.js";
import type { SchedulePeriods } from "../schedule/periods.js";
import type { ScheduleResourceKind } from "../schedule/resources.js";
import { ScheduleClockType, SchedulePeriodsKindType, ScheduleRosterKindType } from "../schedule/types.js";
import { recordSources } from "../utils/record-sources.js";
import { rosterCoverage, rosterWeekHours } from "./coverage.js";
import { rosterAnswer, rosterFit } from "./fit.js";
import { rosterActivitiesTab, rosterLibraryTab, rosterPeopleTab, type RosterLibraryTab } from "./library.js";
import {
    isRosterList, rosterActivities, rosterGroups, rosterPositions, rosterProposals, rosterShifts,
    type RosterGroups, type RosterPositions, type RosterProposals, type RosterShifts,
} from "./lists.js";
import { rosterCheck, rosterRest } from "./rules.js";
import { isRosterTargets, rosterTargets, type RosterTargets } from "./targets.js";
import * as T from "./types.js";

// ============================================================================
// The payload
// ============================================================================

/** Roster's layout: group shifts, or people across the week. */
export const RosterLayoutType = VariantType({ shifts: NullType, people: NullType });
/** Roster's displayed period. People always shows the whole week. */
export const RosterPeriodType = VariantType({ day: NullType, week: NullType });
/** A declared library tab: the People tab, the Activities tab, or an app's tab, its cards resolved over the duty kind. */
export const RosterLibraryTabType = VariantType({ people: NullType, activities: NullType, tab: ScheduleAuthorTabType });

/**
 * The closed renderer payload. BuilderFrame is internal to the renderer.
 * @property duty - The duty kind: the app's duties read and written through their roles, over bytes at the row type
 * @property people - Every person, from the `people` resource kind's accessors: the calculation scope, whatever the slice shows
 * @property agencies - Every agency, from the `agencies` resource kind's
 * @property periods - The app's weeks: their status and dismissals, and Publish; `none`, no Publish
 * @property targets - The app's targets, a row per slot; `none`, no slot has a target
 * @property groups - The groups, in their order
 * @property shifts - The shifts, in their order
 * @property activities - Every activity: each group's skills and the duties of no group
 * @property positions - The positions, in their order; none for a duty kind with no `position` role
 * @property proposals - The app's suggestions, in key order
 * @property rules - The built-in rules
 * @property pay - The app's pay, from a `PayRequest(R)` as bytes to each duty's cost by code; `none`, no costs show
 * @property currency - How costs print
 * @property check - The app's issues, from a `CheckContext(R)` as bytes
 * @property fit - The app's fit, by its `e3.function`'s name: who fits a Find fix's need; `none`, no Find fix is offered (#1334)
 * @property library - The library's tabs, in order
 * @property inspector - Whether the inspector pane shows
 * @property narrowed - Each narrowed source's keys, paged through its part of `slice`: the people and the activities that show (#1342)
 * @property slice - The narrowing's chrome: a Slice over the duties', the targets', the staff's and the activities' records, one rail
 * @property settings - The first view and the view settings
 * @property id - The viewer's identity
 */
export const RosterPayloadType = StructType({
    duty: ScheduleRosterKindType,
    people: ArrayType(T.RosterPersonType),
    agencies: ArrayType(T.RosterAgencyType),
    periods: OptionType(SchedulePeriodsKindType),
    targets: OptionType(T.RosterTargetsKindType),
    groups: ArrayType(T.RosterGroupType),
    shifts: ArrayType(T.RosterShiftType),
    activities: ArrayType(T.RosterSkillType),
    positions: ArrayType(T.RosterPositionType),
    proposals: ArrayType(T.RosterProposalType),
    rules: T.RosterRulesType,
    pay: OptionType(FunctionType([BlobType], T.RosterPayType)),
    currency: OptionType(StringType),
    check: OptionType(FunctionType([BlobType], ArrayType(T.RosterIssueType))),
    fit: OptionType(FuncBindingType),
    library: ArrayType(RosterLibraryTabType),
    inspector: BooleanType,
    narrowed: StructType({ people: OptionType(RowSourceType(ArrayType(StringType))), activities: OptionType(RowSourceType(ArrayType(StringType))) }),
    slice: OptionType(RecordSlicesChromeType),
    settings: StructType({
        layout: RosterLayoutType, period: RosterPeriodType, date: OptionType(DateTimeType),
        weekStart: VariantType({ monday: NullType, sunday: NullType }),
        density: VariantType({ compact: NullType, comfortable: NullType }), chipSkills: BooleanType, requirements: BooleanType, readOnly: BooleanType,
    }),
    id: OptionType(StringType),
});
/** Carrier registered by e3-ui-components. */
export const RosterComponent = EastUI.component("Roster", RosterPayloadType, { optional: true });

// ============================================================================
// The props
// ============================================================================

/**
 * The Roster's props (§5.1).
 *
 * @typeParam R - The app's duty row type: the duty kind's row
 */
export interface RosterProps<R extends EastType = EastType> {
    /** Exactly one event kind, the duties: `{ duty: Schedule.events(Record.bind(duties, [dutiesPatch]), { start, end, resource, shift, group, … }) }`. */
    events: Readonly<Record<string, ScheduleEventKind<EastType, R>>>;
    /**
     * Who is rostered: `people`, the staff — `Schedule.resources(staff.read(), { name, icon, label, group, … })`, every
     * person the calculation scope — and optionally `agencies`, whom positions are requested from.
     */
    resources: { readonly people: ScheduleResourceKind<EastType, EastType>; readonly agencies?: ScheduleResourceKind<EastType, EastType> };
    /** What it publishes, the app's weeks: `Schedule.periods(Record.bind(weeks, [weeksPatch]), { every: "week", status, dismissed? })`. Omitted, no Publish. */
    periods?: SchedulePeriods;
    /** The app's targets, a row per slot: `Roster.targets(Record.bind(cover, [coverPatch]), { day, group, shift, positions, hours })`. */
    targets?: RosterTargets;
    /** The shifts: `Roster.shifts(rows, { label, code, start, hours, order? })`. */
    shifts: RosterShifts;
    /** The groups: `Roster.groups(rows, { label, order? })`. */
    groups: RosterGroups;
    /** The positions: `Roster.positions(rows, { label, code, lead, order? })`; taken only beside a duty kind with a `position` role. */
    positions?: RosterPositions;
    /**
     * Every activity, commonly `Roster.activities(bound.read(), accessors)` over a keyed activities record: each group's skills
     * (an activity of that group) and the duties every group shares (an activity of none). Coverage and checks read every one.
     */
    activities?: SubtypeExprOrValue<ArrayType<T.RosterSkillType>>;
    /** The app's suggestions: `Roster.proposals(rows, { person, day, group, shift, reason })`. */
    proposals?: RosterProposals;
    /**
     * The app's pay (§5.6): an East function from `Roster.Types.PayRequest(R)` — one person's duties for the week, or one agency's
     * requests — to `Roster.Types.Pay`, each duty's cost by the app's own pay codes. Asked a person at a time; omitted, no costs show.
     */
    pay?: SubtypeExprOrValue<FunctionType<[T.RosterPayRequestTypeFor<R>], T.RosterPayType>>;
    /** How costs print, an ISO 4217 code (`"EUR"`); required with `pay`. */
    currency?: string;
    /** The built-in rules, plain values: ten hours' rest, and the lead (with positions), trainer and skill checks, by default. */
    rules?: { rest?: number; lead?: boolean; trainer?: boolean; skill?: boolean };
    /** The app's issues over the complete draft: an East function from `Roster.Types.CheckContext(R)` to `Array<Roster.Types.Issue>`. */
    check?: SubtypeExprOrValue<FunctionType<[T.RosterCheckContextTypeFor<R>], ArrayType<typeof T.RosterIssueType>>>;
    /**
     * The app's fit: `Func.bind` of its `e3.function` from `Roster.Types.FitRequest(R)` to `Roster.Types.FitResult`. A Find fix (find a
     * lead, a trainer, skilled staff) asks it who fits the issue's need on its slot, over the complete staff, and the People tab
     * shows its fits best first, each with its reason. `Roster.fit(R)` is the ready-made rule, `Roster.answer(R)` maps a rule over
     * every person. Omitted, no Find fix is offered; `Roster.check(R)` still reports the issue.
     */
    fit?: BoundFunc<[T.RosterFitRequestTypeFor<R>], T.RosterFitResultType>;
    /**
     * The narrowing: one `Slice.bindRecords`, a source per record it narrows — the duty kind's slot (its interval index from the
     * start to the end, its `range` the start field, which the Roster's navigation writes), `targets`, `people` and `activities`,
     * and any an app's tab names. Coverage, pay, checks and fits still read every duty of the week, person and activity.
     */
    slice?: RecordSlicesChromeOptions;
    /** Tabs to show; omitted, no library pane. */
    library?: readonly RosterLibraryTab[];
    /** Shows the inspector pane: the duty kind's own `inspector` and `Roster.targets`' `inspector` draw in it where given. */
    inspector?: boolean;
    /** Initial view, persisted under id. */
    view?: { layout?: "shifts" | "people"; period?: "day" | "week"; date?: SubtypeExprOrValue<DateTimeType> };
    /** Week boundary; Monday by default. */
    week?: { start?: "monday" | "sunday" };
    /** Assignment spacing; comfortable by default. */
    density?: "compact" | "comfortable";
    /** Shows held skill codes on assignment chips. */
    chipSkills?: SubtypeExprOrValue<BooleanType>;
    /** Shows requirement rows in the shift grid. */
    requirements?: SubtypeExprOrValue<BooleanType>;
    /** Disables edits; published weeks are always read-only. */
    readOnly?: SubtypeExprOrValue<BooleanType>;
    /** Stable viewer identity when multiple Rosters share a surface. */
    id?: string;
}

/** The props §2 removed, each refused by name with the form that replaces it. */
const REMOVED: readonly (readonly [string, string])[] = [
    ["weeks", "`weeks` is gone — the Roster writes the app's own duties, events={{ duty: Schedule.events(Record.bind(duties, [dutiesPatch]), " +
        "{ start, end, resource, shift, group }) }}, and publishes the app's own weeks, periods={Schedule.periods(Record.bind(weeks, [weeksPatch]), { every: \"week\", status })}"],
    ["window", "`window` is gone — the Roster reads a week's duties through the duty kind's source of its slice, an interval index from the start to the " +
        "end: slice={{ slice: Slice.bindRecords(key, { duty: { source: Data.bindPaged(duties, { indexes: [byTime] }), range: \"start\" } }) }}, the kind given " +
        "`entries`; or the record whole"],
    ["people", "`people` moves to `resources`: resources={{ people: Schedule.resources(staff.read(), { name, icon, label, group, … }) }}, every person's " +
        "position, skills, contract and flags its accessors"],
    ["agencies", "`agencies` moves to `resources`: resources={{ people, agencies: Schedule.resources(firms.read(), { name, icon, label }) }}"],
    ["forecast", "`forecast` is gone — the targets are the app's own record, which its forecast fills: " +
        "targets={Roster.targets(Record.bind(cover, [coverPatch]), { day, group, shift, positions, hours })}"],
    ["costs", "`costs` is gone — pay is the app's own, in its own pay codes: pay={…} currency=\"…\", an East function from " +
        "Roster.Types.PayRequest(R) to Roster.Types.Pay"],
    ["visiblePeople", "`visiblePeople` is gone — the Roster reads its people from `slice`'s `people` source: " +
        "slice={{ slice: Slice.bindRecords(key, { people, activities }) }}"],
    ["duties", "`duties` is gone — a duty is an activity of no group in `activities` (Roster.activities)"],
];

/** The lists the Roster reads, each its declaration's words. */
const LISTS: readonly (readonly ["shifts" | "groups" | "positions" | "proposals", string])[] = [
    ["shifts", "Roster.shifts(rows, { label, code, start, hours, order? }) over the app's shift rows"],
    ["groups", "Roster.groups(rows, { label, order? }) over the app's group rows"],
    ["positions", "Roster.positions(rows, { label, code, lead, order? }) over the app's position rows"],
    ["proposals", "Roster.proposals(rows, { person, day, group, shift, reason }) over the app's suggestion rows"],
];

/** A kind's accessor's value for a row, or `otherwise` when the kind has no such accessor. */
type Call = <T extends EastType>(fn: ExprType<FunctionType<[EastType, EastType], T>> | undefined, otherwise: SubtypeExprOrValue<T>) => SubtypeExprOrValue<T>;

/**
 * The people, built from the `people` resource kind's accessors, each called
 * once per row, in key order (§4.2).
 *
 * @param kind - The `people` resource kind, read whole
 * @returns Every person
 * @internal
 */
export function rosterPeopleOf(kind: ScheduleResourceKind<EastType, EastType>): ExprType<ArrayType<typeof T.RosterPersonType>> {
    const a = kind.accessors;
    const group = a.group!;
    const person = East.function([kind.rowType, kind.keyType], T.RosterPersonType, ($, row, key) => {
        const call: Call = (fn, otherwise) => {
            if (fn === undefined) return otherwise;
            const bound = $.const(fn);
            return bound(row as never, key as never) as never;
        };
        const labelOf = $.const(a.label);
        const groupOf = $.const(group);
        return {
            key: key as ExprType<StringType>, name: labelOf(row as never, key as never), group: groupOf(row as never, key as never),
            position: call(a.position, ""), skills: call(a.skills, East.value(new Set<string>(), SetType(StringType))),
            contract: call(a.contract, 0.0), agency: call(a.agency, false), trainer: call(a.trainer, false), trainee: call(a.trainee, false),
            usual: call(a.usual, East.value(none, OptionType(StringType))),
        };
    });
    return kind.source!.toArray(($, row, key) => {
        const make = $.const(person);
        return make(row as never, key as never);
    }) as unknown as ExprType<ArrayType<typeof T.RosterPersonType>>;
}

/**
 * The agencies, built from the `agencies` resource kind's accessors, in key order.
 *
 * @param kind - The `agencies` resource kind, read whole
 * @returns Every agency
 * @internal
 */
export function rosterAgenciesOf(kind: ScheduleResourceKind<EastType, EastType>): ExprType<ArrayType<typeof T.RosterAgencyType>> {
    const label = kind.accessors.label;
    const agency = East.function([kind.rowType, kind.keyType], T.RosterAgencyType, ($, row, key) => {
        const labelOf = $.const(label);
        return { key: key as ExprType<StringType>, name: labelOf(row as never, key as never) };
    });
    return kind.source!.toArray(($, row, key) => {
        const make = $.const(agency);
        return make(row as never, key as never);
    }) as unknown as ExprType<ArrayType<typeof T.RosterAgencyType>>;
}

/**
 * An app's function over a request of the duty row type, checked, then wrapped
 * so the request crosses as bytes.
 *
 * @param fn - The app's function
 * @param asks - The request type over the duty row type
 * @param answers - What it answers
 * @param refusal - What a function of another type is refused with, naming the prop
 * @returns The function over bytes
 * @throws {Error} With `refusal` when the function asks or answers another type
 */
function overBytes<O extends EastType>(fn: unknown, asks: EastType, answers: O, refusal: string): ExprType<FunctionType<[BlobType], O>> {
    const author = East.value(fn as SubtypeExprOrValue<FunctionType>) as ExprType<FunctionType>;
    const type = Expr.type(author as unknown as Expr) as EastType;
    if (type.type !== "Function" || type.inputs.length !== 1 || !isTypeEqual(type.inputs[0]!, asks) || !isTypeEqual(type.output, answers)) {
        throw new Error(refusal);
    }
    return East.function([BlobType], answers as EastType, ($, bytes) => {
        const call = $.const(author as unknown as ExprType<FunctionType<[EastType], EastType>>);
        return call(bytes.decodeBeast(asks, "v2"));
    }) as unknown as ExprType<FunctionType<[BlobType], O>>;
}

/**
 * The fit's binding, checked: `Func.bind` of an `e3.function` from `Roster.Types.FitRequest(R)` to `Roster.Types.FitResult`.
 *
 * @param fit - What the app passed as `fit`
 * @param rowType - The duty kind's row type
 * @returns The binding's descriptor, which names the function
 * @throws {Error} When it is not a `Func.bind` handle, or its function asks or answers another type, naming it
 */
function fitBinding(fit: unknown, rowType: EastType): ExprType<typeof FuncBindingType> {
    const signature = boundFuncSignature(fit);
    if (signature === undefined) {
        throw new Error("Roster: `fit` is Func.bind of the app's e3.function from Roster.Types.FitRequest(R) to Roster.Types.FitResult, R the duties' row type");
    }
    const asked = signature.asks;
    if (!isTypeEqual(asked, T.RosterFitRequestTypeFor(rowType))) {
        // A FitRequest over another row: its week's duties' row.
        const week = asked.type === "Struct" ? asked.fields["week"] : undefined;
        const duties = week?.type === "Struct" ? week.fields["assignments"] : undefined;
        const theirs = duties?.type === "Dict" && duties.value.type === "Struct" ? duties.value.fields["row"] : undefined;
        throw new Error(theirs !== undefined && isTypeEqual(asked, T.RosterFitRequestTypeFor(theirs))
            ? `Roster: \`fit\` is bound over duty rows ${printType(theirs)}, and the duty kind's rows are ${printType(rowType)} — bind a fit over Roster.Types.FitRequest of the duties' row type`
            : `Roster: \`fit\` asks ${printType(asked)}, not Roster.Types.FitRequest(${printType(rowType)})`);
    }
    if (!isTypeEqual(signature.answers, T.RosterFitResultType)) {
        throw new Error(`Roster: \`fit\` answers ${printType(signature.answers)}, not Roster.Types.FitResult`);
    }
    return (fit as ExprType<StructType<{ binding: typeof FuncBindingType }>>).binding;
}

/**
 * Validates the declarations and assembles the Roster's interface. View and
 * interaction behaviour belong to the renderer, not this factory.
 *
 * @typeParam R - The app's duty row type
 * @param props - The Roster's props
 * @returns The closed payload
 * @throws {Error} Naming the change to make (B4): a removed prop — `weeks`, `window`, `people`, `agencies`, `forecast`,
 *   `costs`, `visiblePeople`, `duties`, `inspector={{ assignment, requirement }}` or `rules.agree` — or a list given as
 *   Roster values rather than its declaration; `events` holding other than one kind, or `resources` other than `people`
 *   and `agencies`; a duty kind whose resource names no `people`, or a resource kind read a window at a time; a `people`
 *   kind with no `group`; `positions` beside a duty kind with no `position` role; `pay` without `currency`; a `pay`, a
 *   `check` or a `fit` over another type; a library tab listed twice; and as `Schedule`'s checks, the duty kind's
 *   build (`buildRoster`) and the slice's (`recordSources`) do
 * @internal
 */
export function createRosterPayload<R extends EastType>(props: RosterProps<R>): ExprType<typeof RosterPayloadType> {
    const given = props as unknown as Readonly<Record<string, unknown>>;
    for (const [prop, refusal] of REMOVED) {
        if (given[prop] !== undefined) throw new Error(`Roster: ${refusal}`);
    }
    if (props.inspector !== undefined && typeof props.inspector !== "boolean") {
        throw new Error("Roster: `inspector` is true or false — a duty's own form is the duty kind's `inspector` (Schedule.events(record, { …, inspector })), " +
            "a target's `Roster.targets`' `inspector`");
    }
    const rules = props.rules ?? {};
    if (rules instanceof Expr) {
        throw new Error("Roster: `rules` are plain values — rules={{ rest: 10, lead: true, trainer: true, skill: true }}");
    }
    if ((rules as Readonly<Record<string, unknown>>)["agree"] !== undefined) {
        throw new Error("Roster: `rules.agree` is gone — a duty's own fields say what is agreed, and the app's `check` reads them: " +
            "Roster.Types.CheckContext(R) carries each duty's row and its pay");
    }
    if (rules.rest !== undefined && (typeof rules.rest !== "number" || !Number.isFinite(rules.rest) || rules.rest < 0)) {
        throw new Error(`Roster: \`rules.rest\` is the hours of rest between duties, zero or more — and it is ${String(rules.rest)}`);
    }
    // The lists: each its declaration over the app's rows, not Roster values.
    for (const [prop, declaration] of LISTS) {
        const value = given[prop];
        const required = prop === "shifts" || prop === "groups";
        if (value === undefined && !required) continue;
        if (!isRosterList(value, prop)) {
            throw new Error(`Roster: \`${prop}\` is ${declaration}${value === undefined ? "" : ` — Roster.Types.${prop === "proposals" ? "Proposal" : prop === "shifts" ? "Shift" : prop === "groups" ? "Group" : "Position"} values are gone`}`);
        }
    }
    if (props.targets !== undefined && !isRosterTargets(props.targets)) {
        throw new Error("Roster: `targets` is Roster.targets(Record.bind(record, [patch]), { day, group, shift, positions, hours }) over the app's own targets");
    }

    // The duty kind: exactly one event kind.
    const kinds = Object.entries(props.events ?? {});
    if (kinds.length !== 1) {
        throw new Error(kinds.length === 0
            ? "Roster: `events` holds the duties — events={{ duty: Schedule.events(Record.bind(duties, [dutiesPatch]), { start, end, resource, shift, group }) }}"
            : `Roster: \`events\` holds one kind, the duties — and it holds ${kinds.length} (${kinds.map(([slot]) => slot).join(", ")})`);
    }
    const [slot, kind] = kinds[0]!;
    // Who is rostered: the people, and optionally the agencies.
    const resources = (props.resources ?? {}) as Readonly<Record<string, ScheduleResourceKind<EastType, EastType>>>;
    for (const name of Object.keys(resources)) {
        if (name !== "people" && name !== "agencies") {
            throw new Error(`Roster: \`resources\` holds \`people\`, and optionally \`agencies\` — and it holds \`${name}\``);
        }
    }
    if (resources["people"] === undefined) {
        throw new Error("Roster: `resources` holds `people`, every person rostered: resources={{ people: Schedule.resources(staff.read(), { name, icon, label, group }) }}");
    }
    scheduleCheck(resources, props.events as Readonly<Record<string, ScheduleEventKind<EastType, EastType>>>, "Roster");
    if (!kind.takes.includes("people")) {
        throw new Error(`Roster: events.${slot}'s resource names no \`people\` — a duty is rostered to one of the people, resource: { field, of: "people" }, ` +
            "or to one of them or an agency, a case each: of: { staff: \"people\", agency: \"agencies\" }");
    }
    const people = resources["people"];
    const agencies = resources["agencies"];
    for (const [name, resourceKind] of [["people", people], ["agencies", agencies]] as const) {
        if (resourceKind !== undefined && resourceKind.source === undefined) {
            throw new Error(`Roster: resources.${name} is read whole — coverage, pay and checks read every one — so give the rows as a Dict, ` +
                "usually a record's read(), not a paged read");
        }
    }
    if (people.accessors.group === undefined) {
        throw new Error("Roster: resources.people gives each person's home group — Schedule.resources(staff.read(), { …, group: (p) => p.team })");
    }
    if (props.positions !== undefined && !kind.roles.includes("position")) {
        throw new Error(`Roster: \`positions\` are the positions a duty holds — and events.${slot} maps no \`position\`: give the kind a \`position\`, a String field of its row, or leave \`positions\` out`);
    }
    if (props.pay !== undefined && props.currency === undefined) {
        throw new Error("Roster: `pay` gives each duty's cost — give `currency` with it, how costs print (currency=\"EUR\")");
    }

    // The app's functions over the duty row type.
    const rowType = kind.rowType as EastType;
    const row = printType(rowType);
    const pay = props.pay === undefined ? undefined : overBytes(props.pay, T.RosterPayRequestTypeFor(rowType), T.RosterPayType,
        `Roster: \`pay\` is an East function from Roster.Types.PayRequest(${row}) to Roster.Types.Pay — each duty's cost by the app's own pay codes`);
    const check = props.check === undefined ? undefined : overBytes(props.check, T.RosterCheckContextTypeFor(rowType), ArrayType(T.RosterIssueType),
        `Roster: \`check\` is an East function from Roster.Types.CheckContext(${row}) to Array<Roster.Types.Issue>`);
    const fit = props.fit === undefined ? undefined : fitBinding(props.fit, rowType);

    // The narrowing: a source per record it narrows, named after what it narrows.
    const library = props.library ?? [];
    const named = new Set([slot, ...(props.targets === undefined ? [] : ["targets"]), "people", "activities",
        ...library.flatMap(tab => tab.kind === "tab" && tab.config.source !== undefined ? [tab.config.source] : [])]);
    const narrowing = recordSources(props.slice, {
        builder: "Roster", names: [...named], what: `its duties (${slot}), its targets, its people and its activities, and the tabs that name a source`,
        takes: name => named.has(name),
    });
    const seen = new Set<string>();
    const tabs = library.map(tab => {
        const key = tab.kind === "tab" ? `tab:${tab.config.name}` : tab.kind;
        if (seen.has(key)) throw new Error(`Roster: library tab ${key} is listed twice`);
        seen.add(key);
        return tab.kind === "tab"
            ? East.value(variant("tab", buildScheduleTab(tab, [[slot, kind as ScheduleEventKind<EastType, EastType>]], "Roster", narrowing.names)), RosterLibraryTabType)
            : East.value(variant(tab.kind, null), RosterLibraryTabType);
    });
    const lists = given as unknown as { shifts: RosterShifts; groups: RosterGroups; positions?: RosterPositions; proposals?: RosterProposals };
    const positions = lists.positions;
    return Expr.block($ => {
        const bound = narrowing.bind($);
        const keys = bound.keys as { people?: unknown; activities?: unknown };
        return East.value({
            // The duties, narrowed through their own source of the slice when the slice has one.
            duty: kind.buildRoster(slot, bound.parts[slot]),
            people: rosterPeopleOf(people),
            agencies: agencies === undefined ? [] : rosterAgenciesOf(agencies),
            periods: props.periods === undefined ? none : some(props.periods.build()),
            targets: props.targets === undefined ? none : some(props.targets.build(bound.parts["targets"])),
            groups: lists.groups.rows, shifts: lists.shifts.rows,
            activities: props.activities ?? [], positions: positions === undefined ? [] : positions.rows,
            proposals: lists.proposals === undefined ? [] : lists.proposals.rows,
            // The lead rule reads the positions: without them, there is none.
            rules: { rest: rules.rest ?? 10.0, lead: (rules.lead ?? true) && positions !== undefined, trainer: rules.trainer ?? true, skill: rules.skill ?? true },
            pay: pay === undefined ? none : some(pay),
            currency: props.currency === undefined ? none : some(props.currency),
            check: check === undefined ? none : some(check),
            fit: fit === undefined ? none : some(fit),
            library: tabs,
            inspector: props.inspector ?? false,
            narrowed: {
                people: keys.people === undefined ? none : some(keys.people as never),
                activities: keys.activities === undefined ? none : some(keys.activities as never),
            },
            slice: narrowing.chrome,
            settings: {
                layout: variant(props.view?.layout ?? "shifts", null), period: variant(props.view?.layout === "people" ? "week" : props.view?.period ?? "day", null),
                date: props.view?.date === undefined ? none : some(props.view.date), weekStart: variant(props.week?.start ?? "monday", null),
                density: variant(props.density ?? "comfortable", null), chipSkills: props.chipSkills ?? true,
                requirements: props.requirements ?? true, readOnly: props.readOnly ?? false,
            },
            id: props.id === undefined ? none : some(props.id),
        } as never, RosterPayloadType);
    }) as ExprType<typeof RosterPayloadType>;
}

// ============================================================================
// The namespace
// ============================================================================

/**
 * Refuses a removed helper by name, with the form that replaces it.
 *
 * @param refusal - The words
 * @returns A function that refuses
 */
function removed(refusal: string): (...args: never[]) => never {
    return () => { throw new Error(refusal); };
}

/** The tag, its declarations, its pure functions over the duty row type, and its types. */
export interface RosterNamespace {
    /** Renders a roster over the app's own records. */
    <R extends EastType>(props: RosterProps<R>): UIElement;
    /** Reads the app's shift rows as the Roster's shifts. */
    shifts: typeof rosterShifts;
    /** Reads the app's group rows as the Roster's groups. */
    groups: typeof rosterGroups;
    /** Reads the app's position rows as the Roster's positions. */
    positions: typeof rosterPositions;
    /** Reads the app's activity rows — each group's skills and the duties — as the Roster's activities. */
    activities: typeof rosterActivities;
    /** Reads the app's suggestion rows as the Roster's proposals. */
    proposals: typeof rosterProposals;
    /** Declares the app's targets, a row per slot, over its own record. */
    targets: typeof rosterTargets;
    /** `coverage(R)`: computes coverage without a browser. */
    coverage: typeof rosterCoverage;
    /** `check(R)`: computes the built-in warnings without a browser. */
    check: typeof rosterCheck;
    /** `fit(R)`: the ready-made fit, one person's verdict for a Find fix's need on its slot. */
    fit: typeof rosterFit;
    /** `answer(R)`: a fit's answer from a rule per person. */
    answer: typeof rosterAnswer;
    /** `weekHours(R)`: computes each person's total hours. */
    weekHours: typeof rosterWeekHours;
    /** `rest(R)`: computes the rest before and after a duty. */
    rest: typeof rosterRest;
    /** Declares the library's tabs. */
    library: { people: typeof rosterPeopleTab; activities: typeof rosterActivitiesTab; tab: typeof rosterLibraryTab };
    /** @deprecated Removed (#1368): the people are `resources={{ people: Schedule.resources(staff.read(), { name, icon, label, group, … }) }}`. */
    people: (...args: never[]) => never;
    /** @deprecated Removed (#1368): a card's `drop` returns `Schedule.patch(DutyRowType, { … })`, as Plan's tabs do. */
    patch: (...args: never[]) => never;
    /** Roster's public domain types; those over a week are constructors of the app's duty row type. */
    Types: {
        Clock: typeof ScheduleClockType; Slot: T.RosterSlotType; Who: T.RosterWhoType; Assignment: typeof T.RosterAssignmentTypeFor;
        Requirement: T.RosterRequirementType; Requirements: T.RosterRequirementsType; Status: T.RosterStatusType; Week: typeof T.RosterWeekTypeFor;
        Activity: T.RosterActivityType; Skill: T.RosterSkillType; Group: T.RosterGroupType; Shift: T.RosterShiftType; Position: T.RosterPositionType;
        Agency: T.RosterAgencyType; Person: T.RosterPersonType; Rules: T.RosterRulesType; Context: T.RosterContextType;
        CoverageLine: T.RosterCoverageLineType; Coverage: T.RosterCoverageType; Proposal: T.RosterProposalType; Fix: T.RosterFixType;
        Issue: T.RosterIssueType; CheckContext: typeof T.RosterCheckContextTypeFor; Need: T.RosterNeedType; FitRequest: typeof T.RosterFitRequestTypeFor;
        FitResult: T.RosterFitResultType; Fit: T.RosterFitType; Refusal: T.RosterRefusalType; PayRequest: typeof T.RosterPayRequestTypeFor;
        Pay: T.RosterPayType; Layout: typeof RosterLayoutType; Period: typeof RosterPeriodType;
    };
}

/**
 * Plans staffing over the app's own records, with an internal shared
 * BuilderFrame, Slice toolbar and editing history.
 *
 * @param props - The duties, people, lists and optional weeks, targets, pay, check, fit, library and inspector
 * @returns The Roster extension
 * @remarks One gesture is one undo step across every record it changes; Save sends each record's changes as its own request, and Publish saves, then the week's status. On narrow containers the same commands are explicit card actions.
 */
export const Roster: RosterNamespace = Object.assign(
    <R extends EastType>(props: RosterProps<R>): UIElement => RosterComponent.Root(createRosterPayload(props)),
    {
        shifts: rosterShifts, groups: rosterGroups, positions: rosterPositions, activities: rosterActivities, proposals: rosterProposals,
        targets: rosterTargets, coverage: rosterCoverage, check: rosterCheck, fit: rosterFit, answer: rosterAnswer,
        weekHours: rosterWeekHours, rest: rosterRest,
        library: { people: rosterPeopleTab, activities: rosterActivitiesTab, tab: rosterLibraryTab },
        people: removed("Roster.people is gone — the people are resources={{ people: Schedule.resources(staff.read(), { name, icon, label, group, … }) }}"),
        patch: removed("Roster.patch is gone — a card's drop returns Schedule.patch(DutyRowType, { … }), the duty's own fields, as Plan's tabs do"),
        Types: {
            Clock: ScheduleClockType, Slot: T.RosterSlotType, Who: T.RosterWhoType, Assignment: T.RosterAssignmentTypeFor,
            Requirement: T.RosterRequirementType, Requirements: T.RosterRequirementsType, Status: T.RosterStatusType, Week: T.RosterWeekTypeFor,
            Activity: T.RosterActivityType, Skill: T.RosterSkillType, Group: T.RosterGroupType, Shift: T.RosterShiftType, Position: T.RosterPositionType,
            Agency: T.RosterAgencyType, Person: T.RosterPersonType, Rules: T.RosterRulesType, Context: T.RosterContextType,
            CoverageLine: T.RosterCoverageLineType, Coverage: T.RosterCoverageType, Proposal: T.RosterProposalType, Fix: T.RosterFixType,
            Issue: T.RosterIssueType, CheckContext: T.RosterCheckContextTypeFor, Need: T.RosterNeedType, FitRequest: T.RosterFitRequestTypeFor,
            FitResult: T.RosterFitResultType, Fit: T.RosterFitType, Refusal: T.RosterRefusalType, PayRequest: T.RosterPayRequestTypeFor,
            Pay: T.RosterPayType, Layout: RosterLayoutType, Period: RosterPeriodType,
        },
    },
);

/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    ArrayType, AsyncFunctionType, BooleanType, DateTimeType, DictType, East, Expr, FloatType, FunctionType, NullType,
    OptionType, StringType, StructType, VariantType, isTypeEqual, none, printType, some, variant,
    type EastType, type ExprType, type SubtypeExprOrValue,
} from "@elaraai/east";
import { EastUI, Editing, UIComponentType, type UIElement } from "@elaraai/east-ui";
import { RecordSlicesChromeType, RowSourceType, type RecordSlicesChromeOptions } from "@elaraai/east-ui/internal";
import { DataPagedHandleType } from "../bind/data.js";
import { FuncBindingType, type BoundFunc } from "../bind/func.js";
import { Record, RecordBindingType } from "../bind/record.js";
import { recordSources } from "../utils/record-sources.js";
import * as T from "./types.js";
import { ScheduleClockType } from "../schedule/types.js";
import { rosterCoverage, rosterWeekHours } from "./coverage.js";
import { rosterCheck, rosterRest } from "./rules.js";
import { rosterActivities } from "./activities.js";
import { rosterAnswer, rosterFit } from "./fit.js";
import { rosterPeople } from "./people.js";
import {
    RosterAuthorTabType, RosterPatchType, buildRosterTab, rosterActivitiesTab, rosterLibraryTab, rosterPatch, rosterPeopleTab,
    type RosterLibraryTab,
} from "./library.js";

/** Roster's layout: group shifts, or people across the week. */
export const RosterLayoutType = VariantType({ shifts: NullType, people: NullType });
/** Roster's displayed period. People always shows the whole week. */
export const RosterPeriodType = VariantType({ day: NullType, week: NullType });
/** A declared built-in or author-defined library tab. */
export const RosterLibraryTabType = VariantType({ people: NullType, activities: NullType, tab: RosterAuthorTabType });
/** A custom assignment form receives the value and an update callback, as Plan does. */
export const RosterAssignmentFormType = FunctionType([T.RosterAssignmentType, FunctionType([T.RosterAssignmentType], NullType)], UIComponentType);
/** A custom requirement form receives the value and an update callback. */
export const RosterRequirementFormType = FunctionType([T.RosterRequirementType, FunctionType([T.RosterRequirementType], NullType)], UIComponentType);
/** Optional forms; absent forms use the shared FieldForm inspector. */
export const RosterInspectorType = StructType({
    assignment: OptionType(RosterAssignmentFormType), requirement: OptionType(RosterRequirementFormType),
});
/** Record interface needed by the tag; Record.onApply checks the bound patch door. */
export type RosterWeeksHandle = ExprType<StructType<{ read: FunctionType<[], T.RosterWeeksType>; binding: RecordBindingType }>>;
/** Optional paged history, over the same weeks record. */
export const RosterWindowType = DataPagedHandleType(T.RosterWeeksType);
/**
 * The closed renderer payload. BuilderFrame is internal to the renderer.
 * @property people - Every person: the calculation scope, whatever the slice shows
 * @property activities - Every activity: each group's skills and the duties of no group
 * @property fit - The app's fit, by its `e3.function`'s name: who fits a Find fix's need; `none`, no Find fix is offered (#1334)
 * @property narrowed - Each narrowed source's keys, paged through its part of `slice`: the people and the activities that show (#1342)
 * @property slice - The narrowing's chrome: a Slice over the staff's and the activities' records, one rail
 */
export const RosterPayloadType = StructType({
    sourceId: StringType, read: FunctionType([], T.RosterWeeksType),
    apply: AsyncFunctionType([Editing.Types.ChangeSet(T.RosterWeekType, DateTimeType)], Editing.Types.ApplyResult),
    window: OptionType(RosterWindowType), people: ArrayType(T.RosterPersonType),
    groups: ArrayType(T.RosterGroupType), activities: ArrayType(T.RosterSkillType), shifts: ArrayType(T.RosterShiftType),
    positions: ArrayType(T.RosterPositionType), agencies: ArrayType(T.RosterAgencyType), rules: T.RosterRulesType,
    costs: OptionType(T.RosterCostsType), forecast: DictType(DateTimeType, T.RosterRequirementsType), proposals: ArrayType(T.RosterProposalType),
    check: OptionType(FunctionType([T.RosterCheckContextType], ArrayType(T.RosterIssueType))),
    fit: OptionType(FuncBindingType),
    library: ArrayType(RosterLibraryTabType), inspector: OptionType(RosterInspectorType),
    narrowed: StructType({ people: OptionType(RowSourceType(ArrayType(StringType))), activities: OptionType(RowSourceType(ArrayType(StringType))) }),
    slice: OptionType(RecordSlicesChromeType),
    settings: StructType({
        layout: RosterLayoutType, period: RosterPeriodType, date: OptionType(DateTimeType),
        weekStart: VariantType({ monday: NullType, sunday: NullType }),
        density: VariantType({ compact: NullType, comfortable: NullType }), chipSkills: BooleanType, requirements: BooleanType, readOnly: BooleanType,
    }), id: OptionType(StringType),
});
/** Carrier registered by e3-ui-components. */
export const RosterComponent = EastUI.component("Roster", RosterPayloadType, { optional: true });

/** Author-facing Roster props; data can come from reactive records. */
export interface RosterProps {
    /** Weeks record bound with its patch mutation. */
    weeks: RosterWeeksHandle;
    /** Paged access to the same record; avoids reading history whole. */
    window?: SubtypeExprOrValue<typeof RosterWindowType>;
    /** Complete resolved staff, commonly Roster.people(bound.read(), accessors): coverage, costs and checks read every person. */
    people: SubtypeExprOrValue<ArrayType<T.RosterPersonType>>;
    /** Nonempty groups in display order. */
    groups: SubtypeExprOrValue<ArrayType<T.RosterGroupType>>;
    /** Nonempty recurring shifts. */
    shifts: SubtypeExprOrValue<ArrayType<T.RosterShiftType>>;
    /**
     * Every activity, commonly Roster.activities(bound.read(), accessors) over a keyed activities record: each group's skills
     * (an activity of that group) and the duties every group shares (an activity of none). Coverage and checks read every one.
     */
    activities?: SubtypeExprOrValue<ArrayType<T.RosterSkillType>>;
    /** Positions; defaults to Associate. */
    positions?: SubtypeExprOrValue<ArrayType<T.RosterPositionType>>;
    /** Agencies from which staffing can be requested. */
    agencies?: SubtypeExprOrValue<ArrayType<T.RosterAgencyType>>;
    /** Built-in warnings; defaults to ten hours' rest and all checks enabled. */
    rules?: ExprType<T.RosterRulesType> | {
        rest?: SubtypeExprOrValue<FloatType>; lead?: SubtypeExprOrValue<BooleanType>;
        trainer?: SubtypeExprOrValue<BooleanType>; skill?: SubtypeExprOrValue<BooleanType>; agree?: SubtypeExprOrValue<BooleanType>;
    };
    /** Cost rates and optional daily budget. */
    costs?: SubtypeExprOrValue<T.RosterCostsType>;
    /** Targets used only when a week has not yet been created. */
    forecast?: SubtypeExprOrValue<DictType<DateTimeType, T.RosterRequirementsType>>;
    /** Suggested placements from application data. */
    proposals?: SubtypeExprOrValue<ArrayType<T.RosterProposalType>>;
    /** Additional warnings over the complete draft; exceptions are reported without hiding built-in checks. */
    check?: SubtypeExprOrValue<FunctionType<[T.RosterCheckContextType], ArrayType<T.RosterIssueType>>>;
    /**
     * The app's fit: `Func.bind` of its `e3.function` from `Roster.Types.FitRequest` to `Roster.Types.FitResult`. A Find fix (find a
     * lead, a trainer, skilled staff) asks it who fits the issue's need on its slot, over the complete staff, and the People tab
     * shows its fits best first, each with its reason. `Roster.fit` is the ready-made rule, `Roster.answer` maps a rule over every
     * person. Omitted, no Find fix is offered; `Roster.check` still reports the issue.
     */
    fit?: BoundFunc<[T.RosterFitRequestType], T.RosterFitResultType>;
    /** Tabs to show; omitted, no library pane. */
    library?: readonly RosterLibraryTab[];
    /** Inspector with shared forms, or author-provided typed forms. */
    inspector?: boolean | {
        /** Typed assignment editor. */
        assignment?: SubtypeExprOrValue<typeof RosterAssignmentFormType>;
        /** Typed target editor. */
        requirement?: SubtypeExprOrValue<typeof RosterRequirementFormType>;
    };
    /**
     * The narrowing: `Slice.bindRecords(key, { people, activities })` over the staff's and the activities' records, one rail. Each
     * source narrows every place its rows appear — `people` the grid's and the People layout's people, the People tab and the person
     * choices; `activities` the Activities tab and the activity choices — and the Roster reads each one's keys itself. Coverage,
     * costs and checks still read every person and activity; the week is the Roster's own navigation's.
     */
    slice?: RecordSlicesChromeOptions;
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

/** Whether an East value or expression's type is a struct with the field: an author's groups that still carry their skills. */
function hasField(value: unknown, field: string): boolean {
    if (Array.isArray(value)) return value.some(row => typeof row === "object" && row !== null && field in row);
    if (!(value instanceof Expr)) return false;
    const type = Expr.type(value) as EastType;
    return type.type === "Array" && (type.value as EastType).type === "Struct" && field in (type.value as { fields: object }).fields;
}

/**
 * The fit's binding, checked: `Func.bind` of an `e3.function` from `Roster.Types.FitRequest` to `Roster.Types.FitResult`.
 *
 * @param fit - What the app passed as `fit`
 * @returns The binding's descriptor, which names the function
 * @throws {Error} When it is not a `Func.bind` handle, or its function asks or answers another type, naming it
 */
function fitBinding(fit: unknown): ExprType<typeof FuncBindingType> {
    const fitType = fit instanceof Expr ? Expr.type(fit) as EastType : undefined;
    const fields = fitType?.type === "Struct" ? fitType.fields : undefined;
    const call = fields?.["call"], read = fields?.["read"];
    const asked = call?.type === "Function" && call.inputs.length === 1 ? call.inputs[0]! : undefined;
    const answered = read?.type === "Function" && read.output.type === "Variant" ? read.output.cases["some"] : undefined;
    if (asked === undefined || answered === undefined || fields?.["binding"] === undefined) {
        throw new Error("Roster: `fit` is Func.bind of the app's e3.function from Roster.Types.FitRequest to Roster.Types.FitResult");
    }
    if (!isTypeEqual(asked, T.RosterFitRequestType)) throw new Error(`Roster: \`fit\` asks ${printType(asked)}, not Roster.Types.FitRequest`);
    if (!isTypeEqual(answered, T.RosterFitResultType)) throw new Error(`Roster: \`fit\` answers ${printType(answered)}, not Roster.Types.FitResult`);
    return (fit as ExprType<StructType<{ binding: typeof FuncBindingType }>>).binding;
}

/** Assembles a payload; domain and interaction programs live outside the tag. @internal */
export function createRosterPayload(props: RosterProps): ExprType<typeof RosterPayloadType> {
    if (Array.isArray(props.groups) && props.groups.length === 0) throw new Error("Roster: groups must not be empty");
    if (Array.isArray(props.shifts) && props.shifts.length === 0) throw new Error("Roster: shifts must not be empty");
    // The props #1342 retired, refused by name for an app that still passes them.
    const retired = props as { visiblePeople?: unknown; duties?: unknown };
    if (retired.visiblePeople !== undefined) {
        throw new Error("Roster: `visiblePeople` is gone — the Roster reads its people from `slice`'s `people` source: slice={{ slice: Slice.bindRecords(key, { people, activities }) }}");
    }
    if (retired.duties !== undefined) {
        throw new Error("Roster: `duties` is gone — a duty is an activity of no group in `activities` (Roster.activities)");
    }
    if (hasField(props.groups, "skills")) {
        throw new Error("Roster: groups no longer carry their skills — each skill is an activity of its group in `activities` (Roster.activities)");
    }
    const narrowing = recordSources(props.slice, { builder: "Roster", names: ["people", "activities"], what: "its people and its activities" });
    const fit = props.fit === undefined ? undefined : fitBinding(props.fit);
    const seen = new Set<string>();
    const library = (props.library ?? []).map(tab => {
        const key = tab.kind === "tab" ? `tab:${tab.config.name}` : tab.kind;
        if (seen.has(key)) throw new Error(`Roster: duplicate library tab ${key}`);
        seen.add(key);
        return tab.kind === "tab" ? East.value(variant("tab", buildRosterTab(tab, narrowing.names)), RosterLibraryTabType)
            : East.value(variant(tab.kind, null), RosterLibraryTabType);
    });
    const forms = typeof props.inspector === "object" ? props.inspector : {};
    return Expr.block($ => {
        const narrowed = narrowing.bind($).keys as { people?: unknown; activities?: unknown };
        return East.value({
            sourceId: props.weeks.binding.name, read: props.weeks.read, apply: Record.onApply(props.weeks, { keyed: true }),
            window: props.window === undefined ? none : some(props.window), people: props.people,
            groups: props.groups, shifts: props.shifts,
            activities: props.activities ?? [], positions: props.positions ?? [{ key: "associate", label: "Associate", code: "", lead: false }],
            agencies: props.agencies ?? [], rules: { rest: props.rules?.rest ?? 10.0, lead: props.rules?.lead ?? true, trainer: props.rules?.trainer ?? true, skill: props.rules?.skill ?? true, agree: props.rules?.agree ?? true },
            costs: props.costs === undefined ? none : some(props.costs), forecast: props.forecast ?? new Map(), proposals: props.proposals ?? [],
            check: props.check === undefined ? none : some(props.check), fit: fit === undefined ? none : some(fit), library,
            inspector: props.inspector === undefined || props.inspector === false ? none : some({
                assignment: forms.assignment === undefined ? none : some(forms.assignment),
                requirement: forms.requirement === undefined ? none : some(forms.requirement),
            }),
            narrowed: {
                people: narrowed.people === undefined ? none : some(narrowed.people as never),
                activities: narrowed.activities === undefined ? none : some(narrowed.activities as never),
            },
            slice: narrowing.chrome,
            settings: {
                layout: variant(props.view?.layout ?? "shifts", null), period: variant(props.view?.layout === "people" ? "week" : props.view?.period ?? "day", null),
                date: props.view?.date === undefined ? none : some(props.view.date), weekStart: variant(props.week?.start ?? "monday", null),
                density: variant(props.density ?? "comfortable", null), chipSkills: props.chipSkills ?? true,
                requirements: props.requirements ?? true, readOnly: props.readOnly ?? false,
            }, id: props.id === undefined ? none : some(props.id),
        }, RosterPayloadType);
    }) as ExprType<typeof RosterPayloadType>;
}
/** The tag, domain functions and authoring helpers. */
export interface RosterNamespace {
    /** Renders a roster bound to one weeks record. */
    (props: RosterProps): UIElement;
    /** Adapts complete staff from keyed data. */
    people: typeof rosterPeople;
    /** Adapts every activity — each group's skills and the duties — from keyed data. */
    activities: typeof rosterActivities;
    /** Computes coverage without a browser. */
    coverage: typeof rosterCoverage;
    /** Computes built-in warnings without a browser. */
    check: typeof rosterCheck;
    /** The ready-made fit: one person's verdict for a Find fix's need on its slot. */
    fit: typeof rosterFit;
    /** A fit's answer from a rule per person. */
    answer: typeof rosterAnswer;
    /** Computes each person's total hours. */
    weekHours: typeof rosterWeekHours;
    /** Computes rest before and after an assignment. */
    rest: typeof rosterRest;
    /** Describes a restricted library-card patch. */
    patch: typeof rosterPatch;
    /** Declares optional shared-library tabs. */
    library: { people: typeof rosterPeopleTab; activities: typeof rosterActivitiesTab; tab: typeof rosterLibraryTab };
    /** Roster's public domain types. */
    Types: {
        Clock: typeof ScheduleClockType; Slot: T.RosterSlotType; Who: T.RosterWhoType; Assignment: T.RosterAssignmentType; Requirement: T.RosterRequirementType;
        Requirements: T.RosterRequirementsType; Status: T.RosterStatusType; Week: T.RosterWeekType; Weeks: T.RosterWeeksType;
        Activity: T.RosterActivityType; Skill: T.RosterSkillType; Group: T.RosterGroupType; Shift: T.RosterShiftType; Position: T.RosterPositionType;
        Agency: T.RosterAgencyType; Person: T.RosterPersonType; Rules: T.RosterRulesType; Costs: T.RosterCostsType;
        Context: T.RosterContextType; CoverageLine: T.RosterCoverageLineType; Coverage: T.RosterCoverageType;
        Proposal: T.RosterProposalType; Fix: T.RosterFixType; Issue: T.RosterIssueType; CheckContext: T.RosterCheckContextType;
        Need: T.RosterNeedType; FitRequest: T.RosterFitRequestType; FitResult: T.RosterFitResultType; Fit: T.RosterFitType; Refusal: T.RosterRefusalType;
        Patch: typeof RosterPatchType; Layout: typeof RosterLayoutType; Period: typeof RosterPeriodType;
    };
}
/**
 * Plans staffing with an internal shared BuilderFrame, Slice toolbar and editing session.
 * @param props - Bound weeks, staff, shift configuration and optional library/inspector
 * @returns The Roster extension
 * @remarks One gesture is one undo step; Save and Publish each write one complete week. On narrow containers the same commands are explicit card actions.
 */
export const Roster: RosterNamespace = Object.assign(
    (props: RosterProps): UIElement => RosterComponent.Root(createRosterPayload(props)),
    { people: rosterPeople, activities: rosterActivities, coverage: rosterCoverage, check: rosterCheck, fit: rosterFit, answer: rosterAnswer,
        weekHours: rosterWeekHours, rest: rosterRest, patch: rosterPatch,
        library: { people: rosterPeopleTab, activities: rosterActivitiesTab, tab: rosterLibraryTab },
        Types: {
            Clock: ScheduleClockType, Slot: T.RosterSlotType, Who: T.RosterWhoType, Assignment: T.RosterAssignmentType, Requirement: T.RosterRequirementType,
            Requirements: T.RosterRequirementsType, Status: T.RosterStatusType, Week: T.RosterWeekType, Weeks: T.RosterWeeksType,
            Activity: T.RosterActivityType, Skill: T.RosterSkillType, Group: T.RosterGroupType, Shift: T.RosterShiftType, Position: T.RosterPositionType,
            Agency: T.RosterAgencyType, Person: T.RosterPersonType, Rules: T.RosterRulesType, Costs: T.RosterCostsType,
            Context: T.RosterContextType, CoverageLine: T.RosterCoverageLineType, Coverage: T.RosterCoverageType,
            Proposal: T.RosterProposalType, Fix: T.RosterFixType, Issue: T.RosterIssueType, CheckContext: T.RosterCheckContextType,
            Need: T.RosterNeedType, FitRequest: T.RosterFitRequestType, FitResult: T.RosterFitResultType, Fit: T.RosterFitType, Refusal: T.RosterRefusalType,
            Patch: RosterPatchType, Layout: RosterLayoutType, Period: RosterPeriodType,
        },
    },
);

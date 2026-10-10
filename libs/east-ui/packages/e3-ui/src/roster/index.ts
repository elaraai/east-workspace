/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    ArrayType, AsyncFunctionType, BooleanType, DateTimeType, DictType, East, FloatType, FunctionType, NullType,
    OptionType, SetType, StringType, StructType, VariantType, none, some, variant,
    type ExprType, type SubtypeExprOrValue,
} from "@elaraai/east";
import { EastUI, Editing, UIComponentType, type UIElement } from "@elaraai/east-ui";
import { SliceAffordanceType, SliceBindType, SliceChromeType, type SliceAffordanceLiteral } from "@elaraai/east-ui/internal";
import { DataPagedHandleType } from "../bind/data.js";
import { Record, RecordBindingType } from "../bind/record.js";
import * as T from "./types.js";
import { ScheduleClockType } from "../schedule/types.js";
import { rosterCoverage, rosterWeekHours } from "./coverage.js";
import { rosterCheck, rosterRest } from "./rules.js";
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
/** The closed renderer payload. BuilderFrame is internal to the renderer. */
export const RosterPayloadType = StructType({
    sourceId: StringType, read: FunctionType([], T.RosterWeeksType),
    apply: AsyncFunctionType([Editing.Types.ChangeSet(T.RosterWeekType, DateTimeType)], Editing.Types.ApplyResult),
    window: OptionType(RosterWindowType), people: ArrayType(T.RosterPersonType), visiblePeople: OptionType(SetType(StringType)),
    groups: ArrayType(T.RosterGroupType), duties: ArrayType(T.RosterSkillType), shifts: ArrayType(T.RosterShiftType),
    positions: ArrayType(T.RosterPositionType), agencies: ArrayType(T.RosterAgencyType), rules: T.RosterRulesType,
    costs: OptionType(T.RosterCostsType), forecast: DictType(DateTimeType, T.RosterRequirementsType), proposals: ArrayType(T.RosterProposalType),
    check: OptionType(FunctionType([T.RosterCheckContextType], ArrayType(T.RosterIssueType))),
    library: ArrayType(RosterLibraryTabType), inspector: OptionType(RosterInspectorType), slice: OptionType(SliceChromeType),
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
    /** Complete resolved staff, commonly Roster.people(bound.read(), accessors). */
    people: SubtypeExprOrValue<ArrayType<T.RosterPersonType>>;
    /** Visible staff keys computed with Slice.rows; coverage still uses complete staff. */
    visiblePeople?: SubtypeExprOrValue<SetType<StringType>>;
    /** Nonempty groups in display order, including their skills. */
    groups: SubtypeExprOrValue<ArrayType<T.RosterGroupType>>;
    /** Nonempty recurring shifts. */
    shifts: SubtypeExprOrValue<ArrayType<T.RosterShiftType>>;
    /** Duties available to every group. */
    duties?: SubtypeExprOrValue<ArrayType<T.RosterSkillType>>;
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
    /** Tabs to show; omitted, no library pane. */
    library?: readonly RosterLibraryTab[];
    /** Inspector with shared forms, or author-provided typed forms. */
    inspector?: boolean | {
        /** Typed assignment editor. */
        assignment?: SubtypeExprOrValue<typeof RosterAssignmentFormType>;
        /** Typed target editor. */
        requirement?: SubtypeExprOrValue<typeof RosterRequirementFormType>;
    };
    /** Author-bound Slice and shared toolbar controls; datetime ranges select the containing week. */
    slice?: { slice: SubtypeExprOrValue<SliceBindType>; affordances?: SliceAffordanceLiteral[] };
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

/** Assembles a payload; domain and interaction programs live outside the tag. @internal */
export function createRosterPayload(props: RosterProps): ExprType<typeof RosterPayloadType> {
    if (Array.isArray(props.groups) && props.groups.length === 0) throw new Error("Roster: groups must not be empty");
    if (Array.isArray(props.shifts) && props.shifts.length === 0) throw new Error("Roster: shifts must not be empty");
    const seen = new Set<string>();
    const library = (props.library ?? []).map(tab => {
        const key = tab.kind === "tab" ? `tab:${tab.config.name}` : tab.kind;
        if (seen.has(key)) throw new Error(`Roster: duplicate library tab ${key}`);
        seen.add(key);
        return tab.kind === "tab" ? East.value(variant("tab", buildRosterTab(tab)), RosterLibraryTabType)
            : East.value(variant(tab.kind, null), RosterLibraryTabType);
    });
    const forms = typeof props.inspector === "object" ? props.inspector : {};
    return East.value({
        sourceId: props.weeks.binding.name, read: props.weeks.read, apply: Record.onApply(props.weeks, { keyed: true }),
        window: props.window === undefined ? none : some(props.window), people: props.people,
        visiblePeople: props.visiblePeople === undefined ? none : some(props.visiblePeople), groups: props.groups, shifts: props.shifts,
        duties: props.duties ?? [], positions: props.positions ?? [{ key: "associate", label: "Associate", code: "", lead: false }],
        agencies: props.agencies ?? [], rules: { rest: props.rules?.rest ?? 10.0, lead: props.rules?.lead ?? true, trainer: props.rules?.trainer ?? true, skill: props.rules?.skill ?? true, agree: props.rules?.agree ?? true },
        costs: props.costs === undefined ? none : some(props.costs), forecast: props.forecast ?? new Map(), proposals: props.proposals ?? [],
        check: props.check === undefined ? none : some(props.check), library,
        inspector: props.inspector === undefined || props.inspector === false ? none : some({
            assignment: forms.assignment === undefined ? none : some(forms.assignment),
            requirement: forms.requirement === undefined ? none : some(forms.requirement),
        }),
        slice: props.slice === undefined ? none : some({ slice: props.slice.slice,
            affordances: East.value((props.slice.affordances ?? ["filter", "search"]).map(a => variant(a, null)), ArrayType(SliceAffordanceType)) }),
        settings: {
            layout: variant(props.view?.layout ?? "shifts", null), period: variant(props.view?.layout === "people" ? "week" : props.view?.period ?? "day", null),
            date: props.view?.date === undefined ? none : some(props.view.date), weekStart: variant(props.week?.start ?? "monday", null),
            density: variant(props.density ?? "comfortable", null), chipSkills: props.chipSkills ?? true,
            requirements: props.requirements ?? true, readOnly: props.readOnly ?? false,
        }, id: props.id === undefined ? none : some(props.id),
    }, RosterPayloadType);
}
/** The tag, domain functions and authoring helpers. */
export interface RosterNamespace {
    /** Renders a roster bound to one weeks record. */
    (props: RosterProps): UIElement;
    /** Adapts complete staff from keyed data. */
    people: typeof rosterPeople;
    /** Computes coverage without a browser. */
    coverage: typeof rosterCoverage;
    /** Computes built-in warnings without a browser. */
    check: typeof rosterCheck;
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
        Skill: T.RosterSkillType; Group: T.RosterGroupType; Shift: T.RosterShiftType; Position: T.RosterPositionType;
        Agency: T.RosterAgencyType; Person: T.RosterPersonType; Rules: T.RosterRulesType; Costs: T.RosterCostsType;
        Context: T.RosterContextType; CoverageLine: T.RosterCoverageLineType; Coverage: T.RosterCoverageType;
        Proposal: T.RosterProposalType; Fix: T.RosterFixType; Issue: T.RosterIssueType; CheckContext: T.RosterCheckContextType;
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
    { people: rosterPeople, coverage: rosterCoverage, check: rosterCheck, weekHours: rosterWeekHours, rest: rosterRest, patch: rosterPatch,
        library: { people: rosterPeopleTab, activities: rosterActivitiesTab, tab: rosterLibraryTab },
        Types: {
            Clock: ScheduleClockType, Slot: T.RosterSlotType, Who: T.RosterWhoType, Assignment: T.RosterAssignmentType, Requirement: T.RosterRequirementType,
            Requirements: T.RosterRequirementsType, Status: T.RosterStatusType, Week: T.RosterWeekType, Weeks: T.RosterWeeksType,
            Skill: T.RosterSkillType, Group: T.RosterGroupType, Shift: T.RosterShiftType, Position: T.RosterPositionType,
            Agency: T.RosterAgencyType, Person: T.RosterPersonType, Rules: T.RosterRulesType, Costs: T.RosterCostsType,
            Context: T.RosterContextType, CoverageLine: T.RosterCoverageLineType, Coverage: T.RosterCoverageType,
            Proposal: T.RosterProposalType, Fix: T.RosterFixType, Issue: T.RosterIssueType, CheckContext: T.RosterCheckContextType,
            Patch: RosterPatchType, Layout: RosterLayoutType, Period: RosterPeriodType,
        },
    },
);

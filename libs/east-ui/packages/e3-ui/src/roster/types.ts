/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Roster's East types (#1368, `Builder Interfaces Spec.md` §5.3). A week
 * is the Roster's reading of the app's own rows — each duty the app's row,
 * with the roles the Roster reads from it — carried in the fit's, the pay's
 * and the check's requests and in the renderer, and stored nowhere. The types
 * over a week take the app's duty row type, `R`: each is a constructor, and
 * the same `R` gives the same East type (`isTypeEqual`).
 *
 * @packageDocumentation
 */

import {
    ArrayType, BlobType, BooleanType, DateTimeType, DictType, EastTypeType, FloatType, FunctionType, IntegerType, NullType,
    OptionType, PatchType, SetType, StringType, StructType, VariantType, type EastType, type PatchTypeOf,
} from "@elaraai/east";
import { RecordCommitInfoType } from "@elaraai/e3-types";
import { ColorTokenType, StatusTokenType } from "@elaraai/east-ui";
import { EditingType } from "@elaraai/east-ui/internal";
import { RowInspectorType } from "../utils/row-inspector.js";
import {
    ScheduleClockType, ScheduleEntriesType, ScheduleFitType, ScheduleNewKeyType, SchedulePeriodStatusType, ScheduleRefusalType, ScheduleRosterRolesType,
} from "../schedule/types.js";
import { ScheduleOptimiseRequestType } from "../schedule/optimise.js";
import { OptimisePeriodType, OptimiseSliceType, optimisedRecordType } from "../utils/optimise.js";

/**
 * One shift of one group on one day of the week.
 * @remarks Slot keys compare by East value, including when decoded in the browser.
 * @property day - Day within the week, from zero to six: the duty's day (§5.5, rule 1) less the week's first
 * @property group - Group key
 * @property shift - Shift key
 */
export const RosterSlotType = StructType({ day: IntegerType, group: StringType, shift: StringType });
export type RosterSlotType = typeof RosterSlotType;

/**
 * Where a duty stands in the week (#1548): its day, its shift, and its group —
 * the slot of that group's shift on that day — or none, a duty in no group yet.
 * @remarks Place keys compare by East value, as slots do. A duty in no group counts in its person's hours, contract, rest and pay, and in no group's targets or coverage. Only a kind whose `group` is an `Option<String>` field holds one.
 * @property day - Day within the week, from zero to six, as a slot's
 * @property group - Its group's key; `none` for a duty in no group yet
 * @property shift - Its shift's key
 */
export const RosterPlaceType = StructType({ day: IntegerType, group: OptionType(StringType), shift: StringType });
export type RosterPlaceType = typeof RosterPlaceType;

/**
 * Who a duty is: a person, or an agency asked to send someone.
 * @remarks Requests reserve positions without pretending an agency has supplied a named person.
 * @property person - The person's key, of the `people` resource kind
 * @property request - The agency's key, of the `agencies` resource kind
 */
export const RosterWhoType = VariantType({ person: StringType, request: StringType });
export type RosterWhoType = typeof RosterWhoType;

/**
 * One duty, as the Roster reads it from the app's row (`R`): its place, who it
 * is, and its roles, beside the row itself, every field of it.
 *
 * @typeParam R - The app's duty row type
 * @param row - The app's duty row type
 * @returns The assignment type over it
 * @remarks Its `place` is its day, its shift and its group, none for a duty in no group yet (#1548). Its times are the duty's own; the Roster gives them no name and no worth (§5.5). Its `hours` are what the duty counts.
 */
export function RosterAssignmentTypeFor<R extends EastType>(row: R) {
    return StructType({
        place: RosterPlaceType, who: RosterWhoType, position: StringType, activity: OptionType(StringType),
        start: DateTimeType, end: DateTimeType, hours: FloatType, row,
    });
}
/** Type representing {@link RosterAssignmentTypeFor}. */
export type RosterAssignmentTypeFor<R extends EastType> = ReturnType<typeof RosterAssignmentTypeFor<R>>;

/**
 * A slot's staffing and work targets.
 * @remarks A duty needs assigned hours, whereas a skill also has holder capacity. The slot's hours needed are the app's to define (#1678): `needed` is what its coverage's `hours.needed` reads, its lines each the hours of one key of `hours`.
 * @property positions - Positions to fill
 * @property hours - Hours required by skill or duty key
 * @property needed - The hours the slot needs: the targets' `needed` of its row and its shift's nominal hours, or the sum of `hours` where the targets give none
 */
export const RosterRequirementType = StructType({ positions: IntegerType, hours: DictType(StringType, FloatType), needed: FloatType });
export type RosterRequirementType = typeof RosterRequirementType;
/** Targets keyed by the complete slot. @remarks Use East's comparator for these struct keys. */
export const RosterRequirementsType = DictType(RosterSlotType, RosterRequirementType);
export type RosterRequirementsType = typeof RosterRequirementsType;

/**
 * A week's status: Schedule's period status, read from the app's weeks record
 * (`Schedule.periods`).
 * @property draft - An editable week
 * @property published - A read-only week, and when it was published when the app's published case holds the time
 * @property other - Another case of the app's status, by its name: read-only
 */
export const RosterStatusType = SchedulePeriodStatusType;
export type RosterStatusType = typeof RosterStatusType;

/**
 * One week of the app's rows, as the Roster reads them.
 *
 * @typeParam R - The app's duty row type
 * @param row - The app's duty row type
 * @returns The week type over it
 * @remarks Its assignments are the week's duties by their keys; its requirements the app's targets by slot; its status and its dismissals the app's week row's.
 */
export function RosterWeekTypeFor<R extends EastType>(row: R) {
    return StructType({
        status: RosterStatusType, assignments: DictType(StringType, RosterAssignmentTypeFor(row)),
        requirements: RosterRequirementsType, dismissed: SetType(StringType),
    });
}
/** Type representing {@link RosterWeekTypeFor}. */
export type RosterWeekTypeFor<R extends EastType> = ReturnType<typeof RosterWeekTypeFor<R>>;

/**
 * One row of an activities record, keyed by the activity's key: a skill of one
 * group, or a duty of none, which every group may assign (#1342).
 * @remarks `Roster.activities` reads a record of these, or of the app's own rows through its accessors.
 * @property label - Display name
 * @property code - Short code on assignment chips
 * @property group - The group whose skill it is; none, a duty every group shares
 */
export const RosterActivityType = StructType({ label: StringType, code: StringType, group: OptionType(StringType) });
export type RosterActivityType = typeof RosterActivityType;
/**
 * An activity resolved from the author's keyed activities: a skill within a
 * group, or a duty available to every group.
 * @remarks Keys are unique across all skills and duties: they are the activities record's keys.
 * @property key - Stable identifier: its key in the activities record
 * @property label - Display name
 * @property code - Short code on assignment chips
 * @property group - The group whose skill it is; none, a duty
 */
export const RosterSkillType = StructType({ key: StringType, label: StringType, code: StringType, group: OptionType(StringType) });
export type RosterSkillType = typeof RosterSkillType;
/**
 * A group of people. Its skills are the activities of that group.
 * @remarks The array order controls the grid and library order.
 * @property key - Stable identifier
 * @property label - Display name
 */
export const RosterGroupType = StructType({ key: StringType, label: StringType });
export type RosterGroupType = typeof RosterGroupType;
/**
 * A recurring shift's start and nominal hours, and its colour.
 * @remarks An end past midnight belongs to the following day; a duty still belongs to its shift's start day.
 * @property key - Stable identifier
 * @property label - Display name
 * @property code - Short code in the week layout
 * @property start - Start time in UTC, shared with Schedule
 * @property hours - Nominal shift duration: what a new duty runs, and a skill holder's capacity
 * @property color - The app's colour token for it (#1406): the People layout's tiles' and marks' fill; `none`, neutral
 */
export const RosterShiftType = StructType({
    key: StringType, label: StringType, code: StringType, start: ScheduleClockType, hours: FloatType, color: OptionType(ColorTokenType),
});
export type RosterShiftType = typeof RosterShiftType;
/**
 * A week pattern, as the Roster reads it from the app's row (`Roster.patterns`,
 * #1406): seven days from the week's first day, each a shift's key or `none`
 * for a day off, which a drop on a person's week applies.
 * @remarks The Roster reads patterns and writes nothing to them; a drop writes the person's duties.
 * @property key - Its row's key
 * @property label - Display name: the card's, and the drop's words
 * @property days - Seven entries from the week's first day: a shift's key, or `none` for a day off
 */
export const RosterPatternType = StructType({ key: StringType, label: StringType, days: ArrayType(OptionType(StringType)) });
export type RosterPatternType = typeof RosterPatternType;
/**
 * A position someone may hold on a shift.
 * @remarks Position order determines lead ordering in the grid.
 * @property key - Stable identifier
 * @property label - Display name
 * @property code - Chip badge
 * @property lead - Whether this position satisfies the lead rule
 */
export const RosterPositionType = StructType({ key: StringType, label: StringType, code: StringType, lead: BooleanType });
export type RosterPositionType = typeof RosterPositionType;
/**
 * An agency from which positions may be requested.
 * @remarks The first agency supplies the suggested open-position fix.
 * @property key - Stable identifier: its key in the `agencies` resource kind
 * @property name - Display name
 */
export const RosterAgencyType = StructType({ key: StringType, name: StringType });
export type RosterAgencyType = typeof RosterAgencyType;
/**
 * A person resolved from the app's staff rows (the `people` resource kind).
 * @remarks Roster reads staff; it never writes them.
 * @property key - Original staff key
 * @property name - Display name
 * @property group - Home group
 * @property position - Default position
 * @property skills - Skill keys held
 * @property contract - Contracted weekly hours
 * @property agency - Whether this is a named agency worker
 * @property trainer - Whether this person trains others
 * @property trainee - Whether this person needs a trainer
 * @property usual - Usual shift, or none
 */
export const RosterPersonType = StructType({
    key: StringType, name: StringType, group: StringType, position: StringType, skills: SetType(StringType),
    contract: FloatType, agency: BooleanType, trainer: BooleanType, trainee: BooleanType, usual: OptionType(StringType),
});
export type RosterPersonType = typeof RosterPersonType;
/**
 * Built-in checks enabled for the roster.
 * @remarks The page's rest check reads this week only; double booking is always reported.
 * @property rest - Minimum hours between duties; zero disables the rest check
 * @property lead - Check staffed slots for a lead
 * @property trainer - Check trainees have a trainer
 * @property skill - Check activities against held skills
 */
export const RosterRulesType = StructType({ rest: FloatType, lead: BooleanType, trainer: BooleanType, skill: BooleanType });
export type RosterRulesType = typeof RosterRulesType;
/**
 * Complete reference data used by coverage and checks.
 * @remarks Visibility filters never remove people or activities from this context.
 * @property people - All resolved staff by original key
 * @property groups - Groups
 * @property activities - Every activity: each group's skills, and the duties of no group
 * @property shifts - Shift definitions
 * @property positions - Position definitions
 * @property agencies - Agencies available for gap fixes
 * @property rules - Enabled rules
 */
export const RosterContextType = StructType({
    people: DictType(StringType, RosterPersonType), groups: ArrayType(RosterGroupType), activities: ArrayType(RosterSkillType),
    shifts: ArrayType(RosterShiftType), positions: ArrayType(RosterPositionType), agencies: ArrayType(RosterAgencyType),
    rules: RosterRulesType,
});
export type RosterContextType = typeof RosterContextType;
/**
 * Coverage for one key of a slot's target hours: an activity, or another key the app gives (#1678).
 * @remarks Duties have no holder count or capacity and no skill gap; nor has a key that is no activity, which counts as a duty does.
 * @property skill - Skill or duty key, or another key of the target's hours
 * @property needed - Required hours
 * @property holders - Number of people holding the skill, or none for a duty
 * @property capacity - Nominal hours available from holders, or none for a duty
 * @property gap - Positive shortfall in skill capacity
 * @property assigned - Hours of the duties assigned to this activity
 */
export const RosterCoverageLineType = StructType({
    skill: StringType, needed: FloatType, holders: OptionType(IntegerType), capacity: OptionType(FloatType), gap: FloatType, assigned: FloatType,
});
export type RosterCoverageLineType = typeof RosterCoverageLineType;
/**
 * Staffing, work and pay for a complete slot.
 * @remarks Requests fill positions and contribute their hours, but never count as named people or skilled holders.
 * @property positions - Required positions
 * @property filled - Assignments including requests
 * @property open - Unfilled positions, at least zero
 * @property people - Named people assigned
 * @property hours - Permanent, agency, requested and total rostered hours, each duty's hours; and the hours needed, its target's `needed`
 * @property lines - A line for every key of its target's hours (#1678): the group's skills, then the duties, each in the activities' order; then every other key, in key order — another group's skill counted as the group's own are, a key that is no activity as a duty is
 * @property cost - The slot's pay: its duties' costs summed over every code; zero without `pay`
 * @property lead - A named person holds a lead position
 * @property trainer - A trainer is assigned
 */
export const RosterCoverageType = StructType({
    positions: IntegerType, filled: IntegerType, open: IntegerType, people: IntegerType,
    hours: StructType({ permanent: FloatType, agency: FloatType, requested: FloatType, needed: FloatType, rostered: FloatType }),
    lines: ArrayType(RosterCoverageLineType), cost: FloatType, lead: BooleanType, trainer: BooleanType,
});
export type RosterCoverageType = typeof RosterCoverageType;
/**
 * A suggested placement, as the Roster reads it from the app's rows
 * (`Roster.proposals`).
 * @remarks Acceptance creates a duty; rejection keeps this key in the week's dismissed set.
 * @property key - Its row's key
 * @property day - The day it suggests, a UTC midnight
 * @property group - The group it suggests
 * @property shift - The shift it suggests
 * @property person - Original staff key
 * @property reason - Explanation presented to the planner
 */
export const RosterProposalType = StructType({ key: StringType, day: DateTimeType, group: StringType, shift: StringType, person: StringType, reason: StringType });
export type RosterProposalType = typeof RosterProposalType;
/**
 * What a Find fix looks for (#1334): what the app's fit is asked who fits.
 * @property leads - Someone in a lead position
 * @property trainers - Someone who trains others
 * @property skill - Someone who holds this skill, by its activity key
 */
export const RosterNeedType = VariantType({ leads: NullType, trainers: NullType, skill: StringType });
export type RosterNeedType = typeof RosterNeedType;
/**
 * A corrective action offered for an issue.
 * @remarks Every data-changing action is one gesture of the shared edit history. A find edits nothing: it asks the app's fit who fits its need on the issue's slot, and is offered only when the Roster has a `fit` (#1334).
 * @property request - Request someone from this agency
 * @property accept - Accept this proposal key
 * @property move - Move the duty to this shift
 * @property start - Move the duty to start at this later time, its length kept
 * @property find - Find who fits this need on the issue's slot: the app's fit's answer, in the People tab
 */
export const RosterFixType = VariantType({
    request: StringType, accept: StringType, move: StringType, start: DateTimeType, find: RosterNeedType,
});
export type RosterFixType = typeof RosterFixType;
/**
 * One explanation or warning about the drafted roster.
 * @remarks Warnings do not introduce a separate validation barrier to Save or Publish.
 * @property kind - Breach, gap or proposal
 * @property tone - Shared semantic tone
 * @property title - Short explanation
 * @property detail - Supporting explanation
 * @property slot - Affected slot, or none
 * @property assignment - Affected duty key, or none
 * @property flag - Short text on a chip, or none
 * @property fix - Offered action, or none
 */
export const RosterIssueType = StructType({
    kind: VariantType({ breach: NullType, gap: NullType, proposal: NullType }),
    tone: StatusTokenType, title: StringType, detail: StringType, slot: OptionType(RosterSlotType),
    assignment: OptionType(StringType), flag: OptionType(StringType), fix: OptionType(RosterFixType),
});
export type RosterIssueType = typeof RosterIssueType;
/**
 * The app's pay's answer (§5.6): each duty's cost, by its key, in the app's
 * own pay codes.
 * @remarks The Roster knows no pay code in advance: it totals what the app gives, by code and in all.
 */
export const RosterPayType = DictType(StringType, DictType(StringType, FloatType));
export type RosterPayType = typeof RosterPayType;
/**
 * One question to the app's pay (§5.6): one person's duties for the week, or
 * one agency's requests.
 *
 * @typeParam R - The app's duty row type
 * @param row - The app's duty row type
 * @returns The request type over it
 * @remarks `who` is the person or the agency; `duties` its duties, by key; `context` the complete staff and configuration.
 */
export function RosterPayRequestTypeFor<R extends EastType>(row: R) {
    return StructType({ who: RosterWhoType, start: DateTimeType, duties: DictType(StringType, RosterAssignmentTypeFor(row)), context: RosterContextType });
}
/** Type representing {@link RosterPayRequestTypeFor}. */
export type RosterPayRequestTypeFor<R extends EastType> = ReturnType<typeof RosterPayRequestTypeFor<R>>;
/** Type representing {@link RosterCheckContextTypeFor} over the duties alone. */
export type RosterCheckContextTypeFor<R extends EastType> = StructType<{
    start: DateTimeType; week: RosterWeekTypeFor<R>; context: RosterContextType; coverage: DictType<RosterSlotType, RosterCoverageType>; pay: RosterPayType;
}>;
/** Type representing {@link RosterCheckContextTypeFor} over the duties and a reference record's rows (#1551). */
export type RosterReferenceCheckContextTypeFor<R extends EastType, P extends EastType> = StructType<{
    start: DateTimeType; week: RosterWeekTypeFor<R>; context: RosterContextType; coverage: DictType<RosterSlotType, RosterCoverageType>; pay: RosterPayType;
    reference: DictType<StringType, P>;
}>;
/**
 * Input to an application's additional roster checks.
 *
 * @typeParam R - The app's duty row type
 * @param row - The app's duty row type
 * @returns The check's context over it
 * @remarks The built-in coverage has already been calculated for the same draft, and so have the pay's costs: `start` the week's first day, `week` the drafted week, `context` the complete reference data, `coverage` every configured slot's, `pay` each duty's costs by code.
 */
export function RosterCheckContextTypeFor<R extends EastType>(row: R): RosterCheckContextTypeFor<R>;
/**
 * Input to an application's additional roster checks over a reference record
 * of the app's (#1551) — a rota the duties carry out — read through the
 * slice's `reference` source, which the Roster windows as it does its duties.
 *
 * @typeParam R - The app's duty row type
 * @typeParam P - The reference record's row type
 * @param row - The app's duty row type
 * @param reference - The reference record's row type
 * @returns The check's context over them
 * @remarks As the duties' context, and `reference` the record's rows overlapping the week checked and the twelve hours either side — the window its duties are read over — by key: every one, whatever the rail shows, never the record whole. A row at the window's edge may be one the week either side carries out: a check scopes by `start`.
 */
export function RosterCheckContextTypeFor<R extends EastType, P extends EastType>(row: R, reference: P): RosterReferenceCheckContextTypeFor<R, P>;
export function RosterCheckContextTypeFor<R extends EastType, P extends EastType>(row: R, reference?: P): RosterCheckContextTypeFor<R> | RosterReferenceCheckContextTypeFor<R, P> {
    const week = RosterWeekTypeFor(row), coverage = DictType(RosterSlotType, RosterCoverageType);
    return reference === undefined
        ? StructType({ start: DateTimeType, week, context: RosterContextType, coverage, pay: RosterPayType })
        : StructType({ start: DateTimeType, week, context: RosterContextType, coverage, pay: RosterPayType, reference: DictType(StringType, reference) });
}
/** Why someone does not fit a need: Schedule's, shared with the Allocation (#1334). */
export const RosterRefusalType = ScheduleRefusalType;
export type RosterRefusalType = typeof RosterRefusalType;
/** One verdict of the app's fit: Schedule's, shared with the Allocation — it fits with a score, a reason and a warning, or it is refused (#1334). */
export const RosterFitType = ScheduleFitType;
export type RosterFitType = typeof RosterFitType;
/**
 * One question to the app's fit (#1334, east-workspace#1624): who fits a Find
 * fix's need on its issue's slot. It carries the question and the page's
 * scope, and no row: the call carries the Roster's unsaved edits as drafts,
 * and the function reads what it needs from the workspace with them laid over
 * — the week's duties through the duty record's index, the people it asks
 * about, and the configuration from the app's own records.
 *
 * @property need - What is looked for
 * @property slot - The issue's slot
 * @property start - The week's first day, a UTC midnight
 * @property scope - Each rail source's scope by the source's name (#1621): the narrowing the page holds and the viewer
 *   cannot clear, typed as an optimiser's `slice` is, each field its exact values as East prints them; empty for a page
 *   with no scope. The rail's own choices are never sent: a fit answers whatever the rail shows
 */
export const RosterFitRequestType = StructType({ need: RosterNeedType, slot: RosterSlotType, start: DateTimeType, scope: OptimiseSliceType });
/** Type representing {@link RosterFitRequestType}. */
export type RosterFitRequestType = typeof RosterFitRequestType;
/**
 * What a fit's function read (east-workspace#1624): what `Roster.answer` answers from, which the function makes of the
 * app's own records, in the Roster's types.
 *
 * @property people - The people it asks about, by staff key: every one gets a verdict
 * @property duties - The week's duties by key, each its roles: those read over the week's window (`Roster.window`), the
 *   Roster's unsaved edits among them
 * @property shifts - The shifts
 * @property groups - The groups
 * @property positions - The positions; empty where the duties hold none
 * @property activities - Every activity: each group's skills and the duties of no group
 * @property rest - The hours of rest the rule holds between a person's duties; zero for none
 */
export const RosterFitContextType = StructType({
    people: DictType(StringType, RosterPersonType), duties: DictType(StringType, ScheduleRosterRolesType),
    shifts: ArrayType(RosterShiftType), groups: ArrayType(RosterGroupType), positions: ArrayType(RosterPositionType),
    activities: ArrayType(RosterSkillType), rest: FloatType,
});
/** Type representing {@link RosterFitContextType}. */
export type RosterFitContextType = typeof RosterFitContextType;
/**
 * One of a candidate's duties of the week (east-workspace#1624): where the Roster places it, and its roles.
 *
 * @property place - Its day, its shift and its group, none for a duty in no group yet
 * @property roles - Its roles
 */
export const RosterCandidateDutyType = StructType({ place: RosterPlaceType, roles: ScheduleRosterRolesType });
/** Type representing {@link RosterCandidateDutyType}. */
export type RosterCandidateDutyType = typeof RosterCandidateDutyType;
/**
 * One person against the week (east-workspace#1624): what a fit's rule is asked about, one at a time.
 *
 * @property need - What is looked for
 * @property slot - The slot it is looked for on
 * @property start - The week's first day
 * @property person - The person
 * @property duties - That person's duties of the week by key, each where the Roster places it and its roles
 * @property hours - What those duties count
 * @property shifts - The shifts
 * @property groups - The groups
 * @property positions - The positions
 * @property activities - Every activity
 * @property rest - The hours of rest the rule holds; zero for none
 */
export const RosterCandidateType = StructType({
    need: RosterNeedType, slot: RosterSlotType, start: DateTimeType, person: RosterPersonType,
    duties: DictType(StringType, RosterCandidateDutyType), hours: FloatType,
    shifts: ArrayType(RosterShiftType), groups: ArrayType(RosterGroupType), positions: ArrayType(RosterPositionType),
    activities: ArrayType(RosterSkillType), rest: FloatType,
});
/** Type representing {@link RosterCandidateType}. */
export type RosterCandidateType = typeof RosterCandidateType;
/**
 * Where a duty sits, as the Roster reads it from its roles (§5.5, rules 1 and
 * 8): placed in the week, another week's, or a duty the Roster cannot place —
 * one whose shift or group isn't configured, or that names no one — which it
 * lists in Issues and keeps as stored.
 *
 * @typeParam R - The app's duty row type
 * @param row - The app's duty row type
 * @returns The placement type over it
 * @remarks `placed` the duty as the week holds it; `elsewhere` a duty of another week; `unplaced` the issue that lists it.
 */
export function RosterPlacementTypeFor<R extends EastType>(row: R) {
    return VariantType({ placed: RosterAssignmentTypeFor(row), elsewhere: NullType, unplaced: RosterIssueType });
}
/** Type representing {@link RosterPlacementTypeFor}. */
export type RosterPlacementTypeFor<R extends EastType> = ReturnType<typeof RosterPlacementTypeFor<R>>;
/**
 * A target's roles, as the Roster reads them from the app's row
 * (`Roster.targets`): the slot it is for, and what it asks of it.
 * @property day - The day, a UTC midnight
 * @property group - The group's key
 * @property shift - The shift's key
 * @property positions - Positions to fill
 * @property hours - Hours required, by activity key
 */
export const RosterTargetRolesType = StructType({
    day: DateTimeType, group: StringType, shift: StringType, positions: IntegerType, hours: DictType(StringType, FloatType),
});
export type RosterTargetRolesType = typeof RosterTargetRolesType;
/**
 * One stored target, as the targets' `rows` gives it: its roles, read in the
 * pass that reads the row, and the row as bytes at the row type.
 * @property roles - Its roles
 * @property row - Its row, as bytes at the row type
 */
export const RosterTargetEntryType = StructType({ roles: RosterTargetRolesType, row: BlobType });
export type RosterTargetEntryType = typeof RosterTargetEntryType;
/**
 * The app's targets, closed (`Roster.targets`): its record of targets, a row
 * per slot, read and written through its roles over bytes, so the Roster's
 * payload is one type whatever the record holds.
 * @property editing - The shared session over the record: whole rows by their key, its patch door
 * @property entries - The record read by key, when it is given `entries`; `none` for a record read whole
 * @property newKey - The app's rule for a new target's key (`newKey`): given the keys taken, one that is not; `none`, the Roster makes one up
 * @property rowKey - A target's key, built from its row (`key`): what a new target is made under, and what a target moves to as an edit changes the fields it reads; `none`, it builds none
 * @property rows - The targets whose day falls in `[from, to)`, by key, each its roles and its row; `none` while a read is in flight
 * @property read - A drafted row's roles, from its bytes
 * @property needed - A drafted row's hours needed (#1678), from its bytes and its shift's nominal hours: the targets' `needed`, or the sum of its `hours`
 * @property write - The row with its roles written, and every other field as it was
 * @property create - A new row from the roles, every other field its type's default
 * @property history - The record's commits, newest first
 * @property inspector - The app's own form for one target, over its row as bytes; `none`, the Roster's
 * @property rowType - The row type
 */
export const RosterTargetsKindType = StructType({
    editing: EditingType,
    entries: OptionType(ScheduleEntriesType),
    newKey: OptionType(ScheduleNewKeyType),
    rowKey: OptionType(FunctionType([BlobType], StringType)),
    rows: FunctionType([DateTimeType, DateTimeType], OptionType(DictType(StringType, RosterTargetEntryType))),
    read: FunctionType([BlobType], RosterTargetRolesType),
    needed: FunctionType([BlobType, FloatType], FloatType),
    write: FunctionType([BlobType, RosterTargetRolesType], BlobType),
    create: FunctionType([RosterTargetRolesType], BlobType),
    history: FunctionType([], OptionType(ArrayType(RecordCommitInfoType))),
    inspector: OptionType(RowInspectorType),
    rowType: EastTypeType,
});
export type RosterTargetsKindType = typeof RosterTargetsKindType;
/**
 * The app's fit's answer (#1334). It echoes its question, so the Roster
 * matches each answer to the question it asked.
 * @property need - The need answered
 * @property slot - The slot answered
 * @property people - A verdict for each person the function considered, by staff key (east-workspace#1624); the People tab
 *   shows the fits, best first, among what the rail shows, and lists no one the answer does not name
 */
export const RosterFitResultType = StructType({ need: RosterNeedType, slot: RosterSlotType, people: DictType(StringType, RosterFitType) });
export type RosterFitResultType = typeof RosterFitResultType;
/**
 * What an optimiser takes beyond the week (#1553): `{ edges: true }` lets its
 * answer change the duties at the week's edges — for a business whose week
 * runs by when its shifts end, say, where the night before the week is the
 * week's first shift — and its request names the keys of those it must leave
 * as they are, at the duties' own key type: `key`, for duties keyed by other
 * than String.
 *
 * @typeParam K - The duties' key type
 * @property edges - The duties at the week's edges: the request carries `fixed`, and the answer's one patch may change, remove or add a duty at an edge
 * @property key - The duties' record's key type, which `fixed` holds their keys at — `IntegerType` for duties keyed by number; omitted, String
 */
export interface RosterOptimiseOptions<K extends EastType = StringType> {
    readonly edges: true;
    readonly key?: K;
}
/** Type representing {@link RosterOptimiseRequestTypeFor} over the week alone: Schedule's request, the window and the narrowing. */
export type RosterOptimiseRequestType = ScheduleOptimiseRequestType;
/**
 * Type representing {@link RosterOptimiseRequestTypeFor} given `{ edges: true }` (#1553): the week's request, and the duties it
 * must leave, by their keys at the duties' key type `K`.
 *
 * @typeParam K - The duties' key type
 */
export type RosterOptimiseEdgesRequestType<K extends EastType = StringType> = StructType<{
    from: DateTimeType; to: DateTimeType; period: OptimisePeriodType; run: IntegerType; slice: OptimiseSliceType; fixed: SetType<K>;
}>;
/**
 * One request to the app's optimiser (#1409, east-workspace#1622): the period
 * the Roster shows and what kind it is, the run's number and the rail's
 * narrowing — the Elara eye's one call. It carries no row: the function reads
 * the duties through the duty record's indexes, the Roster's unsaved edits
 * laid over them, and the targets, the staff and the configuration from the
 * app's own records.
 *
 * @returns The request type, Schedule's: `{ from, to, period, run, slice }`
 * @remarks `from` and `to` the period the Roster shows, half open: the day in day view, the week in week view, the month in month view; `period` which of them it is (`day`, `week` or `month`); `run` the run's number, from 1 per Roster per browser; `slice` each rail source's narrowing by the source's name, the page's scope among it.
 */
export function RosterOptimiseRequestTypeFor(): RosterOptimiseRequestType;
/**
 * One request to the app's optimiser that may change the duties at the week's
 * edges (#1553): the week's request, and `fixed`, the keys of the duties at the
 * edges its answer must leave as they are — at the duties' own key type, which
 * `key` names for duties keyed by other than String:
 * `Roster.Types.OptimiseRequest({ edges: true, key: IntegerType })`.
 *
 * @typeParam K - The duties' key type
 * @param options - `{ edges: true }`, and the duties' key type, `key`, where they are keyed by other than String
 * @returns The request type: `{ from, to, period, run, slice, fixed }`, `fixed` a Set of the duties' keys
 * @throws {Error} When `key` is given and is no East type
 * @remarks `fixed` the keys of the duties the window holds — the period in view and the twelve hours either side — that the Roster places in another week and whose week takes no edit — published, or closed — or, where the periods are days, whose day takes none, or that fall in no week the Roster holds. It is the one thing the Roster still works out for the function.
 */
export function RosterOptimiseRequestTypeFor<K extends EastType = StringType>(options: RosterOptimiseOptions<K>): RosterOptimiseEdgesRequestType<K>;
export function RosterOptimiseRequestTypeFor(options?: RosterOptimiseOptions<EastType>): RosterOptimiseRequestType | RosterOptimiseEdgesRequestType<EastType> {
    if (options === undefined) return ScheduleOptimiseRequestType;
    if (typeof options !== "object" || options === null || options.edges !== true) {
        throw new Error("Roster.Types.OptimiseRequest: takes nothing, or { edges: true } for an optimiser that may change the duties at the week's edges");
    }
    const key = options.key ?? StringType;
    if (typeof key !== "object" || key === null || typeof (key as { readonly type?: unknown }).type !== "string") {
        throw new Error("Roster.Types.OptimiseRequest: `key` is the duties' key type, an East type — { edges: true, key: IntegerType } for duties keyed by number");
    }
    return StructType({ from: DateTimeType, to: DateTimeType, period: OptimisePeriodType, run: IntegerType, slice: OptimiseSliceType, fixed: SetType(key) });
}
/**
 * An optimiser's answer over the duties' record `D` — what
 * {@link RosterOptimiseResultTypeFor} constructs.
 *
 * @typeParam D - The duties' record type
 */
export type RosterOptimiseResultType<D extends DictType<EastType, EastType> = DictType<EastType, EastType>> = StructType<{ duties: PatchTypeOf<D> }>;
/**
 * The app's optimiser's answer (#1409, east-workspace#1622): a patch of the
 * duties' record — for each key, a duty inserted, deleted, or updated by a
 * patch of its row. It is what `East.diff` gives of the duties before and
 * after, and what a Save sends. One answer serves both forms: given
 * `{ edges: true }`, its patch may change a duty at the week's edges too.
 *
 * @typeParam D - The duties' record type
 * @param duties - The duties' record type, `DictType(K, Duty)`
 * @returns `StructType({ duties })`
 * @throws {Error} When given a type that is no Dict of duties by key
 * @remarks A new duty's key is the optimiser's own. A published week stays read only: an answer that changes or removes one of the request's `fixed` duties, or a duty in a week that takes no edit (a day, where the periods are days), or puts one in a week beyond the weeks either side, is refused, naming the duty, and changes nothing.
 */
export function RosterOptimiseResultTypeFor<D extends DictType<EastType, EastType>>(duties: D): RosterOptimiseResultType<D> {
    const record = optimisedRecordType(duties as EastType, (given) =>
        `Roster.Types.OptimiseResult: is given ${given} — it takes the duties' record type, a Dict of duties by key: DictType(StringType, Duty)`);
    return StructType({ duties: PatchType(record) }) as unknown as RosterOptimiseResultType<D>;
}

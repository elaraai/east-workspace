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
    OptionType, SetType, StringType, StructType, VariantType, type EastType,
} from "@elaraai/east";
import { RecordCommitInfoType } from "@elaraai/e3-types";
import { ColorTokenType, StatusTokenType } from "@elaraai/east-ui";
import { EditingType } from "@elaraai/east-ui/internal";
import { RowInspectorType } from "../utils/row-inspector.js";
import { ScheduleClockType, ScheduleEntriesType, ScheduleFitType, SchedulePeriodStatusType, ScheduleRefusalType } from "../schedule/types.js";

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
 * Who a duty is: a person, or an agency asked to send someone.
 * @remarks Requests reserve positions without pretending an agency has supplied a named person.
 * @property person - The person's key, of the `people` resource kind
 * @property request - The agency's key, of the `agencies` resource kind
 */
export const RosterWhoType = VariantType({ person: StringType, request: StringType });
export type RosterWhoType = typeof RosterWhoType;

/**
 * One duty, as the Roster reads it from the app's row (`R`): its slot, who it
 * is, and its roles, beside the row itself, every field of it.
 *
 * @typeParam R - The app's duty row type
 * @param row - The app's duty row type
 * @returns The assignment type over it
 * @remarks Its times are the duty's own; the Roster gives them no name and no worth (§5.5). Its `hours` are what the duty counts.
 */
export function RosterAssignmentTypeFor<R extends EastType>(row: R) {
    return StructType({
        slot: RosterSlotType, who: RosterWhoType, position: StringType, activity: OptionType(StringType),
        start: DateTimeType, end: DateTimeType, hours: FloatType, row,
    });
}
/** Type representing {@link RosterAssignmentTypeFor}. */
export type RosterAssignmentTypeFor<R extends EastType> = ReturnType<typeof RosterAssignmentTypeFor<R>>;

/**
 * A slot's staffing and work targets.
 * @remarks A duty needs assigned hours, whereas a skill also has holder capacity.
 * @property positions - Positions to fill
 * @property hours - Hours required by skill or duty key
 */
export const RosterRequirementType = StructType({ positions: IntegerType, hours: DictType(StringType, FloatType) });
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
 * @remarks Rest reads this week only; double booking is always reported.
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
 * Coverage for one required activity.
 * @remarks Duties have no holder count or capacity and no skill gap.
 * @property skill - Skill or duty key
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
 * @property hours - Permanent, agency, requested, needed and total rostered hours: each duty's hours
 * @property lines - Required skills in group order, then duties
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
/**
 * Input to an application's additional roster checks.
 *
 * @typeParam R - The app's duty row type
 * @param row - The app's duty row type
 * @returns The check's context over it
 * @remarks The built-in coverage has already been calculated for the same draft, and so have the pay's costs: `start` the week's first day, `week` the drafted week, `context` the complete reference data, `coverage` every configured slot's, `pay` each duty's costs by code.
 */
export function RosterCheckContextTypeFor<R extends EastType>(row: R) {
    return StructType({
        start: DateTimeType, week: RosterWeekTypeFor(row), context: RosterContextType,
        coverage: DictType(RosterSlotType, RosterCoverageType), pay: RosterPayType,
    });
}
/** Type representing {@link RosterCheckContextTypeFor}. */
export type RosterCheckContextTypeFor<R extends EastType> = ReturnType<typeof RosterCheckContextTypeFor<R>>;
/** Why someone does not fit a need: Schedule's, shared with the Allocation (#1334). */
export const RosterRefusalType = ScheduleRefusalType;
export type RosterRefusalType = typeof RosterRefusalType;
/** One verdict of the app's fit: Schedule's, shared with the Allocation — it fits with a score, a reason and a warning, or it is refused (#1334). */
export const RosterFitType = ScheduleFitType;
export type RosterFitType = typeof RosterFitType;
/**
 * One question to the app's fit (#1334): who fits a Find fix's need on its
 * issue's slot, over the drafted week.
 *
 * @typeParam R - The app's duty row type
 * @param row - The app's duty row type
 * @returns The request type over it
 * @remarks `need` what is looked for, `slot` the issue's, `start` the week's first day, `week` the drafted week, `context` the complete staff and configuration — every person, whatever the rail shows — and `coverage` the drafted week's.
 */
export function RosterFitRequestTypeFor<R extends EastType>(row: R) {
    return StructType({
        need: RosterNeedType, slot: RosterSlotType, start: DateTimeType, week: RosterWeekTypeFor(row), context: RosterContextType,
        coverage: DictType(RosterSlotType, RosterCoverageType),
    });
}
/** Type representing {@link RosterFitRequestTypeFor}. */
export type RosterFitRequestTypeFor<R extends EastType> = ReturnType<typeof RosterFitRequestTypeFor<R>>;
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
 * @property rows - The targets whose day falls in `[from, to)`, by key, each its roles and its row; `none` while a read is in flight
 * @property read - A drafted row's roles, from its bytes
 * @property write - The row with its roles written, and every other field as it was
 * @property create - A new row from the roles, every other field its type's default
 * @property history - The record's commits, newest first
 * @property inspector - The app's own form for one target, over its row as bytes; `none`, the Roster's
 * @property rowType - The row type
 */
export const RosterTargetsKindType = StructType({
    editing: EditingType,
    entries: OptionType(ScheduleEntriesType),
    rows: FunctionType([DateTimeType, DateTimeType], OptionType(DictType(StringType, RosterTargetEntryType))),
    read: FunctionType([BlobType], RosterTargetRolesType),
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
 * @property people - A verdict for every person, by staff key; the People tab shows the fits, best first
 */
export const RosterFitResultType = StructType({ need: RosterNeedType, slot: RosterSlotType, people: DictType(StringType, RosterFitType) });
export type RosterFitResultType = typeof RosterFitResultType;

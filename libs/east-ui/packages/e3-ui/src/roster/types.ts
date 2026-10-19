/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    ArrayType, BooleanType, DateTimeType, DictType, FloatType, IntegerType, NullType,
    OptionType, SetType, StringType, StructType, VariantType,
} from "@elaraai/east";
import { StatusTokenType } from "@elaraai/east-ui";
import { ScheduleClockType, ScheduleFitType, ScheduleRefusalType } from "../schedule/types.js";

/**
 * One shift of one group on one day. Day zero is the record key's UTC date.
 * @remarks Slot keys compare by East value, including when decoded in the browser.
 * @property day - Day within the week, from zero to six
 * @property group - Group key
 * @property shift - Shift key
 */
export const RosterSlotType = StructType({ day: IntegerType, group: StringType, shift: StringType });
export type RosterSlotType = typeof RosterSlotType;

/**
 * The subject of an assignment.
 * @remarks Requests reserve positions without pretending an agency has supplied a named person.
 * @property person - The original staff record key
 * @property request - The agency asked to supply someone
 */
export const RosterWhoType = VariantType({ person: StringType, request: StringType });
export type RosterWhoType = typeof RosterWhoType;

/**
 * An assignment stored within one week.
 * @remarks A start offset moves the start; overtime extends the end. Agreement is absent for an unchanged shift.
 * @property slot - The day, group and shift
 * @property who - A named person or an agency request
 * @property position - Position held on this assignment
 * @property activity - One skill or duty, or none
 * @property offset - Start offset in hours, negative for an early start
 * @property overtime - Additional hours after the shift
 * @property agreed - Whether the person agreed to changed hours
 */
export const RosterAssignmentType = StructType({
    slot: RosterSlotType, who: RosterWhoType, position: StringType, activity: OptionType(StringType),
    offset: FloatType, overtime: FloatType, agreed: OptionType(BooleanType),
});
export type RosterAssignmentType = typeof RosterAssignmentType;

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
 * The durable status of a week.
 * @remarks Publishing saves the complete week and its status atomically.
 * @property draft - An editable week
 * @property published - A read-only week and its publication instant
 */
export const RosterStatusType = VariantType({ draft: NullType, published: StructType({ at: DateTimeType }) });
export type RosterStatusType = typeof RosterStatusType;
/**
 * The single atomic entry in the roster record.
 * @remarks Assignments, targets, dismissals and publication share one optimistic patch baseline.
 * @property status - Draft or published
 * @property assignments - Assignments by stable identifier
 * @property requirements - Targets by slot
 * @property dismissed - Proposal identifiers rejected for this week
 */
export const RosterWeekType = StructType({
    status: RosterStatusType, assignments: DictType(StringType, RosterAssignmentType),
    requirements: RosterRequirementsType, dismissed: SetType(StringType),
});
export type RosterWeekType = typeof RosterWeekType;
/** Weeks keyed by their first day at UTC midnight. @remarks This is the roster record's stored wire type. */
export const RosterWeeksType = DictType(DateTimeType, RosterWeekType);
export type RosterWeeksType = typeof RosterWeeksType;

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
 * A recurring shift's time and nominal hours.
 * @remarks An end past midnight belongs to the following day; the assignment still belongs to its start day.
 * @property key - Stable identifier
 * @property label - Display name
 * @property code - Short code in the week layout
 * @property start - Start time in UTC, shared with Schedule
 * @property hours - Nominal shift duration
 */
export const RosterShiftType = StructType({
    key: StringType, label: StringType, code: StringType, start: ScheduleClockType, hours: FloatType,
});
export type RosterShiftType = typeof RosterShiftType;
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
 * @property key - Stable identifier
 * @property name - Display name
 */
export const RosterAgencyType = StructType({ key: StringType, name: StringType });
export type RosterAgencyType = typeof RosterAgencyType;
/**
 * A person resolved from the author's keyed staff data.
 * @remarks Roster reads staff; all edits go to the weeks record.
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
 * @property rest - Minimum hours between shifts; zero disables the rest check
 * @property lead - Check staffed slots for a lead
 * @property trainer - Check trainees have a trainer
 * @property skill - Check activities against held skills
 * @property agree - Report unagreed changed hours
 */
export const RosterRulesType = StructType({ rest: FloatType, lead: BooleanType, trainer: BooleanType, skill: BooleanType, agree: BooleanType });
export type RosterRulesType = typeof RosterRulesType;
/**
 * Optional costing configuration.
 * @remarks Omitting costs hides monetary readouts; it does not affect staffing checks.
 * @property currency - Currency identifier for the shared formatter
 * @property rates - Permanent, overtime and agency hourly rates
 * @property budget - Daily budget, or none
 */
export const RosterCostsType = StructType({
    currency: StringType, rates: StructType({ permanent: FloatType, overtime: FloatType, agency: FloatType }), budget: OptionType(FloatType),
});
export type RosterCostsType = typeof RosterCostsType;
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
 * @property costs - Optional monetary configuration
 */
export const RosterContextType = StructType({
    people: DictType(StringType, RosterPersonType), groups: ArrayType(RosterGroupType), activities: ArrayType(RosterSkillType),
    shifts: ArrayType(RosterShiftType), positions: ArrayType(RosterPositionType), agencies: ArrayType(RosterAgencyType),
    rules: RosterRulesType, costs: OptionType(RosterCostsType),
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
 * @property assigned - Hours explicitly assigned to this activity
 */
export const RosterCoverageLineType = StructType({
    skill: StringType, needed: FloatType, holders: OptionType(IntegerType), capacity: OptionType(FloatType), gap: FloatType, assigned: FloatType,
});
export type RosterCoverageLineType = typeof RosterCoverageLineType;
/**
 * Staffing, work and costs for a complete slot.
 * @remarks Requests fill positions and contribute requested hours, but never count as named people or skilled holders.
 * @property positions - Required positions
 * @property filled - Assignments including requests
 * @property open - Unfilled positions, at least zero
 * @property people - Named people assigned
 * @property hours - Permanent, agency, overtime, requested, needed and total rostered hours
 * @property lines - Required skills in group order, then duties
 * @property cost - Total cost, zero when costs are absent
 * @property lead - A named person holds a lead position
 * @property trainer - A trainer is assigned
 */
export const RosterCoverageType = StructType({
    positions: IntegerType, filled: IntegerType, open: IntegerType, people: IntegerType,
    hours: StructType({ permanent: FloatType, agency: FloatType, overtime: FloatType, requested: FloatType, needed: FloatType, rostered: FloatType }),
    lines: ArrayType(RosterCoverageLineType), cost: FloatType, lead: BooleanType, trainer: BooleanType,
});
export type RosterCoverageType = typeof RosterCoverageType;
/**
 * An externally computed staffing proposal.
 * @remarks Acceptance creates an assignment; rejection stores this key in the week's dismissed set.
 * @property key - Proposal identifier
 * @property week - Week's first day
 * @property slot - Suggested destination
 * @property person - Original staff key
 * @property reason - Explanation presented to the planner
 */
export const RosterProposalType = StructType({ key: StringType, week: DateTimeType, slot: RosterSlotType, person: StringType, reason: StringType });
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
 * @remarks Every data-changing action is one gesture of the shared edit session. A find edits nothing: it asks the app's fit who fits its need on the issue's slot, and is offered only when the Roster has a `fit` (#1334).
 * @property request - Request someone from this agency
 * @property agree - Mark the assignment agreed
 * @property accept - Accept this proposal key
 * @property move - Move the assignment to this shift
 * @property start - Set this start offset in hours
 * @property find - Find who fits this need on the issue's slot: the app's fit's answer, in the People tab
 */
export const RosterFixType = VariantType({
    request: StringType, agree: NullType, accept: StringType, move: StringType, start: FloatType,
    find: RosterNeedType,
});
export type RosterFixType = typeof RosterFixType;
/**
 * One explanation or warning about the drafted roster.
 * @remarks Warnings do not introduce a separate validation barrier to Save or Publish.
 * @property kind - Breach, gap, agreement or proposal
 * @property tone - Shared semantic tone
 * @property title - Short explanation
 * @property detail - Supporting explanation
 * @property slot - Affected slot, or none
 * @property assignment - Affected assignment key, or none
 * @property flag - Short text on a chip, or none
 * @property fix - Offered action, or none
 */
export const RosterIssueType = StructType({
    kind: VariantType({ breach: NullType, gap: NullType, agree: NullType, proposal: NullType }),
    tone: StatusTokenType, title: StringType, detail: StringType, slot: OptionType(RosterSlotType),
    assignment: OptionType(StringType), flag: OptionType(StringType), fix: OptionType(RosterFixType),
});
export type RosterIssueType = typeof RosterIssueType;
/**
 * Input to an application's additional roster checks.
 * @remarks The built-in coverage has already been calculated for the same draft.
 * @property start - Week's first day
 * @property week - Drafted week
 * @property context - Complete reference data
 * @property coverage - Coverage for every configured slot
 */
export const RosterCheckContextType = StructType({ start: DateTimeType, week: RosterWeekType, context: RosterContextType, coverage: DictType(RosterSlotType, RosterCoverageType) });
export type RosterCheckContextType = typeof RosterCheckContextType;
/** Why someone does not fit a need: Schedule's, shared with the Allocation (#1334). */
export const RosterRefusalType = ScheduleRefusalType;
export type RosterRefusalType = typeof RosterRefusalType;
/** One verdict of the app's fit: Schedule's, shared with the Allocation — it fits with a score, a reason and a warning, or it is refused (#1334). */
export const RosterFitType = ScheduleFitType;
export type RosterFitType = typeof RosterFitType;
/**
 * One question to the app's fit (#1334): who fits a Find fix's need on its
 * issue's slot, over the drafted week.
 * @remarks The context is complete — every person, whatever the rail shows — as the checks read it.
 * @property need - What is looked for
 * @property slot - The issue's day, group and shift
 * @property start - The week's first day
 * @property week - The drafted week
 * @property context - Complete staff and configuration
 * @property coverage - The drafted week's coverage for every configured slot
 */
export const RosterFitRequestType = StructType({
    need: RosterNeedType, slot: RosterSlotType, start: DateTimeType, week: RosterWeekType, context: RosterContextType,
    coverage: DictType(RosterSlotType, RosterCoverageType),
});
export type RosterFitRequestType = typeof RosterFitRequestType;
/**
 * The app's fit's answer (#1334). It echoes its question, so the Roster
 * matches each answer to the question it asked.
 * @property need - The need answered
 * @property slot - The slot answered
 * @property people - A verdict for every person, by staff key; the People tab shows the fits, best first
 */
export const RosterFitResultType = StructType({ need: RosterNeedType, slot: RosterSlotType, people: DictType(StringType, RosterFitType) });
export type RosterFitResultType = typeof RosterFitResultType;

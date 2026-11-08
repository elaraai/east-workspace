/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    ArrayType, DictType, East, FloatType, IntegerType, OptionType, StringType, StructType, none, some, variant,
    type EastType, type ExprType, type FunctionType,
} from "@elaraai/east";
import { scheduleNumberText } from "../schedule/words.js";
import { rosterCoverage } from "./coverage.js";
import {
    RosterAssignmentTypeFor, RosterContextType, RosterFixType, RosterGroupType, RosterIssueType, RosterPlaceType, RosterSlotType, RosterWeekTypeFor,
} from "./types.js";

/** Rest before and after a duty, in hours. Infinity means no other duty of theirs on that side in this week. @internal */
export const RosterRestType = StructType({ before: FloatType, after: FloatType, minimum: FloatType });

/**
 * Measures a duty's rest against the person's other duties of the week.
 *
 * @typeParam R - The app's duty row type
 * @param row - The app's duty row type
 * @returns An East function `(assignment, id, week, context) → Rest`: the rest before it, after it, and the smaller of the two
 * @remarks Rest is measured between the duties' own times: before, from the end of the latest of the person's duties to start before it; after, to the start of the earliest to start after it. Duties that overlap leave negative rest. An agency's request has none. This same calculation checks prospective drops and existing duties.
 * @internal
 */
export function rosterRest<R extends EastType>(row: R) {
    return East.function([RosterAssignmentTypeFor(row as EastType), StringType, RosterWeekTypeFor(row as EastType), RosterContextType], RosterRestType, ($, assignment, id, week, _context) => {
        const before = $.let(Infinity, FloatType);
        const after = $.let(Infinity, FloatType);
        $.if(assignment.who.hasTag("person"), $ => {
            $.for(week.assignments, ($, other, key) => {
                $.if(East.notEqual(key, id).and(() => East.equal(other.who, assignment.who)), $ => {
                    $.if(East.lessEqual(other.start, assignment.start), $ => {
                        $.assign(before, East.min(before, other.end.durationHours(assignment.start)));
                    }).else($ => {
                        $.assign(after, East.min(after, assignment.end.durationHours(other.start)));
                    });
                });
            });
        });
        return { before, after, minimum: East.min(before, after) };
    }) as unknown as ExprType<FunctionType<[RosterAssignmentTypeFor<R>, StringType, RosterWeekTypeFor<R>, RosterContextType], typeof RosterRestType>>;
}

/**
 * Checks a drafted week for staffing gaps and breaches.
 *
 * @typeParam R - The app's duty row type
 * @param row - The app's duty row type
 * @returns An East function `(week, context) → Array<Issue>`: issues in day, group and shift order, with actionable fixes — each day's duties in no group after its groups'
 * @remarks Pure East, shared by tasks and the renderer. Rest is confined to this week. Issues explain the roster; they do not automatically block Save or Publish. The pay's codes are the app's: its own `check` reads them (`CheckContext(R)`). Its words print hours as the fit's do (`scheduleNumberText`): `6 h rest`, `7.5 h unfilled`. A duty in no group (#1548) is checked as its person's — double booked, rest, a skill they don't hold, a person no longer in the staff — its issue in no slot; no group has a target, a lead or a trainer to check.
 */
export function rosterCheck<R extends EastType>(row: R) {
    const Row = row as EastType;
    const coverageFn = rosterCoverage(Row);
    const restFn = rosterRest(Row);
    const Assignment = RosterAssignmentTypeFor(Row);
    return East.function([RosterWeekTypeFor(Row), RosterContextType], ArrayType(RosterIssueType), ($, week, context) => {
        const coverageOf = $.const(coverageFn);
        const restOf = $.const(restFn);
        const hoursText = $.const(scheduleNumberText);
        // "position", or "positions" for any count but one.
        const positionsText = $.const(East.function([IntegerType], StringType, (_$2, n) => East.equal(n, 1n).ifElse(() => "position", () => "positions")));
        // The built-in checks read no costs: the app's own check reads its pay's.
        const coverage = $.const(coverageOf(week, context, East.value(new Map(), DictType(StringType, DictType(StringType, FloatType)))));
        const issues = $.let([], ArrayType(RosterIssueType));
        // Where a day's duties stand: each group's slots, then no group's (#1548).
        const places = $.let([], ArrayType(OptionType(RosterGroupType)));
        $.for(context.groups, ($, group) => { $(places.pushLast(some(group))); });
        $(places.pushLast(none));
        $.for(East.Array.range(0n, 7n), ($, day) => {
            $.for(places, ($, place) => {
                // A group's skills: the activities of that group. A duty in no group is held to every group's.
                const skills = $.const(place.match({
                    some: (_$2, group) => context.activities.filter((_$3, activity) => East.equal(activity.group, some(group.key))),
                    none: (_$2) => context.activities.filter((_$3, activity) => activity.group.hasTag("some")),
                }));
                const groupKey = $.const(place.match({
                    some: (_$2, group) => East.value(some(group.key), OptionType(StringType)),
                    none: (_$2) => East.value(none, OptionType(StringType)),
                }));
                const groupText = $.const(place.match({ some: (_$2, group) => group.label, none: (_$2) => East.value("No group", StringType) }));
                $.for(context.shifts, ($, shift) => {
                    // The slot of the group's shift on the day; none for the duties in no group, which have no slot.
                    const slot = $.const(place.match({
                        some: (_$2, group) => East.value(some({ day, group: group.key, shift: shift.key }), OptionType(RosterSlotType)),
                        none: (_$2) => East.value(none, OptionType(RosterSlotType)),
                    }));
                    const location = $.const(East.str`${groupText} · ${shift.label}`);
                    const at = $.const({ day, group: groupKey, shift: shift.key }, RosterPlaceType);
                    const assignments = $.const(week.assignments.filter((_$, a) => East.equal(a.place, at)));
                    $.match(slot, { some: ($, slot) => {
                        const c = $.const(coverage.get(slot));
                        $.if(context.rules.lead.and(() => East.greater(c.positions, 0n)).and(() => East.greater(c.filled, 0n)).and(() => c.lead.not()), $ => {
                            $(issues.pushLast({ kind: variant("breach", null), tone: variant("warning", null),
                                title: East.str`No lead on ${location}`, detail: "Assign someone in a lead position",
                                slot: some(slot), assignment: none, flag: some("no lead"), fix: some(variant("find", variant("leads", null))) }));
                        });
                    } });
                    $.for(assignments, ($, a, id) => {
                        $.match(a.who, { person: ($, key) => {
                            $.if(context.people.has(key), $ => {
                                const person = $.const(context.people.get(key));
                                const sameDay = $.const(week.assignments.filter((_$, other) =>
                                    East.equal(other.who, a.who).and(() => East.equal(other.place.day, day))));
                                $.if(East.greater(sameDay.size(), 1n), $ => {
                                    $(issues.pushLast({ kind: variant("breach", null), tone: variant("danger", null),
                                        title: East.str`${person.name} · double booked`, detail: East.str`${location} · on ${sameDay.size()} shifts this day`,
                                        slot, assignment: some(id), flag: some("double"), fix: none }));
                                });
                                const rest = $.const(restOf(a, id, week, context));
                                $.if(East.greater(context.rules.rest, 0.0).and(() => East.less(rest.minimum, context.rules.rest)), $ => {
                                    const fix = $.let(none, OptionType(RosterFixType));
                                    // Another shift of the day, the duty's times kept where they stood against its shift's start.
                                    $.for(context.shifts, ($, alternative) => {
                                        $.if(fix.hasTag("none").and(() => East.notEqual(alternative.key, shift.key)), $ => {
                                            const moved = $.const(alternative.start.hour.multiply(60n).add(alternative.start.minute)
                                                .subtract(shift.start.hour.multiply(60n).add(shift.start.minute)));
                                            const candidate = $.const(East.value({
                                                place: { day, group: groupKey, shift: alternative.key }, who: a.who, position: a.position, activity: a.activity,
                                                start: a.start.addMinutes(moved), end: a.end.addMinutes(moved), hours: a.hours, row: a.row,
                                            } as never, Assignment));
                                            $.if(East.greaterEqual(restOf(candidate as never, id, week, context).minimum, context.rules.rest), $ => {
                                                $.assign(fix, some(variant("move", alternative.key)));
                                            });
                                        });
                                    });
                                    $.if(fix.hasTag("none").and(() => East.less(rest.before, context.rules.rest)), $ => {
                                        const extra = $.const(East.Float.roundCeil(context.rules.rest.subtract(rest.before).multiply(2.0)).toFloat().divide(2.0));
                                        // A later start must not fix the previous night by breaking the following one.
                                        $.if(East.greaterEqual(rest.after.subtract(extra), context.rules.rest), $ => {
                                            $.assign(fix, some(variant("start", a.start.addHours(extra))));
                                        });
                                    });
                                    $(issues.pushLast({ kind: variant("breach", null), tone: variant("danger", null),
                                        title: East.str`${person.name} · ${hoursText(rest.minimum)} h rest`,
                                        detail: East.lessEqual(rest.before, rest.after).ifElse(
                                            () => East.str`${location} · minimum ${hoursText(context.rules.rest)} h since the previous shift`,
                                            () => East.str`${location} · minimum ${hoursText(context.rules.rest)} h before the next shift`),
                                        slot, assignment: some(id), flag: some(East.str`${hoursText(rest.minimum)}h rest`), fix }));
                                });
                                $.match(slot, { some: ($, slot) => {
                                    $.if(context.rules.trainer.and(() => person.trainee).and(() => coverage.get(slot).trainer.not()), $ => {
                                        $(issues.pushLast({ kind: variant("breach", null), tone: variant("warning", null),
                                            title: East.str`${person.name} · trainee without trainer`, detail: East.str`${location} · no trainer rostered on this shift`,
                                            slot: some(slot), assignment: some(id), flag: some("trainee"), fix: some(variant("find", variant("trainers", null))) }));
                                    });
                                } });
                                $.if(context.rules.skill, $ => {
                                    $.match(a.activity, { some: ($, activity) => {
                                        $.for(skills, ($, skill) => {
                                            $.if(East.equal(skill.key, activity).and(() => person.skills.has(activity).not()), $ => {
                                                $(issues.pushLast({ kind: variant("breach", null), tone: variant("warning", null),
                                                    title: East.str`${person.name} · not skilled for ${skill.label}`,
                                                    detail: East.str`${location} · activity ${skill.code} needs the skill`,
                                                    slot, assignment: some(id), flag: some("not skilled"), fix: none }));
                                            });
                                        });
                                    } });
                                });
                            }).else($ => {
                                $(issues.pushLast({ kind: variant("breach", null), tone: variant("danger", null),
                                    title: East.str`Unknown person · ${key}`, detail: East.str`${location} · this person is no longer in the staff source`,
                                    slot, assignment: some(id), flag: some("unknown person"), fix: none }));
                            });
                        } });
                    });
                    $.match(slot, { some: ($, slot) => {
                        const c = $.const(coverage.get(slot));
                        $.if(East.greater(c.open, 0n), $ => {
                            const fix = $.let(none, OptionType(RosterFixType));
                            $.if(East.greater(context.agencies.size(), 0n), $ => { $.assign(fix, some(variant("request", context.agencies.get(0n).key))); });
                            $(issues.pushLast({ kind: variant("gap", null), tone: variant("warning", null),
                                title: East.str`${c.open} open ${positionsText(c.open)} · ${location}`,
                                detail: East.str`${hoursText(c.open.toFloat().multiply(shift.hours))} h unfilled · ${c.filled} of ${c.positions} ${positionsText(c.positions)}`,
                                slot: some(slot), assignment: none, flag: some(East.str`${c.open} open`), fix }));
                        });
                        $.if(context.rules.skill.and(() => East.greater(c.filled, 0n)), $ => {
                            $.for(c.lines, ($, line) => {
                                $.if(East.greater(line.gap, 0.0), $ => {
                                    $.for(skills, ($, skill) => {
                                        $.if(East.equal(skill.key, line.skill), $ => {
                                            $(issues.pushLast({ kind: variant("gap", null), tone: variant("warning", null),
                                                title: East.str`${skill.label} · ${hoursText(line.gap)} h short`,
                                                detail: East.str`${location} · ${hoursText(line.capacity.unwrap("some"))} h capacity of ${hoursText(line.needed)} h`,
                                                slot: some(slot), assignment: none, flag: some("skill gap"), fix: some(variant("find", variant("skill", skill.key))) }));
                                        });
                                    });
                                });
                            });
                        });
                    } });
                });
            });
        });
        return issues;
    }) as unknown as ExprType<FunctionType<[RosterWeekTypeFor<R>, RosterContextType], ArrayType<typeof RosterIssueType>>>;
}

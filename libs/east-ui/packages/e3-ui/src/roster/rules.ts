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
import { RosterAssignmentTypeFor, RosterContextType, RosterFixType, RosterIssueType, RosterSlotType, RosterWeekTypeFor } from "./types.js";

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
 * @returns An East function `(week, context) → Array<Issue>`: issues in day, group and shift order, with actionable fixes
 * @remarks Pure East, shared by tasks and the renderer. Rest is confined to this week. Issues explain the roster; they do not automatically block Save or Publish. The pay's codes are the app's: its own `check` reads them (`CheckContext(R)`). Its words print hours as the fit's do (`scheduleNumberText`): `6 h rest`, `7.5 h unfilled`.
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
        $.for(East.Array.range(0n, 7n), ($, day) => {
            $.for(context.groups, ($, group) => {
                // The group's skills: the activities of that group.
                const skills = $.const(context.activities.filter((_$, activity) => East.equal(activity.group, some(group.key))));
                $.for(context.shifts, ($, shift) => {
                    const slot = $.const({ day, group: group.key, shift: shift.key }, RosterSlotType);
                    const c = $.const(coverage.get(slot));
                    const location = $.const(East.str`${group.label} · ${shift.label}`);
                    const assignments = $.const(week.assignments.filter((_$, a) => East.equal(a.slot, slot)));
                    $.if(context.rules.lead.and(() => East.greater(c.positions, 0n)).and(() => East.greater(c.filled, 0n)).and(() => c.lead.not()), $ => {
                        $(issues.pushLast({ kind: variant("breach", null), tone: variant("warning", null),
                            title: East.str`No lead on ${location}`, detail: "Assign someone in a lead position",
                            slot: some(slot), assignment: none, flag: some("no lead"), fix: some(variant("find", variant("leads", null))) }));
                    });
                    $.for(assignments, ($, a, id) => {
                        $.match(a.who, { person: ($, key) => {
                            $.if(context.people.has(key), $ => {
                                const person = $.const(context.people.get(key));
                                const sameDay = $.const(week.assignments.filter((_$, other) =>
                                    East.equal(other.who, a.who).and(() => East.equal(other.slot.day, day))));
                                $.if(East.greater(sameDay.size(), 1n), $ => {
                                    $(issues.pushLast({ kind: variant("breach", null), tone: variant("danger", null),
                                        title: East.str`${person.name} · double booked`, detail: East.str`${location} · on ${sameDay.size()} shifts this day`,
                                        slot: some(slot), assignment: some(id), flag: some("double"), fix: none }));
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
                                                slot: { day, group: group.key, shift: alternative.key }, who: a.who, position: a.position, activity: a.activity,
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
                                        slot: some(slot), assignment: some(id), flag: some(East.str`${hoursText(rest.minimum)}h rest`), fix }));
                                });
                                $.if(context.rules.trainer.and(() => person.trainee).and(() => c.trainer.not()), $ => {
                                    $(issues.pushLast({ kind: variant("breach", null), tone: variant("warning", null),
                                        title: East.str`${person.name} · trainee without trainer`, detail: East.str`${location} · no trainer rostered on this shift`,
                                        slot: some(slot), assignment: some(id), flag: some("trainee"), fix: some(variant("find", variant("trainers", null))) }));
                                });
                                $.if(context.rules.skill, $ => {
                                    $.match(a.activity, { some: ($, activity) => {
                                        $.for(skills, ($, skill) => {
                                            $.if(East.equal(skill.key, activity).and(() => person.skills.has(activity).not()), $ => {
                                                $(issues.pushLast({ kind: variant("breach", null), tone: variant("warning", null),
                                                    title: East.str`${person.name} · not skilled for ${skill.label}`,
                                                    detail: East.str`${location} · activity ${skill.code} needs the skill`,
                                                    slot: some(slot), assignment: some(id), flag: some("not skilled"), fix: none }));
                                            });
                                        });
                                    } });
                                });
                            }).else($ => {
                                $(issues.pushLast({ kind: variant("breach", null), tone: variant("danger", null),
                                    title: East.str`Unknown person · ${key}`, detail: East.str`${location} · this person is no longer in the staff source`,
                                    slot: some(slot), assignment: some(id), flag: some("unknown person"), fix: none }));
                            });
                        } });
                    });
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
                });
            });
        });
        return issues;
    }) as unknown as ExprType<FunctionType<[RosterWeekTypeFor<R>, RosterContextType], ArrayType<typeof RosterIssueType>>>;
}

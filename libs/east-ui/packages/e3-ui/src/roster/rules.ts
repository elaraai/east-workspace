/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { ArrayType, East, FloatType, OptionType, StringType, StructType, none, some, variant } from "@elaraai/east";
import { rosterCoverage } from "./coverage.js";
import { RosterAssignmentType, RosterContextType, RosterFixType, RosterIssueType, RosterSlotType, RosterWeekType } from "./types.js";

/** Rest before and after an assignment, in hours. Infinity means no neighbouring assignment in this week. @internal */
export const RosterRestType = StructType({ before: FloatType, after: FloatType, minimum: FloatType });

/**
 * Measures rest against adjacent days within the supplied week.
 * @param assignment - The assignment or candidate placement
 * @param id - Its identifier, excluded from comparisons
 * @param week - The drafted week
 * @param context - Reference data defining shift times
 * @returns Rest before, after and the smaller of the two
 * @remarks Start offsets move the entire shift, while overtime extends its end. This same calculation checks prospective drops and existing assignments.
 * @internal
 */
export const rosterRest = East.function([RosterAssignmentType, StringType, RosterWeekType, RosterContextType], RosterRestType, ($, assignment, id, week, context) => {
    const before = $.let(Infinity, FloatType);
    const after = $.let(Infinity, FloatType);
    const shifts = $.const(context.shifts.toDict((_$, shift) => shift.key, (_$, shift) => shift));
    $.if(assignment.who.hasTag("person").and(() => shifts.has(assignment.slot.shift)), $ => {
        const shift = $.const(shifts.get(assignment.slot.shift));
        const start = $.const(shift.start.hour.toFloat().add(shift.start.minute.toFloat().divide(60.0)).add(assignment.offset));
        const end = $.const(start.add(shift.hours).add(assignment.overtime));
        $.for(week.assignments, ($, other, key) => {
            $.if(East.notEqual(key, id).and(() => East.equal(other.who, assignment.who)).and(() => shifts.has(other.slot.shift)), $ => {
                const otherShift = $.const(shifts.get(other.slot.shift));
                const otherStart = $.const(otherShift.start.hour.toFloat().add(otherShift.start.minute.toFloat().divide(60.0)).add(other.offset));
                const otherEnd = $.const(otherStart.add(otherShift.hours).add(other.overtime));
                $.if(East.equal(other.slot.day, assignment.slot.day.subtract(1n)), $ => {
                    $.assign(before, East.min(before, start.add(24.0).subtract(otherEnd)));
                });
                $.if(East.equal(other.slot.day, assignment.slot.day.add(1n)), $ => {
                    $.assign(after, East.min(after, otherStart.add(24.0).subtract(end)));
                });
            });
        });
    });
    return { before, after, minimum: East.min(before, after) };
});

/**
 * Checks a drafted week for staffing gaps, breaches and unagreed hours.
 * @param week - The week with draft assignments and targets
 * @param context - Complete people and configuration
 * @returns Issues in day, group and shift order, with actionable fixes
 * @remarks Pure East, shared by tasks and the renderer. Rest is confined to this week. Issues explain the roster; they do not automatically block Save or Publish.
 */
export const rosterCheck = East.function([RosterWeekType, RosterContextType], ArrayType(RosterIssueType), ($, week, context) => {
    const coverageOf = $.const(rosterCoverage);
    const restOf = $.const(rosterRest);
    const coverage = $.const(coverageOf(week, context));
    const issues = $.let([], ArrayType(RosterIssueType));
    $.for(East.Array.range(0n, 7n), ($, day) => {
        $.for(context.groups, ($, group) => {
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
                                $.for(context.shifts, ($, alternative) => {
                                    $.if(fix.hasTag("none").and(() => East.notEqual(alternative.key, shift.key)), $ => {
                                        const candidate = $.const({
                                            slot: { day, group: group.key, shift: alternative.key }, who: a.who,
                                            position: a.position, activity: a.activity, offset: a.offset, overtime: a.overtime, agreed: a.agreed,
                                        }, RosterAssignmentType);
                                        $.if(East.greaterEqual(restOf(candidate, id, week, context).minimum, context.rules.rest), $ => {
                                            $.assign(fix, some(variant("move", alternative.key)));
                                        });
                                    });
                                });
                                $.if(fix.hasTag("none").and(() => East.less(rest.before, context.rules.rest)), $ => {
                                    const extra = $.const(East.Float.roundCeil(context.rules.rest.subtract(rest.before).multiply(2.0)).toFloat().divide(2.0));
                                    // A later start must not fix the previous night by breaking the following one.
                                    $.if(East.greaterEqual(rest.after.subtract(extra), context.rules.rest), $ => {
                                        $.assign(fix, some(variant("start", a.offset.add(extra))));
                                    });
                                });
                                $(issues.pushLast({ kind: variant("breach", null), tone: variant("danger", null),
                                    title: East.str`${person.name} · ${rest.minimum} h rest`,
                                    detail: East.lessEqual(rest.before, rest.after).ifElse(
                                        () => East.str`${location} · minimum ${context.rules.rest} h since the previous shift`,
                                        () => East.str`${location} · minimum ${context.rules.rest} h before the next shift`),
                                    slot: some(slot), assignment: some(id), flag: some(East.str`${rest.minimum}h rest`), fix }));
                            });
                            $.if(context.rules.trainer.and(() => person.trainee).and(() => c.trainer.not()), $ => {
                                $(issues.pushLast({ kind: variant("breach", null), tone: variant("warning", null),
                                    title: East.str`${person.name} · trainee without trainer`, detail: East.str`${location} · no trainer rostered on this shift`,
                                    slot: some(slot), assignment: some(id), flag: some("trainee"), fix: some(variant("find", variant("trainers", null))) }));
                            });
                            $.if(context.rules.skill, $ => {
                                $.match(a.activity, { some: ($, activity) => {
                                    $.for(group.skills, ($, skill) => {
                                        $.if(East.equal(skill.key, activity).and(() => person.skills.has(activity).not()), $ => {
                                            $(issues.pushLast({ kind: variant("breach", null), tone: variant("warning", null),
                                                title: East.str`${person.name} · not skilled for ${skill.label}`,
                                                detail: East.str`${location} · activity ${skill.code} needs the skill`,
                                                slot: some(slot), assignment: some(id), flag: some("not skilled"), fix: none }));
                                        });
                                    });
                                } });
                            });
                            $.if(context.rules.agree.and(() => East.notEqual(a.offset, 0.0).or(() => East.notEqual(a.overtime, 0.0)))
                                .and(() => East.notEqual(a.agreed, some(true))), $ => {
                                $(issues.pushLast({ kind: variant("agree", null), tone: variant("info", null),
                                    title: East.greater(a.overtime, 0.0).ifElse(
                                        () => East.str`${person.name} · +${a.overtime} h OT`,
                                        () => East.str`${person.name} · start offset ${a.offset} h`),
                                    detail: East.str`${location} · not yet agreed`, slot: some(slot), assignment: some(id), flag: none,
                                    fix: some(variant("agree", null)) }));
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
                        title: East.str`${c.open} open positions · ${location}`,
                        detail: East.str`${c.open.toFloat().multiply(shift.hours)} h unfilled · ${c.filled} of ${c.positions} positions`,
                        slot: some(slot), assignment: none, flag: some(East.str`${c.open} open`), fix }));
                });
                $.if(context.rules.skill.and(() => East.greater(c.filled, 0n)), $ => {
                    $.for(c.lines, ($, line) => {
                        $.if(East.greater(line.gap, 0.0), $ => {
                            $.for(group.skills, ($, skill) => {
                                $.if(East.equal(skill.key, line.skill), $ => {
                                    $(issues.pushLast({ kind: variant("gap", null), tone: variant("warning", null),
                                        title: East.str`${skill.label} · ${line.gap} h short`,
                                        detail: East.str`${location} · ${line.capacity.unwrap("some")} h capacity of ${line.needed} h`,
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
});

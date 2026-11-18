/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    ArrayType, BooleanType, DictType, East, FloatType, IntegerType, StringType, StructType, none, some,
    type EastType, type ExprType, type FunctionType,
} from "@elaraai/east";
import {
    RosterContextType, RosterCoverageLineType, RosterCoverageType, RosterPayType, RosterPlaceType, RosterRequirementType,
    RosterSlotType, RosterWeekTypeFor,
} from "./types.js";

/** A line a slot's coverage draws: a key of its target's hours, and whether it counts as a duty — no holders, no capacity, no gap. */
const LineKeyType = StructType({ key: StringType, duty: BooleanType });

/**
 * Calculates every configured slot's staffing, activity coverage and pay
 * (`Builder Interfaces Spec.md` §5.4).
 *
 * @typeParam R - The app's duty row type
 * @param row - The app's duty row type
 * @returns An East function `(week, context, pay) → Dict<Slot, Coverage>`: coverage keyed by day, group and shift
 * @remarks Pure East: tasks and the renderer compile this same calculation. Each duty counts its own hours; requests fill positions, but never supply skills or a lead. A slot's cost is its duties' pay, every code summed: zero without `pay`. A duty in no group (#1548) is in no slot: it counts in no group's coverage, its hours its person's alone. A slot's hours needed are its target's own (`Requirement.needed`, #1678), and it draws a line for every key of its target's hours: its group's skills, then the duties, each in the activities' order; then every other key, in key order — another group's skill counted as the group's own are, its holders the slot's people who hold it, and a key that is no activity as a duty is. Without the targets' own `needed`, the lines add up to the hours needed.
 */
export function rosterCoverage<R extends EastType>(row: R) {
    return East.function([RosterWeekTypeFor(row as EastType), RosterContextType, RosterPayType], DictType(RosterSlotType, RosterCoverageType), ($, week, context, pay) => {
        const result = $.let(new Map(), DictType(RosterSlotType, RosterCoverageType));
        // The duties: the activities of no group, which every group may need.
        const duties = $.const(context.activities.filter((_$, activity) => activity.group.hasTag("none")));
        $.for(East.Array.range(0n, 7n), ($, day) => {
            $.for(context.groups, ($, group) => {
                // The group's skills, then the duties, each in the activities' order.
                const activities = $.const(context.activities.filter((_$, activity) => East.equal(activity.group, some(group.key))).concat(duties));
                $.for(context.shifts, ($, shift) => {
                    const slot = $.const({ day, group: group.key, shift: shift.key }, RosterSlotType);
                    const target = $.const(week.requirements.get(slot, $ => $.const({ positions: 0n, hours: new Map(), needed: 0.0 }, RosterRequirementType)));
                    // The slot's duties: those standing in its group's shift on its day.
                    const place = $.const({ day, group: some(group.key), shift: shift.key }, RosterPlaceType);
                    const assignments = $.const(week.assignments.filter((_$, a) => East.equal(a.place, place)));
                    const permanent = $.let(0.0, FloatType);
                    const agency = $.let(0.0, FloatType);
                    const requested = $.let(0.0, FloatType);
                    const cost = $.let(0.0, FloatType);
                    const people = $.let(0n, IntegerType);
                    const lead = $.let(false, BooleanType);
                    const trainer = $.let(false, BooleanType);
                    $.for(assignments, ($, a, id) => {
                        // The slot's pay: its duties' costs, every code summed.
                        $.match(pay.tryGet(id), { some: ($, costs) => { $.for(costs, ($, amount) => { $.assign(cost, cost.add(amount)); }); } });
                        $.match(a.who, {
                            request: $ => { $.assign(requested, requested.add(a.hours)); },
                            person: ($, key) => {
                                $.assign(people, people.add(1n));
                                $.if(context.people.has(key), $ => {
                                    const person = $.const(context.people.get(key));
                                    $.if(person.agency, $ => { $.assign(agency, agency.add(a.hours)); })
                                        .else($ => { $.assign(permanent, permanent.add(a.hours)); });
                                    $.if(person.trainer, $ => { $.assign(trainer, true); });
                                    $.for(context.positions, ($, position) => {
                                        $.if(East.equal(position.key, a.position).and(() => position.lead), $ => { $.assign(lead, true); });
                                    });
                                });
                            },
                        });
                    });
                    const lines = $.let([], ArrayType(RosterCoverageLineType));
                    // The lines' keys (#1678): every key the target's hours hold — the group's skills, then the duties, each
                    // in the activities' order; then every other key, in key order, another group's skill counted as the
                    // group's own are, and a key that is no activity as a duty is.
                    const keys = $.let([], ArrayType(LineKeyType));
                    $.for(activities, ($, skill) => {
                        $.if(target.hours.has(skill.key), $ => { $(keys.pushLast({ key: skill.key, duty: skill.group.hasTag("none") })); });
                    });
                    $.for(target.hours, ($, _hours, key) => {
                        $.if(East.equal(activities.filter((_$, skill) => East.equal(skill.key, key)).size(), 0n), $ => {
                            $(keys.pushLast({ key, duty: East.equal(context.activities.filter((_$, skill) => East.equal(skill.key, key)).size(), 0n) }));
                        });
                    });
                    $.for(keys, ($, line) => {
                        const holders = $.let(0n, IntegerType);
                        const assigned = $.let(0.0, FloatType);
                        $.for(assignments, ($, a) => {
                            $.match(a.who, { person: ($, key) => {
                                $.if(context.people.has(key), $ => {
                                    $.if(context.people.get(key).skills.has(line.key), $ => { $.assign(holders, holders.add(1n)); });
                                });
                                $.if(East.equal(a.activity, some(line.key)), $ => { $.assign(assigned, assigned.add(a.hours)); });
                            } });
                        });
                        const hours = $.const(target.hours.get(line.key));
                        // A holder's capacity is the shift's nominal hours.
                        const capacity = $.const(holders.toFloat().multiply(shift.hours));
                        $(lines.pushLast({
                            skill: line.key, needed: hours, assigned,
                            holders: line.duty.ifElse(() => none, () => some(holders)),
                            capacity: line.duty.ifElse(() => none, () => some(capacity)),
                            gap: line.duty.ifElse(() => 0.0, () => East.max(hours.subtract(capacity), $.const(0.0, FloatType))),
                        }));
                    });
                    $(result.insert(slot, {
                        positions: target.positions, filled: assignments.size(), open: East.max(target.positions.subtract(assignments.size()), $.const(0n, IntegerType)), people,
                        hours: { permanent, agency, requested, needed: target.needed, rostered: permanent.add(agency).add(requested) },
                        lines, cost, lead, trainer,
                    }));
                });
            });
        });
        return result;
    }) as unknown as ExprType<FunctionType<[RosterWeekTypeFor<R>, RosterContextType, RosterPayType], DictType<RosterSlotType, RosterCoverageType>>>;
}

/**
 * Calculates each person's hours for the week: each of their duties' hours.
 *
 * @typeParam R - The app's duty row type
 * @param row - The app's duty row type
 * @returns An East function `(week, context) → Dict<String, Float>`: weekly hours by the original staff key, zero for unassigned staff
 * @remarks Used by both layouts, library cards and the inspector, and by the ready-made fit.
 */
export function rosterWeekHours<R extends EastType>(row: R) {
    return East.function([RosterWeekTypeFor(row as EastType), RosterContextType], DictType(StringType, FloatType), ($, week, context) => {
        const result = $.let(context.people.map((_$, _person) => 0.0));
        $.for(week.assignments, ($, a) => {
            $.match(a.who, { person: ($, key) => {
                const prior = $.const(result.get(key, () => 0.0));
                $(result.insertOrUpdate(key, prior.add(a.hours)));
            } });
        });
        return result;
    }) as unknown as ExprType<FunctionType<[RosterWeekTypeFor<R>, RosterContextType], DictType<StringType, FloatType>>>;
}

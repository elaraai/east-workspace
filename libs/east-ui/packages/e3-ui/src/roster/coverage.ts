/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    ArrayType, BooleanType, DictType, East, FloatType, IntegerType, StringType, none, some,
    type EastType, type ExprType, type FunctionType,
} from "@elaraai/east";
import {
    RosterContextType, RosterCoverageLineType, RosterCoverageType, RosterPayType, RosterRequirementType,
    RosterSlotType, RosterWeekTypeFor,
} from "./types.js";

/**
 * Calculates every configured slot's staffing, activity coverage and pay
 * (`Builder Interfaces Spec.md` §5.4).
 *
 * @typeParam R - The app's duty row type
 * @param row - The app's duty row type
 * @returns An East function `(week, context, pay) → Dict<Slot, Coverage>`: coverage keyed by day, group and shift
 * @remarks Pure East: tasks and the renderer compile this same calculation. Each duty counts its own hours; requests fill positions, but never supply skills or a lead. A slot's cost is its duties' pay, every code summed: zero without `pay`.
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
                    const target = $.const(week.requirements.get(slot, $ => $.const({ positions: 0n, hours: new Map() }, RosterRequirementType)));
                    const assignments = $.const(week.assignments.filter((_$, a) => East.equal(a.slot, slot)));
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
                    const needed = $.let(0.0, FloatType);
                    $.for(target.hours, ($, hours) => { $.assign(needed, needed.add(hours)); });
                    $.for(activities, ($, skill) => {
                        $.if(target.hours.has(skill.key), $ => {
                            const duty = $.const(skill.group.hasTag("none"));
                            const holders = $.let(0n, IntegerType);
                            const assigned = $.let(0.0, FloatType);
                            $.for(assignments, ($, a) => {
                                $.match(a.who, { person: ($, key) => {
                                    $.if(context.people.has(key), $ => {
                                        $.if(context.people.get(key).skills.has(skill.key), $ => { $.assign(holders, holders.add(1n)); });
                                    });
                                    $.if(East.equal(a.activity, some(skill.key)), $ => { $.assign(assigned, assigned.add(a.hours)); });
                                } });
                            });
                            const hours = $.const(target.hours.get(skill.key));
                            // A holder's capacity is the shift's nominal hours.
                            const capacity = $.const(holders.toFloat().multiply(shift.hours));
                            $(lines.pushLast({
                                skill: skill.key, needed: hours, assigned,
                                holders: duty.ifElse(() => none, () => some(holders)),
                                capacity: duty.ifElse(() => none, () => some(capacity)),
                                gap: duty.ifElse(() => 0.0, () => East.max(hours.subtract(capacity), $.const(0.0, FloatType))),
                            }));
                        });
                    });
                    $(result.insert(slot, {
                        positions: target.positions, filled: assignments.size(), open: East.max(target.positions.subtract(assignments.size()), $.const(0n, IntegerType)), people,
                        hours: { permanent, agency, requested, needed, rostered: permanent.add(agency).add(requested) },
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

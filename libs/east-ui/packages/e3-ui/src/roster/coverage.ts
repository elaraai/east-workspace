/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { ArrayType, BooleanType, DictType, East, FloatType, IntegerType, StringType, none, some } from "@elaraai/east";
import {
    RosterContextType, RosterCoverageLineType, RosterCoverageType, RosterRequirementType,
    RosterSlotType, RosterWeekType,
} from "./types.js";

/**
 * Calculates every configured slot's staffing, activity coverage and cost.
 * @param week - The week, with any drafts already applied
 * @param context - Complete staff and configuration, independent of visibility filters
 * @returns Coverage keyed by day, group and shift
 * @remarks Pure East: tasks and the renderer compile this same calculation. Requests fill positions, but never supply skills or a lead.
 */
export const rosterCoverage = East.function([RosterWeekType, RosterContextType], DictType(RosterSlotType, RosterCoverageType), ($, week, context) => {
    const result = $.let(new Map(), DictType(RosterSlotType, RosterCoverageType));
    $.for(East.Array.range(0n, 7n), ($, day) => {
        $.for(context.groups, ($, group) => {
            $.for(context.shifts, ($, shift) => {
                const slot = $.const({ day, group: group.key, shift: shift.key }, RosterSlotType);
                const target = $.const(week.requirements.get(slot, $ => $.const({ positions: 0n, hours: new Map() }, RosterRequirementType)));
                const assignments = $.const(week.assignments.filter((_$, a) => East.equal(a.slot, slot)));
                const permanent = $.let(0.0, FloatType);
                const agency = $.let(0.0, FloatType);
                const requested = $.let(0.0, FloatType);
                const overtime = $.let(0.0, FloatType);
                const people = $.let(0n, IntegerType);
                const lead = $.let(false, BooleanType);
                const trainer = $.let(false, BooleanType);
                $.for(assignments, ($, a) => {
                    $.assign(overtime, overtime.add(a.overtime));
                    $.match(a.who, {
                        request: $ => { $.assign(requested, requested.add(shift.hours)); },
                        person: ($, key) => {
                            $.assign(people, people.add(1n));
                            $.if(context.people.has(key), $ => {
                                const person = $.const(context.people.get(key));
                                $.if(person.agency, $ => { $.assign(agency, agency.add(shift.hours)); })
                                    .else($ => { $.assign(permanent, permanent.add(shift.hours)); });
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
                $.for(group.skills.concat(context.duties), ($, skill, index) => {
                    $.if(target.hours.has(skill.key), $ => {
                        const duty = $.const(East.greaterEqual(index, group.skills.size()));
                        const holders = $.let(0n, IntegerType);
                        const assigned = $.let(0.0, FloatType);
                        $.for(assignments, ($, a) => {
                            $.match(a.who, { person: ($, key) => {
                                $.if(context.people.has(key), $ => {
                                    $.if(context.people.get(key).skills.has(skill.key), $ => { $.assign(holders, holders.add(1n)); });
                                });
                                $.if(East.equal(a.activity, some(skill.key)), $ => { $.assign(assigned, assigned.add(shift.hours).add(a.overtime)); });
                            } });
                        });
                        const hours = $.const(target.hours.get(skill.key));
                        const capacity = $.const(holders.toFloat().multiply(shift.hours));
                        $(lines.pushLast({
                            skill: skill.key, needed: hours, assigned,
                            holders: duty.ifElse(() => none, () => some(holders)),
                            capacity: duty.ifElse(() => none, () => some(capacity)),
                            gap: duty.ifElse(() => 0.0, () => East.max(hours.subtract(capacity), $.const(0.0, FloatType))),
                        }));
                    });
                });
                const cost = $.let(0.0, FloatType);
                $.match(context.costs, { some: ($, costs) => {
                    $.assign(cost, permanent.multiply(costs.rates.permanent)
                        .add(agency.add(requested).multiply(costs.rates.agency))
                        .add(overtime.multiply(costs.rates.overtime)));
                } });
                $(result.insert(slot, {
                    positions: target.positions, filled: assignments.size(), open: East.max(target.positions.subtract(assignments.size()), $.const(0n, IntegerType)), people,
                    hours: { permanent, agency, overtime, requested, needed, rostered: permanent.add(agency).add(requested).add(overtime) },
                    lines, cost, lead, trainer,
                }));
            });
        });
    });
    return result;
});

/**
 * Calculates each person's nominal shift hours plus overtime for the week.
 * @param week - The drafted week
 * @param context - Complete reference data
 * @returns Weekly hours keyed by the original staff key, including zero for unassigned staff
 * @remarks Used by both layouts, library cards and the inspector; start offsets do not shorten a shift.
 */
export const rosterWeekHours = East.function([RosterWeekType, RosterContextType], DictType(StringType, FloatType), ($, week, context) => {
    const result = $.let(context.people.map((_$, _person) => 0.0));
    const shifts = $.const(context.shifts.toDict((_$, shift) => shift.key, (_$, shift) => shift));
    $.for(week.assignments, ($, a) => {
        $.match(a.who, { person: ($, key) => {
            $.if(shifts.has(a.slot.shift), $ => {
                const prior = $.const(result.get(key, () => 0.0));
                $(result.insertOrUpdate(key, prior.add(shifts.get(a.slot.shift).hours).add(a.overtime)));
            });
        } });
    });
    return result;
});

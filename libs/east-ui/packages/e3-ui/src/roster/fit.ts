/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Roster's fit (#1334, `Allocation Spec.md` §13): who fits a Find fix's
 * need — a lead, a trainer, a holder of a skill — on its issue's slot. The
 * app's `e3.function` answers, bound to the Roster's `fit` with `Func.bind`,
 * the contract the Allocation's fit keeps; `Roster.fit` is the ready-made rule
 * such a function may call, replace or build on, and `Roster.answer` maps a
 * rule over every person. The renderer decides no one itself.
 *
 * @packageDocumentation
 */

import { East, FloatType, FunctionType, StringType, none, variant } from "@elaraai/east";
import { rosterRest } from "./rules.js";
import {
    RosterAssignmentType, RosterContextType, RosterFitRequestType, RosterFitResultType, RosterFitType, RosterPersonType, RosterWeekType,
} from "./types.js";

/** A week's hours: the slot's group's bonus, more than any spare hours of a week. */
const WEEK_HOURS = 168.0;

/**
 * Hours as a fit's words write them: a whole number without a decimal point.
 *
 * @param hours - The hours
 * @returns `14`, `7.5`
 * @internal
 */
export const rosterHoursText = East.function([FloatType], StringType, ($, hours) => {
    const whole = $.const(East.Float.roundHalf(hours));
    return East.equal(whole.toFloat(), hours).ifElse(() => East.print(whole), () => East.print(hours));
});

/**
 * One person's hours this week: each of their assignments' shift hours and its
 * overtime — the hours `Roster.weekHours` gives them.
 *
 * @param week - The drafted week
 * @param context - Its shifts
 * @param key - The person's staff key
 * @returns Their hours
 * @internal
 */
export const rosterPersonHours = East.function([RosterWeekType, RosterContextType, StringType], FloatType, ($, week, context, key) => {
    const shifts = $.const(context.shifts.toDict((_$2, shift) => shift.key, (_$2, shift) => shift.hours));
    const hours = $.let(0.0, FloatType);
    $.for(week.assignments, ($2, a) => {
        $2.match(a.who, { person: ($3, who) => {
            $3.if(East.equal(who, key).and(() => shifts.has(a.slot.shift)), ($4) => {
                $4.assign(hours, hours.add(shifts.get(a.slot.shift)).add(a.overtime));
            });
        } });
    });
    return hours;
});

/**
 * The ready-made fit (§13): one person's verdict for a need on a slot.
 *
 * @param request - The question: the need, the slot, the drafted week and the complete context
 * @param person - The person
 * @returns Their verdict
 *
 * @remarks
 * In order: a person who doesn't hold the need is refused — `Not a lead`
 * (`Associate · not a lead`), `Not a trainer`, `Not skilled` (`doesn't hold
 * Unloading`); one rostered that day is refused, `Rostered` (`rostered on
 * Inbound · Early`), since moving them would leave their own shift short; one
 * whose rest before or after the slot's shift falls under the rules' minimum is
 * refused, `Rest too short` (`6 h rest · minimum 10 h`, its measure the rest).
 * Otherwise they fit, the slot's group first, then spare contract hours: the
 * score is their spare hours this week — their contract less the hours they
 * are rostered, overtime included — and a week's 168 hours more in the slot's
 * group. The reason names their group and those hours (`Dispatch · 14 h
 * spare`, `from Inbound · 2 h over contract`), and nothing warns.
 */
export const rosterFit = East.function([RosterFitRequestType, RosterPersonType], RosterFitType, ($, request, person) => {
    const restOf = $.const(rosterRest);
    const hoursOf = $.const(rosterPersonHours);
    const hoursText = $.const(rosterHoursText);
    const context = $.const(request.context);
    const slot = $.const(request.slot);
    const groups = $.const(context.groups.toDict((_$2, group) => group.key, (_$2, group) => group.label));
    const shifts = $.const(context.shifts.toDict((_$2, shift) => shift.key, (_$2, shift) => shift.label));
    // The need held.
    $.match(request.need, {
        leads: ($2) => {
            const positions = $2.const(context.positions.filter((_$3, position) => East.equal(position.key, person.position)));
            $2.if(positions.some((_$3, position) => position.lead).not(), ($3) => {
                const reason = $3.const(East.greater(positions.size(), 0n).ifElse(() => East.str`${positions.get(0n).label} · not a lead`, () => East.str`not a lead`));
                $3.return(variant("refused", { group: "Not a lead", reason, measure: variant("none", null) }));
            });
        },
        trainers: ($2) => {
            $2.if(person.trainer.not(), ($3) => {
                $3.return(variant("refused", { group: "Not a trainer", reason: "not a trainer", measure: variant("none", null) }));
            });
        },
        skill: ($2, key) => {
            $2.if(person.skills.has(key).not(), ($3) => {
                const skills = $3.const(context.activities.filter((_$4, activity) => East.equal(activity.key, key)));
                const label = $3.const(East.greater(skills.size(), 0n).ifElse(() => skills.get(0n).label, () => key));
                $3.return(variant("refused", { group: "Not skilled", reason: East.str`doesn't hold ${label}`, measure: variant("none", null) }));
            });
        },
    });
    // Not rostered that day: moving them would leave their own shift short.
    const thatDay = $.const(request.week.assignments.filter((_$2, a) => East.equal(a.slot.day, slot.day)
        .and(() => a.who.match({ person: (_$3, key) => East.equal(key, person.key), request: (_$3, _agency) => false }))).toArray((_$2, a) => a));
    $.if(East.greater(thatDay.size(), 0n), ($2) => {
        const held = $2.const(thatDay.get(0n));
        $2.return(variant("refused", {
            group: "Rostered", reason: East.str`rostered on ${groups.get(held.slot.group, () => held.slot.group)} · ${shifts.get(held.slot.shift, () => held.slot.shift)}`,
            measure: variant("none", null),
        }));
    });
    // Rest kept, before and after the slot's shift.
    const candidate = $.const({
        slot, who: variant("person", person.key), position: person.position, activity: none, offset: 0.0, overtime: 0.0, agreed: none,
    }, RosterAssignmentType);
    const rest = $.const(restOf(candidate, "", request.week, context));
    $.if(East.greater(context.rules.rest, 0.0).and(() => East.less(rest.minimum, context.rules.rest)), ($2) => {
        $2.return(variant("refused", {
            group: "Rest too short", reason: East.str`${hoursText(rest.minimum)} h rest · minimum ${hoursText(context.rules.rest)} h`,
            measure: variant("amount", { lead: "rest", value: rest.minimum }),
        }));
    });
    // It fits: the slot's group first, then spare contract hours.
    const spare = $.const(person.contract.subtract(hoursOf(request.week, context, person.key)));
    const home = $.const(East.equal(person.group, slot.group));
    const hours = $.const(East.greater(spare, 0.0).ifElse(
        () => East.str`${hoursText(spare)} h spare`,
        () => East.equal(spare, 0.0).ifElse(() => East.str`no spare hours`, () => East.str`${hoursText(spare.negate())} h over contract`)));
    return variant("fits", {
        score: spare.add(home.ifElse(() => WEEK_HOURS, () => 0.0)),
        why: home.ifElse(() => East.str`${groups.get(slot.group, () => slot.group)} · ${hours}`, () => East.str`from ${groups.get(person.group, () => person.group)} · ${hours}`),
        warn: none,
    });
});

/**
 * Answers the fit's question with a rule per person (§13).
 *
 * @param request - The question
 * @param fit - The rule: one person's verdict, given the question
 * @returns A verdict for every person of the context, by staff key, with the need and the slot it answers
 */
export const rosterAnswer = East.function([
    RosterFitRequestType, FunctionType([RosterFitRequestType, RosterPersonType], RosterFitType),
], RosterFitResultType, (_$, request, fit) => ({
    need: request.need, slot: request.slot,
    people: request.context.people.map((_$2, person) => fit(request, person)),
}));

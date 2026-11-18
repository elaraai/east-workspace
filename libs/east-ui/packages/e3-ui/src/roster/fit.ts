/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Roster's fit (#1334, east-workspace#1624; `Allocation Spec.md` §13): who
 * fits a Find fix's need — a lead, a trainer, a holder of a skill — on its
 * issue's slot. The app's `e3.function` answers, bound to the Roster's `fit`
 * with `Func.bind`, the contract the Allocation's fit keeps. It is asked the
 * question and the page's scope, and sent no row: it reads the week's duties
 * through their record's index, the Roster's unsaved edits laid over them, the
 * people it asks about and the configuration, and makes of them a
 * `Roster.Types.FitContext`. `Roster.fit()` is the ready-made rule such a
 * function may call, replace or build on, over one person against the week
 * (`Roster.Types.Candidate`); `Roster.answer` places the context's duties in
 * the week as the page places them, and maps a rule over every person of the
 * context. None reads a row of the app's. The renderer decides no one itself.
 *
 * @packageDocumentation
 */

import { DictType, East, FloatType, FunctionType, StringType, none, variant, type SubtypeExprOrValue } from "@elaraai/east";
import { scheduleNumberText } from "../schedule/words.js";
import { rosterRestBetween } from "./rules.js";
import { rosterPlaceOf, rosterShiftStart } from "./times.js";
import { RosterCandidateDutyType, RosterCandidateType, RosterFitContextType, RosterFitRequestType, RosterFitResultType, RosterFitType } from "./types.js";

/** A week's hours: the slot's group's bonus, more than any spare hours of a week. */
const WEEK_HOURS = 168.0;

/** A person's duties of the week, by key: each where the Roster places it, and its roles. */
const CandidateDutiesType = DictType(StringType, RosterCandidateDutyType);

/**
 * The ready-made fit (§13): one person's verdict for a need on a slot.
 *
 * @param words - The fit's words the app gives (#1516): `notALead`, in place of `not a lead` and `Not a lead`
 * @returns An East function `(candidate) → Fit`: their verdict
 *
 * @remarks
 * In order: a person who doesn't hold the need is refused — `Not a lead`
 * (`Associate · not a lead`), `Not a trainer`, `Not skilled` (`doesn't hold
 * Unloading`); one rostered that day is refused, `Rostered` (`rostered on
 * Inbound · Early`, or on a duty in no group yet `rostered on Early`), since
 * moving them would leave their own shift short; one
 * whose rest before or after the slot's shift falls under the candidate's
 * `rest` is refused, `Rest too short` (`6 h rest · minimum 10 h`, its measure
 * the rest), the shift run as a new duty would run it, from its start on the
 * slot's day, against the candidate's duties. Otherwise
 * they fit, the slot's group first, then spare contract hours: the score is
 * their spare hours this week — their contract less the candidate's `hours` —
 * and a week's 168 hours more in the slot's group. The reason names their
 * group and those hours (`Dispatch · 14 h spare`, `from Inbound · 2 h over
 * contract`), and nothing warns.
 *
 * @example
 * ```ts
 * // Inside an e3.function's body: the ready-made rule, then the app's own order.
 * const answer = $.const(Roster.answer);
 * const rule = $.const(Roster.fit());
 * return answer(request, context, East.function([Roster.Types.Candidate], Roster.Types.Fit, ($2, candidate) => {
 *     const verdict = $2.const(rule(candidate));
 *     $2.match(verdict, { refused: ($3) => { $3.return(verdict); } });
 *     const fits = $2.const(verdict.unwrap("fits"));
 *     return variant("fits", { score: candidate.person.contract.subtract(candidate.hours), why: fits.why, warn: fits.warn });
 * }));
 * ```
 */
export function rosterFit(words?: { notALead?: SubtypeExprOrValue<StringType> }) {
    return East.function([RosterCandidateType], RosterFitType, ($, candidate) => {
        const between = $.const(rosterRestBetween);
        const shiftStart = $.const(rosterShiftStart);
        const hoursText = $.const(scheduleNumberText);
        const person = $.const(candidate.person);
        const slot = $.const(candidate.slot);
        const groups = $.const(candidate.groups.toDict((_$2, group) => group.key, (_$2, group) => group.label));
        const labels = $.const(candidate.shifts.toDict((_$2, shift) => shift.key, (_$2, shift) => shift.label));
        const shifts = $.const(candidate.shifts.toDict((_$2, shift) => shift.key, (_$2, shift) => shift));
        // The need held.
        $.match(candidate.need, {
            leads: ($2) => {
                const positions = $2.const(candidate.positions.filter((_$3, position) => East.equal(position.key, person.position)));
                $2.if(positions.some((_$3, position) => position.lead).not(), ($3) => {
                    const word = $3.const(words?.notALead ?? "not a lead", StringType);
                    const reason = $3.const(East.greater(positions.size(), 0n).ifElse(() => East.str`${positions.get(0n).label} · ${word}`, () => word));
                    $3.return(variant("refused", { group: words?.notALead ?? "Not a lead", reason, measure: variant("none", null) }));
                });
            },
            trainers: ($2) => {
                $2.if(person.trainer.not(), ($3) => {
                    $3.return(variant("refused", { group: "Not a trainer", reason: "not a trainer", measure: variant("none", null) }));
                });
            },
            skill: ($2, key) => {
                $2.if(person.skills.has(key).not(), ($3) => {
                    const skills = $3.const(candidate.activities.filter((_$4, activity) => East.equal(activity.key, key)));
                    const label = $3.const(East.greater(skills.size(), 0n).ifElse(() => skills.get(0n).label, () => key));
                    $3.return(variant("refused", { group: "Not skilled", reason: East.str`doesn't hold ${label}`, measure: variant("none", null) }));
                });
            },
        });
        // Not rostered that day: moving them would leave their own shift short.
        const thatDay = $.const(candidate.duties.filter((_$2, duty) => East.equal(duty.place.day, slot.day)).toArray((_$2, duty) => duty));
        $.if(East.greater(thatDay.size(), 0n), ($2) => {
            const held = $2.const(thatDay.get(0n));
            // Its group's shift — or, for a duty in no group yet, its shift alone, which names no group the app's words don't (#1548).
            const shift = $2.const(labels.get(held.place.shift, () => held.place.shift));
            const where = $2.const(held.place.group.match({ some: (_$3, group) => East.str`${groups.get(group, () => group)} · ${shift}`, none: (_$3) => shift }));
            $2.return(variant("refused", { group: "Rostered", reason: East.str`rostered on ${where}`, measure: variant("none", null) }));
        });
        // Rest kept, before and after the slot's shift, run as a new duty runs it.
        $.if(shifts.has(slot.shift), ($2) => {
            const shift = $2.const(shifts.get(slot.shift));
            const start = $2.const(shiftStart(candidate.start.addDays(slot.day), shift));
            const others = $2.const(candidate.duties.toArray((_$3, duty) => ({ start: duty.roles.start, end: duty.roles.end })));
            const rest = $2.const(between(start, start.addHours(shift.hours), others));
            $2.if(East.greater(candidate.rest, 0.0).and(() => East.less(rest.minimum, candidate.rest)), ($3) => {
                $3.return(variant("refused", {
                    group: "Rest too short", reason: East.str`${hoursText(rest.minimum)} h rest · minimum ${hoursText(candidate.rest)} h`,
                    measure: variant("amount", { lead: "rest", value: rest.minimum }),
                }));
            });
        });
        // It fits: the slot's group first, then spare contract hours.
        const spare = $.const(person.contract.subtract(candidate.hours));
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
}

/**
 * Answers the fit's question with a rule per person (§13, east-workspace#1624).
 *
 * @param request - The question: the need, the slot and the week's first day
 * @param context - What the function read: the people it asks about, the week's duties as their roles, the configuration
 * @param fit - The rule, asked one candidate at a time
 * @returns A verdict for every person of the context, by staff key, with the need and the slot it answers
 *
 * @remarks
 * It places the context's duties in the week of the request's `start` once, as
 * the page places them — a duty's day the UTC day whose shift start is nearest
 * its own, one of another week, of a shift or a group not configured, or of no
 * person left out — and makes each person's candidate: their duties of the
 * week, each with its place, and the hours those count. For a context that
 * holds what the page holds, its verdicts are the page's.
 *
 * @example
 * ```ts
 * const answer = $.const(Roster.answer);
 * const context = $.const({ people, duties: week, shifts, groups, positions, activities, rest: 10.0 }, Roster.Types.FitContext);
 * return answer(request, context, Roster.fit());
 * ```
 */
export const rosterAnswer = East.function(
    [RosterFitRequestType, RosterFitContextType, FunctionType([RosterCandidateType], RosterFitType)], RosterFitResultType,
    ($, request, context, fit) => {
        const placeOf = $.const(rosterPlaceOf);
        // The context's duties placed in the week, once: each person's, by key, and the hours they count.
        const byPerson = $.let(new Map(), DictType(StringType, CandidateDutiesType));
        const hours = $.let(new Map(), DictType(StringType, FloatType));
        $.for(context.duties, ($2, roles, key) => {
            $2.match(roles.resource, {
                some: ($3, ref) => {
                    $3.if(East.equal(ref.kind, "people"), ($4) => {
                        $4.match(placeOf(roles, request.start, context.shifts, context.groups), {
                            placed: ($5, place) => {
                                $5.if(byPerson.has(ref.key).not(), ($6) => { $6(byPerson.insert(ref.key, East.value(new Map(), CandidateDutiesType))); });
                                $5(byPerson.get(ref.key).insert(key, { place, roles }));
                                const held = $5.const(hours.get(ref.key, () => 0.0));
                                $5(hours.insertOrUpdate(ref.key, held.add(roles.hours)));
                            },
                        });
                    });
                },
            });
        });
        return {
            need: request.need, slot: request.slot,
            people: context.people.map((_$2, person, key) => fit({
                need: request.need, slot: request.slot, start: request.start, person,
                duties: byPerson.get(key, () => East.value(new Map(), CandidateDutiesType)), hours: hours.get(key, () => 0.0),
                shifts: context.shifts, groups: context.groups, positions: context.positions, activities: context.activities, rest: context.rest,
            })),
        };
    });

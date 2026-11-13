/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the Roster reads from a duty's times (#1368, `Builder Interfaces
 * Spec.md` §5.5): pure East functions, compiled once by the renderer, so a
 * task and the screen use the same arithmetic.
 *
 * - **Day.** A duty's day is the UTC day whose shift start is nearest the
 *   duty's start ({@link rosterDayOf}); its week is the week holding that day.
 * - **A duty**, as the Roster reads it, is its kind's roles and its row
 *   ({@link rosterPlacement}): its place, from its day, its shift and its
 *   group — none for a duty in no group yet (#1548); who it is, from its
 *   resource; its position, its activity, its own times and its hours. A duty
 *   whose shift or group isn't configured, or that names no one, is placed
 *   nowhere: the Roster lists it in Issues and keeps it as stored.
 * - **A move** to another place ({@link rosterMove}) moves the duty's start
 *   and end with it, kept where they stood against its shift's start, and
 *   writes its shift and group: a move and back leaves its times as they were.
 * - **A new duty** ({@link rosterNewDuty}) runs its slot's shift: from the
 *   shift's start on its day ({@link rosterShiftStart}), for the shift's
 *   hours. Copying the week before copies each duty so, its other fields as
 *   they were.
 *
 * @packageDocumentation
 */

import {
    DateTimeType, East, IntegerType, OptionType, StringType, none, some, variant,
    type EastType, type ExprType, type FunctionType,
} from "@elaraai/east";
import { ScheduleClockType, ScheduleResourceRefType, ScheduleRosterRolesType } from "../schedule/types.js";
import { RosterContextType, RosterIssueType, RosterPlaceType, RosterPlacementTypeFor, RosterShiftType, RosterSlotType, RosterWhoType } from "./types.js";

/**
 * A duty's day (§5.5, rule 1): the UTC midnight of the day whose shift start is
 * nearest the duty's start.
 *
 * @param start - The duty's start
 * @param clock - Its shift's start, a time of day
 * @returns Its day, a UTC midnight
 * @remarks The shift starts on the duty's day within 12 hours of the duty's start, so the day is the one `start` falls in once moved back by the shift's start and on by 12 hours: an early start (`05:00` on the `06:00` shift) is the shift's day, and a night shift's duty past midnight (`00:30` on the `22:00` shift) the night before's.
 * @internal
 */
export const rosterDayOf = East.function([DateTimeType, ScheduleClockType], DateTimeType, ($, start, clock) => {
    const minutes = $.const(clock.hour.multiply(60n).add(clock.minute));
    return East.DateTime.roundDownDay(start.subtractMinutes(minutes).addHours(12n), 1n);
});

/**
 * A shift's start on a day (§5.5, rule 5): where a new duty of the shift
 * starts, and what a duty's own times are drawn against.
 *
 * @param day - The day, a UTC midnight
 * @param shift - The shift
 * @returns Its start on that day
 * @internal
 */
export const rosterShiftStart = East.function([DateTimeType, RosterShiftType], DateTimeType, (_$, day, shift) =>
    day.addMinutes(shift.start.hour.multiply(60n).add(shift.start.minute)));

/**
 * Reads one duty as the Roster does: its kind's roles and its row, in the week
 * of `start`.
 *
 * @typeParam R - The app's duty row type
 * @param row - The app's duty row type
 * @returns An East function `(roles, row, key, start, context) → Placement(R)`: the duty placed in the week of
 *   `start`; `elsewhere` for a duty whose day falls in another week; `unplaced`, with the issue that lists it, for a
 *   duty of this week whose shift or group isn't configured, or that names no person and no agency; a duty in no group,
 *   of a kind whose `group` is an `Option<String>` field, is placed in no group (#1548)
 * @remarks The duty kind's resource names the `people` slot for a person and the `agencies` slot for an agency's request; a kind with no `position` role holds none, `""`. A duty of a shift not configured has no shift start to be nearest: its day is the UTC day it starts. An issue says where its duty is rostered — its group and its shift (`Inbound · Early · the duty names no person and no agency`) — and of a duty in no group its shift alone.
 * @internal
 */
export function rosterPlacement<R extends EastType>(row: R) {
    // The row's type erased inside, as the Allocation's functions over their row type are: East checks it as it builds.
    const Placement = RosterPlacementTypeFor(row as EastType);
    return East.function([ScheduleRosterRolesType, row as EastType, StringType, DateTimeType, RosterContextType], Placement, ($, roles, value, key, start, context) => {
        const dayOf = $.const(rosterDayOf);
        const shifts = $.const(context.shifts.filter((_$2, shift) => East.equal(shift.key, roles.shift)));
        const groups = $.const(context.groups.filter((_$2, group) => East.equal(roles.group, some(group.key))));
        // A duty in no group stands in none (#1548); a group not configured places it nowhere.
        const grouped = $.const(roles.group.match({ some: (_$2, _group) => East.greater(groups.size(), 0n), none: (_$2) => East.value(true) }));
        const known = $.const(East.greater(shifts.size(), 0n));
        // Its day: its shift's start nearest its own — or, for a shift not configured, the UTC day it starts.
        const day = $.const(known.ifElse(() => dayOf(roles.start, shifts.get(0n).start), () => East.DateTime.roundDownDay(roles.start, 1n)));
        $.if(East.less(day, start).or(() => East.greaterEqual(day, start.addDays(7n))), ($2) => { $2.return(variant("elsewhere", null)); });
        // A group as its issue names it: its label, or the key no group of the Roster's has.
        const groupText = $.const(East.function([StringType], StringType, (_$2, group) =>
            East.greater(groups.size(), 0n).ifElse(() => groups.get(0n).label, () => group)));
        const shiftText = $.const(known.ifElse(() => shifts.get(0n).label, () => roles.shift));
        // The issue that lists a duty the Roster cannot place: its title, its detail and its flag. It says where the duty is
        // rostered, as far as the Roster knows: its group, and its shift where configured. A duty in no group stands in none
        // an issue could name, so its issue names no group, in no word but the app's (#1548).
        const unplaced = $.const(East.function([StringType, StringType, StringType], RosterIssueType, (_$2, title, detail, flag) => ({
            kind: variant("breach", null), tone: variant("danger", null), title, detail,
            slot: none, assignment: some(key), flag: some(flag), fix: none,
        })));
        $.if(known.not(), ($2) => {
            const detail = $2.const(roles.group.match({
                some: (_$3, group) => East.str`${groupText(group)} · this shift isn't configured: the duty is kept as stored`,
                none: (_$3) => East.value("This shift isn't configured: the duty is kept as stored", StringType),
            }));
            $2.return(variant("unplaced", unplaced(East.str`Unknown shift · ${roles.shift}`, detail, "unknown shift")));
        });
        $.if(grouped.not(), ($2) => {
            // Only a duty of a group the Roster doesn't know: named by its key.
            const group = $2.const(roles.group.unwrap("some"));
            $2.return(variant("unplaced", unplaced(East.str`Unknown group · ${group}`,
                East.str`${shiftText} · this group isn't configured: the duty is kept as stored`, "unknown group")));
        });
        const who = $.let(none, OptionType(RosterWhoType));
        $.match(roles.resource, {
            some: ($2, ref) => {
                $2.if(East.equal(ref.kind, "people"), ($3) => { $3.assign(who, some(variant("person", ref.key))); });
                $2.if(East.equal(ref.kind, "agencies"), ($3) => { $3.assign(who, some(variant("request", ref.key))); });
            },
        });
        $.if(who.hasTag("none"), ($2) => {
            const where = $2.const(roles.group.match({ some: (_$3, group) => East.str`${groupText(group)} · ${shiftText}`, none: (_$3) => shiftText }));
            $2.return(variant("unplaced", unplaced(East.str`No one rostered · ${key}`, East.str`${where} · the duty names no person and no agency`, "no one")));
        });
        // Both are UTC midnights: a whole number of days apart.
        const index = $.const(East.Float.roundHalf(start.durationDays(day)), IntegerType);
        const position = $.const(roles.position.match({ some: (_$2, held) => held, none: (_$2) => East.value("", StringType) }));
        return variant("placed", {
            place: { day: index, group: roles.group, shift: roles.shift }, who: who.unwrap("some"), position, activity: roles.activity,
            start: roles.start, end: roles.end, hours: roles.hours, row: value,
        });
    }) as unknown as ExprType<FunctionType<[ScheduleRosterRolesType, R, StringType, DateTimeType, RosterContextType], RosterPlacementTypeFor<R>>>;
}

/**
 * The slot a duty stands in (#1548): its group's shift on its day — the slot
 * its coverage counts it in, and an issue about it names — or none for a duty
 * in no group yet.
 *
 * @param place - The duty's place
 * @returns Its slot; `none` for a duty in no group
 * @example
 * ```ts
 * const slotOf = $.const(Roster.slotOf);
 * $.for(cx.week.assignments, ($2, a, id) => {
 *     $2(issues.pushLast({ kind: variant("breach", null), tone: variant("info", null), title: "Overtime not agreed", detail: "",
 *         slot: slotOf(a.place), assignment: some(id), flag: some("OT"), fix: none }));
 * });
 * ```
 */
export const rosterSlotOf = East.function([RosterPlaceType], OptionType(RosterSlotType), ($, place) => {
    const slot = $.let(none, OptionType(RosterSlotType));
    $.match(place.group, { some: ($2, group) => { $2.assign(slot, some({ day: place.day, group, shift: place.shift })); } });
    return slot;
});

/**
 * A duty moved to a place (§5.5, rule 3): its start and end moved with it,
 * kept where they stood against its shift's start, and its shift and group
 * written — its group none for a move into no group (#1548).
 *
 * @param roles - The duty's roles
 * @param start - The week's first day, a UTC midnight
 * @param place - The place it moves to: a group's slot, or no group's
 * @param context - The configuration
 * @returns Its roles, moved; `none` for a place whose shift or group isn't configured
 * @remarks Its length is kept, and its start stands as far from the slot's shift's start as it stood from its own: a move and back leaves its times as they were. A duty of a shift not configured has no start to stand against, and starts the slot's shift.
 * @internal
 */
export const rosterMove = East.function([ScheduleRosterRolesType, DateTimeType, RosterPlaceType, RosterContextType], OptionType(ScheduleRosterRolesType),
    ($, roles, start, place, context) => {
        const dayOf = $.const(rosterDayOf);
        const shiftStart = $.const(rosterShiftStart);
        const targets = $.const(context.shifts.filter((_$2, shift) => East.equal(shift.key, place.shift)));
        const grouped = $.const(place.group.match({
            some: (_$2, key) => context.groups.some((_$3, group) => East.equal(group.key, key)),
            none: (_$2) => East.value(true),
        }));
        $.if(East.equal(targets.size(), 0n).or(() => grouped.not()), ($2) => { $2.return(none); });
        // How far its start stood from its own shift's start on its day.
        const own = $.const(context.shifts.filter((_$2, shift) => East.equal(shift.key, roles.shift)));
        const offset = $.let(0n, IntegerType);
        $.if(East.greater(own.size(), 0n), ($2) => {
            const from = $2.const(own.get(0n));
            const anchor = $2.const(shiftStart(dayOf(roles.start, from.start), from));
            $2.assign(offset, anchor.durationMilliseconds(roles.start));
        });
        const moved = $.const(shiftStart(start.addDays(place.day), targets.get(0n)).addMilliseconds(offset));
        return some({
            start: moved, end: moved.addMilliseconds(roles.start.durationMilliseconds(roles.end)), resource: roles.resource,
            shift: place.shift, group: place.group, position: roles.position, activity: roles.activity, hours: roles.hours,
        });
    });

/**
 * A new duty (§5.5, rule 5): it runs its slot's shift, from the shift's start
 * on its day, for the shift's hours.
 *
 * @param who - Who it is: a person, or an agency asked to send someone
 * @param place - Its place: a group's slot, or no group's (#1548)
 * @param start - The week's first day, a UTC midnight
 * @param position - The position it holds; `none` for a kind with no `position` role
 * @param activity - Its activity, if any
 * @param context - The configuration
 * @returns Its roles; `none` for a place whose shift or group isn't configured
 * @remarks A person is a key of the `people` resource kind, an agency of the `agencies` one. Its hours are the shift's, until its row says otherwise. Copying the week before runs each of its duties so, written over its own row.
 * @internal
 */
export const rosterNewDuty = East.function(
    [RosterWhoType, RosterPlaceType, DateTimeType, OptionType(StringType), OptionType(StringType), RosterContextType], OptionType(ScheduleRosterRolesType),
    ($, who, place, start, position, activity, context) => {
        const shiftStart = $.const(rosterShiftStart);
        const shifts = $.const(context.shifts.filter((_$2, shift) => East.equal(shift.key, place.shift)));
        const grouped = $.const(place.group.match({
            some: (_$2, key) => context.groups.some((_$3, group) => East.equal(group.key, key)),
            none: (_$2) => East.value(true),
        }));
        $.if(East.equal(shifts.size(), 0n).or(() => grouped.not()), ($2) => { $2.return(none); });
        const shift = $.const(shifts.get(0n));
        const from = $.const(shiftStart(start.addDays(place.day), shift));
        const resource = $.const(who.match({
            person: (_$2, key) => East.value({ kind: "people", key }, ScheduleResourceRefType),
            request: (_$2, key) => East.value({ kind: "agencies", key }, ScheduleResourceRefType),
        }));
        return some({
            start: from, end: from.addHours(shift.hours), resource: some(resource), shift: place.shift, group: place.group,
            position, activity, hours: shift.hours,
        });
    });

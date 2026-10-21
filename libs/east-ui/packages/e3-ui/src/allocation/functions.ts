/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Allocation's pure functions (`Allocation Spec.md` §5.1, §12): a day's
 * loads, a fit's candidates, the built-in rules, an answer to a fit's
 * question, a greedy look-ahead, the built-in checks and the day's slots, and
 * a bin as the board reads it from the app's row. Tasks, the app's
 * `e3.function` fit and the renderer run these same East functions, so the
 * screen and e3 agree on every figure and every word.
 *
 * Those over a day take the app's bin row type (#1371, `Builder Interfaces
 * Spec.md` §6.3), as `Editing.apply` takes its source type:
 * `Allocation.loads(KilnBin)` is an East function over
 * `Allocation.Types.Day(KilnBin)`. They read each bin's roles, never its row,
 * which they carry for the app's own functions. `Allocation.fit` reads one
 * candidate, so it needs none.
 *
 * @packageDocumentation
 */

import {
    ArrayType, BooleanType, DateTimeType, DictType, East, FloatType, FunctionType, IntegerType, OptionType, SetType, StringType,
    StructType, none, some, variant, type EastType, type ExprType,
} from "@elaraai/east";
import { StatusTokenType, TimeStepType } from "@elaraai/east-ui";
import { ScheduleAllocationRolesType } from "../schedule/types.js";
import { scheduleNumberText } from "../schedule/words.js";
import {
    AllocationArrivalType, AllocationBinTypeFor, AllocationCandidateType, AllocationContextType, AllocationDayTypeFor, AllocationFitRequestTypeFor,
    AllocationFitResultType, AllocationFitType, AllocationFixType, AllocationIntervalType, AllocationIssueType, AllocationJobType, AllocationLoadType,
    AllocationResourceLineType, AllocationResourceType, AllocationRulesType, AllocationSlotType, type AllocationBinType,
    type AllocationContextType as ContextType, type AllocationDayType, type AllocationFitRequestType,
} from "./types.js";

/** A day, in milliseconds. */
const DAY_MS = 86_400_000;

// ============================================================================
// Words and time
// ============================================================================

/**
 * A duration in milliseconds — a month counts 30 days, as Schedule's do.
 *
 * @param step - The duration
 * @returns Its length in milliseconds
 */
export const allocationMilliseconds = East.function([TimeStepType], IntegerType, (_$, step) => East.Float.roundHalf(step.match({
    minutes: (_$2, n) => n.multiply(60_000.0),
    hours: (_$2, n) => n.multiply(3_600_000.0),
    days: (_$2, n) => n.multiply(86_400_000.0),
    weeks: (_$2, n) => n.multiply(604_800_000.0),
    months: (_$2, n) => n.multiply(2_592_000_000.0),
})));

/**
 * A quantity and its unit.
 *
 * @param value - The quantity
 * @param unit - The unit, or empty
 * @returns `21 m³`, or `21` with no unit
 */
export const allocationQuantityText = East.function([FloatType, StringType], StringType, ($, value, unit) => {
    const num = $.const(scheduleNumberText);
    return East.equal(unit, "").ifElse(() => num(value), () => East.str`${num(value)} ${unit}`);
});

/**
 * A day as the board names it.
 *
 * @param at - An instant on the day
 * @returns `Wed 19`
 */
export const allocationDayText = East.function([DateTimeType], StringType, (_$, at) => at.printFormatted("ddd D"));

/**
 * A resource's load, naming the limit it breaks (A19).
 *
 * @param fill - What its bins put on it
 * @param resource - The resource
 * @param unit - The quantity's unit
 * @returns `11 m³ · max 9 · 2 over`, `16 m³ · min 40 · 24 short`, or `45 m³ · takes 26–48`
 */
export const allocationLoadText = East.function([FloatType, AllocationResourceType, StringType], StringType, ($, fill, resource, unit) => {
    const num = $.const(scheduleNumberText);
    const qty = $.const(allocationQuantityText);
    const f = $.const(East.Float.roundHalf(fill).toFloat());
    const out = $.let(East.str`${qty(f, unit)} · takes ${num(resource.min)}–${num(resource.max)}`);
    $.if(East.greater(f, resource.max), ($2) => {
        $2.assign(out, East.str`${qty(f, unit)} · max ${num(resource.max)} · ${num(f.subtract(resource.max))} over`);
    }).else(($2) => {
        $2.if(East.greater(f, 0.0).and(() => East.less(f, resource.min)), ($3) => {
            $3.assign(out, East.str`${qty(f, unit)} · min ${num(resource.min)} · ${num(resource.min.subtract(f))} short`);
        });
    });
    return out;
});

/**
 * The job that makes a resource busy on a day: one covering the day's start,
 * the latest to end of them.
 *
 * @param resource - The resource
 * @param day - The plan day
 * @returns The job, or `none`
 */
export const allocationBusyJob = East.function([AllocationResourceType, DateTimeType], OptionType(AllocationJobType), ($, resource, day) => {
    const found = $.let(none, OptionType(AllocationJobType));
    $.for(resource.jobs, ($2, job) => {
        $2.if(East.lessEqual(job.start, day).and(() => East.greater(job.end, day)), ($3) => {
            $3.match(found, {
                none: ($4) => { $4.assign(found, some(job)); },
                some: ($4, current) => { $4.if(East.greater(job.end, current.end), ($5) => { $5.assign(found, some(job)); }); },
            });
        });
    });
    return found;
});

/**
 * A resource's next job after a day's start: the first to start.
 *
 * @param resource - The resource
 * @param day - The plan day
 * @returns The job, or `none`
 */
export const allocationNextJob = East.function([AllocationResourceType, DateTimeType], OptionType(AllocationJobType), ($, resource, day) => {
    const found = $.let(none, OptionType(AllocationJobType));
    $.for(resource.jobs, ($2, job) => {
        $2.if(East.greater(job.start, day), ($3) => {
            $3.match(found, {
                none: ($4) => { $4.assign(found, some(job)); },
                some: ($4, current) => { $4.if(East.less(job.start, current.start), ($5) => { $5.assign(found, some(job)); }); },
            });
        });
    });
    return found;
});

/**
 * A resource's line on the plan day (A19), and the marks its bins' cards carry
 * (A16).
 *
 * @param day - The plan day
 * @param resource - The resource
 * @param load - Its load
 * @param unit - The quantity's unit
 * @returns Its line, its tone, whether it is over its maximum, under its minimum, or held into its next job, and that job
 *
 * @remarks
 * Loading, the line is its load (`45 m³ · takes 26–48`; `reserved · takes
 * 26–48` with only reservations) and `· 2 d into next job` when its hold runs
 * into the job; busy, `busy until Fri 14`; free, its meta (or its group) and
 * what it takes (`Hall B · 40 m³ · takes 20–40 m³`).
 */
export const allocationResourceLine = East.function([DateTimeType, AllocationResourceType, AllocationLoadType, StringType], AllocationResourceLineType, ($, day, resource, load, unit) => {
    const busyOf = $.const(allocationBusyJob);
    const nextOf = $.const(allocationNextJob);
    const dayText = $.const(allocationDayText);
    const num = $.const(scheduleNumberText);
    const qty = $.const(allocationQuantityText);
    const loadText = $.const(allocationLoadText);
    const over = $.const(East.greater(load.fill, resource.max));
    const under = $.const(East.greater(load.fill, 0.0).and(() => East.less(load.fill, resource.min)));
    const next = $.const(nextOf(resource, day));
    const overlap = $.let(false, BooleanType);
    const into = $.let(0.0, FloatType);
    $.match(load.hold, {
        some: ($2, hold) => {
            $2.match(next, {
                some: ($3, job) => {
                    $3.if(East.greater(hold.to, job.start), ($4) => {
                        $4.assign(overlap, true);
                        $4.assign(into, job.start.durationMilliseconds(hold.to).toFloat().divide(DAY_MS));
                    });
                },
            });
        },
    });
    const text = $.let("", StringType);
    $.match(load.state, {
        loading: ($2) => {
            const held = $2.const(East.greater(load.fill, 0.0).ifElse(
                () => loadText(load.fill, resource, unit),
                () => East.str`reserved · takes ${num(resource.min)}–${num(resource.max)}`));
            $2.assign(text, overlap.ifElse(() => East.str`${held} · ${num(into)} d into next job`, () => held));
        },
        busy: ($2) => {
            $2.assign(text, busyOf(resource, day).match({
                some: (_$3, job) => East.str`busy until ${dayText(job.end)}`,
                none: (_$3) => East.str`busy`,
            }));
        },
        free: ($2) => {
            const takes = $2.const(East.str`takes ${num(resource.min)}–${qty(resource.max, unit)}`);
            $2.assign(text, resource.meta.match({
                some: (_$3, meta) => East.str`${meta} · ${takes}`,
                none: (_$3) => resource.group.match({ some: (_$4, group) => East.str`${group} · ${takes}`, none: (_$4) => takes }),
            }));
        },
    });
    return {
        text,
        tone: over.ifElse(
            () => East.value(variant("danger", null), StatusTokenType),
            () => overlap.or(() => under).ifElse(() => East.value(variant("warning", null), StatusTokenType), () => East.value(variant("neutral", null), StatusTokenType))),
        over, under, overlap, next,
    };
});

// ============================================================================
// A bin, as the board reads it from the app's row
// ============================================================================

/**
 * One bin, as the board reads it on its plan day (#1371, B12): its kind's
 * roles beside its row — a stored bin's roles as the kind's `rows` gives them,
 * a drafted one's as its `read` does.
 *
 * @typeParam R - The app's bin row type
 * @param row - The app's bin row type
 * @returns An East function `(roles, row, day) → Option<Bin(R)>`: the bin, when its `at` falls in the day `[day, day + 1 d)`; `none` for a bin of another day
 *
 * @remarks
 * A bin's UTC day is its plan day (`Builder Interfaces Spec.md` §6.2), so the
 * board's day holds the bins whose `at` falls in it, `day` its UTC midnight.
 * Each bin's `at` is read as it is, so a batch's bins, booked a minute apart,
 * read back a minute apart, in one slot (`Allocation.slots`).
 * @internal
 */
export function allocationBinOf<R extends EastType>(row: R) {
    const Bin = AllocationBinTypeFor(row as EastType);
    return East.function([ScheduleAllocationRolesType, row as EastType, DateTimeType], OptionType(Bin), ($, roles, value, day) => {
        $.if(East.less(roles.at, day).or(() => East.greaterEqual(roles.at, day.addDays(1n))), ($2) => { $2.return(none); });
        return some({
            lane: roles.lane, at: roles.at, arrival: roles.arrival, quantity: roles.quantity, kind: roles.kind, hold: roles.hold, parts: roles.parts,
            row: value,
        });
    }) as unknown as ExprType<FunctionType<[ScheduleAllocationRolesType, R, DateTimeType], OptionType<AllocationBinType<R>>>>;
}

// ============================================================================
// Mates: what a resource already holds, without the app's rows
// ============================================================================

/**
 * One bin's part on one resource, as loads and candidates read it.
 *
 * @property bin - The bin's id; empty for a placement the look-ahead adds
 * @property quantity - Its part's quantity
 * @property hold - Its hold, in milliseconds
 * @property kind - Its kind
 * @property reserve - Whether it is a reservation
 * @internal
 */
export const AllocationMateType = StructType({ bin: StringType, quantity: FloatType, hold: IntegerType, kind: OptionType(StringType), reserve: BooleanType });

/** The bins' parts on every resource, by the resource's key. @internal */
const MatesType = DictType(StringType, ArrayType(AllocationMateType));

/**
 * Every resource's parts of the day's bins, an entry for every resource.
 *
 * @typeParam R - The app's bin row type
 * @param row - The app's bin row type
 * @returns An East function from the day and the context to the parts on each resource
 * @internal
 */
export function allocationMates<R extends EastType>(row: R) {
    return East.function([AllocationDayTypeFor(row), AllocationContextType], MatesType, ($, plan, context) => {
        const step = $.const(allocationMilliseconds);
        const out = $.let(context.resources.map((_$2, _resource) => East.value([], ArrayType(AllocationMateType))));
        $.for(plan.bins, ($2, bin, id) => {
            const hold = $2.const(step(bin.hold));
            const reserve = $2.const(bin.arrival.hasTag("none"));
            $2.for(bin.parts, ($3, quantity, resource) => {
                $3.if(out.has(resource), ($4) => {
                    $4(out.get(resource).pushLast({ bin: id, quantity, hold, kind: bin.kind, reserve }));
                });
            });
        });
        return out;
    }) as unknown as ExprType<FunctionType<[AllocationDayType<R>, ContextType], typeof MatesType>>;
}

/**
 * A resource's load from its parts.
 *
 * @param day - The plan day
 * @param resource - The resource
 * @param mates - Its parts
 * @returns Its load
 * @internal
 */
export const allocationLoadOf = East.function([DateTimeType, AllocationResourceType, ArrayType(AllocationMateType)], AllocationLoadType, ($, day, resource, mates) => {
    const step = $.const(allocationMilliseconds);
    const busyOf = $.const(allocationBusyJob);
    const fill = $.let(0.0, FloatType);
    const longest = $.let(none, OptionType(IntegerType));
    $.for(mates, ($2, mate) => {
        $2.assign(fill, fill.add(mate.quantity));
        $2.if(mate.reserve.not(), ($3) => {
            $3.match(longest, {
                none: ($4) => { $4.assign(longest, some(mate.hold)); },
                some: ($4, held) => { $4.assign(longest, some(East.max(held, mate.hold))); },
            });
        });
    });
    // A resource holding only reservations is held for its own hold.
    const length = $.const(longest.unwrap("some", () => step(resource.hold)));
    const hold = $.let(none, OptionType(AllocationIntervalType));
    $.if(East.greater(mates.size(), 0n), ($2) => { $2.assign(hold, some({ from: day, to: day.addMilliseconds(length) })); });
    const busy = $.const(busyOf(resource, day).hasTag("some"));
    return {
        resource: resource.key, fill, bins: mates.size(), hold,
        state: East.greater(mates.size(), 0n).ifElse(
            () => East.value(variant("loading", null), AllocationLoadType.fields.state),
            () => busy.ifElse(() => East.value(variant("busy", null), AllocationLoadType.fields.state), () => East.value(variant("free", null), AllocationLoadType.fields.state))),
    };
});

/**
 * One candidate: a quantity on a resource, against the parts it already holds.
 *
 * @param day - The plan day
 * @param bin - The bin it is for, if any
 * @param reserve - Whether it reserves a slot
 * @param quantity - What the resource would hold of it
 * @param arrival - Its arrival, if any
 * @param kind - Its kind
 * @param hold - Its hold, in milliseconds
 * @param resource - The resource
 * @param mates - The resource's other parts
 * @param load - The resource's load
 * @param rules - The built-in rules
 * @param unit - The quantity's unit
 * @returns The candidate
 * @internal
 */
export const allocationCandidateOf = East.function([
    DateTimeType, OptionType(StringType), BooleanType, FloatType, OptionType(AllocationArrivalType), OptionType(StringType), IntegerType,
    AllocationResourceType, ArrayType(AllocationMateType), AllocationLoadType, AllocationRulesType, StringType,
], AllocationCandidateType, ($, day, bin, reserve, quantity, arrival, kind, hold, resource, mates, load, rules, unit) => {
    const nextOf = $.const(allocationNextJob);
    const fill = $.let(0.0, FloatType);
    const length = $.let(hold, IntegerType);
    const kindMates = $.let(false, BooleanType);
    $.for(mates, ($2, mate) => {
        $2.assign(fill, fill.add(mate.quantity));
        $2.assign(length, East.max(length, mate.hold));
        $2.if(kind.hasTag("some").and(() => East.equal(mate.kind, kind)), ($3) => { $3.assign(kindMates, true); });
    });
    const to = $.const(day.addMilliseconds(length));
    const spare = $.let(none, OptionType(FloatType));
    $.match(nextOf(resource, day), {
        some: ($2, job) => { $2.assign(spare, some(to.durationMilliseconds(job.start).toFloat().divide(DAY_MS))); },
    });
    return {
        day, bin, reserve, quantity, arrival, kind, resource, load, after: fill.add(quantity), hold: { from: day, to }, spare, kindMates,
        otherMates: East.greater(mates.size(), 0n).and(() => kindMates.not()), rules, unit,
    };
});

// ============================================================================
// The built-in rules
// ============================================================================

/**
 * The built-in rules (§12.3): one verdict for one candidate.
 *
 * @param candidate - A quantity on a resource, against the drafted day
 * @returns Its verdict
 *
 * @remarks
 * In order: a job covering the day's start refuses it (`busy until Fri 14`);
 * a hold running past the next job's start refuses it (`gap too short · next
 * job Wed 19`); a fill over the maximum refuses it (`over max by 4 m³`); a
 * reservation on a resource already at its maximum is refused (`full · …`).
 * Otherwise it fits: its score is what it fills of the maximum, plus 0.25 when
 * a bin of its kind is already there, less 0.1 when only other kinds are, less
 * 0.5 under the minimum, less 0.04 a spare day up to six; its reason the spare
 * days and the load it leaves; under the minimum it warns, when the rules ask.
 */
export const allocationFit = East.function([AllocationCandidateType], AllocationFitType, ($, candidate) => {
    const busyOf = $.const(allocationBusyJob);
    const nextOf = $.const(allocationNextJob);
    const dayText = $.const(allocationDayText);
    const qty = $.const(allocationQuantityText);
    const num = $.const(scheduleNumberText);
    const loadText = $.const(allocationLoadText);
    const resource = $.const(candidate.resource);
    $.match(busyOf(resource, candidate.day), {
        some: ($2, job) => {
            $2.return(variant("refused", { group: "Busy", reason: East.str`busy until ${dayText(job.end)}`, measure: variant("day", { lead: "until", at: job.end }) }));
        },
    });
    const next = $.const(nextOf(resource, candidate.day));
    $.match(next, {
        some: ($2, job) => {
            $2.if(East.greater(candidate.hold.to, job.start), ($3) => {
                $3.return(variant("refused", {
                    group: "Gap too short", reason: East.str`gap too short · next job ${dayText(job.start)}`,
                    measure: variant("day", { lead: "next job", at: job.start }),
                }));
            });
        },
    });
    $.if(East.greater(candidate.after, resource.max), ($2) => {
        const by = $2.const(East.Float.roundHalf(candidate.after.subtract(resource.max)).toFloat());
        $2.return(variant("refused", { group: "Over max", reason: East.str`over max by ${qty(by, candidate.unit)}`, measure: variant("amount", { lead: "by", value: by }) }));
    });
    const fill = $.const(candidate.after.subtract(candidate.quantity));
    $.if(candidate.reserve.and(() => East.greaterEqual(fill, resource.max)), ($2) => {
        $2.return(variant("refused", { group: "Full", reason: East.str`full · ${loadText(fill, resource, candidate.unit)}`, measure: variant("none", null) }));
    });
    // The score, term for term in the mock's order, so equal fits tie exactly.
    const spare = $.const(candidate.spare.unwrap("some", () => 9.0));
    const score = $.const(candidate.after.divide(resource.max)
        .add(candidate.kindMates.ifElse(() => 0.25, () => 0.0))
        .subtract(candidate.otherMates.ifElse(() => 0.1, () => 0.0))
        .subtract(East.less(candidate.after, resource.min).ifElse(() => 0.5, () => 0.0))
        .subtract(East.min(spare, $.const(6.0, FloatType)).multiply(0.04)));
    const gap = $.const(next.match({
        some: (_$2, job) => East.str`${num(spare)} d spare to ${dayText(job.start)}`,
        none: (_$2) => East.str`open gap`,
    }));
    return variant("fits", {
        score, why: East.str`${gap} · leaves ${loadText(candidate.after, resource, candidate.unit)}`,
        warn: East.less(candidate.after, resource.min).and(() => candidate.rules.under).ifElse(
            () => East.value(some("under min"), OptionType(StringType)), () => East.value(none, OptionType(StringType))),
    });
});

// ============================================================================
// Loads, candidates and answers
// ============================================================================

/**
 * Every resource's load on the plan day.
 *
 * @typeParam R - The app's bin row type
 * @param row - The app's bin row type
 * @returns An East function `(day, plan, context) → Dict<String, Load>`: an entry for every resource, by key
 */
export function allocationLoads<R extends EastType>(row: R) {
    const matesOf = allocationMates(row);
    return East.function([DateTimeType, AllocationDayTypeFor(row), AllocationContextType], DictType(StringType, AllocationLoadType), ($, day, plan, context) => {
        const parts = $.const(matesOf);
        const loadOf = $.const(allocationLoadOf);
        const mates = $.const(parts(plan, context));
        return context.resources.map(($2, resource, key) => loadOf(day, resource, mates.get(key)));
    }) as unknown as ExprType<FunctionType<[DateTimeType, AllocationDayType<R>, ContextType], DictType<StringType, typeof AllocationLoadType>>>;
}

/**
 * The candidates for a fit's question.
 *
 * @typeParam R - The app's bin row type
 * @param row - The app's bin row type
 * @returns An East function `(request) → Array<Candidate>`: a place's subject on every resource, in the resources' key order; or for a take, every bin on its resource, then every arrival the day has not booked, then a reservation
 *
 * @remarks
 * A bin is placed with its own kind and hold, an arrival with its, and a bin
 * booking no arrival — a reservation — with no quantity and each resource's
 * own hold (§12.3, rule 4); the resource's other parts are every bin's but
 * the subject's. A take places each bin's unallocated quantity (with its part
 * already there), or the whole bin when it has none; then each arrival no bin
 * of the day books, whole, as a place of it would; and last a reservation with
 * the resource's hold.
 */
export function allocationCandidates<R extends EastType>(row: R) {
    const matesOf = allocationMates(row);
    return East.function([AllocationFitRequestTypeFor(row)], ArrayType(AllocationCandidateType), ($, request) => {
        const parts = $.const(matesOf);
        const loadOf = $.const(allocationLoadOf);
        const candidateOf = $.const(allocationCandidateOf);
        const step = $.const(allocationMilliseconds);
        const context = $.const(request.context);
        const day = $.const(request.day);
        const mates = $.const(parts(request.plan, context));
        const out = $.let([], ArrayType(AllocationCandidateType));
        $.match(request.ask, {
            place: ($2, place) => {
                const bin = $2.let(none, OptionType(StringType));
                const arrival = $2.let(none, OptionType(AllocationArrivalType));
                const kind = $2.let(none, OptionType(StringType));
                const hold = $2.let(0n, IntegerType);
                const reserve = $2.let(false, BooleanType);
                $2.match(place.subject, {
                    bin: ($3, id) => {
                        const subject = $3.const(request.plan.bins.get(id));
                        $3.assign(bin, some(id));
                        $3.match(subject.arrival, { some: ($4, key) => { $4.assign(arrival, context.arrivals.tryGet(key)); } });
                        $3.assign(kind, subject.kind);
                        $3.assign(hold, step(subject.hold));
                        $3.assign(reserve, subject.arrival.hasTag("none"));
                    },
                    arrival: ($3, key) => {
                        const subject = $3.const(context.arrivals.get(key));
                        $3.assign(arrival, some(subject));
                        $3.assign(kind, subject.kind);
                        $3.assign(hold, step(subject.hold));
                    },
                });
                const subject = $2.const(bin.unwrap("some", () => ""));
                $2.for(context.resources, ($3, resource, key) => {
                    const all = $3.const(mates.get(key));
                    const others = $3.const(all.filter(($4, mate) => East.notEqual(mate.bin, subject)));
                    const length = $3.const(reserve.ifElse(() => step(resource.hold), () => hold));
                    $3(out.pushLast(candidateOf(day, bin, reserve, place.quantity, arrival, kind, length, resource, others, loadOf(day, resource, all), context.rules, context.unit)));
                });
            },
            take: ($2, take) => {
                const resource = $2.const(context.resources.get(take.resource));
                const all = $2.const(mates.get(take.resource));
                const load = $2.const(loadOf(day, resource, all));
                $2.for(request.plan.bins, ($3, bin, id) => {
                    const allocated = $3.let(0.0, FloatType);
                    $3.for(bin.parts, ($4, part) => { $4.assign(allocated, allocated.add(part)); });
                    const reserve = $3.const(bin.arrival.hasTag("none"));
                    const quantity = $3.let(bin.quantity, FloatType);
                    $3.if(reserve, ($4) => { $4.assign(quantity, 0.0); }).else(($4) => {
                        $4.if(East.less(allocated, bin.quantity), ($5) => {
                            $5.assign(quantity, bin.quantity.subtract(allocated).add(bin.parts.get(take.resource, () => 0.0)));
                        });
                    });
                    const arrival = $3.let(none, OptionType(AllocationArrivalType));
                    $3.match(bin.arrival, { some: ($4, key) => { $4.assign(arrival, context.arrivals.tryGet(key)); } });
                    const others = $3.const(all.filter(($4, mate) => East.notEqual(mate.bin, id)));
                    $3(out.pushLast(candidateOf(day, some(id), reserve, quantity, arrival, bin.kind, step(bin.hold), resource, others, load, context.rules, context.unit)));
                });
                // Every arrival the day has not booked, whole on the resource.
                const booked = $2.let(new Set<string>(), SetType(StringType));
                $2.for(request.plan.bins, ($3, bin) => {
                    $3.match(bin.arrival, { some: ($4, key) => { $4.if(booked.has(key).not(), ($5) => { $5(booked.insert(key)); }); } });
                });
                $2.for(context.arrivals, ($3, arrival, key) => {
                    $3.if(booked.has(key).not(), ($4) => {
                        $4(out.pushLast(candidateOf(day, none, false, arrival.quantity, some(arrival), arrival.kind, step(arrival.hold), resource, all, load, context.rules, context.unit)));
                    });
                });
                $2(out.pushLast(candidateOf(day, none, true, 0.0, none, none, step(resource.hold), resource, all, load, context.rules, context.unit)));
            },
        });
        return out;
    }) as unknown as ExprType<FunctionType<[AllocationFitRequestType<R>], ArrayType<typeof AllocationCandidateType>>>;
}

/**
 * Answers a fit's question with a fit per candidate.
 *
 * @typeParam R - The app's bin row type
 * @param row - The app's bin row type
 * @returns An East function `(request, fit, basis) → FitResult`: a place's verdict for every resource, or a take's for every bin, every arrival the day has not booked, and reserving; `basis` says in words how the fit ranks (`ranked by load, kind and spare days`)
 */
export function allocationAnswer<R extends EastType>(row: R) {
    const candidatesOf = allocationCandidates(row);
    return East.function([
        AllocationFitRequestTypeFor(row), FunctionType([AllocationCandidateType], AllocationFitType), StringType,
    ], AllocationFitResultType, ($, request, fit, basis) => {
        const candidates = $.const(candidatesOf);
        const resources = $.let(new Map(), DictType(StringType, AllocationFitType));
        const bins = $.let(new Map(), DictType(StringType, AllocationFitType));
        const arrivals = $.let(new Map(), DictType(StringType, AllocationFitType));
        const reserve = $.let(none, OptionType(AllocationFitType));
        $.for(candidates(request), ($2, candidate) => {
            $2.match(request.ask, {
                place: ($3) => { $3(resources.insert(candidate.resource.key, fit(candidate))); },
                take: ($3) => {
                    $3.match(candidate.bin, {
                        some: ($4, id) => { $4(bins.insert(id, fit(candidate))); },
                        none: ($4) => {
                            $4.match(candidate.arrival, {
                                some: ($5, arrival) => { $5(arrivals.insert(arrival.key, fit(candidate))); },
                                none: ($5) => { $5.assign(reserve, some(fit(candidate))); },
                            });
                        },
                    });
                },
            });
        });
        return { ask: request.ask, resources, bins, arrivals, reserve, basis };
    }) as unknown as ExprType<FunctionType<[AllocationFitRequestType<R>, FunctionType<[typeof AllocationCandidateType], typeof AllocationFitType>, StringType], typeof AllocationFitResultType>>;
}

/**
 * A greedy look-ahead over a fit (§12.4): what a placement leaves for the
 * day's other arrivals.
 *
 * @typeParam R - The app's bin row type
 * @param row - The app's bin row type
 * @returns An East function `(request, candidate, fit) → Fit`
 *
 * @remarks
 * A refusal is returned as `fit` gives it. A fit places the candidate — a bin
 * moves whole onto the candidate's resource with the candidate's quantity —
 * then each of the day's unbooked arrivals, largest first (ties in key
 * order), on the resource `fit` scores best for it (ties in key order), and
 * lowers the score by one for each arrival left with nowhere to go, adding
 * `· leaves 1 load with no fit` to its reason.
 */
export function allocationLookahead<R extends EastType>(row: R) {
    const matesOf = allocationMates(row);
    return East.function([
        AllocationFitRequestTypeFor(row), AllocationCandidateType, FunctionType([AllocationCandidateType], AllocationFitType),
    ], AllocationFitType, ($, request, candidate, fit) => {
        const parts = $.const(matesOf);
        const loadOf = $.const(allocationLoadOf);
        const candidateOf = $.const(allocationCandidateOf);
        const step = $.const(allocationMilliseconds);
        const context = $.const(request.context);
        const day = $.const(request.day);
        const verdict = $.const(fit(candidate));
        $.match(verdict, { refused: ($2) => { $2.return(verdict); } });
        const fits = $.const(verdict.unwrap("fits"));
        // The candidate placed: its bin off every resource, its quantity on its resource.
        const subject = $.const(candidate.bin.unwrap("some", () => ""));
        const placed = $.const(parts(request.plan, context).map(($2, list) => list.filter(($3, mate) => East.notEqual(mate.bin, subject))));
        $(placed.get(candidate.resource.key).pushLast({
            bin: "", quantity: candidate.quantity, hold: day.durationMilliseconds(candidate.hold.to), kind: candidate.kind, reserve: candidate.reserve,
        }));
        // The day's unbooked arrivals, largest first.
        const booked = $.let(new Set<string>(), SetType(StringType));
        $.for(request.plan.bins, ($2, bin) => {
            $2.match(bin.arrival, { some: ($3, key) => { $3.if(booked.has(key).not(), ($4) => { $4(booked.insert(key)); }); } });
        });
        $.match(candidate.arrival, { some: ($2, arrival) => { $2.if(booked.has(arrival.key).not(), ($3) => { $3(booked.insert(arrival.key)); }); } });
        const waiting = $.const(context.arrivals.filter(($2, _arrival, key) => booked.has(key).not()).toArray(($2, arrival) => arrival)
            .sort(($2, arrival) => ({ quantity: arrival.quantity.negate(), key: arrival.key })));
        const left = $.let(0n, IntegerType);
        $.for(waiting, ($2, arrival) => {
            const hold = $2.const(step(arrival.hold));
            const best = $2.let(none, OptionType(StringType));
            const bestScore = $2.let(0.0, FloatType);
            $2.for(context.resources, ($3, resource, key) => {
                const mates = $3.const(placed.get(key));
                const there = $3.const(candidateOf(day, none, false, arrival.quantity, some(arrival), arrival.kind, hold, resource, mates, loadOf(day, resource, mates), context.rules, context.unit));
                $3.match(fit(there), {
                    fits: ($4, it) => {
                        $4.if(best.hasTag("none").or(() => East.greater(it.score, bestScore)), ($5) => {
                            $5.assign(best, some(key));
                            $5.assign(bestScore, it.score);
                        });
                    },
                });
            });
            $2.match(best, {
                some: ($3, key) => { $3(placed.get(key).pushLast({ bin: "", quantity: arrival.quantity, hold, kind: arrival.kind, reserve: false })); },
                none: ($3) => { $3.assign(left, left.add(1n)); },
            });
        });
        const leaves = $.const(East.equal(left, 1n).ifElse(() => East.str` · leaves 1 load with no fit`, () => East.str` · leaves ${left} loads with no fit`));
        return East.greater(left, 0n).ifElse(
            () => East.value(variant("fits", { score: fits.score.subtract(left.toFloat()), why: East.str`${fits.why}${leaves}`, warn: fits.warn }), AllocationFitType),
            () => verdict);
    }) as unknown as ExprType<FunctionType<[AllocationFitRequestType<R>, typeof AllocationCandidateType, FunctionType<[typeof AllocationCandidateType], typeof AllocationFitType>], typeof AllocationFitType>>;
}

// ============================================================================
// The built-in checks
// ============================================================================

/**
 * The built-in checks (§12.3), over committed and drafted bins alike.
 *
 * @typeParam R - The app's bin row type
 * @param row - The app's bin row type
 * @returns An East function `(day, plan, context) → Array<Issue>`: bins not linked, then partly allocated, then resources whose hold overlaps their next job, over their maximum, and under their minimum when the rules ask
 *
 * @remarks
 * Issues never block Save or Publish. A resource's issue offers to move its
 * latest bin; the app's `check` follows these wherever issues show.
 */
export function allocationCheck<R extends EastType>(row: R) {
    const loadsOf = allocationLoads(row);
    return East.function([DateTimeType, AllocationDayTypeFor(row), AllocationContextType], ArrayType(AllocationIssueType), ($, day, plan, context) => {
        const loadsFor = $.const(loadsOf);
        const nextOf = $.const(allocationNextJob);
        const qty = $.const(allocationQuantityText);
        const num = $.const(scheduleNumberText);
        const dayText = $.const(allocationDayText);
        const loadText = $.const(allocationLoadText);
        const loads = $.const(loadsFor(day, plan, context));
        const lanes = $.const(context.lanes.toDict(($2, lane) => lane.key, ($2, lane) => lane.label));
        const issues = $.let([], ArrayType(AllocationIssueType));
        const where = $.const(East.function([StringType, DateTimeType], StringType, ($2, lane, at) =>
            East.str`${lanes.get(lane, () => lane)} ${at.printFormatted("HH:mm")}`));
        const labelOf = $.const(East.function([StringType], StringType, ($2, key) => context.arrivals.tryGet(key).match({
            some: (_$3, arrival) => arrival.label, none: (_$3) => key,
        })));
        // Bins: not linked, then partly allocated.
        $.for(plan.bins, ($2, bin, id) => {
            $2.match(bin.arrival, {
                some: ($3, key) => {
                    $3.if(East.equal(bin.parts.size(), 0n), ($4) => {
                        $4(issues.pushLast({ kind: variant("unlinked", null), tone: variant("warning", null),
                            title: East.str`${labelOf(key)} · ${qty(bin.quantity, context.unit)}`, detail: East.str`${where(bin.lane, bin.at)} · no resource yet`,
                            bin: some(id), resource: none, flag: none, fix: some(variant("choose", null)) }));
                    });
                },
            });
        });
        $.for(plan.bins, ($2, bin, id) => {
            $2.match(bin.arrival, {
                some: ($3, key) => {
                    const allocated = $3.let(0.0, FloatType);
                    $3.for(bin.parts, ($4, part) => { $4.assign(allocated, allocated.add(part)); });
                    $3.if(East.greater(bin.parts.size(), 0n).and(() => East.less(allocated, bin.quantity)), ($4) => {
                        $4(issues.pushLast({ kind: variant("unallocated", null), tone: variant("warning", null),
                            title: East.str`${labelOf(key)} · ${qty(bin.quantity, context.unit)}`,
                            detail: East.str`${qty(bin.quantity.subtract(allocated), context.unit)} unallocated · ${where(bin.lane, bin.at)}`,
                            bin: some(id), resource: none, flag: none, fix: some(variant("find", null)) }));
                    });
                },
            });
        });
        // The latest bin booking an arrival on each resource: what its issues offer to move.
        const lastOf = $.const(East.function([StringType], OptionType(StringType), ($2, resource) => {
            const last = $2.let(none, OptionType(StringType));
            const lastAt = $2.let(day, DateTimeType);
            $2.for(plan.bins, ($3, bin, id) => {
                $3.if(bin.arrival.hasTag("some").and(() => bin.parts.has(resource)), ($4) => {
                    $4.if(last.hasTag("none").or(() => East.greaterEqual(bin.at, lastAt)), ($5) => {
                        $5.assign(last, some(id));
                        $5.assign(lastAt, bin.at);
                    });
                });
            });
            return last;
        }));
        const moveOf = $.const(East.function([StringType], OptionType(AllocationFixType), ($2, resource) => {
            const fix = $2.let(none, OptionType(AllocationFixType));
            $2.match(lastOf(resource), { some: ($3, id) => { $3.assign(fix, some(variant("move", id))); } });
            return fix;
        }));
        $.for(context.resources, ($2, resource, key) => {
            const load = $2.const(loads.get(key));
            $2.match(load.hold, {
                some: ($3, hold) => {
                    $3.match(nextOf(resource, day), {
                        some: ($4, job) => {
                            $4.if(East.greater(hold.to, job.start), ($5) => {
                                const length = $5.const(day.durationMilliseconds(hold.to).toFloat().divide(DAY_MS));
                                const into = $5.const(job.start.durationMilliseconds(hold.to).toFloat().divide(DAY_MS));
                                $5(issues.pushLast({ kind: variant("overlap", null), tone: variant("warning", null), title: resource.label,
                                    detail: East.str`${num(length)}-day hold to ${dayText(hold.to.addMilliseconds(-1n))} · runs ${num(into)} d into the job planned ${dayText(job.start)}`,
                                    bin: none, resource: some(key), flag: none, fix: moveOf(key) }));
                            });
                        },
                    });
                },
            });
        });
        $.for(context.resources, ($2, resource, key) => {
            const load = $2.const(loads.get(key));
            $2.if(East.greater(load.fill, resource.max), ($3) => {
                $3(issues.pushLast({ kind: variant("over", null), tone: variant("danger", null), title: resource.label,
                    detail: East.str`${loadText(load.fill, resource, context.unit)} · over max`, bin: none, resource: some(key), flag: none, fix: moveOf(key) }));
            });
        });
        $.for(context.resources, ($2, resource, key) => {
            const load = $2.const(loads.get(key));
            $2.if(context.rules.under.and(() => East.greater(load.fill, 0.0)).and(() => East.less(load.fill, resource.min))
                .and(() => East.lessEqual(load.fill, resource.max)), ($3) => {
                $3(issues.pushLast({ kind: variant("under", null), tone: variant("warning", null), title: resource.label,
                    detail: East.str`${loadText(load.fill, resource, context.unit)} · a warning, Save still works`,
                    bin: none, resource: some(key), flag: none, fix: moveOf(key) }));
            });
        });
        return issues;
    }) as unknown as ExprType<FunctionType<[DateTimeType, AllocationDayType<R>, ContextType], ArrayType<typeof AllocationIssueType>>>;
}

// ============================================================================
// Slots
// ============================================================================

/**
 * The plan day's lane slots: one per lane per `every`, in time then lane order.
 *
 * @typeParam R - The app's bin row type
 * @param row - The app's bin row type
 * @returns An East function `(day, plan, context) → Array<Slot>`
 *
 * @remarks
 * A bin is in the slot whose time it follows: from ten minutes before the
 * slot's time to ten minutes before the next one's, as a batch follows its
 * slot by a minute a bin. A slot holding a bin booking an arrival is booked,
 * one holding only reservations reserved, an empty one free. A bin in a lane
 * the context does not have is in no slot.
 */
export function allocationSlots<R extends EastType>(row: R) {
    return East.function([DateTimeType, AllocationDayTypeFor(row), AllocationContextType], ArrayType(AllocationSlotType), ($, day, plan, context) => {
        const step = $.const(allocationMilliseconds);
        const every = $.const(step(context.every));
        $.if(East.lessEqual(every, 0n), ($2) => { $2.error("Allocation: `every` must be longer than no time"); });
        const count = $.const(East.value(BigInt(DAY_MS)).divide(every));
        const laneIndex = $.const(context.lanes.toDict(($2, lane) => lane.key, ($2, _lane, i) => i));
        // Each lane's slots, each its bins' ids.
        const held = $.let(context.lanes.map((_$2) => East.Array.generate(count, ArrayType(StringType), (_$3) => East.value([], ArrayType(StringType)))));
        $.for(plan.bins, ($2, bin, id) => {
            $2.match(laneIndex.tryGet(bin.lane), {
                some: ($3, lane) => {
                    const offset = $3.const(step(context.lanes.get(lane).offset));
                    const since = $3.const(day.durationMilliseconds(bin.at).subtract(offset).add(600_000n));
                    const index = $3.const(East.max(since, $3.const(0n, IntegerType)).divide(every).remainder(count));
                    $3(held.get(lane).get(index).pushLast(id));
                },
            });
        });
        const out = $.let([], ArrayType(AllocationSlotType));
        $.for(context.lanes, ($2, lane, li) => {
            const offset = $2.const(step(lane.offset));
            $2.for(held.get(li), ($3, ids, k) => {
                const sorted = $3.const(ids.sort(($4, id) => ({ at: plan.bins.get(id).at, id })));
                const booked = $3.const(sorted.some(($4, id) => plan.bins.get(id).arrival.hasTag("some")));
                $3(out.pushLast({
                    lane: lane.key, at: day.addMilliseconds(k.multiply(every).add(offset)),
                    status: booked.ifElse(
                        () => East.value(variant("booked", null), AllocationSlotType.fields.status),
                        () => East.greater(sorted.size(), 0n).ifElse(
                            () => East.value(variant("reserved", null), AllocationSlotType.fields.status),
                            () => East.value(variant("free", null), AllocationSlotType.fields.status))),
                    bins: sorted,
                }));
            });
        });
        return out.sort(($2, slot) => ({ at: slot.at, lane: laneIndex.get(slot.lane) }));
    }) as unknown as ExprType<FunctionType<[DateTimeType, AllocationDayType<R>, ContextType], ArrayType<typeof AllocationSlotType>>>;
}

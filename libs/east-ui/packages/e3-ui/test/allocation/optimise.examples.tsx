/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
/**
 * The Allocation's optimiser (#1409, `Optimise Spec.md` §3): the kiln yard's
 * day in, the day out — `Allocation.Types.OptimiseRequest(KilnBin)` to
 * `Allocation.Types.OptimiseResult(KilnBin)`, an `e3.function` — bound to the
 * board's `optimise`, which the Elara eye calls once per run and whose answer
 * lands in the session as one edit. It is a joint optimiser: one run decides
 * both where a load is booked — its bay slot — and where it goes — its kilns —
 * for the loads still waiting and for the bins the day already holds, so an
 * answer books, links, relinks, or any mix, and a load no kiln can take is
 * booked on none.
 */
import { DateTimeType, DictType, East, FloatType, OptionType, SetType, StringType, StructType, example, none, some, variant } from "@elaraai/east";
import e3 from "@elaraai/e3";
import { Box, Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
import { Allocation, Data, Func, Record, Schedule } from "@elaraai/e3-ui";
import { KilnBin, YardPlan, yardDay } from "./kiln-yard.js";
import {
    arrivals, arrivalsBySpec, kilnBins, kilnBinsByTime, kilnBinsPatch, kilns, kilnsByGroup, yardBays, yardBaysByArea, yardDays, yardDaysPatch, yardFit,
} from "./allocation.examples.js";

const Request = Allocation.Types.OptimiseRequest(KilnBin), Result = Allocation.Types.OptimiseResult(KilnBin);
/** The day's bins by key, the yard's own rows. */
const Bins = DictType(StringType, KilnBin);
/** A bin's split across kilns: its quantity on each. */
const Kilns = DictType(StringType, FloatType);
/** One part a run places: a quantity on a kiln. */
const Part = StructType({ kiln: StringType, quantity: FloatType });

/** The day as the board reads it, from the bins as they stand: each bin its roles and its own row. */
const dayOf = East.function([Bins], YardPlan, ($, rows) => $.const({
    status: variant("draft", null),
    bins: rows.toDict(($2, _bin, key) => key, ($2, bin) => ({ lane: bin.bay, at: bin.at, arrival: bin.load, quantity: bin.m3, kind: bin.spec, hold: bin.dryFor, parts: bin.kilns, row: bin })),
}, YardPlan));
/** A bin's row with its kilns replaced, the yard's own fields kept. */
const withKilns = East.function([KilnBin, Kilns], KilnBin, (_$, bin, kilns) => ({
    bay: bin.bay, at: bin.at, load: bin.load, m3: bin.m3, spec: bin.spec, dryFor: bin.dryFor, kilns,
    specBooked: bin.specBooked, specMeasured: bin.specMeasured, gradeBooked: bin.gradeBooked, gradeMeasured: bin.gradeMeasured, instruction: bin.instruction,
}));
/** A bin's kilns with a quantity added to one of them — or taken off it, for a quantity below zero. */
const addPart = East.function([Kilns, StringType, FloatType], Kilns, ($, held, kiln, quantity) => {
    const kilns = $.let(new Map(), Kilns);
    $.for(held, ($2, part, key) => { $2(kilns.insert(key, part)); });
    $(kilns.insertOrUpdate(kiln, quantity, (_$2, part, more) => part.add(more)));
    return kilns;
});
/**
 * Places a quantity of a bin's on the kilns the fit ranks best — whole on the best fit; failing that, split, the kiln
 * with the most room first, until nothing has room — writing each part into the bin's row as it goes. The fit is asked
 * about the bin itself, its own spec and drying time, over the day as the bins stand with the bin once more under a
 * key of its own: a place's candidates leave the subject's parts out of the kilns' loads, and the copy puts them back,
 * so a kiln's room is what the day leaves it, the bin's parts there included.
 *
 * @returns The bins with the parts written, and how much of the quantity found a kiln
 */
const settle = East.function([DateTimeType, Allocation.Types.Context, Bins, StringType, FloatType], StructType({ bins: Bins, placed: FloatType }),
    ($, day, context, held, id, quantity) => {
        const candidatesOf = $.const(Allocation.candidates(KilnBin));
        const rule = $.const(Allocation.fit);
        const planOf = $.const(dayOf);
        const rowWith = $.const(withKilns);
        const partOn = $.const(addPart);
        const bins = $.let(new Map(), Bins);
        $.for(held, ($2, bin, key) => { $2(bins.insert(key, bin)); });
        const remaining = $.let(quantity, FloatType);
        $.while(East.greater(remaining, 0.0), ($2, loop) => {
            const rows = $2.let(new Map(), Bins);
            $2.for(bins, ($3, bin, key) => { $3(rows.insert(key, bin)); });
            $2(rows.insert(East.str`${id}·`, bins.get(id)));
            const request = $2.const({ day, plan: planOf(rows), ask: variant("place", { subject: variant("bin", id), quantity: remaining }), context },
                Allocation.Types.FitRequest(KilnBin));
            const best = $2.let(none, OptionType(StringType)), bestScore = $2.let(0.0, FloatType);
            const roomiest = $2.let(none, OptionType(StringType)), room = $2.let(0.0, FloatType);
            $2.for(candidatesOf(request), ($3, candidate) => {
                const kiln = $3.const(candidate.resource.key);
                $3.match(rule(candidate), {
                    fits: ($4, fit) => {
                        $4.if(best.hasTag("none").or(() => East.greater(fit.score, bestScore)), ($5) => { $5.assign(best, some(kiln)); $5.assign(bestScore, fit.score); });
                    },
                    refused: ($4, refusal) => {
                        // Refused for the quantity alone: a part of it, what the kiln has room for, would fit.
                        const spare = $4.const(candidate.resource.max.subtract(candidate.after.subtract(candidate.quantity)));
                        $4.if(East.equal(refusal.group, "Over max").and(() => East.greater(spare, room)), ($5) => { $5.assign(roomiest, some(kiln)); $5.assign(room, spare); });
                    },
                });
            });
            const chosen = $2.let(none, OptionType(Part));
            $2.match(best, {
                some: ($3, kiln) => { $3.assign(chosen, some({ kiln, quantity: remaining })); },
                none: ($3) => { $3.match(roomiest, { some: ($4, kiln) => { $4.assign(chosen, some({ kiln, quantity: room })); } }); },
            });
            $2.match(chosen, {
                none: ($3) => { $3.break(loop); },
                some: ($3, part) => {
                    const bin = $3.const(bins.get(id));
                    $3(bins.insertOrUpdate(id, rowWith(bin, partOn(bin.kilns, part.kiln, part.quantity)), (_$4, _was, next) => next));
                    $3.assign(remaining, remaining.subtract(part.quantity));
                },
            });
        });
        return { bins, placed: quantity.subtract(remaining) };
    });

/**
 * The yard's optimiser's body, in three passes over the day as drafted, every bin it held kept in its slot. First the
 * kilns: one over its maximum gives the excess of its latest bin — the check's own fix, Move — to the kilns the fit ranks
 * best. Then the bins: one not linked, or partly allocated, gets what its parts leave of it placed the same way. Then the
 * loads: every one not yet booked, in the loads' order, is booked into the day's first free bay slot — its m³, its spec
 * and its drying time the load's, its spec booked as measured, under a key of the run's own — and placed on the kilns
 * the fit ranks best. A quantity goes whole onto the best fit (`Allocation.fit`: never a busy kiln, never one whose next
 * job its hold runs into, never over a maximum); when no kiln takes it whole it is split, the kiln with the most room
 * first; what no kiln has room for stays unallocated, for the planner. A run that finds nothing to do answers the day as
 * it was.
 */
export const allocationOptimiseBody = East.function([Request], Result, ($, req) => {
    const loadsOf = $.const(Allocation.loads(KilnBin));
    const checkOf = $.const(Allocation.check(KilnBin));
    const slotsOf = $.const(Allocation.slots(KilnBin));
    const planOf = $.const(dayOf);
    const rowWith = $.const(withKilns);
    const partOn = $.const(addPart);
    const place = $.const(settle);
    const day = $.const(req.day), context = $.const(req.context);
    const bins = $.let(new Map(), Bins);
    $.for(req.bins, ($2, bin, key) => { $2(bins.insert(key, bin)); });
    // The kilns: one over its maximum gives the excess of its latest bin — the check's fix, Move — to the kilns the fit
    // ranks best; its part there shrinks by what found room, and what found none stays, over, for the planner.
    $.for(checkOf(day, planOf(bins), context), ($2, issue) => {
        $2.match(issue.kind, { over: ($3) => {
            $3.match(issue.resource, { some: ($4, kiln) => {
                $4.match(issue.fix, { some: ($5, fix) => {
                    $5.match(fix, { move: ($6, id) => {
                        const bin = $6.const(bins.get(id));
                        const over = $6.const(loadsOf(day, planOf(bins), context).get(kiln).fill.subtract(context.resources.get(kiln).max));
                        const excess = $6.const(East.min(over, bin.kilns.get(kiln, () => 0.0)));
                        $6.if(East.greater(excess, 0.0), ($7) => {
                            const settled = $7.const(place(day, context, bins, id, excess));
                            $7.assign(bins, settled.bins);
                            const moved = $7.const(bins.get(id));
                            const kilns = $7.let(partOn(moved.kilns, kiln, settled.placed.negate()));
                            $7.if(East.lessEqual(kilns.get(kiln), 0.0), ($8) => { $8(kilns.delete(kiln)); });
                            $7(bins.insertOrUpdate(id, rowWith(moved, kilns), (_$8, _was, next) => next));
                        });
                    } });
                } });
            } });
        } });
    });
    // The bins: one not linked, or partly allocated, gets what its parts leave of it placed; a reservation holds nothing.
    $.for(req.bins, ($2, _held, id) => {
        const bin = $2.const(bins.get(id));
        const allocated = $2.let(0.0, FloatType);
        $2.for(bin.kilns, ($3, held) => { $3.assign(allocated, allocated.add(held)); });
        const left = $2.const(bin.m3.subtract(allocated));
        $2.if(East.greater(left, 0.0), ($3) => { $3.assign(bins, place(day, context, bins, id, left).bins); });
    });
    // The loads: every one not yet booked, in the loads' order, into the day's first free bay slot — its m³, its spec and
    // its drying time the load's, its spec booked as measured, under a key of the run's own — and onto the kilns.
    const booked = $.let(new Set<string>(), SetType(StringType));
    $.for(bins, ($2, bin) => {
        // A load may be booked in two bins, a batch's: once in the set.
        $2.match(bin.load, { some: ($3, load) => { $3.if(booked.has(load).not(), ($4) => { $4(booked.insert(load)); }); } });
    });
    const free = $.const(slotsOf(day, planOf(bins), context).filter(($2, slot) => slot.status.hasTag("free")));
    const waiting = $.const(req.arrivals.filter(($2, load) => booked.has(load.key).not()));
    $.for(waiting, ($2, load, i) => {
        $2.if(i.less(free.size()), ($3) => {
            const slot = $3.const(free.get(i));
            const spec = $3.const(load.kind.unwrap("some", () => ""));
            const id = $3.const(East.str`elara-${req.run}-${load.key}`);
            $3(bins.insert(id, {
                bay: slot.lane, at: slot.at, load: some(load.key), m3: load.quantity, spec: load.kind, dryFor: load.hold, kilns: new Map(),
                specBooked: spec, specMeasured: spec, gradeBooked: "", gradeMeasured: "", instruction: none,
            }));
            $3.assign(bins, place(day, context, bins, id, load.quantity).bins);
        });
    });
    return { bins };
});
/** The yard's optimiser, on e3: the day's bins in, the day's bins out — the kilns' overloads moved, the day's links mended, every waiting load booked into a free bay slot and onto the kilns the fit ranks best. */
export const yardOptimise = e3.function("yard_optimise", allocationOptimiseBody);

export const allocationOptimise = example({
    description: "The kiln yard's board with the Elara eye (#1409): `optimise` is Func.bind of the yard's optimiser on e3 — Allocation.Types.OptimiseRequest(KilnBin) in, the day in view, the run number, the day's bins as drafted, every arrival and the board's context; Allocation.Types.OptimiseResult(KilnBin) out, the bins complete. A joint optimiser: a kiln over its maximum gives the excess to the kilns the fit ranks best, a bin not linked or partly allocated is linked, and every load not yet booked is booked into the day's free bay slots and onto the kilns the fit ranks best — whole on the best fit, split when no one kiln takes it. A click on the eye runs it once over the day; the result lands in the session as one edit — bins added, bins relinked — which one Undo reverts and Save commits with everything else.",
    keywords: ["Allocation", "optimise", "Optimise", "Elara", "OptimiseRequest", "OptimiseResult", "Func.bind", "e3.function", "joint", "links", "one edit", "Undo", "Schedule.events", "Schedule.resources", "Schedule.periods", "Allocation.arrivals", "Allocation.slots", "Allocation.candidates", "Allocation.fit", "Allocation.check", "fit"], inputs: [],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const bins = $.let(Record.bind(kilnBins, [kilnBinsPatch]));
        const entries = $.let(Data.bindPaged(kilnBins));
        const byTime = $.let(Data.bindPaged(kilnBins, { indexes: [kilnBinsByTime] }));
        const days = $.let(Record.bind(yardDays, [yardDaysPatch]));
        // Every bay, kiln and load is the calculation scope — and the optimiser's: the narrowing only chooses which show.
        const yard = $.let(Data.bind(kilns));
        const loads = $.let(Data.bind(arrivals));
        const bays = $.let(Data.bind(yardBays));
        const bayIndex = $.let(Data.bindPaged(yardBays, { indexes: [yardBaysByArea] }));
        const kilnIndex = $.let(Data.bindPaged(kilns, { indexes: [kilnsByGroup] }));
        const loadIndex = $.let(Data.bindPaged(arrivals, { indexes: [arrivalsBySpec] }));
        const slice = $.let(Slice.bindRecords("ex.allocationOptimise", {
            bin: { source: byTime, range: "at" },
            bays: { source: bayIndex, fields: { area: { label: "Area", hints: ["North", "South"] } } },
            kilns: { source: kilnIndex, fields: { group: { label: "Kiln group", hints: ["Hall A", "Hall B", "Compact", "Standard", "Large", "Bulk"] } } },
            arrivals: { source: loadIndex, fields: { spec: { label: "Spec", hints: ["MC08", "MC10", "MC12", "MC14", "MC16", "MC18", "MC20", "MC22"] } } },
        }));
        const fit = $.let(Func.bind(yardFit));
        // The app's optimiser: the eye calls it once per run over the day in view, and its answer is one edit.
        const optimise = $.let(Func.bind(yardOptimise));
        return <Box width="100%" height="900px"><Allocation id="allocationOptimise" title="Kiln loading" fit={fit} optimise={optimise} slice={{ slice }} inspector
            library={[Allocation.library.arrivals(), Allocation.library.resources()]} view={{ layout: "timeline", date: yardDay }}
            events={{ bin: Schedule.events(bins, {
                name: "Bin", icon: "box", entries,
                at: "at", resource: { field: "bay", of: "bays" }, arrival: "load",
                quantity: { field: "m3", unit: "m³" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor", kind: "spec",
                fields: { specMeasured: Schedule.field.text({ label: "Spec measured" }), instruction: Schedule.field.text({ label: "Loading instruction" }) },
            }) }}
            resources={{
                bays: Schedule.resources(bays.read(), { name: "Bays", icon: "warehouse", label: b => b.name, offset: b => b.offset }),
                kilns: Schedule.resources(yard.read(), { name: "Kilns", icon: "fire", label: k => k.name, group: k => k.group,
                    meta: k => some(East.str`${k.group} · ${East.Float.roundHalf(k.max)} m³`), note: k => k.note,
                    min: k => k.min, max: k => k.max, hold: k => variant("days", k.days), jobs: k => k.charges }),
            }}
            arrivals={Allocation.arrivals(loads.read(), {
                label: l => l.code, meta: l => some(East.str`${l.mill} · ${l.grade} · spec ${l.spec}`),
                quantity: l => l.m3, hold: l => variant("days", l.dryingDays), kind: l => some(l.spec),
                due: l => some(l.due), window: l => some({ from: l.from, to: l.to }),
                details: l => [{ label: "Settings", value: l.schedule }],
                values: l => ({ specBooked: l.spec, specMeasured: l.spec, gradeBooked: l.grade.substring(0n, 1n), gradeMeasured: l.grade, instruction: l.instruction }),
            })}
            periods={Schedule.periods(days, { every: "day", status: { field: "state", draft: "draft", published: "issued" } })} />
        </Box>;
    }}</Reactive>),
});

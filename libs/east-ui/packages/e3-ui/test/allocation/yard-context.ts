/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * The kiln yard's context, as the board sends it beside a fit's and a check's
 * request (#1371): its bays, its loads and its kilns, read through the
 * Allocation's own adapters of the yard's rows, with the accessors the kiln
 * yard's examples give them.
 */
import { DictType, East, StringType, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Allocation, Schedule } from "@elaraai/e3-ui";
import { allocationArrivalsOf, allocationLanesOf, allocationResourcesOf } from "@elaraai/e3-ui/internal";
import { Bay, Kiln, TimberLoad, yardArrivals, yardBayRows, yardKilns } from "./kiln-yard.js";

/** The context, from the yard's bays, loads and kilns. */
const contextOf = East.compile(East.function([DictType(StringType, Bay), DictType(StringType, TimberLoad), DictType(StringType, Kiln)], Allocation.Types.Context,
    ($, bays, loads, yard) => {
        const lanes = $.const(allocationLanesOf(Schedule.resources(bays, { name: "Bays", icon: "warehouse", label: b => b.name, offset: b => b.offset })));
        const arrivals = $.const(allocationArrivalsOf(Allocation.arrivals(loads, {
            label: l => l.code, meta: l => some(East.str`${l.mill} · ${l.grade} · spec ${l.spec}`),
            quantity: l => l.m3, hold: l => variant("days", l.dryingDays), kind: l => some(l.spec),
            due: l => some(l.due), window: l => some({ from: l.from, to: l.to }), details: l => [{ label: "Settings", value: l.schedule }],
        })));
        const resources = $.const(allocationResourcesOf(Schedule.resources(yard, {
            name: "Kilns", icon: "fire", label: k => k.name, group: k => k.group, meta: k => some(East.str`${k.group} · ${East.Float.roundHalf(k.max)} m³`),
            note: k => k.note, min: k => k.min, max: k => k.max, hold: k => variant("days", k.days), jobs: k => k.charges,
        })));
        return {
            lanes, every: variant("hours", 1.0),
            arrivals: arrivals.toDict(($2, a) => a.key, ($2, a) => a), resources: resources.toDict(($2, r) => r.key, ($2, r) => r),
            rules: { under: true }, unit: "m³",
        };
    }), []);

/** The kiln yard's context: its three bays, its 27 loads and its 33 kilns, every rule on, its quantities in m³. */
export const yardContext: ValueTypeOf<typeof Allocation.Types.Context> = contextOf(yardBayRows, yardArrivals, yardKilns);

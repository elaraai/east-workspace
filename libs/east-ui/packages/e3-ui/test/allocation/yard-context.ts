/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * The kiln yard's context, as the board sends it beside a fit's and a check's
 * request (#1371): its bays, its loads and its kilns, read through
 * `Allocation.context` (#1622) — the board's own adapters — with the
 * accessors the kiln yard's examples give them.
 */
import { DictType, East, StringType, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Allocation, Schedule } from "@elaraai/e3-ui";
import { Bay, Kiln, TimberLoad, yardArrivals, yardBayRows, yardKilns } from "./kiln-yard.js";

/** The context, from the yard's bays, loads and kilns. */
const contextOf = East.compile(East.function([DictType(StringType, Bay), DictType(StringType, TimberLoad), DictType(StringType, Kiln)], Allocation.Types.Context,
    (_$, bays, loads, yard) => Allocation.context({
        lanes: Schedule.resources(bays, { name: "Bays", icon: "warehouse", label: b => b.name, offset: b => b.offset }),
        arrivals: Allocation.arrivals(loads, {
            label: l => l.code, meta: l => some(East.str`${l.mill} · ${l.grade} · spec ${l.spec}`),
            quantity: l => l.m3, hold: l => variant("days", l.dryingDays), kind: l => some(l.spec),
            due: l => some(l.due), window: l => some({ from: l.from, to: l.to }), details: l => [{ label: "Settings", value: l.schedule }],
        }),
        resources: Schedule.resources(yard, {
            name: "Kilns", icon: "fire", label: k => k.name, group: k => k.group, meta: k => some(East.str`${k.group} · ${East.Float.roundHalf(k.max)} m³`),
            note: k => k.note, min: k => k.min, max: k => k.max, hold: k => variant("days", k.days), jobs: k => k.charges,
        }),
        unit: "m³",
    })), []);

/** The kiln yard's context: its three bays, its 27 loads and its 33 kilns, every rule on, its quantities in m³. */
export const yardContext: ValueTypeOf<typeof Allocation.Types.Context> = contextOf(yardBayRows, yardArrivals, yardKilns);

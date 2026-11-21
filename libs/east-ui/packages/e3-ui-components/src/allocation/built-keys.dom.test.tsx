/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * A board whose bin kind builds each bin's key from its row (`key`,
 * east-workspace#1709), over the smallest board's bins on e3 itself: a bin
 * keyed by its bay and how many kilns it is linked to. Unlinked, a bin moves
 * under the key it then builds, still selected, and Save writes it there; a
 * second bin of the bay, unlinked, would build that key too, and is refused,
 * the board saying whose key it is.
 */
import { expect, test } from "vitest";
import { waitFor } from "@testing-library/react";
import { East, equalFor, variant } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { Allocation, Data, Func, Record, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import * as fx from "@elaraai/e3-ui/fixtures/allocation/allocation-bounds";
import { e3Harness } from "../e3-web-mount.test-utils.js";
import { TUE } from "./harness.test-utils.js";
import { button, card, details, press, save } from "./inspector.test-utils.js";

const h = e3Harness({ "allocation/allocation": ex, "allocation/allocation-bounds": fx }, { main: "data-allocation-main" });
const sameBin = equalFor(fx.MoistureBin);

/** The smallest board over the bins, each keyed by its bay and the kilns it is linked to: `B-2/1`. */
const keyedYard = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const bins = $.let(Record.bind(fx.moistureBins, ["patch"]));
    const loads = $.let(Data.bind(ex.arrivals));
    const yard = $.let(Data.bind(ex.kilns));
    const bays = $.let(Data.bind(ex.yardBays));
    const fit = $.let(Func.bind(fx.moistureFit));
    return Allocation({
        id: "keyedYard", fit, inspector: true, view: { layout: "timeline", date: TUE },
        events: { bin: Schedule.events(bins, {
            name: "Bin", icon: "box",
            at: "at", resource: { field: "bay", of: "bays" }, arrival: "load",
            quantity: { field: "m3", unit: "m³" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor",
            key: (bin) => East.str`${bin.bay}/${bin.kilns.size()}`,
        }) },
        resources: {
            bays: Schedule.resources(bays.read(), { name: "Bays", icon: "warehouse", label: b => b.name, offset: b => b.offset }),
            kilns: Schedule.resources(yard.read(), { name: "Kilns", icon: "fire", label: k => k.name, min: k => k.min, max: k => k.max, jobs: k => k.charges }),
        },
        arrivals: Allocation.arrivals(loads.read(), { label: l => l.code, quantity: l => l.m3, hold: l => variant("days", l.dryingDays) }),
    });
}))) };

test("ruling 1 — a bin unlinked moves under the key its bay and its links then build, still selected; a second bin of the bay, which would build that key too, is refused, the board saying whose key it is; and Save writes the bin under its new key", async () => {
    const { container: c } = await h.mount(keyedYard);
    await waitFor(() => expect(card(c, "3113")).not.toBeNull());
    const before = await h.read(fx.moistureBins);
    // 3113 stands in bay B-2, linked to one kiln: unlinked, its row builds B-2/0.
    await press(card(c, "3113"));
    await press(button(details(c), "Unlink"));
    expect([card(c, "3113"), card(c, "B-2/0") !== null]).toEqual([null, true]);
    // Its Details are open on it still: what it holds is unallocated, and can be linked again.
    expect(details(c).querySelector("[data-allocation-bin-actions]")).not.toBeNull();
    // 3115 stands in B-2 too, on one kiln: unlinked, it would build B-2/0 as well.
    await press(card(c, "3115"));
    await press(button(details(c), "Unlink"));
    expect([...c.querySelectorAll("[role='alert']")].map(alert => alert.textContent)).toContain('Another bin is keyed "B-2/0" already');
    await press(save(c));
    await waitFor(async () => expect((await h.read(fx.moistureBins)).has("B-2/0")).toBe(true));
    const saved = await h.read(fx.moistureBins);
    expect([saved.has("3113"), saved.get("B-2/0")!.kilns.size, sameBin(saved.get("3115")!, before.get("3115")!), saved.size]).toEqual([false, 0, true, before.size]);
});

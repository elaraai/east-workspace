/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * A bin's number outside its field's bounds (#1585), over the smallest
 * board's bins on e3 itself, each with the moisture its load measured on
 * arrival, in a test's own board whose bin form holds it to at most 18: bin
 * 3113's is stored at 21. Stored, its card wears the warn ring and Issues
 * warns of it, holding no Save — another bin's change saves; unlinked, Issues
 * says it among what is not saved yet, by the field's label and the bound in
 * its hint's own words, and Save waits, the ring kept.
 */
import { expect, test } from "vitest";
import { waitFor } from "@testing-library/react";
import { East, variant } from "@elaraai/east";
import { Fields, Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { Allocation, Data, Func, Record, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import * as fx from "@elaraai/e3-ui/fixtures/allocation/allocation-bounds";
import { e3Harness } from "../e3-web-mount.test-utils.js";
import { TUE } from "./harness.test-utils.js";
import { button, card, details, issuesTab, press, save, tab } from "./inspector.test-utils.js";

const h = e3Harness({ "allocation/allocation": ex, "allocation/allocation-bounds": fx }, { main: "data-allocation-main" });

/** The smallest board over the bins and their moisture, the bin form holding it to at most 18. */
const moistureYard = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const bins = $.let(Record.bind(fx.moistureBins, ["patch"]));
    const loads = $.let(Data.bind(ex.arrivals));
    const yard = $.let(Data.bind(ex.kilns));
    const bays = $.let(Data.bind(ex.yardBays));
    const fit = $.let(Func.bind(fx.moistureFit));
    return Allocation({
        id: "moistureYard", fit, inspector: true, view: { layout: "timeline", date: TUE },
        events: { bin: Schedule.events(bins, {
            name: "Bin", icon: "box",
            at: "at", resource: { field: "bay", of: "bays" }, arrival: "load",
            quantity: { field: "m3", unit: "m³" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor",
            fields: { moisture: Fields.number({ label: "Moisture", max: 18.0 }) },
        }) },
        resources: {
            bays: Schedule.resources(bays.read(), { name: "Bays", icon: "warehouse", label: b => b.name, offset: b => b.offset }),
            kilns: Schedule.resources(yard.read(), { name: "Kilns", icon: "fire", label: k => k.name, min: k => k.min, max: k => k.max, jobs: k => k.charges }),
        },
        arrivals: Allocation.arrivals(loads.read(), { label: l => l.code, quantity: l => l.m3, hold: l => variant("days", l.dryingDays) }),
    });
}))) };

/** The refusals holding Save Issues lists: each one's bin and what it says. */
const refusals = (c: HTMLElement) => [...issuesTab(c).querySelectorAll('[data-allocation-issue="refusal"]')]
    .map((el) => [el.querySelector("[title]")?.textContent, el.lastElementChild?.textContent]);
/** Issues' numbers out of range: each one's bin and what it says, and its group's tone. */
const outOfRange = (c: HTMLElement) => {
    const group = issuesTab(c).querySelector('[data-allocation-issue-group="custom:Out of range"]');
    return group === null ? [] : [...group.querySelectorAll('[data-allocation-issue="custom"]')]
        .map((el) => [el.querySelector("[title]")?.textContent, el.lastElementChild?.textContent, group.firstElementChild?.getAttribute("data-tone")]);
};
/** Whether a bin's card wears the warn ring of a broken bound. */
const ringed = (c: HTMLElement, id: string) => card(c, id).hasAttribute("data-bounds");

test("a stored bin's moisture over its most wears the warn ring and is a warning in Issues, holding no Save — another bin's change saves; unlinked, Issues says it among what is not saved yet and Save waits, the ring kept (#1585)", async () => {
    const { container: c } = await h.mount(moistureYard);
    await waitFor(() => expect(card(c, "3113")).not.toBeNull());
    expect([ringed(c, "3113"), ringed(c, "3111")]).toEqual([true, false]);
    // Stored: Issues warns of it, and nothing holds Save.
    await tab(c, "Issues");
    expect([refusals(c), outOfRange(c)]).toEqual([[], [["LD-2210", "Moisture: at most 18", "warning"]]]);
    // Another bin's change saves: the stored breach holds nothing.
    await press(card(c, "3111"));
    await press(button(details(c), "Unlink"));
    expect(save(c)).toHaveProperty("disabled", false);
    // 3113 unlinked: its breach is what is not saved yet, Save waits, and its card keeps the ring.
    await press(card(c, "3113"));
    await press(button(details(c), "Unlink"));
    expect(save(c)).toHaveProperty("disabled", true);
    await tab(c, "Issues");
    expect([refusals(c), outOfRange(c)]).toEqual([[["LD-2210", "Moisture: at most 18"]], []]);
    expect(ringed(c, "3113")).toBe(true);
});

/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * A bin's quantity outside the bounds a hint gives it (#1585), over the kiln
 * yard on e3 itself, a hint holding a bin to at most 40 m³: LD-2204's bin
 * 3104 is stored at 47. Stored, Details says it under the bin's quantity and
 * it holds no Save — another bin's change saves; its own measured spec
 * retyped, Save waits, Issues saying it among what is not saved yet, by the
 * hint's label, in its own words. A hint holding a bin to at least 1 m³ holds
 * a bin of none so too — its card ringed and Issues warning of it while it is
 * stored — but never a reservation, which holds no quantity until a load is
 * booked into it: no ring, no warning and no wait, changed or saved.
 */
import { expect, test } from "vitest";
import { within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SortedMap } from "@elaraai/east";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import { dayKey } from "./model.js";
import { allocationHarness, kilnYard, offering, settle } from "./harness.test-utils.js";
import { button, byKey, card, details, hour, issuesTab, pane, press, save, tab, tableRow, toolbar } from "./inspector.test-utils.js";

const h = allocationHarness();

/** The line under the selected bin's quantity. */
const said = (c: HTMLElement) => details(c).querySelector('[data-allocation-bin-section] [data-field="quantity"] [data-scope=field][data-part=error-text]')?.textContent;
/** Retypes the selected bin's measured spec, committed with Enter. */
async function retype(c: HTMLElement, user: ReturnType<typeof userEvent.setup>, text: string) {
    const spec = within(details(c).querySelector<HTMLElement>('[data-field="specMeasured"]')!).getByRole("textbox");
    await user.clear(spec);
    await user.type(spec, `${text}{Enter}`);
    await settle();
}
/** What Issues says is not saved yet: each refusal's bin and its words. */
const refusals = (c: HTMLElement) => [...issuesTab(c).querySelectorAll<HTMLElement>('[data-allocation-issue="refusal"]')]
    .map(refusal => [refusal.querySelector("[title]")?.textContent, refusal.lastElementChild?.textContent]);
/** Issues' numbers out of range: each one's bin and what it says, and its group's tone. */
const outOfRange = (c: HTMLElement) => {
    const group = issuesTab(c).querySelector('[data-allocation-issue-group="custom:Out of range"]');
    return group === null ? [] : [...group.querySelectorAll('[data-allocation-issue="custom"]')]
        .map(issue => [issue.querySelector("[title]")?.textContent, issue.lastElementChild?.textContent, group.firstElementChild?.getAttribute("data-tone")]);
};
/** Whether an element of a bin — its Timeline card, its Table row — wears the warn ring of a broken bound. */
const ringed = (el: HTMLElement) => el.hasAttribute("data-bounds");

test("a stored bin past its most: Details says it under its quantity and it holds no Save — another bin's change saves; its own spec retyped, Save waits and Issues says it (#1585)", async () => {
    const c = (await h.mount(kilnYard({ most: 40 }))).container;
    const user = userEvent.setup();
    // Another bin's change saves: the stored breach holds nothing.
    await press(card(c, "3113"));
    expect(said(c)).toBeUndefined();
    await retype(c, user, "MC08");
    expect(save(c)).toHaveProperty("disabled", false);
    // Stored: the line under its quantity.
    await press(card(c, "3104"));
    expect(said(c)).toBe("at most 40");
    // Its own spec retyped: Save waits, and Issues says why.
    await retype(c, user, "MC12");
    expect(save(c)).toHaveProperty("disabled", true);
    await tab(c, "Issues");
    expect(refusals(c)).toEqual([["LD-2204", "Volume: at most 40"]]);
});

test("a bin of 0 m³ under a least of 1 rings, warns and waits as one past its most does, but never a reservation, which holds no quantity until a load is booked into it (#1585)", async () => {
    // Another session empties LD-2204's bin 3104, on K-501 still.
    const bins = await h.read(ex.kilnBins);
    bins.set("3104", { ...bins.get("3104")!, m3: 0, kilns: new SortedMap([["K-501", 0]], byKey) });
    await h.patch(ex.kilnBins, bins);
    const c = (await h.mount(kilnYard({ least: 1 }))).container;
    const user = userEvent.setup();
    /** The bin of none, as Issues warns of it while it is stored. */
    const emptied = [["LD-2204", "Volume: at least 1", "warning"]];
    // Stored, the bin of none wears the warn ring, and Issues warns of it alone, holding no Save.
    expect([ringed(card(c, "3104")), ringed(card(c, "3113"))]).toEqual([true, false]);
    await tab(c, "Issues");
    expect([refusals(c), outOfRange(c)]).toEqual([[], emptied]);
    // A reservation holds 0 m³: no ring, Save waits for nothing, and Issues says nothing of it — nor once it is saved.
    await tab(c, "Details");
    await press(toolbar(c).getByRole("radio", { name: "Table" }));
    await press(tableRow(c, `slot:B-1|${dayKey(hour(0, 15))}`).querySelector("span"));
    offering(["V1"]);
    await press(button(pane(c).querySelector<HTMLElement>('[data-allocation-reserve] [data-allocation-option="K-305"]')!, "Reserve"));
    expect(ringed(tableRow(c, "bin:V1"))).toBe(false);
    expect(save(c)).toHaveProperty("disabled", false);
    await tab(c, "Issues");
    expect([refusals(c), outOfRange(c)]).toEqual([[], emptied]);
    await press(save(c));
    expect((await h.read(ex.kilnBins)).has("V1")).toBe(true);
    expect(ringed(tableRow(c, "bin:V1"))).toBe(false);
    await tab(c, "Issues");
    expect([refusals(c), outOfRange(c)]).toEqual([[], emptied]);
    // The bin of none: the line under its quantity; its spec retyped, Save waits, Issues saying it alone among what is
    // not saved yet, and its card keeps the ring.
    await tab(c, "Details");
    await press(toolbar(c).getByRole("radio", { name: "Timeline" }));
    await press(card(c, "3104"));
    expect(said(c)).toBe("at least 1");
    await retype(c, user, "MC12");
    expect(save(c)).toHaveProperty("disabled", true);
    await tab(c, "Issues");
    expect([refusals(c), outOfRange(c)]).toEqual([[["LD-2204", "Volume: at least 1"]], []]);
    expect(ringed(card(c, "3104"))).toBe(true);
});

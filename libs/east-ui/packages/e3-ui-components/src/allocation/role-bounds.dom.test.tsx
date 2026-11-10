/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * A bin's quantity outside the bounds a hint gives it (#1585), over the kiln
 * yard on e3 itself, a hint holding a bin to at most 40 m³: LD-2204's bin
 * 3104 is stored at 47. Stored, Details says it once, in the help line of the
 * bin's quantity, as a warning, and it holds no Save — another bin's change
 * saves; its own measured spec retyped, Save waits, the help line an error,
 * Issues saying it among what is not saved yet, by the hint's label, in its
 * own words. A hint holding a bin to at least 1 m³ holds
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

/** What the selected bin's quantity says of its bound: the part of its help line said in a tone, and that tone — never a second line. */
const said = (c: HTMLElement) => {
    const quantity = details(c).querySelector('[data-allocation-bin-section] [data-field="quantity"]');
    const toned = quantity?.querySelector("[data-scope=field][data-part=helper-text] [data-breach]");
    expect(quantity?.querySelector("[data-scope=field][data-part=error-text]") ?? null).toBeNull();
    return toned === null || toned === undefined ? undefined : [toned.textContent, toned.getAttribute("data-breach")];
};
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

test("a stored bin past its most: Details says it once, as a warning, in its quantity's help line and it holds no Save — another bin's change saves; its own spec retyped, Save waits, the help line is an error and Issues says it (#1585)", async () => {
    const c = (await h.mount(kilnYard({ most: 40 }))).container;
    const user = userEvent.setup();
    // Another bin's change saves: the stored breach holds nothing.
    await press(card(c, "3113"));
    expect(said(c)).toBeUndefined();
    await retype(c, user, "MC08");
    expect(save(c)).toHaveProperty("disabled", false);
    // Stored: its quantity's help line, as a warning.
    await press(card(c, "3104"));
    expect(said(c)).toEqual(["0–40 m³ · step 1", "warn"]);
    // Its own spec retyped: Save waits, the help line is an error, and Issues says why.
    await retype(c, user, "MC12");
    expect(save(c)).toHaveProperty("disabled", true);
    expect(said(c)).toEqual(["0–40 m³ · step 1", "error"]);
    await tab(c, "Issues");
    expect(refusals(c)).toEqual([["LD-2204", "Volume: at most 40"]]);
});

test("the Inspector collapsed, the toolbar's issue pressed opens it, as its rail does, and the bin's quantity takes the keyboard (#1585)", async () => {
    const c = (await h.mount(kilnYard({ most: 40 }))).container;
    const user = userEvent.setup();
    await press(card(c, "3104"));
    await retype(c, user, "MC12");
    expect(save(c)).toHaveProperty("disabled", true);
    await press(within(pane(c)).getByRole("button", { name: "Collapse Inspector" }));
    expect(pane(c).hasAttribute("data-collapsed")).toBe(true);
    await press(c.querySelector('[data-frame-slot="toolbar"] [data-slot="historyIssues"] button'));
    const quantity = details(c).querySelector('[data-allocation-bin-section] [data-field="quantity"]');
    expect([pane(c).hasAttribute("data-collapsed"), quantity?.contains(document.activeElement) === true]).toEqual([false, true]);
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
    // The bin of none: its quantity's help line, as a warning; its spec retyped, Save waits, the help line an error, Issues
    // saying it alone among what is not saved yet, and its card keeps the ring.
    await tab(c, "Details");
    await press(toolbar(c).getByRole("radio", { name: "Timeline" }));
    await press(card(c, "3104"));
    expect(said(c)).toEqual(["at least 1 m³ · step 1", "warn"]);
    await retype(c, user, "MC12");
    expect(save(c)).toHaveProperty("disabled", true);
    expect(said(c)).toEqual(["at least 1 m³ · step 1", "error"]);
    await tab(c, "Issues");
    expect([refusals(c), outOfRange(c)]).toEqual([[["LD-2204", "Volume: at least 1"]], []]);
    expect(ringed(card(c, "3104"))).toBe(true);
});

/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The Roster's narrowing from outside its rail (#1342): a write to its people
 * source narrows the board by original keys through that source's own index,
 * and leaves coverage complete; with nothing chosen of the staff or the
 * activities, neither reads an index page — only the one-row primary page its
 * revision and total come from. The week's duties are read through their
 * own source, an interval index whose range the Roster's navigation writes
 * (#1369). While a narrowing is read, the week's duties are retained (#1398,
 * CL8): aria-disabled, focusable and selectable, every gesture refused until it
 * lands. The pages are e3's (#1376), read from the request log.
 */
import { expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { DateTimeType, OptionType, StringType, compareFor, printFor, some, variant } from "@elaraai/east";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { act, assignment, at, hover, narrow, open, press, release, rosterHarness, settle, slot, type Choice } from "./harness.test-utils.js";
const h = rosterHarness();
const byDate = compareFor(DateTimeType);
/** An activity's group, as the activities' rail field takes it. */
const group = printFor(OptionType(StringType));
/** Each read of an index's rows — a page, or several runs in one (#1351) — by the index's name. */
const indexPages = () => [...h.requests("page"), ...h.requests("runs")].flatMap(request => { const index = request.query.get("index"); return index === null ? [] : [index]; });
/** The pages read through an index of the staff's or the activities'. */
const narrowingPages = () => indexPages().filter(index => index !== ex.rosterDutiesByTime.name);

test("a people narrowing read while the week stands in keeps the week's rows, retained — stale, aria-disabled, never inert — until it lands (#1398, CL5, CL8)", async () => {
    const { container, store } = await open(ex.rosterWarehouse);
    const main = () => slot(container, "main").querySelector<HTMLElement>("[data-roster-main]")!;
    const duties = () => container.querySelectorAll("[data-roster-assignment]:not([data-request])").length;
    const before = duties();
    expect(before).toBeGreaterThan(1);
    // The staff index's reads held on their way to e3: the people's new membership is in flight.
    const held = h.e3.hold(request => request.query.get("index") === ex.rosterStaffByName.name);
    await narrow(store, "rosterWarehouse", "people", new Map<string, Choice>([["name", variant("prefix", "C. Clo")]]));
    expect([main().hasAttribute("data-roster-stale"), main().getAttribute("aria-disabled"), main().hasAttribute("inert")]).toEqual([true, "true", false]);
    // The week stands in, whole: every duty as it was, never a cover — and a duty still selects.
    expect(duties()).toBe(before);
    expect(container.querySelector("[data-builder-loading]")).toBeNull();
    await act(async () => { fireEvent.click(assignment(container, "s37")); });
    expect(assignment(container, "s37").getAttribute("aria-pressed")).toBe("true");
    await act(async () => { held.release(); });
    await settle();
    await waitFor(() => expect(duties()).toBe(1));
    expect([main().hasAttribute("data-roster-stale"), main().hasAttribute("aria-disabled"), main().hasAttribute("inert")]).toEqual([false, false, false]);
    // The selection is kept through it.
    expect(assignment(container, "s37").getAttribute("aria-pressed")).toBe("true");
});

test("an activities narrowing read keeps the week's duties retained (#1398, CL8): each focusable and selectable, its controls in place, its Remove refused and its drag picking nothing up, until it lands", async () => {
    const { container, store } = await open(ex.rosterWarehouse);
    const main = () => slot(container, "main").querySelector<HTMLElement>("[data-roster-main]")!;
    const duty = () => assignment(container, "s37");
    const remove = () => within(duty()).getByRole("button", { name: "Remove C. Clover" });
    // The activities index's reads held on their way to e3: the activities' new membership is in flight.
    const held = h.e3.hold(request => request.query.get("index") === ex.rosterActivitiesByGroup.name);
    await narrow(store, "rosterWarehouse", "activities", new Map<string, Choice>([["group", variant("values", [group(some("picking"))])]]));
    expect([main().hasAttribute("data-roster-stale"), main().getAttribute("aria-disabled"), main().hasAttribute("inert")]).toEqual([true, "true", false]);
    // Readable and focusable, and selectable.
    duty().focus();
    expect(document.activeElement).toBe(duty());
    await act(async () => { fireEvent.click(duty()); });
    expect(duty().getAttribute("aria-pressed")).toBe("true");
    // Its controls in place — every gesture refused: Remove removes nothing, and a drag picks nothing up.
    await press(remove());
    expect(duty().hasAttribute("data-removed")).toBe(false);
    await hover(duty(), main());
    expect(duty().hasAttribute("data-dragging")).toBe(false);
    await release();
    expect(duty().hasAttribute("data-removed")).toBe(false);
    await act(async () => { held.release(); });
    await settle();
    await waitFor(() => expect(main().hasAttribute("aria-disabled")).toBe(false));
    // Landed: the selection kept, and Remove removes.
    expect(duty().getAttribute("aria-pressed")).toBe("true");
    await press(remove());
    expect(duty().hasAttribute("data-removed")).toBe(true);
});

test("an external write to the people source narrows the board by original keys without narrowing coverage, through the staff's own index", async () => {
    const { container, store } = await open(ex.rosterWarehouse);
    // Nothing chosen of the staff or the activities: neither reads an index page.
    expect(narrowingPages()).toEqual([]);
    expect(indexPages()).toContain(ex.rosterDutiesByTime.name);
    const total = [...slot(container, "main").querySelectorAll('[role="img"][aria-label]')].map(e => e.getAttribute("aria-label"));
    await narrow(store, "rosterWarehouse", "people", new Map<string, Choice>([["name", variant("prefix", "C. Clo")]]));
    expect(assignment(container, "s37")).not.toBeNull();
    expect(container.querySelectorAll("[data-roster-assignment]:not([data-request])")).toHaveLength(1);
    expect([...slot(container, "main").querySelectorAll('[role="img"][aria-label]')].map(e => e.getAttribute("aria-label"))).toEqual(total);
    // The summary names the sources a narrowing hides rows of (#1358): the people, and the duties the week's window holds of
    // the record's; the activities' rows are all shown.
    const summary = slot(container, "toolbar").querySelector("[data-record-slices-summary]")!;
    expect(summary.querySelector('[data-record-slice-source="people"]')?.textContent).toBe("1 of 69 people");
    expect(summary.querySelector('[data-record-slice-source="activities"]')).toBeNull();
    // The window the Roster reads: the week, and the twelve hours either side its shifts' starts may stand from its days.
    const from = at("2028-03-04T12:00:00"), to = at("2028-03-12T12:00:00");
    const duties = [...(await h.read(ex.rosterDuties)).values()];
    const held = duties.filter(duty => byDate(duty.start, to) < 0 && byDate(duty.end, from) > 0).length;
    expect(summary.querySelector('[data-record-slice-source="duty"]')?.textContent).toBe(`${held} of ${duties.length} duty events`);
    expect(narrowingPages().length).toBeGreaterThan(0);
    expect(narrowingPages().every(index => index === ex.rosterStaffByName.name)).toBe(true);
});

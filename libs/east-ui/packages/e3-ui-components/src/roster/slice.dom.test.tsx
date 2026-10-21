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
 * (#1369). The pages are e3's (#1376), read from the request log.
 */
import { expect, test } from "vitest";
import { DateTimeType, compareFor, variant } from "@elaraai/east";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { assignment, at, narrow, open, rosterHarness, slot, type Choice } from "./harness.test-utils.js";
const h = rosterHarness();
const byDate = compareFor(DateTimeType);
/** Each page read through an index, by the index's name. */
const indexPages = () => h.requests("page").flatMap(request => { const index = request.query.get("index"); return index === null ? [] : [index]; });
/** The pages read through an index of the staff's or the activities'. */
const narrowingPages = () => indexPages().filter(index => index !== ex.rosterDutiesByTime.name);

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

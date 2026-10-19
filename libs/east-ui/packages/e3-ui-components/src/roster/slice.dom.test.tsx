/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The Roster's narrowing from outside its rail (#1342): a write to its people
 * source narrows the board by original keys through that source's own index,
 * and leaves coverage complete; with nothing chosen, no source
 * reads an index page — only the one-row primary page its revision and total come from.
 */
import { expect, test } from "vitest";
import { variant } from "@elaraai/east";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { assignment, narrow, open, rosterHarness, slot, type Choice } from "./harness.test-utils.js";
const h = rosterHarness();
const indexPages = () => h.paging.requests.filter(r => / index \w+ page /.test(r));

test("an external write to the people source narrows the board by original keys without narrowing coverage, through the staff's own index", async () => {
    const { container, store } = await open(ex.rosterWarehouse);
    // Nothing chosen: no source reads an index page.
    expect(indexPages()).toEqual([]);
    const total = [...slot(container, "main").querySelectorAll('[role="img"][aria-label]')].map(e => e.getAttribute("aria-label"));
    await narrow(store, "rosterWarehouse", "people", new Map<string, Choice>([["name", variant("prefix", "C. Clo")]]));
    expect(assignment(container, "s37")).not.toBeNull();
    expect(container.querySelectorAll("[data-roster-assignment]:not([data-request])")).toHaveLength(1);
    expect([...slot(container, "main").querySelectorAll('[role="img"][aria-label]')].map(e => e.getAttribute("aria-label"))).toEqual(total);
    // The summary names the people alone: the activities' rows are all shown (#1358).
    expect(slot(container, "toolbar").querySelector("[data-record-slices-summary]")?.textContent).toBe("1 of 69 people");
    expect(indexPages().length).toBeGreaterThan(0);
    expect(indexPages().every(r => / index roster_staff_by_name page /.test(r))).toBe(true);
});

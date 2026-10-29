/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The nested series example (#1439), on e3 itself: `planNestedAll` mounts as
 * a surface mounts it, its rows read through the record's indexes and its
 * collections through the nested series index a cell at a time, its Plan built
 * with no refusal and every row drawn; its series picked, each switched off
 * and on from the library's Series tab; and a crew's hours typed into a week,
 * the works' sum above moving at once, and saved: one commit, read back whole,
 * nothing left pending.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { East } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-nested";
import type { TreePath } from "@elaraai/e3-types";
import { boundFrame, frameScrolls } from "../../sheet/frame.test-utils.js";
import { instantKey, timeInstant } from "../instant.js";
import { act, entry, planHarness, rowAt, settle, slot } from "./harness.test-utils.js";

const h = planHarness({ "plan/plan-nested": ex });

/** A record's path, as e3's requests name it. */
const pathText = (path: TreePath) => path.map((step) => step.value).join(".");

// The examples' frames as a browser lays them: 700px tall, each mounted row as tall as it draws.
let restore: (() => void)[] = [];
beforeEach(() => { restore = [boundFrame(700), frameScrolls()]; });
afterEach(() => { for (const undo of restore.reverse()) undo(); });

/** What a mounted Plan drew: its rows — a group's strip among them — and anything it could not draw. */
function drawn(c: HTMLElement) {
    const main = slot(c, "main") ?? c;
    return {
        rows: main.querySelectorAll("[role='treegrid'] [role='row']").length,
        refused: [...c.querySelectorAll("[data-plan-diagnostic],[data-plan-error],[role='alert']")].map((el) => el.textContent ?? ""),
    };
}

/** The kinds of request a record was read with, through its nested series index or not. */
const kindsOf = (dataset: string, index?: string) => h.requests().filter((request) => request.dataset === dataset
    && (index === undefined || (request.query.get("index") ?? undefined) === index)).map((request) => request.kind);

/**
 * planNestedAll mounted with Jobs and Load switched off and every works unfolded, and the first crew's first week of
 * hours in the window typed 500: its cells, and how to read them.
 */
async function typedCrewHours() {
    const { container: c } = await h.mount(ex.planNestedAll);
    await settle();
    // Jobs and Load switched off, and every works unfolded: the first works' crews under its crew hours.
    const pane = slot(c, "start")!;
    fireEvent.click([...pane.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent?.startsWith("Series "))!);
    await settle();
    for (const name of ["Jobs", "Load"]) {
        const panel = pane.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;
        fireEvent.click([...panel.querySelectorAll<HTMLElement>("button[aria-pressed]")].find((b) => b.getAttribute("aria-label") === `Toggle ${name}`)!);
        await settle();
    }
    await act(async () => { fireEvent.click(within(slot(c, "toolbar")!).getByRole("button", { name: "Expand all" })); });
    await settle();
    // The first crew's first week of hours in the window, as the generator made it: its works' sum that week is its alone.
    const crews = [...East.compile(ex.generateWorks, [])(0n, 522n).crews.values()];
    const from = new Date("2026-09-28T00:00:00Z").getTime();
    const to = new Date("2026-12-28T00:00:00Z").getTime();
    const [week, hours] = [...crews[0]!.hours].find(([at]) => at.getTime() >= from && at.getTime() < to)!;
    expect(crews[1]!.hours.has(week)).toBe(false);
    const key = instantKey(timeInstant(week));
    const cellOf = (...path: string[]) => [...c.querySelectorAll<HTMLElement>(`${rowAt(entry(path.length === 1 ? "crews" : "crew", ...path))} [data-cell]`)]
        .find((cell) => cell.getAttribute("data-cell") === key);
    const printed = (cell: HTMLElement | undefined) => cell?.querySelector("[data-part='0']")?.textContent ?? "none";
    await waitFor(() => expect(printed(cellOf("W-10001", "C-10001-1"))).toBe(String(hours)));
    expect(printed(cellOf("W-10001"))).toBe(String(hours));
    await act(async () => { fireEvent.doubleClick(cellOf("W-10001", "C-10001-1")!); });
    const input = c.querySelector<HTMLInputElement>("[data-plan-typing] input")!;
    await act(async () => { fireEvent.input(input, { target: { value: "500" } }); });
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
    await settle();
    return { c, cellOf, printed };
}

describe("the nested series example on e3 (#1439)", () => {
    test("planNestedAll: its rows paged lean, its collections read a cell at a time through plan_works_in_time, every row drawn", async () => {
        const { container: c } = await h.mount(ex.planNestedAll);
        await settle();
        const { rows, refused } = drawn(c);
        expect(refused).toEqual([]);
        expect(rows).toBeGreaterThan(0);
        const dataset = pathText(ex.planWorks.path as TreePath);
        expect(kindsOf(dataset)).toContain("page");
        expect(kindsOf(dataset, ex.planWorks.indexes.plan_works_in_time.name)).toContain("runs");
        // Nothing read whole, nor a row by its key: no gesture asked for one.
        expect(h.requests("rows", dataset)).toEqual([]);
        expect(h.requests("read", dataset)).toEqual([]);
    });

    test("planNestedAll: the Series tab lists every series, and switching one off takes its rows and on brings them back", async () => {
        const { container: c } = await h.mount(ex.planNestedAll);
        await settle();
        const pane = slot(c, "start")!;
        const tab = [...pane.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent?.startsWith("Series "))!;
        fireEvent.click(tab);
        await settle();
        const panel = () => pane.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;
        const lines = () => [...panel().querySelectorAll<HTMLElement>("[data-slot='pickPanel'] button[aria-pressed]")]
            .map((line) => [line.getAttribute("aria-label")!.replace(/^Toggle /, ""), line.getAttribute("aria-pressed") === "true"]);
        expect(lines()).toEqual([["Jobs", true], ["Load", true], ["Crew hours", true], ["Parts", true]]);
        const jobs = () => slot(c, "main")!.querySelector(rowAt(entry("works", "W-10001")));
        expect(jobs()).not.toBeNull();
        const toggle = async (name: string) => {
            fireEvent.click([...panel().querySelectorAll<HTMLElement>("button[aria-pressed]")].find((b) => b.getAttribute("aria-label") === `Toggle ${name}`)!);
            await settle();
        };
        await toggle("Jobs");
        await waitFor(() => expect(jobs()).toBeNull());
        // On again, its rows come back above the load the view kept: at the top, the first works' jobs draw again.
        await toggle("Jobs");
        await act(async () => { c.querySelector<HTMLElement>('[data-virtual-rows="bounded"]')!.scrollTo({ top: 0 }); });
        await waitFor(() => expect(jobs()?.querySelector("[data-run]")).not.toBeNull());
    });

    test("planNestedAll: a crew's hours typed into a week move the works' sum above at once", async () => {
        const { c, cellOf, printed } = await typedCrewHours();
        await waitFor(() => expect(printed(cellOf("W-10001", "C-10001-1"))).toBe("500"));
        await waitFor(() => expect(printed(cellOf("W-10001"))).toBe("500"));
    });

    test("planNestedAll: a crew's hours typed are saved: one commit of the works record, read back with nothing pending", async () => {
        const { c, cellOf, printed } = await typedCrewHours();
        await act(async () => { fireEvent.click(within(slot(c, "toolbar")!).getByRole("button", { name: editingMessages.apply() })); });
        await settle();
        expect(h.requests("mutate", ex.planWorks.name)).toHaveLength(1);
        await waitFor(() => expect(slot(c, "footer")!.querySelector('[data-plan-count="pending"]')?.textContent).toBe("0 pending"));
        expect([...(slot(c, "banners")?.querySelectorAll("[data-session-banner]") ?? [])].map((banner) => banner.textContent)).toEqual([]);
        expect(printed(cellOf("W-10001", "C-10001-1"))).toBe("500");
    });
});

/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The nested series examples (#1439), on e3 itself: each mounts as a surface
 * mounts it, its rows read through the record's indexes and its collections
 * through the nested series index a cell at a time, its Plan built with no
 * refusal and every row drawn; the twelve machines read whole read no index.
 * The ledgers take a typed reading at once, every subtotal above it moving.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/plan-nested/plan-nested";
import type { TreePath } from "@elaraai/e3-types";
import { boundFrame, frameScrolls } from "../../sheet/frame.test-utils.js";
import { instantKey, timeInstant } from "../instant.js";
import { act, entry, planHarness, rowAt, settle, slot } from "./harness.test-utils.js";

const h = planHarness({ "plan-nested/plan-nested": ex });

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

describe("the nested series examples on e3 (#1439)", () => {
    const paged = [
        { name: "planNestedMachines", example: ex.planNestedMachines, record: ex.machines, index: ex.machines.indexes.machines_in_time.name },
        { name: "planNestedHalls", example: ex.planNestedHalls, record: ex.halls, index: ex.halls.indexes.halls_in_time.name },
        { name: "planNestedAssemblies", example: ex.planNestedAssemblies, record: ex.assemblies, index: ex.assemblies.indexes.assemblies_in_time.name },
        { name: "planNestedLedgers", example: ex.planNestedLedgers, record: ex.ledgers, index: ex.ledgers.indexes.ledgers_in_time.name },
    ] as const;
    for (const { name, example, record, index } of paged) {
        test(`${name}: its rows paged lean, its collections read a cell at a time through ${index}, every row drawn`, async () => {
            const { container: c } = await h.mount(example);
            await settle();
            const { rows, refused } = drawn(c);
            expect(refused).toEqual([]);
            expect(rows).toBeGreaterThan(0);
            const dataset = pathText(record.path as TreePath);
            expect(kindsOf(dataset)).toContain("page");
            expect(kindsOf(dataset, index)).toContain("runs");
            // Nothing read whole, nor a row by its key: no gesture asked for one.
            expect(h.requests("rows", dataset)).toEqual([]);
            expect(h.requests("read", dataset)).toEqual([]);
        });
    }

    test("planNestedInline: the twelve machines read whole, no index asked", async () => {
        const { container: c } = await h.mount(ex.planNestedInline);
        await settle();
        const { rows, refused } = drawn(c);
        expect(refused).toEqual([]);
        expect(rows).toBeGreaterThan(0);
        expect(h.requests().filter((request) => request.kind === "find" || request.kind === "runs")).toEqual([]);
    });

    test("planNestedLedgers: a reading typed into a leaf's week moves every subtotal above it at once", async () => {
        const { container: c } = await h.mount(ex.planNestedLedgers);
        await settle();
        const OCT_12 = instantKey(timeInstant(new Date("2026-10-12T00:00:00Z")));
        const at = (...path: string[]) => [...c.querySelectorAll<HTMLElement>(`${rowAt(entry("measure-totals", "L-101", ...path))} [data-cell]`)]
            .find((cell) => cell.getAttribute("data-cell") === OCT_12);
        const leaf = ["101.1", "101.1.1", "101.1.1.1"];
        // Each cell's readings — its first part; the stock is its second.
        const printed = () => [at(...leaf), at("101.1", "101.1.1"), at("101.1")]
            .map((cell) => cell?.querySelector("[data-part='0']")?.textContent ?? "no reading");
        const before = printed();
        // Week 40 of the year (Oct 12): the first leaf's reading is 40 % 17 + 1 = 7.
        expect(before[0]).toBe("7");
        await act(async () => { fireEvent.doubleClick(at(...leaf)!); });
        const input = c.querySelector<HTMLInputElement>("[data-plan-typing] input")!;
        await act(async () => { fireEvent.input(input, { target: { value: "20" } }); });
        await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
        await settle();
        await waitFor(() => expect(printed()[0]).toBe("20"));
        // The middle's and the top's readings each moved by 13.
        const moved = printed();
        const reading = (text: string) => Number(text.replace(/,/g, ""));
        expect([reading(moved[1]!) - reading(before[1]!), reading(moved[2]!) - reading(before[2]!)]).toEqual([13, 13]);
    });
});

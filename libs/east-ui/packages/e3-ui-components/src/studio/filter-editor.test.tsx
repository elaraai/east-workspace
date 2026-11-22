/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A page filter's conditions, edited (#1673): the query builder's condition
 * rows over one source — a condition drawn as its row, a value picked from
 * the values the source holds, a condition added and told only once it is
 * finished, all or any, and a line of jq where no row says the condition;
 * its removes (ruled 22 November 2026) — a row's ×, and a group's Remove group
 * in words at its foot — a group left with one row that row, plain, and the
 * filter removed once its last finished row is. The rules themselves, step by
 * step, are `query/visual/filter-flow.test.ts`'s.
 * In place: no frame of their own, a lone condition with no joiner column,
 * the shared picker in the flow under them — open on a new filter's field,
 * Esc closing it and leaving the rows, Tab choosing as Enter does. Its
 * values are read on e3 itself, from the quarter's orders the tiles examples
 * deploy (`tile_test_quarter`).
 */

import { describe, expect, test } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { printJq, type JqNode } from "@elaraai/east";
import { act, settle } from "../e3-web-mount.test-utils.js";
import { slotActions } from "../query/slots.test-utils.js";
import { ORDERS_ROOT, ORDERS_SOURCE, condition } from "../query/visual/visual.test-utils.js";
import { FilterConditions } from "./filter-editor.js";
import { onE3, tileHarness } from "./tile.test-utils.js";

tileHarness();

const { popover, offers, openSlot, pick } = slotActions(act, settle);

/** A filter's rows over the orders, on e3, and each thing they told — a condition, as jq, or the filter `removed`; `autoOpen` as a new filter's are. */
async function rowsOf(where: string | undefined, autoOpen = false) {
    const told: string[] = [];
    const onChange = (next: JqNode | undefined) => { told.push(next === undefined ? "removed" : printJq(next).text); };
    const { container } = await onE3(
        <FilterConditions id="f1" where={where === undefined ? undefined : condition(where)} read={ORDERS_SOURCE} root={ORDERS_ROOT} onChange={onChange} autoOpen={autoOpen} />,
    );
    const rows = container.querySelector<HTMLElement>("[data-studio-filter-rows]")!;
    return { rows, told };
}

/** Each row's words: its slots', its inputs' and its joiners', in order. */
const lines = (rows: HTMLElement) => [...rows.querySelectorAll<HTMLElement>("[data-query-line=row]")].map((row) => row.textContent);

describe("a page filter's conditions", () => {
    test("draws its condition as the query builder's row — a field, a comparison, a value — and no card, step number or toolbar around it", async () => {
        const { rows } = await rowsOf(`.region == "SA"`);
        expect(lines(rows)).toHaveLength(1);
        expect(lines(rows)[0]).toContain("region");
        expect(lines(rows)[0]).toContain("SA");
        expect(rows.querySelector("[data-step-id], [data-query-shape-text]")).toBeNull();
        expect(screen.queryByRole("button", { name: "Move up" })).toBeNull();
    });

    test("offers a value from the values the source holds, with how many rows hold each, and tells the condition the pick makes", async () => {
        const { rows, told } = await rowsOf(`.region == "SA"`);
        await openSlot(rows, "SA");
        await waitFor(() => expect(offers()).toContain("NSW"));
        // Each value the orders hold, with its count.
        expect(popover()!.textContent).toContain("VIC");
        await pick("NSW");
        expect(told).toEqual([`.region == "NSW"`]);
        expect(lines(rows)[0]).toContain("NSW");
    });

    test("tells a condition added only once it is finished: until its field, its comparison and its value are set, the filter is as it was", async () => {
        const { rows, told } = await rowsOf(`.region == "SA"`);
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add condition" })); });
        await settle();
        expect(lines(rows)).toHaveLength(2);
        expect(told).toEqual([]);
        // The new row's field opens at once: pick revenue, then its comparison, then type its value.
        await waitFor(() => expect(popover()).not.toBeNull());
        await pick("revenue");
        expect(told).toEqual([]);
        // Its value opens next, offering figures the orders' revenue holds: the pick finishes the row.
        await waitFor(() => expect(offers()).toContain("40.00"));
        await pick("40.00");
        // A number is at least its value until its comparison is changed.
        expect(told).toEqual([`.region == "SA" and .revenue >= 40`]);
        expect(lines(rows)).toHaveLength(2);
    });

    test("starts a filter still to be written as one empty row, and tells nothing until it is finished", async () => {
        const { rows, told } = await rowsOf(undefined);
        expect(lines(rows)).toHaveLength(1);
        expect(told).toEqual([]);
    });

    test("in place: the rows draw no frame of their own — a lone condition with no joiner column; from the second, the all · any head", async () => {
        const { rows } = await rowsOf(`.region == "SA"`);
        const block = rows.querySelector<HTMLElement>("[data-condition-rows]")!;
        expect([block.getAttribute("data-query-look"), block.hasAttribute("data-single"), block.querySelector("[data-query-line=head]")]).toEqual(["inline", true, null]);
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add condition" })); });
        await settle();
        expect([block.hasAttribute("data-single"), block.querySelector("[data-query-line=head]")!.textContent]).toEqual([false, "allof these are true"]);
    });

    test("a new filter opens on its field's list: the shared picker under the rows, named by its slot, its offers the source's fields", async () => {
        await rowsOf(undefined, true);
        await waitFor(() => expect(popover()).not.toBeNull());
        expect([popover()!.hasAttribute("data-chooser"), popover()!.getAttribute("data-surface")]).toEqual([true, "bare"]);
        // Its search takes the focus as it mounts.
        await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Field" })));
        expect(offers()).toEqual(["ordered at", "region", "customer", "revenue", "units", "margin"]);
    });

    test("Esc in the list closes it and leaves the rows, the focus back on its slot; Tab chooses as Enter does", async () => {
        const { rows, told } = await rowsOf(`.region == "SA"`);
        await openSlot(rows, "SA");
        await waitFor(() => expect(offers()).toContain("NSW"));
        await act(async () => { fireEvent.keyDown(screen.getByRole("combobox", { name: "Value" }), { key: "Escape" }); });
        await settle();
        expect([popover(), lines(rows)[0]?.includes("SA"), document.activeElement?.textContent?.startsWith("SA")]).toEqual([null, true, true]);
        await openSlot(rows, "SA");
        await waitFor(() => expect(offers()).toContain("NSW"));
        await act(async () => { fireEvent.keyDown(screen.getByRole("combobox", { name: "Value" }), { key: "ArrowDown" }); });
        await act(async () => { fireEvent.keyDown(screen.getByRole("combobox", { name: "Value" }), { key: "Tab" }); });
        await settle();
        expect(told).toHaveLength(1);
        expect(popover()).toBeNull();
    });

    test("Remove group closes the list the group's condition opened: no list stays open on a slot that is gone", async () => {
        const { rows } = await rowsOf(`.region == "SA"`);
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add group" })); });
        await settle();
        // The group's first condition opens on its field's list.
        await waitFor(() => expect(popover()).not.toBeNull());
        expect(lines(rows)).toHaveLength(3);
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Remove group" })); });
        await settle();
        expect([lines(rows).length, popover()]).toEqual([1, null]);
    });

    test("a condition's × closes the list open on it, and leaves a list open on another row where it is", async () => {
        const { rows } = await rowsOf(`.region == "SA"`);
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add condition" })); });
        await settle();
        // The new row's field opens at once; its own × takes the list with the row.
        await waitFor(() => expect(popover()).not.toBeNull());
        const removes = () => screen.getAllByRole("button", { name: "Remove" });
        await act(async () => { fireEvent.click(removes()[1]!); });
        await settle();
        expect([lines(rows).length, popover()]).toEqual([1, null]);
        // A list open on the first row's value stays open on it when a row added after it is removed.
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add condition" })); });
        await settle();
        await openSlot(rows, "SA");
        await waitFor(() => expect(offers()).toContain("NSW"));
        await act(async () => { fireEvent.click(removes()[1]!); });
        await settle();
        expect(lines(rows)).toHaveLength(1);
        expect(offers()).toContain("NSW");
    });

    test("a group's remove is its words, Remove group, at its foot's end after its add — never a × in its head — and each row keeps its own ×, each marked by what it takes", async () => {
        const { rows } = await rowsOf(`.region == "SA"`);
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add group" })); });
        await settle();
        const box = rows.querySelector<HTMLElement>("[data-query-group-box]")!;
        const removeGroup = screen.getByRole("button", { name: "Remove group" });
        const foot = box.querySelector<HTMLElement>(":scope > [data-query-line=foot]")!;
        expect([removeGroup.textContent, removeGroup.getAttribute("data-query-remove"), removeGroup.querySelector("svg"), removeGroup.parentElement === foot]).toEqual(["Remove group", "group", null, true]);
        expect([...foot.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Add condition", "Remove group"]);
        expect(box.querySelector("[data-query-group-head] [data-query-remove]")).toBeNull();
        // The filter's own row, and the group's two: each a × that takes its row.
        const crosses = [...rows.querySelectorAll<HTMLElement>("[data-query-line=row] > [data-query-remove]")];
        expect(crosses.map((cross) => [cross.getAttribute("data-query-remove"), cross.getAttribute("aria-label"), cross.querySelector("svg")?.getAttribute("data-icon")]))
            .toEqual([["row", "Remove", "xmark"], ["row", "Remove", "xmark"], ["row", "Remove", "xmark"]]);
    });

    test("a group's row removed leaves the other as a plain row: no group of one, and nothing told while neither is finished", async () => {
        const { rows, told } = await rowsOf(`.region == "SA"`);
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add group" })); });
        await settle();
        expect([lines(rows).length, rows.querySelectorAll("[data-query-group-box]").length]).toEqual([3, 1]);
        await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[2]!); });
        await settle();
        expect([lines(rows).length, rows.querySelectorAll("[data-query-group-box]").length, screen.queryByRole("button", { name: "Remove group" }), told]).toEqual([2, 0, null, []]);
    });

    test("its only condition's × removes the filter — told once — and leaves the adds to write another, which is a filter again once finished", async () => {
        const { rows, told } = await rowsOf(`.region == "SA"`);
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Remove" })); });
        await settle();
        expect([lines(rows), told, popover()]).toEqual([[], ["removed"], null]);
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add condition" })); });
        await settle();
        await waitFor(() => expect(popover()).not.toBeNull());
        await pick("region");
        await waitFor(() => expect(offers()).toContain("NSW"));
        await pick("NSW");
        expect(told).toEqual(["removed", `.region == "NSW"`]);
    });

    test("its last finished row removed beside a row still empty removes the filter, and the empty row stands", async () => {
        const { rows, told } = await rowsOf(`.region == "SA"`);
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add condition" })); });
        await settle();
        await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!); });
        await settle();
        expect([lines(rows).length, told]).toEqual([1, ["removed"]]);
    });

    test("holds a condition no row says as a line of jq", async () => {
        const { rows } = await rowsOf(`.region | IN("SA", "NSW")`);
        expect(lines(rows)).toHaveLength(0);
        expect(rows.textContent).toContain(`map(select(.region | IN("SA", "NSW")))`);
    });
});

/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A page filter's conditions, edited (#1673): the query builder's condition
 * rows over one source — a condition drawn as its row, a value picked from
 * the values the source holds, a condition added and told only once it is
 * finished, all or any, and a line of jq where no row says the condition.
 */

import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { ArrayType, printJq, variant, type JqNode } from "@elaraai/east";
import { StateRuntime, UIStore, system } from "@elaraai/east-ui-components";
import { QueryCallProvider } from "../query/hooks.js";
import { createInMemoryQueryCall } from "../query/in-memory-call.js";
import { slotActions } from "../query/slots.test-utils.js";
import { ORDERS, ORDERS_ROOT, ORDERS_SOURCE, OrderRow, condition } from "../query/visual/visual.test-utils.js";
import { FilterConditions } from "./filter-editor.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

beforeEach(() => { StateRuntime.initializeStore(new UIStore()); });
afterEach(() => { cleanup(); });

const settle = async () => { await act(async () => { await Promise.resolve(); }); };
const { popover, offers, openSlot, pick } = slotActions(act, settle);

/** The orders, answered in memory: what a slot's values are read from. */
const CALL = createInMemoryQueryCall([{ path: [variant("field", "inputs"), variant("field", "orders")], type: ArrayType(OrderRow), value: ORDERS }]);

/** A filter's rows over the orders, and each condition they told, as jq. */
function rowsOf(where: string | undefined) {
    const told: string[] = [];
    const onChange = (next: JqNode) => { told.push(printJq(next).text); };
    const host = (children: ReactNode) => <ChakraProvider value={system}><QueryCallProvider call={CALL}>{children}</QueryCallProvider></ChakraProvider>;
    const { container } = render(host(
        <FilterConditions id="f1" where={where === undefined ? undefined : condition(where)} read={ORDERS_SOURCE} root={ORDERS_ROOT} onChange={onChange} />,
    ));
    const rows = container.querySelector<HTMLElement>("[data-studio-filter-rows]")!;
    return { rows, told };
}

/** Each row's words: its slots', its inputs' and its joiners', in order. */
const lines = (rows: HTMLElement) => [...rows.querySelectorAll<HTMLElement>("[data-query-line=row]")].map((row) => row.textContent);

describe("a page filter's conditions", () => {
    test("draws its condition as the query builder's row — a field, a comparison, a value — and no card, step number or toolbar around it", () => {
        const { rows } = rowsOf(`.region == "SA"`);
        expect(lines(rows)).toHaveLength(1);
        expect(lines(rows)[0]).toContain("region");
        expect(lines(rows)[0]).toContain("SA");
        expect(rows.querySelector("[data-step-id], [data-query-shape-text]")).toBeNull();
        expect(screen.queryByRole("button", { name: "Move up" })).toBeNull();
    });

    test("offers a value from the values the source holds, with how many rows hold each, and tells the condition the pick makes", async () => {
        const { rows, told } = rowsOf(`.region == "SA"`);
        await openSlot(rows, "SA");
        await waitFor(() => expect(offers()).toContain("NSW"));
        // Each value the orders hold, with its count.
        expect(popover()!.textContent).toContain("VIC");
        await pick("NSW");
        expect(told).toEqual([`.region == "NSW"`]);
        expect(lines(rows)[0]).toContain("NSW");
    });

    test("tells a condition added only once it is finished: until its field, its comparison and its value are set, the filter is as it was", async () => {
        const { rows, told } = rowsOf(`.region == "SA"`);
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

    test("starts a filter still to be written as one empty row, and tells nothing until it is finished", () => {
        const { rows, told } = rowsOf(undefined);
        expect(lines(rows)).toHaveLength(1);
        expect(told).toEqual([]);
    });

    test("holds a condition no row says as a line of jq", () => {
        const { rows } = rowsOf(`.region | IN("SA", "NSW")`);
        expect(lines(rows)).toHaveLength(0);
        expect(rows.textContent).toContain(`map(select(.region | IN("SA", "NSW")))`);
    });
});

/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * @vitest-environment jsdom
 *
 * A Studio page's visuals asked on e3 itself (#1670), under the dataset cache
 * a page mounts: each program is asked once as the page loads — a tile asks
 * before the cache's first poll reads its source's hash, and the run it
 * started serves it once the hash is known — and the builder's publish
 * preview draws what its canvas answered, asking nothing again.
 */

import { describe, expect, test } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/studio/studio";
import { act, e3Harness, settle } from "../e3-web-mount.test-utils.js";
import "./builder.js";

const h = e3Harness({ "studio/studio": ex }, { measure: false });

/** The one-shot calls the page has launched of e3: each a call started, or run within one request. */
const launched = () => h.requests("one-shot").filter((request) => request.method === "POST");

/** A placement's tile on the canvas. */
const tile = (container: HTMLElement, key: string) => container.querySelector<HTMLElement>(`[data-studio-canvas] [data-snap-grid-tile="${key}"]`)!;

/** Whether both the content example's visuals have answered in an element: the revenue drawn as its chart, and the regions as its list, a row each. */
async function bothAnswered(within_: (key: string) => HTMLElement) {
    await waitFor(() => expect(within_("s-revenue").querySelector('[data-studio-chart="column"]')).not.toBeNull());
    await waitFor(() => expect(within_("s-top").querySelectorAll("[data-studio-list-row]")).toHaveLength(3));
}

/** Mounts the content example's builder, and waits for both its visuals to answer: revenue by region and channel, and the regions by revenue. */
async function mountAnswered(storageKey: string): Promise<HTMLElement> {
    const { container } = await h.mount(ex.studioContent, { storageKey });
    await bothAnswered((key) => tile(container, key));
    await settle();
    return container;
}

describe("a page's visuals, asked on e3", () => {
    test("asks each program once as the page loads, though its tiles ask before the poll first reads their source's hash", async () => {
        // The calls slower than the poll, as on a server: held until the cache's poll has read the source's hash.
        const calls = h.e3.hold((request) => request.kind === "one-shot");
        const { container } = await h.mount(ex.studioContent, { storageKey: "studio-answers" });
        await h.poll();
        await act(async () => { calls.release(); });
        await bothAnswered((key) => tile(container, key));
        await settle();
        // Two visuals, two programs: one call each.
        expect(launched()).toHaveLength(2);
    });

    test("the showcase's page of visuals draws every form from its answers: the KPIs, the seven charts, the list, the three tables (#1671)", async () => {
        const { container } = await h.mount(ex.studioVisuals, { storageKey: "studio-visuals" });
        const cell = (key: string) => container.querySelector<HTMLElement>(`[data-snap-grid-cell="${key}"]`)!;
        const charts: readonly (readonly [string, string])[] = [
            ["v-share", "pie"], ["v-months", "column"], ["v-customers", "bar"], ["v-units", "line"], ["v-trend", "area"], ["v-scatter", "scatter"], ["v-combo", "combo"],
        ];
        for (const [key, kind] of charts) await waitFor(() => expect(cell(key).querySelector(`[data-studio-chart="${kind}"]`), key).not.toBeNull());
        // The quarter's revenue with its goal, its change on a year ago and its trend; its orders with their change on the
        // quarter before and their trend — each period moved from the page's window, its starting filter's.
        await waitFor(() => expect(cell("v-revenue").querySelector("[data-studio-kpi-goal]")).not.toBeNull());
        await waitFor(() => expect([cell("v-revenue").querySelector("[data-studio-kpi-change]"), cell("v-orders").querySelector("[data-studio-kpi-change]")].map((el) => el !== null)).toEqual([true, true]));
        // The quarter's fourteen customers, each a row with its bar.
        await waitFor(() => expect(cell("v-list").querySelectorAll("[data-studio-list-row] [data-studio-list-bar]")).toHaveLength(14));
        // The summary's total row, the query's, after its functions; the pivot's heat legend; the records' first page among the quarter's orders.
        await waitFor(() => expect([...cell("v-summary").querySelectorAll("tfoot [data-total-label]")].map((el) => el.textContent)).toEqual(["sum", "ratio"]));
        await waitFor(() => expect(cell("v-pivot").querySelectorAll("[data-studio-heat] [data-step]")).toHaveLength(5));
        await waitFor(() => expect(cell("v-records").querySelector("[data-studio-visual-note]")?.textContent).toBe("Showing 1–50 of 372"));
    });

    test("the publish preview draws what the canvas answered, and asks nothing again", async () => {
        const container = await mountAnswered("studio-preview");
        const asked = launched().length;
        const button = screen.getByRole("button", { name: "Preview" });
        await act(async () => {
            fireEvent.mouseDown(button, { button: 0 });
            fireEvent.click(button);
        });
        await settle();
        const preview = container.querySelector<HTMLElement>("[data-studio-publish]")!;
        await bothAnswered((key) => preview.querySelector<HTMLElement>(`[data-snap-grid-cell="${key}"]`)!);
        expect(launched()).toHaveLength(asked);
    });
});

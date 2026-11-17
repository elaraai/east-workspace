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
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/studio/studio";
import { act, e3Harness, settle } from "../e3-web-mount.test-utils.js";
import "./builder.js";

const h = e3Harness({ "studio/studio": ex }, { measure: false });

/** The one-shot calls the page has launched of e3: each a call started, or run within one request. */
const launched = () => h.requests("one-shot").filter((request) => request.method === "POST");

/** A placement's tile on the canvas. */
const tile = (container: HTMLElement, key: string) => container.querySelector<HTMLElement>(`[data-studio-canvas] [data-snap-grid-tile="${key}"]`)!;

/** Mounts the content example's builder, and waits for both its visuals to answer: revenue by region and channel, and the regions by revenue. */
async function mountAnswered(storageKey: string): Promise<HTMLElement> {
    const { container } = await h.mount(ex.studioContent, { storageKey });
    await waitFor(() => expect(within(tile(container, "s-revenue")).getByText("6 groups from 6 rows")).toBeTruthy());
    await waitFor(() => expect(within(tile(container, "s-top")).getByText("3 groups from 6 rows")).toBeTruthy());
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
        await waitFor(() => expect(within(tile(container, "s-revenue")).getByText("6 groups from 6 rows")).toBeTruthy());
        await waitFor(() => expect(within(tile(container, "s-top")).getByText("3 groups from 6 rows")).toBeTruthy());
        await settle();
        // Two visuals, two programs: one call each.
        expect(launched()).toHaveLength(2);
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
        expect(within(preview).getByText("6 groups from 6 rows")).toBeTruthy();
        expect(within(preview).getByText("3 groups from 6 rows")).toBeTruthy();
        expect(launched()).toHaveLength(asked);
    });
});

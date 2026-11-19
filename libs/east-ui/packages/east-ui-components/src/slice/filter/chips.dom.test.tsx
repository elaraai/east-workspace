/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A row of filter chips whose editors apply each edit as it is made (`live`,
 * #1673): a filter's popover keeps Remove filter and holds no Cancel, and the
 * new filter's holds no Done — neither says an edit waits for it. A row whose
 * editors wait keeps both.
 */

import { describe, test, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, screen, act } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../../theme/index.js";
import { SliceFilterChips } from "./chips.js";

afterEach(cleanup);

/** The popover's positioner observes sizes; jsdom has no ResizeObserver. */
class ResizeObserverStub {
    observe(): void { /* noop */ }
    unobserve(): void { /* noop */ }
    disconnect(): void { /* noop */ }
}

/** One filter's row, its editors applying each edit as it is made or not. */
function Row({ live }: { live: boolean }) {
    return (
        <ChakraProvider value={system}>
            <SliceFilterChips density="focused" live={live} onRemove={() => undefined} onClear={() => undefined}
                chips={[{ label: "region is SA", editLabel: "Filter on Orders", large: true, editor: () => <div>its rows</div> }]}
                add={() => <div>a new filter's rows</div>} />
        </ChakraProvider>
    );
}

/** Opens a popover by its trigger, and names the buttons in its foot. */
async function footOf(trigger: HTMLElement): Promise<string[]> {
    await act(async () => { fireEvent.click(trigger); await Promise.resolve(); });
    const content = document.querySelector("[data-scope='popover'][data-part='content'][data-state='open']");
    expect(content, "the popover opened").not.toBeNull();
    const words = [...content!.querySelectorAll("button")].map((b) => b.textContent ?? "").filter((t) => t !== "");
    await act(async () => { fireEvent.click(trigger); await Promise.resolve(); });
    return words;
}

describe("a row of filter chips whose editors apply each edit as it is made", () => {
    beforeEach(() => { vi.stubGlobal("ResizeObserver", ResizeObserverStub); });
    afterEach(() => { vi.unstubAllGlobals(); });

    test("live: a filter's popover keeps Remove filter and holds no Cancel; the new filter's holds no Done", async () => {
        render(<Row live />);
        expect(await footOf(document.querySelector<HTMLElement>("[data-slice-clause]")!)).toEqual(["Remove filter"]);
        expect(await footOf(screen.getByRole("button", { name: "Add filter" }))).toEqual([]);
    });

    test("waiting: a filter's popover has Remove filter and Cancel, and the new filter's Done", async () => {
        render(<Row live={false} />);
        expect(await footOf(document.querySelector<HTMLElement>("[data-slice-clause]")!)).toEqual(["Remove filter", "Cancel"]);
        expect(await footOf(screen.getByRole("button", { name: "Add filter" }))).toEqual(["Done"]);
    });
});

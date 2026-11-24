/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The foot of rows that page (`parts-pagination`): its range line at its
 * start, in its host's words, whole on hover; then its page buttons — the
 * Pagination over its rows, on the page its host shows; a turn of the page
 * tells its host the page's index, from 0; and rows that all stand on one page
 * draw no buttons. Its sizes and colours are measured in a real browser
 * (`pagination-sizes.spec.ts`, P5 and P6).
 */

import { describe, test, expect, afterEach } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../../theme/index.js";
import { PageButtons, PageFoot, PageRange, type PageButtonsProps } from "./page-foot.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

afterEach(cleanup);

/** 120 rows, 25 a page, on the second page: what the turns are told to. */
function pagesOf(turns: number[]): PageButtonsProps {
    return { count: 120, pageSize: 25, page: 1, onPage: (page) => { turns.push(page); }, storageKey: "page-foot-test" };
}

/** Lets a queued turn of the page reach its host. */
async function flush(): Promise<void> {
    await act(async () => { await Promise.resolve(); });
}

/** The pages the Pagination's strip draws, and the one it marks as shown. */
function strip(container: HTMLElement): { pages: string[]; shown: string | null } {
    const items = [...container.querySelectorAll("[data-scope='pagination'][data-part='item']")];
    return { pages: items.map((item) => item.textContent ?? ""), shown: items.find((item) => item.hasAttribute("data-selected"))?.textContent ?? null };
}

describe("the foot of rows that page", () => {
    test("its range line stands at its start, whole on hover, then its page buttons on the page its host shows", () => {
        const { container } = render(
            <ChakraProvider value={system}>
                <PageFoot pages={pagesOf([])}><PageRange>Showing 26–50 of 120</PageRange></PageFoot>
            </ChakraProvider>,
        );
        const foot = container.querySelector("[data-page-foot]")!;
        const [range, pager] = [...foot.children];
        expect([range?.getAttribute("data-page-range"), range?.textContent, range?.getAttribute("title")]).toEqual(["", "Showing 26–50 of 120", "Showing 26–50 of 120"]);
        expect([pager?.getAttribute("data-scope"), pager?.getAttribute("data-part")]).toEqual(["pagination", "root"]);
        // The second of five pages: 120 rows, 25 a page.
        expect(strip(container)).toEqual({ pages: ["1", "2", "3", "4", "5"], shown: "2" });
    });

    test("a turn of the page tells its host the page's index, from 0", async () => {
        const turns: number[] = [];
        const { container } = render(
            <ChakraProvider value={system}>
                <PageFoot pages={pagesOf(turns)}><PageRange>Showing 26–50 of 120</PageRange></PageFoot>
            </ChakraProvider>,
        );
        fireEvent.click(container.querySelector('[aria-label="Next page"]')!);
        await flush();
        fireEvent.click(container.querySelector('[aria-label="Previous page"]')!);
        await flush();
        // The page shown is its host's: each turn is from the second page.
        expect(turns).toEqual([2, 0]);
    });

    test("rows that all stand on one page draw no page buttons", () => {
        const { container } = render(
            <ChakraProvider value={system}>
                <PageFoot><PageRange>Showing 500 of 1,240 groups</PageRange></PageFoot>
            </ChakraProvider>,
        );
        expect(container.querySelector("[data-page-range]")?.textContent).toBe("Showing 500 of 1,240 groups");
        expect(container.querySelector("[data-scope='pagination']")).toBeNull();
    });

    test("the page buttons alone stand in a host's own footer: the first page has no page before it", () => {
        const { container } = render(
            <ChakraProvider value={system}>
                <PageButtons {...pagesOf([])} page={0} />
            </ChakraProvider>,
        );
        expect(strip(container)).toEqual({ pages: ["1", "2", "3", "4", "5"], shown: "1" });
        expect(container.querySelector<HTMLButtonElement>('[aria-label="Previous page"]')!.disabled).toBe(true);
        expect(container.querySelector<HTMLButtonElement>('[aria-label="Next page"]')!.disabled).toBe(false);
    });
});

/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Pagination's compact form reads the room the pagination is given, never
 * what it draws (#1268): the width it follows is its root's — as wide as its
 * container leaves it, whichever form it draws — so a wide room shows the page
 * strip, a room under 360px the `page / total` readout, and the form follows
 * the room both ways, whichever way the width got there.
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { East, IntegerType, NullType } from "@elaraai/east";
import { Pagination, UIComponentType } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { EastChakraComponent } from "../../component.js";

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

/**
 * A `ResizeObserver` the test delivers by hand, and a width for every
 * element: the pagination's root (its `nav`) is as wide as the room, and
 * every other element as wide as a page strip draws, under 360px — so a form
 * read from anything but the root would be compact in any room.
 *
 * @param room - The room the pagination is given, read at each measure
 * @returns A delivery to every observer, as a resize would make one
 */
function stubRoom(room: () => number): () => void {
    const callbacks: Array<() => void> = [];
    class Observer {
        constructor(callback: () => void) { callbacks.push(callback); }
        observe() { /* delivered by hand */ }
        unobserve() { /* delivered by hand */ }
        disconnect() { /* delivered by hand */ }
    }
    vi.stubGlobal("ResizeObserver", Observer);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        const width = this.tagName === "NAV" ? room() : 300;
        return { width, height: 32, top: 0, left: 0, right: width, bottom: 32, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    return () => { for (const callback of callbacks) callback(); };
}

/** The catalog's Pagination: page 1 of 25 (pageSize 20 of 500), as the catalog renders it. */
function show() {
    const value = East.compile(East.function([], UIComponentType, () => Pagination.Root({
        page: 0n, pageSize: 20n, count: 500n, onPageChange: East.function([IntegerType], NullType, () => {}),
    })), [])();
    return render(
        <ChakraProvider value={system}>
            <EastChakraComponent value={value} storageKey="pagination-test" />
        </ChakraProvider>,
    );
}

/** What the pagination draws between prev and next: whether its page strip shows, and its readout's text. */
function drawn(container: HTMLElement): { strip: boolean; readout: string | null } {
    return {
        strip: container.querySelectorAll("[data-scope='pagination'][data-part='item']").length > 0,
        readout: container.querySelector("[data-scope='pagination'] [aria-live='polite']")?.textContent ?? null,
    };
}

describe("the Pagination's compact form reads the room it is given, never what it draws (#1268)", () => {
    test("a wide room shows the page strip; under 360px, the readout; 360px, the strip again", () => {
        let room = 728;
        const deliver = stubRoom(() => room);
        const { container } = show();
        expect(drawn(container)).toEqual({ strip: true, readout: null });
        room = 359;
        act(() => deliver());
        expect(drawn(container)).toEqual({ strip: false, readout: "1 / 25" });
        room = 360;
        act(() => deliver());
        expect(drawn(container)).toEqual({ strip: true, readout: null });
    });

    test("a room under 360px at first shows the readout, and widened, the strip — the same forms as a room that narrowed", () => {
        let room = 320;
        const deliver = stubRoom(() => room);
        const { container } = show();
        expect(drawn(container)).toEqual({ strip: false, readout: "1 / 25" });
        room = 728;
        act(() => deliver());
        expect(drawn(container)).toEqual({ strip: true, readout: null });
        room = 320;
        act(() => deliver());
        expect(drawn(container)).toEqual({ strip: false, readout: "1 / 25" });
    });
});

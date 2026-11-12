/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 *
 * A tooltip's styles made ahead of its first opening (#1594): the classes a
 * part makes of the `tooltip` recipe's slots (`useSlotStyles`, `useSlotClass`)
 * are the ones Chakra's own tooltip draws with, so a tooltip opened after them
 * adds no rule to the page's styles. A file of its own: the page's styles are
 * the file's, so no tooltip another test opened has made them already.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { ChakraProvider, Tooltip } from "@chakra-ui/react";
import { system } from "./index.js";
import { useSlotClass, useSlotStyles } from "./slot-styles.js";

/** Ark's positioner observes sizes, and its tooltip the page's scroll; jsdom has neither. */
class ObserverStub {
    observe(): void { /* noop */ }
    unobserve(): void { /* noop */ }
    disconnect(): void { /* noop */ }
    takeRecords(): never[] { return []; }
}

beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("IntersectionObserver", ObserverStub);
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

/** How many rules the page's styles hold. */
const rules = (): number => [...document.styleSheets].reduce((n, sheet) => n + sheet.cssRules.length, 0);

/** A part that makes the tooltip's styles as it mounts, and opens a tooltip when told. */
function Part({ open, heard }: { open: boolean; heard: (content: string) => void }) {
    const tip = useSlotStyles("tooltip");
    const made = useSlotClass();
    for (const part of Object.values(tip)) made(part);
    heard(made(tip["content"]));
    return (
        <Tooltip.Root open={open}>
            <Tooltip.Trigger asChild><button type="button">Bar</button></Tooltip.Trigger>
            <Tooltip.Positioner>
                <Tooltip.Content data-tip="">Whole label</Tooltip.Content>
            </Tooltip.Positioner>
        </Tooltip.Root>
    );
}

test("a tooltip opened after its styles were made adds no rule to the page's styles, and draws with the class made for its content", async () => {
    let content = "";
    const heard = (name: string) => { content = name; };
    const view = render(<ChakraProvider value={system}><Part open={false} heard={heard} /></ChakraProvider>);
    const made = rules();
    expect([made > 0, content.startsWith("css-")]).toEqual([true, true]);
    view.rerender(<ChakraProvider value={system}><Part open heard={heard} /></ChakraProvider>);
    await waitFor(() => expect(document.querySelector("[data-tip]")).not.toBeNull());
    const drawn = document.querySelector<HTMLElement>("[data-tip]")!;
    expect([rules(), drawn.classList.contains(content)]).toEqual([made, true]);
});

/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 *
 * The edit popover drawn again (#1398, CL9): its trigger's words moving — as a
 * timeline's date navigator's do with each day its view crosses — it draws with
 * its styles made once for the theme and its size, never its recipe's slots
 * worked out again.
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../../theme/index.js";
import { SliceEditPopover } from "./index.js";

afterEach(cleanup);

/** A closed popover whose trigger says the words it is given. */
function Drawn({ words }: { words: string }) {
    return <ChakraProvider value={system}>
        <SliceEditPopover open={false} onOpenChange={() => undefined} label="Choose date" trigger={<button type="button">{words}</button>}>
            <div>Days</div>
        </SliceEditPopover>
    </ChakraProvider>;
}

describe("the edit popover drawn again (#1398, CL9)", () => {
    test("as its trigger's words move, works out none of its recipe's slots again", () => {
        // Each slot's styles of the popover's recipe at its size, as a recipe works them out.
        const slots = new Set(Object.values(system.sva(structuredClone(system.getSlotRecipe("sliceEdit")))({ size: "sm" }) as Record<string, unknown>)
            .map((style) => JSON.stringify((style as Record<string, unknown>)["@layer recipes"])));
        const { rerender } = render(<Drawn words="1–18 Oct" />);
        // A recipe working a slot's styles out wraps them in the recipes' layer.
        const wrap = vi.spyOn(system.layers, "wrap");
        try {
            for (const words of ["2–19 Oct", "3–20 Oct", "4–21 Oct"]) rerender(<Drawn words={words} />);
            expect(wrap.mock.calls.filter(([, styles]) => slots.has(JSON.stringify(styles))).length).toBe(0);
        } finally {
            wrap.mockRestore();
        }
    });
});

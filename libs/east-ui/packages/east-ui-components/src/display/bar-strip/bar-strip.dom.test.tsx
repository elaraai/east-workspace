/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 *
 * A sorted BarStrip orders its rows as East orders their Float values — a NaN
 * last ascending and first descending — never by subtraction, whose NaN
 * comparisons leave the order undefined. The value is built by the east-ui
 * factory and COMPILED, so the renderer reads what an author's program
 * produces.
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { East, type ValueTypeOf } from "@elaraai/east";
import { BarStrip, Text, UIComponentType } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { EastChakraComponent } from "../../component.js";

afterEach(cleanup);

/** A strip of Two, an unknown (NaN) and One, sorted as asked. */
const strip = (sort: "asc" | "desc"): ValueTypeOf<typeof UIComponentType> =>
    East.compile(East.function([], UIComponentType, (_$) => BarStrip.Root([
        { label: Text.Root("Two"), value: 2 },
        { label: Text.Root("Unknown"), value: NaN },
        { label: Text.Root("One"), value: 1 },
    ], { sort })), [])() as ValueTypeOf<typeof UIComponentType>;

/** The rows' labels, top to bottom. */
function labels(root: Element): string[] {
    const words = new Set(["One", "Two", "Unknown"]);
    const out: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
        const s = (n.textContent ?? "").trim();
        if (words.has(s)) out.push(s);
    }
    return out;
}

describe("BarStrip — sorted in East's order", () => {
    test("ascending puts the NaN row last", () => {
        const { container } = render(<ChakraProvider value={system}><EastChakraComponent value={strip("asc")} storageKey="bar-asc" /></ChakraProvider>);
        expect(labels(container)).toEqual(["One", "Two", "Unknown"]);
    });

    test("descending puts the NaN row first", () => {
        const { container } = render(<ChakraProvider value={system}><EastChakraComponent value={strip("desc")} storageKey="bar-desc" /></ChakraProvider>);
        expect(labels(container)).toEqual(["Unknown", "Two", "One"]);
    });
});

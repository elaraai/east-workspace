/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 *
 * A proposed allocation's amount draft is an East Float: it shows the amount
 * as East prints it and commits what East reads in it. An emptied or
 * unreadable draft names no amount — it never commits 0 (`Number("")`) — and
 * shows the amount again. The Blend value is typed from its East type.
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Blend } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { EastChakraBlend, type BlendValue } from "./index.js";

afterEach(cleanup);

type AmountEvent = ValueTypeOf<typeof Blend.Types.AmountEvent>;

/** One target holding one proposed allocation of 16000; its edits land in `events`. */
function blendOf(events: AmountEvent[]): BlendValue {
    return {
        id: "bench", sources: [], diff: [], verdict: none, onDrag: none, canDrop: none, onAction: none,
        onAmountChange: some((event: AmountEvent) => { events.push(event); return null; }),
        targets: [{
            key: "B1", label: "Blend 1", capacity: 40000, unit: "u", objective: none, metrics: [],
            allocations: [{
                source: "LOT-1", label: "Lot 1", sublabel: none, amount: 16000, pinned: false,
                state: variant("proposed", variant("added", null)),
            }],
        }],
    };
}

/** Type into the amount draft and leave it; the commit's callback runs in a microtask. */
async function edit(text: string): Promise<HTMLInputElement> {
    const input = screen.getByDisplayValue("16000.0") as HTMLInputElement;
    fireEvent.change(input, { target: { value: text } });
    fireEvent.blur(input);
    await Promise.resolve();
    return input;
}

describe("Blend — an allocation's amount draft reads and prints as East does", () => {
    test("the draft shows the amount as East prints it, and an edit East reads commits it", async () => {
        const events: AmountEvent[] = [];
        render(<ChakraProvider value={system}><EastChakraBlend value={blendOf(events)} storageKey="blend" /></ChakraProvider>);
        await edit("12500.5");
        expect(events).toEqual([{ target: "B1", source: "LOT-1", amount: 12500.5 }]);
    });

    test("an emptied or unreadable draft commits nothing — never 0 — and shows the amount again", async () => {
        const events: AmountEvent[] = [];
        render(<ChakraProvider value={system}><EastChakraBlend value={blendOf(events)} storageKey="blend" /></ChakraProvider>);
        for (const text of ["", "twelve", "Infinity"]) {
            const input = await edit(text);
            expect(input.value, JSON.stringify(text)).toBe("16000.0");
        }
        expect(events).toEqual([]);
    });
});

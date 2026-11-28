/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * East UI's Textarea that grows (`autoresize`, east-workspace#1779): as tall
 * as its text through the shared `useGrowWithText`, never resized by hand, and
 * a value its host gives it never told back to the host's `onChange` as typing
 * — as Ark's own `autoresize` told it. One that doesn't grow keeps its height.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { defaultValue, some } from "@elaraai/east";
import { Textarea } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { EastChakraTextarea, type TextareaValue } from "./index.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }

beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    // jsdom lays nothing out: a row of 20px for each 20 characters, never under three, as a browser measures it.
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
        configurable: true, get(this: HTMLTextAreaElement) { return Math.max(3, Math.ceil(this.value.length / 20)) * 20; },
    });
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    delete (HTMLTextAreaElement.prototype as { scrollHeight?: number }).scrollHeight;
});

/** A Textarea's payload: East's default of its type, holding `text`, growing or not, its host told each edit. */
function textarea(text: string, grows: boolean, told: string[]): TextareaValue {
    return {
        ...defaultValue<typeof Textarea.Types.Textarea>(Textarea.Types.Textarea),
        value: text,
        rows: some(3n),
        ...(grows && { autoresize: some(true) }),
        onChange: some((next: string) => { told.push(next); return null; }),
    } as TextareaValue;
}

const ui = (value: TextareaValue) => render(<ChakraProvider value={system}><EastChakraTextarea value={value} /></ChakraProvider>);

describe("East UI's Textarea that grows (east-workspace#1779)", () => {
    test("it is as tall as its text, typed or given, and never resized by hand", () => {
        const told: string[] = [];
        const { rerender } = ui(textarea("Short.", true, told));
        const box = screen.getByRole("textbox") as HTMLTextAreaElement;
        const tall = () => parseFloat(box.style.height);
        const three = tall();
        expect(getComputedStyle(box).resize).toBe("none");
        fireEvent.change(box, { target: { value: "x".repeat(100) } });
        expect(tall() - three).toBe(40);
        rerender(<ChakraProvider value={system}><EastChakraTextarea value={textarea("Short again.", true, told)} /></ChakraProvider>);
        expect(tall()).toBe(three);
    });

    test("a value its host gives it is never told back to the host as typing; what is typed is, once", async () => {
        const told: string[] = [];
        const { rerender } = ui(textarea("Generated sentence.", true, told));
        rerender(<ChakraProvider value={system}><EastChakraTextarea value={textarea("Given from the host.", true, told)} /></ChakraProvider>);
        await new Promise<void>((resolve) => { setTimeout(resolve, 20); });
        expect(told).toEqual([]);
        fireEvent.change(screen.getByRole("textbox"), { target: { value: "Typed." } });
        await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
        expect(told).toEqual(["Typed."]);
    });

    test("one that doesn't grow keeps its own height", () => {
        ui(textarea("x".repeat(100), false, []));
        expect((screen.getByRole("textbox") as HTMLTextAreaElement).style.height).toBe("");
    });
});

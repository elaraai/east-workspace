/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The rail's and a record slice's search box (`SliceSearchInput`): its text is
 * its host's, told of each key; typed faster than React's later work, every
 * key lands (east-workspace#1779).
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../../theme/index.js";
import { underLoad } from "../../testing/typing.js";
import { SliceSearchInput } from "./input.js";

/** Ark's positioner observes sizes; jsdom has no ResizeObserver. */
class ResizeObserverStub {
    observe(): void { /* noop */ }
    unobserve(): void { /* noop */ }
    disconnect(): void { /* noop */ }
}
// jsdom has no `CSS.escape`, and the combobox finds its highlighted item with it — every browser has one.
(globalThis as { CSS?: { escape?: (s: string) => string } }).CSS ??= {};
(globalThis as { CSS: { escape?: (s: string) => string } }).CSS.escape ??= (s: string) => s.replace(/[^\w-]/g, "\\$&");

beforeEach(() => { vi.stubGlobal("ResizeObserver", ResizeObserverStub); });
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

/** The search box, its text held by its host, which records each text it is told. */
function Host({ told }: { told: string[] }) {
    const [text, setText] = useState("");
    return <SliceSearchInput text={text} items={[]} placeholder="Search records"
        onInput={(next) => { told.push(next); setText(next); }} onSelect={() => {}} />;
}

test("keys typed faster than React's later work — as a loaded machine sends them — all land: typed `keys`, the box holds them, and its host is told each text in turn (east-workspace#1779)", async () => {
    const told: string[] = [];
    render(<ChakraProvider value={system}><Host told={told} /></ChakraProvider>);
    const box = screen.getByPlaceholderText("Search records") as HTMLInputElement;
    await underLoad(box, () => userEvent.type(box, "keys"));
    expect(box.value).toBe("keys");
    expect(told).toEqual(["k", "ke", "key", "keys"]);
});

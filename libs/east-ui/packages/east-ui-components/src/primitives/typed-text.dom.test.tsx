/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A combobox's text, held by React, committed at once (east-workspace#1779):
 * told of a change from a microtask, as Zag tells of one, the render and its
 * passive effects — where Zag writes the input's text — have run before the
 * commit returns; and a Zag combobox whose host holds its text, committed so,
 * loses no key typed faster than React's later work.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useMemo, useState } from "react";
import { ChakraProvider, Combobox, Portal, createListCollection } from "@chakra-ui/react";
import { system } from "../theme/index.js";
import { underLoad } from "../testing/typing.js";
import { commitTypedText } from "./typed-text.js";

/** Ark's positioner observes sizes; jsdom has no ResizeObserver. */
class ResizeObserverStub {
    observe(): void { /* noop */ }
    unobserve(): void { /* noop */ }
    disconnect(): void { /* noop */ }
}

beforeEach(() => { vi.stubGlobal("ResizeObserver", ResizeObserverStub); });
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

test("told from a microtask, as Zag tells of a change, the text is drawn and its passive effects have run before the commit returns", async () => {
    let set: (text: string) => void = () => {};
    const effects: string[] = [];
    function Held() {
        const [text, setText] = useState("");
        set = setText;
        useEffect(() => { effects.push(text); }, [text]);
        return <output data-testid="held">{text}</output>;
    }
    render(<Held />);
    const seen = await new Promise<{ drawn: string | null; effect: string | undefined }>((resolve) => {
        queueMicrotask(() => {
            commitTypedText(() => set("keys"));
            resolve({ drawn: screen.getByTestId("held").textContent, effect: effects.at(-1) });
        });
    });
    expect(seen).toEqual({ drawn: "keys", effect: "keys" });
});

/** A Zag combobox whose host holds its text, committed at once, recording each text it is told. */
function HeldCombobox({ told }: { told: string[] }) {
    const [text, setText] = useState("");
    const collection = useMemo(() => createListCollection<{ value: string; label: string }>({ items: [] }), []);
    return (
        <Combobox.Root collection={collection} value={[]} inputValue={text} allowCustomValue selectionBehavior="preserve"
            onInputValueChange={(d) => commitTypedText(() => { told.push(d.inputValue); setText(d.inputValue); })}>
            <Combobox.Control><Combobox.Input placeholder="Search" /></Combobox.Control>
            <Portal><Combobox.Positioner><Combobox.Content><Combobox.Empty>No matches</Combobox.Empty></Combobox.Content></Combobox.Positioner></Portal>
        </Combobox.Root>
    );
}

test("a Zag combobox whose host holds its text, committed so: keys typed faster than React's later work — as a loaded machine sends them — all land, its host told each text in turn; Zag told of each from no render or commit of React's, so React refuses none", async () => {
    const told: string[] = [];
    // React says so where a commit runs inside one of its renders or commits — and flushes nothing then.
    const errors = vi.spyOn(console, "error");
    try {
        render(<ChakraProvider value={system}><HeldCombobox told={told} /></ChakraProvider>);
        const box = screen.getByPlaceholderText("Search") as HTMLInputElement;
        await underLoad(box, () => userEvent.type(box, "keys"));
        expect(box.value).toBe("keys");
        expect(told).toEqual(["k", "ke", "key", "keys"]);
        expect(errors.mock.calls.filter((call) => call.some((part) => String(part).includes("flushSync")))).toEqual([]);
    } finally {
        errors.mockRestore();
    }
});

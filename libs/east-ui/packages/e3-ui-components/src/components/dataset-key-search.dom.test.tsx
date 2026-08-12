/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * DatasetKeySearch (#520): the one search control of the dataset preview.
 * String keys type-ahead as debounced prefix queries whose match range
 * lists in the shared combobox popup; other key types parse as `.east`
 * literals (bad input hints the expected type and sends nothing);
 * committing a match — or Enter with no highlighted option — jumps the
 * host tree, and next/prev step through the remembered range.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import { toEastTypeValue, IntegerType, StringType, StructType } from "@elaraai/east";
import { system } from "@elaraai/east-ui-components";
import { DatasetKeySearch, parseKeyInput, type DatasetKeySearchProps } from "./DatasetKeySearch.js";

/** Ark positioners observe sizes; jsdom has no ResizeObserver. */
class ResizeObserverStub {
    observe(): void { /* noop */ }
    unobserve(): void { /* noop */ }
    disconnect(): void { /* noop */ }
}

beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

const StringKey = toEastTypeValue(StringType);
const IntegerKey = toEastTypeValue(IntegerType);
const MachineKey = toEastTypeValue(StructType({ machine: StringType, shift: IntegerType }));

function renderSearch(props: DatasetKeySearchProps) {
    return render(
        <ChakraProvider value={system}>
            <DatasetKeySearch {...props} />
        </ChakraProvider>,
    );
}

describe("DatasetKeySearch", () => {
    test("string keys type-ahead as one debounced prefix query listing the head of the range", async () => {
        const onFind = vi.fn(async () => ({ found: true, row: 100, count: 27 }));
        const onListRange = vi.fn(async (row: number, limit: number) =>
            Array.from({ length: Math.min(limit, 5) }, (_, i) => `k01${String(row + i - 100).padStart(2, "0")}`));
        const onJump = vi.fn();
        renderSearch({ keyType: StringKey, onFind, onListRange, onJump });

        const input = screen.getByPlaceholderText("Search keys");
        await userEvent.type(input, "k01");
        await waitFor(() => expect(onFind).toHaveBeenCalled());
        // The keystrokes collapse into one trailing query for the final text.
        expect(onFind).toHaveBeenCalledTimes(1);
        expect(onFind).toHaveBeenCalledWith({ prefix: "k01" });
        await waitFor(() => expect(screen.getByText("27 matches")).toBeTruthy());
        expect(onListRange).toHaveBeenCalledWith(100, 20);
        // The popup lists the head of the match range.
        await waitFor(() => expect(screen.getByText("k0100")).toBeTruthy());
    });

    test("committing a match jumps the tree and next/prev step the range", async () => {
        const onFind = vi.fn(async () => ({ found: true, row: 100, count: 3 }));
        const onListRange = vi.fn(async (row: number, limit: number) =>
            Array.from({ length: Math.min(limit, 3) }, (_, i) => `key-${row + i}`));
        const onJump = vi.fn();
        renderSearch({ keyType: StringKey, onFind, onListRange, onJump });

        await userEvent.type(screen.getByPlaceholderText("Search keys"), "key");
        await waitFor(() => expect(screen.getByText("key-100")).toBeTruthy());
        fireEvent.click(screen.getByText("key-100"));
        await waitFor(() => expect(onJump).toHaveBeenCalledWith(100));
        await waitFor(() => expect(screen.getByText("1 of 3")).toBeTruthy());
        // Committing preserves the typed query — the label must not replace
        // it (the controlled empty selection re-syncing would then wipe the
        // input, the range and the held highlight).
        expect((screen.getByPlaceholderText("Search keys") as HTMLInputElement).value).toBe("key");

        fireEvent.click(screen.getByLabelText("Next match"));
        await waitFor(() => expect(onJump).toHaveBeenCalledWith(101));
        expect(screen.getByText("2 of 3")).toBeTruthy();
        fireEvent.click(screen.getByLabelText("Previous match"));
        await waitFor(() => expect(onJump).toHaveBeenLastCalledWith(100));
        expect(screen.getByText("1 of 3")).toBeTruthy();
    });

    test("Enter with no highlighted option jumps to the first match", async () => {
        const onFind = vi.fn(async () => ({ found: true, row: 42, count: 2 }));
        const onListRange = vi.fn(async () => ["a", "b"]);
        const onJump = vi.fn();
        renderSearch({ keyType: StringKey, onFind, onListRange, onJump });

        const input = screen.getByPlaceholderText("Search keys");
        await userEvent.type(input, "a");
        await waitFor(() => expect(onFind).toHaveBeenCalled());
        await waitFor(() => expect(screen.getByText("2 matches")).toBeTruthy());
        fireEvent.keyDown(input, { key: "Enter" });
        await waitFor(() => expect(onJump).toHaveBeenCalledWith(42));
    });

    test("scalar keys parse as .east literals; unparsable input hints and sends nothing", async () => {
        const onFind = vi.fn(async () => ({ found: true, row: 42, count: 1 }));
        const onListRange = vi.fn(async () => ["42"]);
        const onJump = vi.fn();
        renderSearch({ keyType: IntegerKey, onFind, onListRange, onJump });

        const input = screen.getByPlaceholderText("Find key (Integer)");
        await userEvent.type(input, "abc");
        expect(await screen.findByText("Key is Integer")).toBeTruthy();
        // The debounce window passes without a request going out.
        await new Promise((resolve) => setTimeout(resolve, 320));
        expect(onFind).not.toHaveBeenCalled();

        await userEvent.clear(input);
        await userEvent.type(input, "42");
        await waitFor(() => expect(onFind).toHaveBeenCalledWith({ key: "42" }));
        await waitFor(() => expect(screen.getByText("1 match")).toBeTruthy());
    });

    // Struct input parsing is pinned as pure unit tests — jsdom keystroke
    // latency races the debounce for multi-character typed sequences.
    test("struct input parses to leading-field queries, prefixes, literals and hints", () => {
        // A bare value types ahead as a prefix on the FIRST field.
        expect(parseKeyInput(MachineKey, "press")).toEqual({ kind: "query", query: { prefix: "press" } });
        // A comma narrows: exact leading fields, the last segment exact for
        // a non-String field.
        expect(parseKeyInput(MachineKey, "press, 2")).toEqual({ kind: "query", query: { fields: ['"press"', "2"] } });
        // A trailing comma narrows to the leading exact fields.
        expect(parseKeyInput(MachineKey, "press,")).toEqual({ kind: "query", query: { fields: ['"press"'] } });
        // A quoted String segment is exact, not a prefix.
        expect(parseKeyInput(MachineKey, '"press", 2')).toEqual({ kind: "query", query: { fields: ['"press"', "2"] } });
        // A parenthesised whole-key literal exact-jumps.
        expect(parseKeyInput(MachineKey, '(machine="press", shift=2)')).toEqual({ kind: "query", query: { key: '(machine="press", shift=2)' } });
        // Bad segments hint the field's type; too many segments hint the shape.
        expect(parseKeyInput(MachineKey, "press, x")).toEqual({ kind: "hint", hint: "shift is Integer — key is (machine: String, shift: Integer)" });
        expect(parseKeyInput(MachineKey, "a, 1, extra")).toEqual({ kind: "hint", hint: "Key is (machine: String, shift: Integer)" });
        // A String field prefix mid-tuple rides the leading exacts.
        const TripleKey = toEastTypeValue(StructType({ machine: StringType, line: StringType, shift: IntegerType }));
        expect(parseKeyInput(TripleKey, "press, L")).toEqual({ kind: "query", query: { fields: ['"press"'], prefix: "L" } });
    });

    test("struct keys type ahead on the first field through the combobox", async () => {
        const onFind = vi.fn(async () => ({ found: true, row: 100, count: 10 }));
        const onListRange = vi.fn(async () => ["press · 2"]);
        const onJump = vi.fn();
        renderSearch({ keyType: MachineKey, onFind, onListRange, onJump });

        // The placeholder spells out the key's field names; one keystroke
        // (no debounce race) reaches the host as a first-field prefix.
        const input = screen.getByPlaceholderText("Search keys (machine, shift)");
        await userEvent.type(input, "p");
        await waitFor(() => expect(onFind).toHaveBeenCalledWith({ prefix: "p" }));
    });

    test("the clear button empties the input, drops the query state, and tells the host", async () => {
        const onFind = vi.fn(async () => ({ found: true, row: 100, count: 3 }));
        const onListRange = vi.fn(async () => ["a", "b", "c"]);
        const onJump = vi.fn();
        const onClear = vi.fn();
        renderSearch({ keyType: StringKey, onFind, onListRange, onJump, onClear });

        const input = screen.getByPlaceholderText("Search keys") as HTMLInputElement;
        await userEvent.type(input, "a");
        await waitFor(() => expect(screen.getByText("3 matches")).toBeTruthy());
        fireEvent.click(screen.getByLabelText("Clear search"));
        await waitFor(() => expect(onClear).toHaveBeenCalled());
        expect(screen.queryByText("3 matches")).toBeNull();
        expect((screen.getByPlaceholderText("Search keys") as HTMLInputElement).value).toBe("");

        // Emptying the input by hand clears the host highlight too.
        await userEvent.type(screen.getByPlaceholderText("Search keys"), "b");
        await waitFor(() => expect(screen.getByText("3 matches")).toBeTruthy());
        await userEvent.clear(screen.getByPlaceholderText("Search keys"));
        await waitFor(() => expect(onClear).toHaveBeenCalledTimes(2));
    });

    test("misses report No matches; the control is the shared combobox recipe", async () => {
        const onFind = vi.fn(async () => ({ found: false, row: 7, count: 0 }));
        const onListRange = vi.fn(async () => [] as string[]);
        const onJump = vi.fn();
        const view = renderSearch({ keyType: StringKey, onFind, onListRange, onJump });

        // The design system's combobox slot recipe — not a bespoke input.
        expect(view.container.querySelector('[class*="elara-combobox"]')).toBeTruthy();

        await userEvent.type(screen.getByPlaceholderText("Search keys"), "zz");
        await waitFor(() => expect(screen.getByText("No matches")).toBeTruthy());
        expect(onListRange).not.toHaveBeenCalled();
        expect(screen.queryByLabelText("Next match")).toBeNull();
    });
});

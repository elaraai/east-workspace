/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 */

/**
 * The shared date input inside a `Field` (#1147): as the field's Ark inputs
 * are, the date and the time are named by the field's label and held by its
 * read-only. Outside a Field, the input is as its value says.
 */

import { describe, test, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { defaultValue, none, some, variant } from "@elaraai/east";
import { Field, Input } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { EastChakraField } from "../field/index.js";
import { EastChakraDateTimeInput } from "./index.js";

afterEach(cleanup);

const DUE = new Date(Date.UTC(2026, 9, 6, 9, 0));
const INPUT = { ...defaultValue<typeof Input.Types.DateTime>(Input.Types.DateTime), value: DUE };
const FIELD = defaultValue<typeof Field.Types.Field>(Field.Types.Field);

/** A Field labelled Due around the date input, read-only or not. */
function inField(readOnly: boolean) {
    return render(
        <ChakraProvider value={system}>
            <EastChakraField storageKey="due" value={{
                ...FIELD, label: "Due", control: variant("DateTimeInput", INPUT), readOnly: readOnly ? some(true) : none,
            }} />
        </ChakraProvider>,
    );
}

describe("DateTimeInput inside a Field (#1147)", () => {
    test("its date and time segments are named by the Field's label", () => {
        inField(false);
        const segments = screen.getAllByRole("spinbutton");
        expect(segments.length).toBeGreaterThan(0);
        expect(screen.getAllByRole("spinbutton", { name: /Due/ })).toHaveLength(segments.length);
        for (const segment of segments) expect(segment.getAttribute("aria-readonly")).not.toBe("true");
    });

    test("a read-only Field holds its date and time read-only", () => {
        inField(true);
        for (const segment of screen.getAllByRole("spinbutton")) expect(segment.getAttribute("aria-readonly")).toBe("true");
    });

    test("outside a Field, the input is named and held as before: by nothing, and by its own disabled", () => {
        render(<ChakraProvider value={system}><EastChakraDateTimeInput value={INPUT} /></ChakraProvider>);
        expect(screen.queryAllByRole("spinbutton", { name: /Due/ })).toHaveLength(0);
        for (const segment of screen.getAllByRole("spinbutton")) expect(segment.getAttribute("aria-readonly")).not.toBe("true");
    });
});

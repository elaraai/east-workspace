/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 */

/**
 * The number inputs under a host that writes back each change (#1211): a
 * number from the host other than the one the box reads replaces the box's
 * text — a Float at its precision, an Integer as East prints it — while the
 * echo of the number the box already reads keeps the text as typed.
 *
 * That the echo keeps a person's typing (`3.5`, never `35.00`) is measured in
 * Chromium (`east-ui-showcase/tests/responsive/number-input.spec.ts`): under
 * jsdom, user-event puts the caret at the end of the box before each key,
 * where a browser leaves it where the box's last write put it, so the lost
 * key cannot show here.
 */

import { describe, test, expect, afterEach } from "vitest";
import { useState } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import { defaultValue, some } from "@elaraai/east";
import { Input } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { EastChakraFloatInput, EastChakraIntegerInput, type FloatInputValue, type IntegerInputValue } from "./index.js";

afterEach(cleanup);

/** Lets the input's microtasks, the host's write-back, the renders and the input's next frames settle: zag writes the box's text on a frame. */
async function settle() {
    await act(async () => {
        for (let i = 0; i < 4; i++) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
        for (let i = 0; i < 3; i++) await new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); });
    });
}

/** Types a key at a time, the host's write-back settling between keys. */
async function typeKeys(user: ReturnType<typeof userEvent.setup>, el: HTMLElement, text: string) {
    for (const key of text) {
        await user.type(el, key);
        await settle();
    }
}

/** A Float input with precision 2 under a host that writes back each change; `host` sets the host's own number. */
function mountFloat() {
    let tell: (n: number) => void = () => {};
    function Host() {
        const [n, setN] = useState(0);
        tell = setN;
        const value: FloatInputValue = {
            ...defaultValue(Input.Types.Float),
            value: n,
            precision: some(2n),
            onChange: some((next: number) => { setN(next); return null; }),
        };
        return <EastChakraFloatInput value={value} />;
    }
    render(<ChakraProvider value={system}><Host /></ChakraProvider>);
    return { box: () => screen.getByRole("spinbutton") as HTMLInputElement, host: (n: number) => act(() => { tell(n); }) };
}

/** An Integer input under a host that writes back each change; `host` sets the host's own number. */
function mountInteger() {
    let tell: (n: bigint) => void = () => {};
    function Host() {
        const [n, setN] = useState(0n);
        tell = setN;
        const value: IntegerInputValue = {
            ...defaultValue(Input.Types.Integer),
            value: n,
            onChange: some((next: bigint) => { setN(next); return null; }),
        };
        return <EastChakraIntegerInput value={value} />;
    }
    render(<ChakraProvider value={system}><Host /></ChakraProvider>);
    return { box: () => screen.getByRole("spinbutton") as HTMLInputElement, host: (n: bigint) => act(() => { tell(n); }) };
}

describe("a number input whose host writes back each change (#1211)", () => {
    test("a Float: the host's own number, not the one the box reads, replaces what was typed, at the precision", async () => {
        const { box, host } = mountFloat();
        const user = userEvent.setup();
        await user.clear(box());
        await settle();
        await typeKeys(user, box(), "3.5");
        expect(box().value).toBe("3.5");
        await host(7.25);
        await settle();
        expect(box().value).toBe("7.25");
        await host(2);
        await settle();
        expect(box().value).toBe("2.00");
    });

    test("an Integer: the host's own number, not the one the box reads, replaces what was typed", async () => {
        const { box, host } = mountInteger();
        const user = userEvent.setup();
        await user.clear(box());
        await settle();
        await typeKeys(user, box(), "03");
        expect(box().value).toBe("03");
        await host(12n);
        await settle();
        expect(box().value).toBe("12");
    });
});

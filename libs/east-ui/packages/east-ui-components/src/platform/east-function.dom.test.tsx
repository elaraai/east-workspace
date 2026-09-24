/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<EastFunction>` remounts at its settled size. The first mount of an IR
 * compiles after the first paint, behind a skeleton. The compiled function is
 * kept for that IR object, so a remount (a virtualized row scrolled back into
 * range) renders its content in its FIRST frame. A remount that flashed the
 * skeleton changed size, and the showcase's virtualized doc list chased that
 * change without end: a row above the viewport shrank, the list scrolled to
 * hold the rows below still, and the row remounted again.
 */

import { describe, test, expect, afterEach } from "vitest";
import { useLayoutEffect } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { East } from "@elaraai/east";
import { Text, UIComponentType } from "@elaraai/east-ui/internal";
import { system } from "../theme/index.js";
import { EastFunction, type EastFunctionProps } from "./state-hooks.js";
import { registerPlatformImplementation } from "./registry.js";

afterEach(cleanup);

const hello = East.function([], UIComponentType, (_$) => Text.Root("HELLO"));

/** Records the page's text at the first commit. A later sibling's layout
 *  effect runs once the EastFunction's DOM is in place, before any passive
 *  effect or idle callback — the first frame. */
function FirstFrame({ seen }: { seen: string[] }) {
    useLayoutEffect(() => {
        seen.push(document.body.textContent ?? "");
    }, [seen]);
    return null;
}

function mount(ir: EastFunctionProps["ir"], seen: string[]) {
    return render(
        <ChakraProvider value={system}>
            <EastFunction ir={ir} storageKey="east-function" />
            <FirstFrame seen={seen} />
        </ChakraProvider>,
    );
}

describe("EastFunction remounts at its settled size", () => {
    test("the first mount compiles behind a skeleton; a remount of the same IR renders in its first frame", async () => {
        const ir = hello.toIR();
        const first: string[] = [];
        mount(ir, first);
        expect(first[0]).not.toContain("HELLO");
        await screen.findByText("HELLO");
        cleanup();

        const again: string[] = [];
        mount(ir, again);
        expect(again[0]).toContain("HELLO");
    });

    test("the kept compile belongs to the IR object — a new IR compiles again", async () => {
        mount(hello.toIR(), []);
        await screen.findByText("HELLO");
        cleanup();

        const fresh: string[] = [];
        mount(hello.toIR(), fresh);
        expect(fresh[0]).not.toContain("HELLO");
        await screen.findByText("HELLO");
    });

    test("a change to the platform registrations compiles again", async () => {
        const ir = hello.toIR();
        mount(ir, []);
        await screen.findByText("HELLO");
        cleanup();

        // Registering replaces the registry's array, which is its version.
        const unregister = registerPlatformImplementation([]);
        try {
            const after: string[] = [];
            mount(ir, after);
            expect(after[0]).not.toContain("HELLO");
            await screen.findByText("HELLO");
        } finally {
            unregister();
        }
    });
});

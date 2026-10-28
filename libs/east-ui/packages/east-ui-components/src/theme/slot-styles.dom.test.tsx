/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 *
 * A slot's class (#1398, CL9): the class Chakra gives an element drawn with the
 * slot's styles, its rules inserted once, made once for the theme — the same
 * string for every caller, the system asked for the slot's styles once.
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Box, ChakraProvider } from "@chakra-ui/react";
import { system } from "./index.js";
import { useSlotClass, useSlotStyles } from "./slot-styles.js";

afterEach(cleanup);

/** Draws a slot of the Calendar's recipe twice: as Chakra's styled element, and as a plain element of the slot's class. */
function Drawn({ slot }: { slot: string }) {
    const styles = useSlotStyles("calendar");
    const classOf = useSlotClass();
    return <>
        <Box css={styles[slot]} data-drawn="chakra" />
        <div className={classOf(styles[slot])} data-drawn="class" />
        <div className={classOf(styles[slot])} data-drawn="again" />
    </>;
}

/** The rules emotion holds for a class, as its sheets have them in the page. */
function rulesOf(name: string): string[] {
    return [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText)).filter((text) => text.includes(`.${name}`));
}

describe("a slot's class (#1398, CL9)", () => {
    test("is the class Chakra gives an element drawn with the slot's styles, the same string every time, its rules inserted once", () => {
        const { container } = render(<ChakraProvider value={system}><Drawn slot="event" /></ChakraProvider>);
        const [chakra, own, again] = ["chakra", "class", "again"].map((drawn) => container.querySelector<HTMLElement>(`[data-drawn="${drawn}"]`)!.className);
        expect(own).toMatch(/^css-/);
        expect([own, again]).toEqual([chakra, chakra]);
        expect(rulesOf(own!).length).toBeGreaterThan(0);
    });

    test("is made once for the theme: every caller drawing the slot again asks the system for none of its styles", () => {
        render(<ChakraProvider value={system}><Drawn slot="eventTitle" /></ChakraProvider>);
        const styles = system.sva(structuredClone(system.getSlotRecipe("calendar")))({}) as Record<string, unknown>;
        const title = JSON.stringify(styles["eventTitle"]);
        const css = vi.spyOn(system, "css");
        try {
            render(<ChakraProvider value={system}><Drawn slot="eventTitle" /></ChakraProvider>);
            // Chakra's styled element asks again as it draws; the slot's class, made before, asks nothing.
            expect(css.mock.calls.filter((call) => call.some((style) => JSON.stringify(style) === title)).length).toBe(1);
        } finally {
            css.mockRestore();
        }
    });
});

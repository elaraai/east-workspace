/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Story's progress chrome (#1263): its previous and next buttons are Font
 * Awesome's arrow-up and arrow-down, named in words — never a written arrow —
 * and they step the counter.
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent, act } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { East, none, some } from "@elaraai/east";
import { Story, Text, UIComponentType } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { faIcons, loneGlyphs } from "../../testing/icons.js";
import { EastChakraComponent } from "../../component.js";
import { EastChakraStoryProgress } from "./index.js";

afterEach(cleanup);

// jsdom has no media queries and no resize observer; the Story uses both (as the e3 harness stubs them).
(globalThis as { matchMedia?: unknown }).matchMedia ??= (query: string) => ({ matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } });
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

describe("Story.Progress — its step buttons are Font Awesome's arrows (#1263)", () => {
    test("previous is arrow-up and next arrow-down, each named in words and writing no text; next steps the counter", async () => {
        const { container } = render(
            <ChakraProvider value={system}>
                <EastChakraStoryProgress value={{ count: 3n, active: none, title: some("Tour") }} storageKey="story-test" />
            </ChakraProvider>,
        );
        const buttons = ([["Previous step", "arrow-up"], ["Next step", "arrow-down"]] as const).map(([name, icon]) => {
            const button = screen.getByRole("button", { name });
            return [name, button.textContent, faIcons(button, icon).length];
        });
        expect(buttons).toEqual([["Previous step", "", 1], ["Next step", "", 1]]);
        expect(loneGlyphs(container)).toEqual([]);
        // The counter reads the active step; next steps it on.
        const counter = () => container.querySelector('[data-scope="story-progress"]')!.textContent;
        expect(counter()).toBe("Tour1 / 3");
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Next step" })); });
        expect(counter()).toBe("Tour2 / 3");
    });
});

describe("Story — a step's height, worked out from its scrollport, is written inline (#1440)", () => {
    test("each step of a story with a scrollport of its own sets its min-height inline, where a style prop would mint a class for every height a resize gives it", () => {
        const value = East.compile(East.function([], UIComponentType, () => Story.Root([
            Story.Step([Text.Root("One")], { id: "one", title: "One", stage: Text.Root("Stage one") }),
            Story.Step([Text.Root("Two")], { id: "two", title: "Two", stage: Text.Root("Stage two") }),
        ], { height: 440, stageHeight: 340 })), [])();
        const { container } = render(
            <ChakraProvider value={system}>
                <EastChakraComponent value={value} storageKey="story-heights" />
            </ChakraProvider>,
        );
        const steps = [...container.querySelectorAll<HTMLElement>("[data-story-step]")];
        expect(steps).toHaveLength(2);
        expect(steps.map((step) => /^\d+px$/.test(step.style.minHeight))).toEqual([true, true]);
    });
});

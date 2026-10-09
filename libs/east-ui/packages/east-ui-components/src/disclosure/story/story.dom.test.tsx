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
import { none, some } from "@elaraai/east";
import { system } from "../../theme/index.js";
import { faIcons, loneGlyphs } from "../../testing/icons.js";
import { EastChakraStoryProgress } from "./index.js";

afterEach(cleanup);

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

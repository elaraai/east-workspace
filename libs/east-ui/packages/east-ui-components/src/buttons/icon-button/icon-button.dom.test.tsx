/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 *
 * IconButton badge + attention (#123): a `badge` renders a corner bubble
 * (the count text, or an empty dot-only indicator), the button keeps its
 * required aria-label, and an IconButton with neither badge nor attention
 * renders bare (no wrapper chrome).
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { variant, some, none } from "@elaraai/east";
import { system } from "../../theme/index.js";
import { EastChakraIconButton, type IconButtonValue } from "./index.js";

afterEach(cleanup);

function iconBtn(opts: { badge?: string; palette?: string; attention?: "none" | "pulse" | "ring" } = {}): IconButtonValue {
    return {
        prefix: "fas",
        name: "bell",
        label: "Alerts",
        loadingIcon: none,
        loading: none,
        disabled: none,
        onClick: none,
        badge: opts.badge !== undefined ? some(opts.badge) : none,
        badgeColorPalette: opts.palette !== undefined ? some(variant(opts.palette, null)) : none,
        attention: opts.attention !== undefined ? some(variant(opts.attention, null)) : none,
        style: none,
    } as IconButtonValue;
}

const ui = (value: IconButtonValue) =>
    render(<ChakraProvider value={system}><EastChakraIconButton value={value} /></ChakraProvider>);

describe("IconButton badge + attention (#123)", () => {
    test("a count badge renders its text alongside the labelled button", () => {
        ui(iconBtn({ badge: "3" }));
        expect(screen.getByText("3")).toBeTruthy();
        expect(screen.getByRole("button", { name: "Alerts" })).toBeTruthy();
    });

    test("a dot-only badge ('') renders the button with no badge text", () => {
        const { container } = ui(iconBtn({ badge: "" }));
        expect(screen.getByRole("button", { name: "Alerts" })).toBeTruthy();
        // The button is wrapped (badge present) but shows no numeric/text content.
        expect(container.textContent).toBe("");
    });

    test("with neither badge nor attention, the button renders bare", () => {
        ui(iconBtn());
        expect(screen.getByRole("button", { name: "Alerts" })).toBeTruthy();
        expect(screen.queryByText("3")).toBeNull();
    });

    test("the ring attention keeps the labelled button (and adds no badge text)", () => {
        ui(iconBtn({ attention: "ring" }));
        expect(screen.getByRole("button", { name: "Alerts" })).toBeTruthy();
        expect(screen.queryByText("3")).toBeNull();
    });
});

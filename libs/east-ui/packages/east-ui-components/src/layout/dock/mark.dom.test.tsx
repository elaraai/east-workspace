/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * A collapsed pane's rail mark (#1330): after the badge, what the pane holds
 * that needs a look — its icon in its tone, its words for assistive technology
 * and the tooltip — and none without one.
 */
import { afterEach, expect, test } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../../theme/index.js";
import { DockPane } from "./index.js";
afterEach(() => { cleanup(); localStorage.clear(); });

test("the rail's mark follows its badge: its icon, its tone and its words; a pane given none draws none", () => {
    const { container, rerender } = render(<ChakraProvider value={system}>
        <DockPane storageKey="marked" label="Library" icon="layer-group" badge={27} defaultCollapsed body={<div />}
            mark={{ icon: "triangle-exclamation", label: "Overdue event", tone: "warning" }} />
    </ChakraProvider>);
    const mark = container.querySelector<HTMLElement>("[data-dock-mark]")!;
    expect([mark.getAttribute("role"), mark.getAttribute("aria-label"), mark.title, mark.getAttribute("data-tone")]).toEqual(["img", "Overdue event", "Overdue event", "warning"]);
    expect(mark.querySelector("svg[data-icon='triangle-exclamation']")).not.toBeNull();
    expect(mark.previousElementSibling!.hasAttribute("data-dock-badge")).toBe(true);
    rerender(<ChakraProvider value={system}><DockPane storageKey="marked" label="Library" icon="layer-group" badge={27} defaultCollapsed body={<div />} /></ChakraProvider>);
    expect(container.querySelector("[data-dock-mark]")).toBeNull();
});

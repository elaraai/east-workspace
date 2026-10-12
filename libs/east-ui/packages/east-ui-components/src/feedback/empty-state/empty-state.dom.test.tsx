/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The empty state's one mark (#1263): its `icon`, a Font Awesome solid icon
 * drawn by name above the title — never a text glyph — and no mark at all
 * without one; the same for the empty state a host renderer draws as React.
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, cleanup, within } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { East, type ValueTypeOf } from "@elaraai/east";
import { EmptyState, UIComponentType } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { EastChakraComponent } from "../../component.js";
import { faIcons, loneGlyphs, markOf } from "../../testing/icons.js";
import { EmptyStateView } from "./index.js";

afterEach(cleanup);

/** An empty state as its East factory builds it, rendered. */
function mount(options: Parameters<typeof EmptyState.Root>[0]) {
    const value = East.compile(East.function([], UIComponentType, () => EmptyState.Root(options)), [])() as ValueTypeOf<typeof UIComponentType>;
    return render(
        <ChakraProvider value={system}>
            <EastChakraComponent value={value} storageKey="empty-state-test" />
        </ChakraProvider>,
    );
}

/** What the empty state draws above its title: each Font Awesome icon, `fas <name>`, then any text — `null` with no mark. */
const markAbove = (container: HTMLElement): string | null => markOf(within(container).getByRole("heading").parentElement!.previousElementSibling);

describe("EmptyState — its one mark is a Font Awesome solid icon (#1263)", () => {
    test("its icon is drawn by name above the title, the mark writing no text", () => {
        const { container } = mount({ title: "No results", icon: { prefix: "fas", name: "magnifying-glass" }, description: "Try clearing filters." });
        expect(markAbove(container)).toBe("fas magnifying-glass");
        expect(faIcons(container, "magnifying-glass")).toHaveLength(1);
        expect(within(container).getByRole("heading").textContent).toBe("No results");
        expect(loneGlyphs(container)).toEqual([]);
    });

    test("without an icon it draws no mark", () => {
        const { container } = mount({ title: "Nothing here" });
        expect(markAbove(container)).toBeNull();
        expect(container.querySelector("svg")).toBeNull();
    });

    test("the empty state a host renderer draws takes the same icon", () => {
        const { container } = render(
            <ChakraProvider value={system}>
                <EmptyStateView icon={{ prefix: "fas", name: "box-open" }} title="No templates" description="The builder declares none." />
            </ChakraProvider>,
        );
        expect(markAbove(container)).toBe("fas box-open");
        expect(loneGlyphs(container)).toEqual([]);
    });
});

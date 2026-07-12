/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Behaviour guard for the nested-Drawer stack rails (#328):
 *   - a `stacked` ancestor (any drawer that is not the deepest) collapses to a
 *     labeled vertical rail instead of hiding behind the active drawer,
 *   - a NON-stacked ancestor keeps hiding behind (default, unchanged),
 *   - clicking an ancestor rail pops the stack back to it (closes the deeper
 *     drawers) — the rail then disappears as it becomes the active drawer again.
 *
 * DrawerContent (Ark overlay) is mocked to a plain div so the test exercises the
 * overlay-manager stack/rail logic without the portal + body-scroll machinery.
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { variant, some, none } from "@elaraai/east";
import { system } from "../theme/index.js";

// Mock the Ark drawer to a bare div carrying its title — keeps the test on the
// manager's stack/rail logic, not Ark portals / matchMedia / scroll-lock.
vi.mock("./drawer/index.js", async (orig) => {
    const actual = await orig<typeof import("./drawer/index.js")>();
    return {
        ...actual,
        DrawerContent: ({ value }: { value: { title: { type: string; value: string } } }) => (
            <div data-testid="full-drawer">{value.title?.type === "some" ? value.title.value : "drawer"}</div>
        ),
    };
});

import { OverlayManagerProvider, useOverlayManager } from "./overlay-manager.js";
import type { DrawerOpenInputValue } from "./drawer/index.js";

afterEach(cleanup);

/** Hand-built programmatic drawer open input (all optional knobs absent). */
function drawerValue(title: string, stacked: boolean, placement = "end"): DrawerOpenInputValue {
    return {
        body: [],
        eyebrow: none,
        title: some(title),
        description: none,
        style: some({
            size: none,
            placement: some(variant(placement, null)),
            contained: none,
            onOpenChange: none,
            onExitComplete: none,
            bodyPadding: none,
            flush: none,
            fillBody: none,
            stacked: stacked ? some(true) : none,
            stackIcon: none,
        }),
    } as unknown as DrawerOpenInputValue;
}

function Harness({ onReady }: { onReady: (open: (v: DrawerOpenInputValue) => void) => void }) {
    const { openDrawer } = useOverlayManager();
    onReady(openDrawer);
    return null;
}

function mount() {
    let open!: (v: DrawerOpenInputValue) => void;
    const utils = render(
        <ChakraProvider value={system}>
            <OverlayManagerProvider>
                <Harness onReady={(o) => { open = o; }} />
            </OverlayManagerProvider>
        </ChakraProvider>,
    );
    return { ...utils, open };
}

describe("Drawer stack rails (#328)", () => {
    test("a stacked ancestor collapses to a rail; clicking it pops the stack", async () => {
        const { open, queryByRole, getByRole } = mount();

        // Parent (stacked) — alone, it is the deepest, so it renders full (no rail).
        await act(async () => { open(drawerValue("B4418", true)); });
        expect(queryByRole("button", { name: "Back to B4418" })).toBeNull();

        // Child opens on top — the parent becomes an ancestor and collapses to a rail.
        await act(async () => { open(drawerValue("Decisions", false)); });
        const rail = getByRole("button", { name: "Back to B4418" });
        expect(rail).toBeTruthy();

        // Click the rail → pop back to the parent; it is the deepest again, so the
        // rail is gone.
        await act(async () => { fireEvent.click(rail); });
        expect(queryByRole("button", { name: "Back to B4418" })).toBeNull();
    });

    test("a NON-stacked ancestor keeps hiding behind (default unchanged)", async () => {
        const { open, queryByRole } = mount();
        await act(async () => { open(drawerValue("Parent", false)); });
        await act(async () => { open(drawerValue("Child", false)); });
        // No stacked flag → no rail; the ancestor just hides behind the child.
        expect(queryByRole("button", { name: "Back to Parent" })).toBeNull();
    });
});

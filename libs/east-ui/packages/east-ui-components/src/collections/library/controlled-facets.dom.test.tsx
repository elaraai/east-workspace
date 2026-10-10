/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */
import { useState } from "react";
import { expect, test, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { East, some, type ValueTypeOf } from "@elaraai/east";
import { Library, UIComponentType } from "@elaraai/east-ui/internal";
import { getRegisteredPlatformImplementations } from "../../platform/registry.js";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { system } from "../../theme/index.js";
import { EastChakraLibrary } from "./index.js";
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
(globalThis as { CSS?: { escape?: (s: string) => string } }).CSS ??= {};
(globalThis as { CSS: { escape?: (s: string) => string } }).CSS.escape ??= s => s.replace(/[^\w-]/g, "\\$&");
afterEach(() => { cleanup(); localStorage.clear(); });
const program = East.compile(East.function([], UIComponentType, _$ => Library.Root([
    { key: "lead", name: "A. Aspen", role: "Lead" }, { key: "crew", name: "B. Bracken", role: "Crew" },
], { id: "people", item: p => ({ key: p.key, label: p.name }), filters: [{ key: "role", label: "Role", values: p => [p.role] }], search: p => p.name })), getRegisteredPlatformImplementations());
test("host facets, shared filter controls and search all narrow the same compact cards; avatars retain initials", async () => {
    initializeStore(new UIStore()); const component = program() as ValueTypeOf<typeof UIComponentType>;
    if (component.type !== "Library") throw new Error("Expected Library");
    const library = { ...component.value, items: component.value.items.map(item => ({ ...item, avatar: some(item.label) })) };
    function Host() {
        const [values, setValues] = useState<Record<string, string[]>>({ role: ["Lead"] });
        return <ChakraProvider value={system}><button onClick={() => setValues({ role: ["Crew"] })}>Crew only</button><EastChakraLibrary value={library} storageKey="controlled" facetFilter={{ values, onChange: setValues }} /></ChakraProvider>;
    }
    const { container } = render(<Host />);
    expect(screen.getByText('A. Aspen')).not.toBeNull(); expect(screen.queryByText('B. Bracken')).toBeNull();
    expect(container.querySelector('[data-part="fallback"]')?.textContent).toContain('AA');
    await act(async () => { fireEvent.click(screen.getByText('Crew only')); });
    expect(screen.getByText('B. Bracken')).not.toBeNull(); expect(screen.queryByText('A. Aspen')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByText('Show all')); });
    expect(screen.getByText('A. Aspen')).not.toBeNull();
    await act(async () => { fireEvent.change(screen.getByRole('textbox', { name: 'Search library' }), { target: { value: 'Bracken' } }); });
    expect(screen.getByText('B. Bracken')).not.toBeNull(); expect(screen.queryByText('A. Aspen')).toBeNull();
});

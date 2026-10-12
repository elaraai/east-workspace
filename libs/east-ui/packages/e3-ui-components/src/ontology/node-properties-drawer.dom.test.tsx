/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The node drawer's type picker draws Font Awesome's chevron-down, never
 * Chakra's own (#1263) — whether the drawer edits the node or only shows it.
 */

import { describe, test, expect, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { some, variant } from "@elaraai/east";
import { system } from "@elaraai/east-ui-components";
import { foreignIcons, markOf } from "@elaraai/east-ui-components/testing";
import { NodePropertiesDrawer } from "./NodePropertiesDrawer.js";
import type { OntologyNode } from "./types.js";

afterEach(cleanup);

/** A data node, as an ontology value holds one. */
const NODE: OntologyNode = { id: "orders", name: "Orders", description: some("Every order placed."), type: variant("data", null) };

describe("the node drawer's type picker (#1263)", () => {
    for (const editing of [true, false]) {
        test(`its chevron is Font Awesome's chevron-down (${editing ? "editing" : "read-only"})`, () => {
            const edit = editing ? () => {} : null;
            render(
                <ChakraProvider value={system}>
                    <NodePropertiesDrawer nodeId={NODE.id} getNode={(id) => (id === NODE.id ? NODE : undefined)} onClose={() => {}} onUpdate={edit} onDelete={edit} />
                </ChakraProvider>,
            );
            const picker = document.querySelector<HTMLElement>("[class*='native-select__root']")!;
            expect(picker.querySelector("select")!.value).toBe("data");
            expect(markOf(picker.querySelector("[class*='native-select__indicator']"))).toBe("fas chevron-down");
            expect(foreignIcons(picker)).toEqual([]);
        });
    }
});

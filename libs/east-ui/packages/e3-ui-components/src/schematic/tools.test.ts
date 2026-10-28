/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The tools the Schematic offers, the tool in force, and the viewer's choice
 * kept in the UI store (#1387, `tools.ts`, §6.1): Select, Zoom box and Marquee
 * always; Connect while a link kind is editable, Move while an item kind is. A
 * tool the viewer holds that the Schematic does not offer is held as Select,
 * and a link kind no longer editable as the first that is. The choice is an
 * East value under the Schematic's tools key, which every Schematic of that
 * key follows.
 */

import { beforeEach, describe, expect, test } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { decodeBeast2For, equalFor, none, some, variant } from "@elaraai/east";
import { StateRuntime, UIStore } from "@elaraai/east-ui-components";
import { SchematicToolsType, offeredTools, toolsInForce, useSchematicTools } from "./tools.js";

describe("offeredTools", () => {
    test("Select, Zoom box and Marquee always; Connect over an editable link kind; Move over an editable item kind; in the toolbar's order", () => {
        expect(offeredTools({ links: [], movable: false })).toEqual(["select", "zoom", "marquee"]);
        expect(offeredTools({ links: ["fibre"], movable: false })).toEqual(["select", "zoom", "marquee", "connect"]);
        expect(offeredTools({ links: [], movable: true })).toEqual(["select", "zoom", "marquee", "move"]);
        expect(offeredTools({ links: ["fibre", "uplinks"], movable: true })).toEqual(["select", "zoom", "marquee", "connect", "move"]);
    });
});

describe("toolsInForce", () => {
    test("a tool the Schematic offers is held as it is", () => {
        expect(toolsInForce({ tool: "marquee", link: undefined }, { links: [], movable: false })).toEqual({ tool: "marquee", link: undefined });
        expect(toolsInForce({ tool: "move", link: undefined }, { links: [], movable: true })).toEqual({ tool: "move", link: undefined });
    });

    test("a tool it does not offer is held as Select: Connect over no editable link kind, Move over no editable item kind", () => {
        expect(toolsInForce({ tool: "connect", link: "fibre" }, { links: [], movable: true }).tool).toBe("select");
        expect(toolsInForce({ tool: "move", link: undefined }, { links: ["fibre"], movable: false }).tool).toBe("select");
    });

    test("Connect draws the first editable link kind until the viewer picks one, and a kind no longer editable as the first that is", () => {
        expect(toolsInForce({ tool: "connect", link: undefined }, { links: ["fibre", "uplinks"], movable: false })).toEqual({ tool: "connect", link: "fibre" });
        expect(toolsInForce({ tool: "connect", link: "uplinks" }, { links: ["fibre", "uplinks"], movable: false })).toEqual({ tool: "connect", link: "uplinks" });
        expect(toolsInForce({ tool: "connect", link: "patches" }, { links: ["fibre", "uplinks"], movable: false })).toEqual({ tool: "connect", link: "fibre" });
    });
});

describe("useSchematicTools", () => {
    const KEY = "schematic.floor.tools";
    beforeEach(() => { StateRuntime.initializeStore(new UIStore()); });

    test("holds Select and no link kind until the viewer picks; a pick is an East value under the key, which another Schematic of the key follows", () => {
        const first = renderHook(() => useSchematicTools(KEY));
        const second = renderHook(() => useSchematicTools(KEY));
        expect(first.result.current[0]).toEqual({ tool: "select", link: undefined });
        act(() => { first.result.current[1]({ tool: "connect", link: "uplinks" }); });
        expect(first.result.current[0]).toEqual({ tool: "connect", link: "uplinks" });
        expect(second.result.current[0]).toEqual({ tool: "connect", link: "uplinks" });
        const stored = decodeBeast2For(SchematicToolsType)(StateRuntime.getStore().read(KEY)!);
        expect(equalFor(SchematicToolsType)(stored, { tool: variant("connect", null), link: some("uplinks") })).toBe(true);
        act(() => { second.result.current[1]({ tool: "marquee", link: undefined }); });
        expect(first.result.current[0]).toEqual({ tool: "marquee", link: undefined });
        expect(equalFor(SchematicToolsType)(decodeBeast2For(SchematicToolsType)(StateRuntime.getStore().read(KEY)!), { tool: variant("marquee", null), link: none })).toBe(true);
    });

    test("two Schematics of different ids hold their tools apart", () => {
        const floor = renderHook(() => useSchematicTools(KEY));
        const hall = renderHook(() => useSchematicTools("schematic.hall.tools"));
        act(() => { floor.result.current[1]({ tool: "zoom", link: undefined }); });
        expect(hall.result.current[0]).toEqual({ tool: "select", link: undefined });
    });
});

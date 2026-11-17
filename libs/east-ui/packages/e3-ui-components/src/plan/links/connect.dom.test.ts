/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * @vitest-environment jsdom
 *
 * The tool a viewer holds on a Plan (#1541, U10): Select until one is picked;
 * Connect only over an editable link kind, drawing the kind picked, or the
 * first the Plan edits; kept in the UI store under the Plan's tools key, as
 * an East value every Plan under the key follows.
 */

import { beforeEach, describe, expect, test } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { decodeBeast2For, equalFor, none, some, variant } from "@elaraai/east";
import { StateRuntime, UIStore } from "@elaraai/east-ui-components";
import { planKeys } from "@elaraai/e3-ui/internal";
import { PLAN_TOOLS, PlanToolsType, planToolsInForce, usePlanTools } from "./connect.js";

const KEY = planKeys("works").tools;
const sameTools = equalFor(PlanToolsType);
const stored = () => decodeBeast2For(PlanToolsType)(StateRuntime.getStore().read(KEY)!);

describe("planToolsInForce", () => {
    test("Connect over no editable link kind is held as Select", () => {
        expect(planToolsInForce({ tool: "connect", link: "feed" }, [])).toEqual({ tool: "select", link: undefined });
    });

    test("Connect draws the kind picked while the Plan edits it, else the first it edits", () => {
        expect(planToolsInForce({ tool: "connect", link: "runoff" }, ["feed", "runoff"])).toEqual({ tool: "connect", link: "runoff" });
        expect(planToolsInForce({ tool: "connect", link: "gone" }, ["feed", "runoff"])).toEqual({ tool: "connect", link: "feed" });
        expect(planToolsInForce({ tool: "connect", link: undefined }, ["feed"])).toEqual({ tool: "connect", link: "feed" });
    });

    test("Select stays Select, the kind Connect would draw kept beside it", () => {
        expect(planToolsInForce({ tool: "select", link: undefined }, ["feed"])).toEqual({ tool: "select", link: "feed" });
    });

    test("the tools are Select then Connect, in the toolbar's order", () => {
        expect(PLAN_TOOLS).toEqual(["select", "connect"]);
    });
});

describe("usePlanTools", () => {
    beforeEach(() => { StateRuntime.initializeStore(new UIStore()); });

    test("Select and no link kind until the viewer picks; a pick is kept under the Plan's tools key as an East value", () => {
        const plan = renderHook(() => usePlanTools(KEY));
        expect(plan.result.current[0]).toEqual({ tool: "select", link: undefined });
        act(() => { plan.result.current[1]({ tool: "connect", link: "feed" }); });
        expect(plan.result.current[0]).toEqual({ tool: "connect", link: "feed" });
        expect(sameTools(stored(), { tool: variant("connect", null), link: some("feed") })).toBe(true);
        act(() => { plan.result.current[1]({ tool: "select", link: undefined }); });
        expect(sameTools(stored(), { tool: variant("select", null), link: none })).toBe(true);
    });

    test("two Plans of one id hold one tool; a Plan of another id holds its own", () => {
        const first = renderHook(() => usePlanTools(KEY));
        const second = renderHook(() => usePlanTools(KEY));
        const other = renderHook(() => usePlanTools(planKeys("press").tools));
        act(() => { first.result.current[1]({ tool: "connect", link: "feed" }); });
        expect(second.result.current[0]).toEqual({ tool: "connect", link: "feed" });
        expect(other.result.current[0]).toEqual({ tool: "select", link: undefined });
    });
});

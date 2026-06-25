/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Regression tests for issue #106 — a `Navigation.bind` handle (and any callback
 * that captures one) must survive beast2 encode → decode and re-bind to the
 * DECODER's store. Nav handles are captured in serialized UI callbacks (e.g.
 * `onClick={() => nav.go.detail(row)}`), so before the fix encoding one threw.
 *
 * The handle's path-stack methods are now IR-bearing `East.function`s over the
 * `nav_*` primitives, capturing only the store key + the seed path.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    NullType, StringType, IntegerType, StructType, variant, toEastTypeValue,
    encodeBeast2For, decodeBeast2For,
} from "@elaraai/east";
import { Navigation, NavBindHandleType } from "@elaraai/east-ui/internal";
import { getRegisteredPlatformImplementations } from "../../src/platform/registry.js";
import { initializeStore } from "../../src/platform/state-runtime.js";
import { UIStore } from "../../src/platform/state-store.js";
import { NavImpl } from "../../src/platform/nav/index.js";

const ItemRow = StructType({ id: StringType, value: IntegerType });
const cfg = Navigation.config({
    overview: { value: NullType, label: "Overview" },
    detail: { value: ItemRow, label: "Item" },
});
const HandleType = NavBindHandleType(cfg.routes);
const handleTypeVal = toEastTypeValue(HandleType);
const routeTypeVal = toEastTypeValue(cfg.Route);
const initial = [variant("overview", null)];

/** Build a live nav handle by driving the bind impl as the compiler does. */
function bindNav(key: string) {
    return NavImpl[0]!.fn!(handleTypeVal, routeTypeVal)(key, initial);
}

test("#106 — a Navigation.bind handle ENCODES (its methods carry IR)", () => {
    initializeStore(new UIStore());
    const handle = bindNav("nav.encode");
    // Today (pre-fix): throws "Cannot serialize function: no IR attached".
    assert.doesNotThrow(() => encodeBeast2For(HandleType)(handle as never));
});

test("#106 — a captured nav handle round-trips and re-binds to the DECODER's store", () => {
    initializeStore(new UIStore());
    const bytes = encodeBeast2For(HandleType)(bindNav("nav.cb") as never);

    // Decode against a FRESH store — go/pop must operate THERE.
    initializeStore(new UIStore());
    const decoded = decodeBeast2For(HandleType, { platform: getRegisteredPlatformImplementations() })(bytes) as {
        depth: () => bigint;
        current: () => { type: string };
        go: { detail: (row: { id: string; value: bigint }) => null };
        pop: () => null;
    };

    assert.equal(decoded.depth(), 1n, "starts at the captured initial (overview)");
    decoded.go.detail({ id: "x", value: 5n });
    assert.equal(decoded.depth(), 2n, "go.detail pushed onto the decoder store");
    assert.equal(decoded.current().type, "detail", "current() is the pushed route");
    decoded.pop();
    assert.equal(decoded.depth(), 1n, "pop() dropped the leaf");
});

test("#106 — NavImpl ships the backing primitives (decode path)", () => {
    const names = new Set(getRegisteredPlatformImplementations().map(p => p.name));
    for (const name of ["nav_bind", "nav_read", "nav_write", "nav_pop", "nav_go"]) {
        assert.ok(names.has(name), `platform '${name}' must be registered for handle decode to re-bind`);
    }
});

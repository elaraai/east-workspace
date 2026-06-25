/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Runtime regression tests for the `Navigation.bind` (`nav_bind`) platform impl.
 *
 * Drives the real {@link NavImpl} factory exactly as the compiler does —
 * `fn(...typeParams)(...valueArgs)` — through a full navigate / pop / navigateTo
 * lifecycle. Guards the original bug: the impl must recover the path array type by
 * introspecting the handle struct (`path` field output) and feed that
 * `EastTypeValue` straight to `encodeBeast2For`, never re-wrapping the runtime route
 * type with the `ArrayType` TS builder (which produced a malformed type the encoder
 * crashed on with `Object.keys(undefined)`).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { NullType, StringType, IntegerType, StructType, variant, toEastTypeValue } from "@elaraai/east";
import { Navigation, NavBindHandleType } from "@elaraai/east-ui/internal";
import { NavImpl } from "../../src/platform/nav/index.js";

const ItemRow = StructType({ id: StringType, value: IntegerType });
const cfg = Navigation.config({
    overview: { value: NullType, label: "Overview" },
    detail: { value: ItemRow, label: "Item" },
});

interface NavHandle {
    path: () => { type: string; value: { id: string; value: bigint } }[];
    current: () => { type: string; value: { id: string; value: bigint } };
    depth: () => bigint;
    canPop: () => boolean;
    pop: () => null;
    go: Record<string, (payload: unknown) => null>;
    navigateTo: (p: unknown) => null;
}

/** Bind a fresh handle on a unique key (the shared UIStore persists across the module). */
function bind(key: string): NavHandle {
    const handler = NavImpl[0]!.fn!(
        toEastTypeValue(NavBindHandleType(cfg.routes)),
        toEastTypeValue(cfg.Route),
    );
    return handler(key, [variant("overview", null)]) as NavHandle;
}

test("Navigation.bind seeds at the initial leaf", () => {
    const nav = bind("nav.seed");
    assert.equal(nav.depth(), 1n);
    assert.equal(nav.current().type, "overview");
    assert.equal(nav.canPop(), false);
});

test("go.<route>(payload) pushes a typed route (encode/decode roundtrip)", () => {
    const nav = bind("nav.go");
    nav.go.detail!({ id: "item-1", value: 42n });
    assert.equal(nav.depth(), 2n);
    assert.equal(nav.current().type, "detail");
    assert.equal(nav.current().value.id, "item-1");
    assert.equal(nav.current().value.value, 42n);
    assert.equal(nav.canPop(), true);
});

test("pop() drops the leaf", () => {
    const nav = bind("nav.pop");
    nav.go.detail!({ id: "x", value: 1n });
    nav.pop();
    assert.equal(nav.depth(), 1n);
    assert.equal(nav.current().type, "overview");
});

test("navigateTo([…]) replaces the whole stack (nested path)", () => {
    const nav = bind("nav.navto");
    nav.navigateTo([variant("overview", null), variant("detail", { id: "x9", value: 7n })]);
    assert.equal(nav.depth(), 2n);
    assert.equal(nav.path()[1]!.value.id, "x9");
});

test("go closures recover every route name from the handle struct", () => {
    const nav = bind("nav.gofields");
    assert.deepEqual(Object.keys(nav.go).sort(), ["detail", "overview"]);
});

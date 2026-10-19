/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { expect, test } from "vitest";
import { IntegerType, encodeBeast2For } from "@elaraai/east";
import { UIStore } from "./state-store.js";

const encode = encodeBeast2For(IntegerType);
/** Calls past this many in one write are a flush visiting a subscriber again: the subscriber stops subscribing again there, so even a flush that does ends. */
const BOUND = 20;

test("a subscriber that subscribes again from its own callback, as a tracked read's run does, is called once a write (#1354)", () => {
    const store = new UIStore();
    let calls = 0;
    // Another subscriber on the key, so the set the flush walks is not emptied while the first is out of it.
    store.subscribe("k", () => {});
    let unsubscribe = store.subscribe("k", function again() {
        calls += 1;
        if (calls >= BOUND) return;
        unsubscribe();
        unsubscribe = store.subscribe("k", again);
    });
    store.write("k", encode(1n));
    expect(calls).toBe(1);
    // Still subscribed: the next write calls it again, once.
    store.write("k", encode(2n));
    expect(calls).toBe(2);
});

test("a global subscriber that subscribes again from its own callback is called once a write", () => {
    const store = new UIStore();
    let calls = 0;
    store.subscribe(() => {});
    let unsubscribe = store.subscribe(function again() {
        calls += 1;
        if (calls >= BOUND) return;
        unsubscribe();
        unsubscribe = store.subscribe(again);
    });
    store.write("k", encode(1n));
    expect(calls).toBe(1);
});

test("a subscriber another's callback removes during the flush is not called", () => {
    const store = new UIStore();
    const called: string[] = [];
    let offB = () => {};
    store.subscribe("k", () => { called.push("a"); offB(); });
    offB = store.subscribe("k", () => { called.push("b"); });
    store.write("k", encode(1n));
    expect(called).toEqual(["a"]);
});

test("a subscriber another's callback subscribes again, the key's set replaced, is still called once", () => {
    const store = new UIStore();
    const called: string[] = [];
    let offA = () => {};
    let offB = () => {};
    const b = () => { called.push("b"); };
    const a = () => {
        called.push("a");
        // Every subscriber leaves, so the key's set goes, and both come back in a set of their own.
        offA();
        offB();
        offA = store.subscribe("k", a);
        offB = store.subscribe("k", b);
    };
    offA = store.subscribe("k", a);
    offB = store.subscribe("k", b);
    store.write("k", encode(1n));
    expect(called).toEqual(["a", "b"]);
});

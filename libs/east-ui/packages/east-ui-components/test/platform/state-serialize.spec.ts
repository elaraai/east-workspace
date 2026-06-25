/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Regression tests for issue #106 — a `State.bind` handle (and any callback that
 * captures one) must survive beast2 encode → decode and re-bind to the DECODER's
 * store.
 *
 * Today `State.bind`'s runtime returns `{read,write,has}` as RAW HOST CLOSURES
 * with no IR, so the type-directed beast2 encoder throws
 * `Cannot serialize function: no IR attached`. The fix makes those methods
 * IR-bearing `East.function`s over `state_read`/`state_write`/`state_has`
 * primitives, capturing only the plain-data key + default — so the handle is
 * ordinary serializable East data, and `decodeBeast2For({platform})` re-binds it
 * to whatever store is current on the decode side.
 *
 * Drives the REAL `State.bind` + `StateImpl` through the compiler, exactly as the
 * extension encode/webview decode path does.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    East, StructType, FunctionType, FloatType, NullType, BooleanType,
} from "@elaraai/east";
import { encodeBeast2For, decodeBeast2For } from "@elaraai/east/internal";
import { State } from "@elaraai/east-ui/internal";
import { getRegisteredPlatformImplementations } from "../../src/platform/registry.js";
import { getStore, initializeStore, enableTracking, disableTracking } from "../../src/platform/state-runtime.js";
import { UIStore } from "../../src/platform/state-store.js";

// The East type of a State.bind([FloatType], ...) handle.
const FloatHandleType = StructType({
    read: FunctionType([], FloatType),
    write: FunctionType([FloatType], NullType),
    has: FunctionType([], BooleanType),
});

/** Build a live State.bind handle by running it through the compiler (as the UI does). */
function bindFloat(key: string, def: number) {
    const platform = getRegisteredPlatformImplementations();
    return East.compile(
        East.function([], FloatHandleType, ($) => { $.return(State.bind([FloatType], key, def)); }),
        platform,
    )() as { read: () => number; write: (v: number) => null; has: () => boolean };
}

/** Swap in a fresh empty store; return it. Mirrors a fresh webview/decoder. */
function freshStore(): UIStore {
    const store = new UIStore();
    initializeStore(store);
    return store;
}

test("#106 — a State.bind handle ENCODES (its methods carry IR)", () => {
    freshStore();
    const handle = bindFloat("s106.encode", 0.0);
    // Today: throws "Cannot serialize function: no IR attached".
    assert.doesNotThrow(() => encodeBeast2For(FloatHandleType)(handle));
});

test("#106 — a callback capturing a State.bind handle round-trips and re-binds to the DECODER's store", () => {
    const platform = getRegisteredPlatformImplementations();
    freshStore();

    // The issue's exact shape: onChange captures the handle and writes through it.
    const PayloadType = StructType({ onChange: FunctionType([FloatType], NullType) });
    const payload = East.compile(
        East.function([], PayloadType, ($) => {
            const probe = $.let(State.bind([FloatType], "s106.cb", 0.0));
            const onChange = East.function([FloatType], NullType, ($$, v) => { $$.return(probe.write(v)); });
            $.return(East.value({ onChange }, PayloadType));
        }),
        platform,
    )();

    const bytes = encodeBeast2For(PayloadType)(payload); // RED today (throws here)

    // Decode against a FRESH store — the write must land THERE, not in the encoder's store.
    const decoderStore = freshStore();
    const decoded = decodeBeast2For(PayloadType, { platform })(bytes) as { onChange: (v: number) => null };
    decoded.onChange(42.0);

    assert.ok(decoderStore.has("s106.cb"), "decoder store should have the key after onChange");
    const raw = decoderStore.read("s106.cb")!;
    assert.equal(decodeBeast2For(FloatType)(raw), 42.0, "callback wrote 42 to the decoder store");
});

test("#106 — after decode, read() falls back to the captured default (eager-init does not re-run)", () => {
    const platform = getRegisteredPlatformImplementations();
    freshStore();
    const bytes = encodeBeast2For(FloatHandleType)(bindFloat("s106.default", 3.5));

    freshStore(); // decode side starts empty — bind does NOT re-run here
    const decoded = decodeBeast2For(FloatHandleType, { platform })(bytes) as { read: () => number; has: () => boolean };
    assert.equal(decoded.read(), 3.5, "read() returns the captured default when the key is absent on decode");
});

test("#106 — read() still registers a reactive dependency (trackKey)", () => {
    freshStore();
    const handle = bindFloat("s106.track", 1.0);
    const tracked = enableTracking();
    handle.read();
    const keys = disableTracking();
    assert.ok(tracked.has("s106.track") || keys.includes("s106.track"), "read() tracks its key");
});

test("#106 — non-serialized path still works (bind → has/read/write)", () => {
    freshStore();
    const handle = bindFloat("s106.local", 2.0);
    assert.equal(handle.has(), true, "has() true after bind (eager-init)");
    assert.equal(handle.read(), 2.0, "read() returns default");
    handle.write(9.0);
    assert.equal(handle.read(), 9.0, "read() returns written value");
});

test("#106 — the backing primitives are registered (so they're available at the extension decode site)", () => {
    // The extension decode site resolves `getRegisteredPlatformImplementations()`
    // per-decode (extension/registry.ts). The primitives ride along on the already-
    // wired `StateImpl` array — no new import wiring needed. Guard against a future
    // regression that would surface as "Platform function 'state_read' is not available".
    const names = new Set(getRegisteredPlatformImplementations().map(p => p.name));
    for (const name of ["state_bind", "state_read", "state_write", "state_has"]) {
        assert.ok(names.has(name), `platform '${name}' must be registered for handle decode to re-bind`);
    }
});

test("#106 — the compiled handle is cached, and the cached handle still re-binds after a store swap", () => {
    freshStore();
    const h1 = bindFloat("s106.cache", 1.0);
    const h2 = bindFloat("s106.cache", 1.0);
    // Same key ⇒ cache hit ⇒ the very same compiled methods (no recompile per render).
    assert.equal(h1.read, h2.read, "same key returns the cached handle");

    // Swap the store; the cached handle must operate on the NEW store (methods
    // resolve getStore() live — the cache never pins a stale store).
    const swapped = freshStore();
    h1.write(9.0);
    assert.ok(swapped.has("s106.cache"), "cached handle wrote to the swapped store");
    assert.equal(h1.read(), 9.0, "cached handle reads the swapped store");
});

/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * End-to-end test for issue #106 over the REAL extension-component path.
 *
 * Unlike `state-serialize.spec.ts` (which hand-builds `FunctionType` structs),
 * this drives the actual surface that throws in production:
 *   EastUI.component(name, S).Root(value)
 *     -> variant("Extension", { kind, payload: East.Blob.encodeBeast(expr, 'v2') })
 * where `value` captures a live `State.bind` handle in a callback. We run the
 * component program (so the lazy runtime encode fires), pull the Extension
 * payload bytes, and decode them exactly as the webview registry does
 * (decodeBeast2For(S, { platform: getRegisteredPlatformImplementations() }))
 * against a FRESH store — then invoke the decoded callback and assert it
 * re-bound to that store.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { East, StructType, FunctionType, FloatType, NullType, decodeBeast2For } from "@elaraai/east";
import { EastUI, UIComponentType, State } from "@elaraai/east-ui/internal";
import { getRegisteredPlatformImplementations } from "../../src/platform/registry.js";
import { initializeStore } from "../../src/platform/state-runtime.js";
import { UIStore } from "../../src/platform/state-store.js";

// A component whose payload carries a callback that writes through a State.bind handle.
const ProbeSchema = StructType({ onChange: FunctionType([FloatType], NullType) });
const Probe = EastUI.component("HandleProbeE2E", ProbeSchema);

test("#106 e2e — an EastUI.component payload capturing a State.bind handle round-trips through the extension path", () => {
    const platform = getRegisteredPlatformImplementations();

    // 1. Build + run the component on the producer side. The State.bind handle is
    //    captured by onChange; East.Blob.encodeBeast fires lazily at runtime.
    initializeStore(new UIStore()); // producer store
    const component = East.compile(
        East.function([], UIComponentType, ($) => {
            const probe = $.let(State.bind([FloatType], "e2e.probe", 0.0));
            const onChange = East.function([FloatType], NullType, ($$, v) => { $$.return(probe.write(v)); });
            $.return(Probe.Root(East.value({ onChange }, ProbeSchema)));
        }),
        platform,
    )() as unknown as { type: string; value: { kind: string; payload: Uint8Array } };

    // 2. It encoded to an Extension variant with an opaque payload blob.
    assert.equal(component.type, "Extension");
    assert.equal(component.value.kind, "HandleProbeE2E");
    const payloadBytes = component.value.payload;
    assert.ok(payloadBytes instanceof Uint8Array && payloadBytes.length > 0);

    // 3. Decode the payload exactly as the webview registry does — against a FRESH
    //    store (the decoder side). The captured handle must re-bind here.
    const decoderStore = new UIStore();
    initializeStore(decoderStore);
    const decoded = decodeBeast2For(ProbeSchema, { platform })(payloadBytes) as { onChange: (v: number) => null };

    // 4. Invoke the decoded callback — it must write to the DECODER's store.
    decoded.onChange(42.0);
    assert.ok(decoderStore.has("e2e.probe"), "decoder store has the key after onChange");
    assert.equal(
        decodeBeast2For(FloatType)(decoderStore.read("e2e.probe")!),
        42.0,
        "the captured handle wrote 42 to the decoder store (re-bound through the extension blob)",
    );
});

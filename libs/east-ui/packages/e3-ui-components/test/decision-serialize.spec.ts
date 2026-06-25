/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Regression tests for issue #106 — a `Decision.bind` handle must survive beast2
 * encode → decode and re-bind to the DECODER's store. Before the fix the handle
 * carried 12 raw host closures (queue / select / answer / resolve / …), so it
 * couldn't encode at all — the design worked around it by shipping a plain-data
 * `DecisionHandleRefType` and reconstructing the handle on the renderer side.
 *
 * The fix makes every method an IR-bearing `East.function` over a `decision_*`
 * primitive, capturing only the plain-data binding descriptors (decisions /
 * judgements) + the derived selection key. The owned `slice` is a serialized
 * `Slice.bind` handle. So the whole handle is ordinary serializable East data.
 *
 * Encode + the selection methods (select / selected / clearSelection) touch only
 * the selection store, so they're exercised here without a live dataset cache;
 * the view-backed methods (queue / judgement / resolve) need registered
 * `Data.bind` views and are covered by the decision examples / loop suite.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { variant, none, toEastTypeValue, encodeBeast2For, decodeBeast2For } from "@elaraai/east";
import type { TreePath } from "@elaraai/e3-types";
import { DecisionConstraintType, DecisionHandleType } from "@elaraai/e3-ui/internal";
import { StateRuntime, UIStore, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components/platform";
import { DecisionBindPlatform } from "../src/decision/handle-runtime.js";

const pathOf = (...segs: string[]): TreePath => segs.map(s => variant("field", s)) as never;
const constraintTypeVal = toEastTypeValue(DecisionConstraintType);

const makeBinding = (name: string) => ({ source: pathOf(name), patch: none, mode: variant("direct", null) });
const decisions = [makeBinding("decisions")];
const judgements = makeBinding("judgements");

/** Drive the `decision_bind` impl as the compiler does → a live handle. */
function bindDecision() {
    const resolver = DecisionBindPlatform[0]!.fn!;
    return resolver(constraintTypeVal)(decisions, judgements, none);
}

interface DecodedDecision {
    selected: () => { type: string; value?: string };
    select: (id: string) => unknown;
    clearSelection: () => unknown;
}

test("#106 — a Decision.bind handle ENCODES (its 12 methods + owned slice carry IR)", () => {
    StateRuntime.initializeStore(new UIStore());
    const handle = bindDecision();
    // Today (pre-fix): throws "Cannot serialize function: no IR attached".
    assert.doesNotThrow(() => encodeBeast2For(DecisionHandleType)(handle as never));
});

test("#106 — a captured decision handle round-trips and its selection re-binds to the DECODER's store", () => {
    StateRuntime.initializeStore(new UIStore());
    const bytes = encodeBeast2For(DecisionHandleType)(bindDecision() as never);

    // Decode against a FRESH store — select/selected must operate THERE.
    StateRuntime.initializeStore(new UIStore());
    const decoded = decodeBeast2For(DecisionHandleType, { platform: getRegisteredPlatformImplementations() })(bytes) as unknown as DecodedDecision;

    assert.equal(decoded.selected().type, "none", "fresh decoder store: nothing selected");
    decoded.select("case-1");
    const sel = decoded.selected();
    assert.equal(sel.type, "some", "select wrote to the decoder store");
    assert.equal(sel.value, "case-1");
    decoded.clearSelection();
    assert.equal(decoded.selected().type, "none", "clearSelection cleared the decoder store");
});

test("#106 — a view-backed method surfaces the host throw (React hook loading-state contract)", () => {
    StateRuntime.initializeStore(new UIStore());
    const bytes = encodeBeast2For(DecisionHandleType)(bindDecision() as never);
    const decoded = decodeBeast2For(DecisionHandleType, { platform: getRegisteredPlatformImplementations() })(bytes) as unknown as { queue: () => unknown };
    // With no Data.bind views registered, viewFor throws; the compiled East
    // method MUST surface that as a JS throw so useDecisionHandle's try/catch
    // renders the loading state (as the pre-#106 raw closures did).
    assert.throws(() => decoded.queue());
});

test("#106 — DecisionBindPlatform ships the backing primitives (decode path)", () => {
    const names = new Set(getRegisteredPlatformImplementations().map(p => p.name));
    for (const name of [
        "decision_bind", "decision_queue", "decision_selected", "decision_select",
        "decision_clear_selection", "decision_decision", "decision_update", "decision_judgement",
        "decision_answer", "decision_add_knowledge", "decision_inject", "decision_resolve", "decision_commit_state",
    ]) {
        assert.ok(names.has(name), `platform '${name}' must be registered for handle decode to re-bind`);
    }
});

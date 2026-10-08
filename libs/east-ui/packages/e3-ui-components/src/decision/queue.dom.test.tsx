/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The DecisionQueue's grouped sections (#1263), over the grouped example and
 * its inputs' declared values: each collapsible section's head leads with
 * Font Awesome's caret — down while the section is open, right while it is
 * collapsed — hidden from a reader and never a text glyph; a click on the
 * head turns it.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { encodeBeast2For, type EastIR, type ValueTypeOf } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui/internal";
import { EastChakraComponent, StateRuntime, UIStore, getRegisteredPlatformImplementations, system } from "@elaraai/east-ui-components";
import { loneGlyphs, markOf } from "@elaraai/east-ui-components/testing";
import * as ex from "@elaraai/e3-ui/examples/decision/queue";
import { ReactiveDatasetCache, datasetCacheKey, initializeReactiveDatasetCache, type DatasetApi } from "../platform/index.js";
// The queue is an extension: its renderer registers as it loads.
import "./queue.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
// jsdom has no `matchMedia`; a Box asks it whether the viewer wants less motion.
(globalThis as { matchMedia?: unknown }).matchMedia ??= (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; },
});

/** The workspace the queue's inputs live in. */
const WORKSPACE = "decision-queue-test";

/** An input of the example's, its declared value in the cache. */
function seed(cache: ReactiveDatasetCache, input: { path: Parameters<ReactiveDatasetCache["write"]>[1]; type: Parameters<typeof encodeBeast2For>[0]; source?: { type: string; value?: unknown } }) {
    if (input.source?.type !== "value") throw new Error("the input declares no value");
    void cache.write(WORKSPACE, input.path, encodeBeast2For(input.type)(input.source.value as never));
}

beforeEach(() => {
    StateRuntime.initializeStore(new UIStore());
    const store = new Map<string, Uint8Array>();
    const api: DatasetApi = {
        async get(ws, path) {
            const bytes = store.get(datasetCacheKey(ws, path));
            if (!bytes) throw new Error(`no dataset ${datasetCacheKey(ws, path)}`);
            return { data: bytes, hash: null };
        },
        async set(ws, path, value) { store.set(datasetCacheKey(ws, path), value); },
        async launchDataflow() { /* in memory — nothing to launch */ },
        async listRoot() { return []; },
        async listAt() { return []; },
        async workspaceStatus() { return { datasets: [] }; },
    };
    const cache = new ReactiveDatasetCache({ workspace: WORKSPACE }, api);
    cache.setScheduler((notify) => queueMicrotask(notify));
    initializeReactiveDatasetCache(cache);
    seed(cache, ex.queueDecisions);
    seed(cache, ex.queueJudgements);
});
afterEach(() => {
    cleanup();
    localStorage.clear();
});

/** Lets the inputs' reads and the renders settle. */
async function settle() {
    await act(async () => {
        for (let i = 0; i < 8; i++) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    });
}

describe("DecisionQueue — a section's caret is Font Awesome's (#1263)", () => {
    test("each collapsible head leads with the caret: down while open, right while collapsed, hidden from a reader; a click turns it", async () => {
        const program = (ex.decisionQueueGrouped.fn.toIR() as EastIR<[], typeof UIComponentType>).compile(getRegisteredPlatformImplementations());
        const { container } = render(
            <ChakraProvider value={system}>
                <EastChakraComponent value={program() as ValueTypeOf<typeof UIComponentType>} storageKey="decision-queue" />
            </ChakraProvider>,
        );
        await settle();
        /** Each head: its words, and its caret — hidden from a reader, and what it draws. */
        const heads = () => [...container.querySelectorAll<HTMLElement>("[data-collapsible]")].map((head) => {
            const caret = head.firstElementChild!;
            return [head.children[1]!.textContent, caret.getAttribute("aria-hidden"), markOf(caret)];
        });
        // The urgency grouping's routine tail ships collapsed.
        expect(heads()).toEqual([
            ["Overdue · 1", "true", "fas caret-down"],
            ["Due today · 1", "true", "fas caret-down"],
            ["Routine · 3", "true", "fas caret-right"],
        ]);
        expect(loneGlyphs(container)).toEqual([]);
        await act(async () => { fireEvent.click(container.querySelectorAll<HTMLElement>("[data-collapsible]")[2]!); });
        expect(heads()[2]).toEqual(["Routine · 3", "true", "fas caret-down"]);
        await act(async () => { fireEvent.click(container.querySelectorAll<HTMLElement>("[data-collapsible]")[0]!); });
        expect(heads()[0]).toEqual(["Overdue · 1", "true", "fas caret-right"]);
    });
});

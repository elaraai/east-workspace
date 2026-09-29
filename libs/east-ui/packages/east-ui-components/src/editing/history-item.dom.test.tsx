/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The history item (#988) is one item of the shared toolbar, the same in every
 * editable collection: the whole bar while the row has room, the buttons alone
 * once it has not — its one step taken after every other item's — and measured
 * again whenever what it says changes. jsdom lays nothing out, so widths are
 * stubbed from the form each item shows: the whole bar 200px, the buttons alone
 * 120; a peer item 300, or 100 once folded; the gap 10px.
 */

import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { IntegerType, StringType, StructType, none, variant } from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";
import { system } from "../theme/index.js";
import { formatters } from "../format/index.js";
import { Toolbar, type ToolbarItem } from "../toolbar/index.js";
import { historyToolbarItem } from "./history-item.js";
import { editingMessages, type EditingWords } from "./messages.js";
import { EditSession } from "./session.js";

afterEach(cleanup);

// jsdom lacks ResizeObserver; the toolbar observes its row and items through it.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }

/** The stubbed layout: the toolbar row's box. */
const row = { px: 0 };

function widthOf(el: Element): number {
    if (el.hasAttribute("data-toolbar")) return row.px;
    switch (el.getAttribute("data-toolbar-item")) {
        case "history": return el.querySelector('[data-history-form="buttons"]') !== null ? 120 : 200;
        case "peer": return el.querySelector('[data-peer="short"]') !== null ? 100 : 300;
        default: return 0;
    }
}

const originalRect = Element.prototype.getBoundingClientRect;
const originalRO = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
beforeAll(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
    Element.prototype.getBoundingClientRect = function (this: Element) {
        const width = widthOf(this);
        return { x: 0, y: 0, left: 0, top: 0, width, height: 30, right: width, bottom: 30, toJSON() { return {}; } } as DOMRect;
    };
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element, pseudo?: string | null) => {
        const style = computed(el, pseudo);
        if (!el.hasAttribute("data-toolbar")) return style;
        return new Proxy(style, { get: (target, prop) => (prop === "columnGap" ? "10px" : Reflect.get(target, prop)) });
    });
});
afterAll(() => {
    Element.prototype.getBoundingClientRect = originalRect;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = originalRO;
    vi.restoreAllMocks();
});

const Run = StructType({ id: StringType, end: IntegerType });
const Draft = Editing.Types.Draft(Run);
const WORDS: EditingWords = { ...formatters("en-US"), m: editingMessages };
const noop = () => {};

function editSession(): EditSession<string> {
    const session = new EditSession<string>({
        sourceId: "runs", entryType: Run, draftType: Draft, idField: "id", auto: false,
        apply: () => variant("applied", { revision: none }), patch: undefined, refresh: undefined,
    });
    session.observeBase(variant("snapshot", [{ id: "a", end: 1n }]));
    return session;
}

/** A collection's own item, which folds before the history does. */
const PEER: ToolbarItem = { key: "peer", forms: [<span data-peer="long" />, <span data-peer="short" />], rank: 5 };

function mount(px: number) {
    row.px = px;
    const history = historyToolbarItem({ session: editSession(), words: WORDS, editing: false, onAction: noop, onIssue: noop });
    return render(<ChakraProvider value={system}><Toolbar items={[PEER, history]} /></ChakraProvider>);
}

function formOf(container: HTMLElement): string | null {
    return container.querySelector("[data-history-form]")!.getAttribute("data-history-form");
}

test("the history item sits at the row's end, and folds to the buttons alone only after every other item has", () => {
    // The whole row: 300 + 200 + 10.
    const whole = mount(510);
    expect(whole.container.querySelector('[data-toolbar-item="history"]')!.hasAttribute("data-toolbar-end")).toBe(true);
    expect(formOf(whole.container)).toBe("full");
    expect(whole.container.querySelector('[data-slot="historyIssues"]')).not.toBeNull();
    cleanup();
    // A pixel less: the peer folds, the bar keeps its status line and its issues.
    const peerFolded = mount(509);
    expect(peerFolded.container.querySelector('[data-peer="short"]')).not.toBeNull();
    expect(formOf(peerFolded.container)).toBe("full");
    cleanup();
    // Past that (100 + 200 + 10 = 310): the buttons alone.
    const folded = mount(309);
    expect(formOf(folded.container)).toBe("buttons");
    expect(folded.container.querySelector('[data-slot="historyIssues"]')).toBeNull();
    for (const name of ["Undo", "Redo", "Discard", "Apply changes"]) {
        expect(folded.container.querySelector(`button[aria-label="${name}"]`)).not.toBeNull();
    }
});

test("the item is measured again when its status line, its issues or its error change", () => {
    const session = editSession();
    const version = () => historyToolbarItem({ session, words: WORDS, editing: false, onAction: noop, onIssue: noop }).version;
    const idle = version();
    session.status = "applying";
    const applying = version();
    expect(applying).not.toBe(idle);
    session.error = "Refused by the host";
    expect(version()).not.toBe(applying);
});

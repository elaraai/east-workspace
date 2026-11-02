/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * What the Inspector's specs (`inspector-bin.dom.test.tsx`,
 * `inspector.dom.test.tsx`) read of the kiln yard's board and do to it — one
 * spec once, seven minutes of one CI shard (#1466) — and over a file's
 * harness, {@link inspectorKit}.
 */
import { expect } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import { DateTimeType, FloatType, StringType, compareFor, type ValueTypeOf } from "@elaraai/east";
import { AllocationFitResultType } from "@elaraai/e3-ui/internal";
import { editingMessages } from "@elaraai/east-ui-components";
import { pointAt } from "@elaraai/east-ui-components/testing";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import { act, settle, slot, type AllocationHarness } from "./harness.test-utils.js";

/** The yard fit's answer, as the harness records it. */
export type FitResult = ValueTypeOf<typeof AllocationFitResultType>;
export const byScore = compareFor(FloatType), byKey = compareFor(StringType);
export const pane = (c: HTMLElement) => slot(c, "end");
export const details = (c: HTMLElement) => pane(c).querySelector<HTMLElement>('[data-allocation-inspector="details"]')!;
export const issuesTab = (c: HTMLElement) => pane(c).querySelector<HTMLElement>('[data-allocation-inspector="issues"]')!;
export const tabs = (c: HTMLElement) => within(pane(c)).getAllByRole("tab");
export const activeTab = (c: HTMLElement) => tabs(c).find(t => t.getAttribute("aria-selected") === "true")?.textContent;
export const card = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-allocation-card="${id}"]`)!;
export const connector = (c: HTMLElement, id: string) => card(c, id).querySelector<HTMLElement>("[data-allocation-connector]")!;
export const row = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-allocation-resource="${key}"]`)!;
export const tableRow = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-allocation-row="${key}"]`)!;
export const libraryCard = (c: HTMLElement, key: string) => slot(c, "start").querySelector<HTMLElement>(`[data-library-item="${key}"]`)!;
export const toolbar = (c: HTMLElement) => within(slot(c, "toolbar"));
export const undo = (c: HTMLElement) => toolbar(c).getByRole("button", { name: editingMessages.undo() });
export const save = (c: HTMLElement) => toolbar(c).getByRole("button", { name: editingMessages.apply() });
export const text = (el: Element | null | undefined) => el?.textContent ?? null;
/** What the inspected head says: its kind, its title, its line, its status and its tone, and a draft's chip. */
export const headOf = (c: HTMLElement) => {
    const d = details(c);
    return {
        kind: text(d.querySelector("[data-inspector-kind]")), title: text(d.querySelector("[data-inspector-title]")), when: text(d.querySelector("[data-inspector-when]")),
        status: text(d.querySelector("[data-inspector-status]")), tone: d.querySelector("[data-inspector-status]")?.getAttribute("data-tone") ?? null,
        chip: text(d.querySelector("[data-inspector-marks] [data-state]")),
    };
};
export const actions = (c: HTMLElement) => [...details(c).querySelectorAll("[data-allocation-bin-actions] button")].map(b => b.textContent);
export const banners = (c: HTMLElement) => [...details(c).querySelectorAll<HTMLElement>("[data-allocation-banner]")].map(b => [b.getAttribute("data-allocation-banner"), b.querySelector("[role]")!.textContent]);
/** A dl's rows: each its label and its value, and its value's tone. */
export const rowsOf = (dl: Element | null) => {
    const cells = [...(dl?.children ?? [])];
    const out: (string | null)[][] = [];
    for (let i = 0; i + 1 < cells.length; i += 2) out.push([cells[i]!.textContent, cells[i + 1]!.textContent, cells[i + 1]!.getAttribute("data-tone")]);
    return out;
};
export const mates = (c: HTMLElement) => [...details(c).querySelectorAll<HTMLElement>("[data-allocation-mate]")].map(m => [...m.children].map(s => s.textContent).concat(m.hasAttribute("data-current") ? ["current"] : []));
/** The Key field among a bin's facts: its label, the key it prints, whether it is read only, and whether it is tinted as a draft. */
export const keyField = (root: HTMLElement) => {
    const field = root.querySelector<HTMLElement>('[data-field="key"]')!;
    return {
        label: field.querySelector("label")!.firstChild!.textContent, value: field.querySelector("input")!.value,
        readOnly: field.getAttribute("data-editor") === "readonly" && field.querySelector("input")!.readOnly, dirty: field.hasAttribute("data-dirty"),
    };
};
export async function press(node: Element | null | undefined) { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(); }
export async function key(c: HTMLElement, k: string) { await act(async () => { fireEvent.keyDown(slot(c, "main"), { key: k }); }); await settle(); }
export async function tab(c: HTMLElement, name: "Details" | "Issues") { await press(tabs(c).find(t => t.textContent!.startsWith(name))); }
export const button = (root: HTMLElement, name: string | RegExp) => within(root).getByRole("button", { name });
/** A row of the Table, its pane scrolled until it is mounted. */
export async function revealRow(c: HTMLElement, key: string) {
    const el = c.querySelector<HTMLElement>("[data-allocation-table] [data-virtual-rows]")!;
    for (let top = 0; c.querySelector(`[data-allocation-row="${key}"]`) === null && top <= 120 * 36; top += 10 * 36) { await act(async () => { el.scrollTop = top; fireEvent.scroll(el); }); await settle(); }
    return tableRow(c, key);
}
/** Scrolls the resource pane until a row far down it is mounted. */
export async function reveal(c: HTMLElement, key: string) {
    const el = c.querySelector<HTMLElement>("[data-allocation-timeline] [data-virtual-rows]")!;
    for (let top = 0; c.querySelector(`[data-allocation-resource="${key}"]`) === null && top <= 33 * 62; top += 6 * 36) { await act(async () => { el.scrollTop = top; fireEvent.scroll(el); }); await settle(); }
    return row(c, key);
}
export async function hover(from: Element, into: Element) {
    expect(from).toBeTruthy(); expect(into).toBeTruthy();
    await act(async () => { pointAt(from); fireEvent.pointerDown(from, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 0, clientY: 0 }); pointAt(into); fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: 10, clientY: 10 }); });
    await settle();
    await act(async () => { pointAt(into); fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: 12, clientY: 12 }); });
    await settle();
}
export async function over(into: Element, x = 14) { await act(async () => { pointAt(into); fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: x, clientY: 12 }); }); await settle(); }
export async function release() { await act(async () => { fireEvent.pointerUp(document, { pointerId: 1, pointerType: "mouse", clientX: 14, clientY: 12 }); }); await settle(); }
export async function cancel() { await act(async () => { fireEvent.keyDown(document, { key: "Escape", code: "Escape" }); }); await settle(); }
export const placing = (bin: string) => (ask: FitResult["ask"]) => ask.type === "place" && ask.value.subject.type === "bin" && ask.value.subject.value === bin;
/** An answer's best fits, the current resource excepted. */
export const bestOf = (a: FitResult, current?: string) => [...a.resources].flatMap(([k, f]) => f.type === "fits" && k !== current ? [{ k, score: f.value.score }] : [])
    .sort((x, y) => byScore(y.score, x.score)).slice(0, 3).map(f => f.k);
export const whyOf = (a: FitResult, key: string) => { const f = a.resources.get(key)!; return f.type === "fits" ? f.value.why : f.value.reason; };
export const hour = (h: number, m: number) => new Date(Date.UTC(2027, 4, 11, h, m));
export const byDate = compareFor(DateTimeType);

/** What {@link inspectorKit} gives a file, over its harness. */
export interface InspectorKit {
    /** Mounts the board — the kiln yard's, unless another example is given — and gives its container. */
    readonly open: (example?: { fn: { toIR(): unknown } }) => Promise<HTMLElement>;
    /** The yard fit's latest answer to a question. */
    readonly answerTo: (match: (ask: FitResult["ask"]) => boolean) => FitResult;
}

/** A file's harness's own helpers: the board mounted, and the yard fit's latest answer to a question. */
export function inspectorKit(h: AllocationHarness): InspectorKit {
    return {
        open: async (example = ex.allocationKilnYard) => (await h.mount(example)).container,
        answerTo: (match) => [...h.fits.answers()].reverse().find(a => match((a as FitResult).ask)) as FitResult,
    };
}

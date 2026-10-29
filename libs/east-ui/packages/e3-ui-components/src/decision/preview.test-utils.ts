/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the DecisionQueue's previews' DOM tests read (#1453, `Decision Queue
 * Spec.md` §9.5): the cards in their order and their sections' heads, a
 * card's preview — its rows, each row's measure in its tone, and the entries
 * it draws as the change marks them — a Sheet crop's head and cells, a lanes
 * crop's ruler, a card's options, chip line and actions, and the history's
 * buttons.
 *
 * @packageDocumentation
 */

import { act, fireEvent, within } from "@testing-library/react";
import { settle, slot } from "../e3-web-mount.test-utils.js";

/** The cases whose cards the list draws, in its order. */
export const heads = (container: HTMLElement) => [...container.querySelectorAll("[data-decision-head]")].map(el => el.getAttribute("data-decision-head"));
/** A case's card's head. */
export const head = (container: HTMLElement, key: string) => container.querySelector<HTMLElement>(`[data-decision-head="${key}"]`)!;
/** A case's card. */
export const card = (container: HTMLElement, key: string) => container.querySelector<HTMLElement>(`[data-decision-card="${key}"]`)!;
/** The open card's case's key; `undefined` while none is open. */
export const openCard = (container: HTMLElement) => container.querySelector("[data-decision-card][data-open]")?.getAttribute("data-decision-card") ?? undefined;
/** Each section's head as it reads: its label, its count and its total. */
export const sections = (container: HTMLElement) => [...container.querySelectorAll("[data-decision-section]")].map(el =>
    [el.getAttribute("data-decision-section"), [...el.children].map(part => part.textContent).filter(text => text !== "").join(" | ")]);
/** A case's preview: the one image in its card's head. */
export const preview = (container: HTMLElement, key: string) => head(container, key).querySelector<HTMLElement>("[data-decision-preview]")!;
/** A preview's rows, by the name each heads. */
export const previewRows = (frame: HTMLElement) => [...frame.querySelectorAll<HTMLElement>("[data-preview-row]")].map(row => row.getAttribute("data-preview-row"));
/** A preview's row by the name it heads. */
export const previewRow = (frame: HTMLElement, name: string) => frame.querySelector<HTMLElement>(`[data-preview-row="${name}"]`)!;

/**
 * A row's measure, as it reads, and the tone it is drawn in.
 *
 * @param row - The row
 * @param text - Its measure's words
 * @returns The tone; `undefined` for neither better nor worse
 */
export function measure(row: HTMLElement, text: string): string | undefined {
    return within(row).getByText(text).getAttribute("data-tone") ?? undefined;
}

/**
 * A duty's tile in a row, as the change marks it.
 *
 * @param row - The row
 * @param key - The duty's key
 * @returns Its mark, its fill and its title; `undefined` where the row draws none
 */
export function tile(row: HTMLElement, key: string) {
    const el = row.querySelector<HTMLElement>(`[data-preview-tile="${key}"]`);
    return el === null ? undefined : { op: el.getAttribute("data-op") ?? undefined, fill: el.getAttribute("data-fill") ?? undefined, title: el.getAttribute("title") };
}

/** Every entry of a key a row draws — a moved event's ghost and where it lands — as the change marks each. */
export const tiles = (row: HTMLElement, key: string) => [...row.querySelectorAll<HTMLElement>(`[data-preview-tile="${key}"]`)].map(el =>
    ({ op: el.getAttribute("data-op") ?? undefined, fill: el.getAttribute("data-fill") ?? undefined, title: el.getAttribute("title") }));
/** Every entry a lanes row draws, in its order: its mark, how the board draws it — a resource's job before or after the day — and its title. */
export const entries = (row: HTMLElement) => [...row.querySelectorAll<HTMLElement>("[data-preview-tile]")].map(el =>
    ({ op: el.getAttribute("data-op") ?? undefined, look: el.getAttribute("data-look") ?? undefined, title: el.getAttribute("title") }));
/** The duties a row draws that the change marks. */
export const marked = (row: HTMLElement) => [...row.querySelectorAll("[data-preview-tile][data-op]")].map(el => el.getAttribute("data-preview-tile"));
/** A Sheet crop's head: its columns' heads. */
export const sheetHead = (frame: HTMLElement) => [...frame.firstElementChild!.children].map(el => el.textContent);

/**
 * A Sheet crop's row's name.
 *
 * @param row - The row
 * @returns Its mark and its title
 */
export function sheetName(row: HTMLElement) {
    const el = row.querySelector<HTMLElement>("[data-preview-name]")!;
    return { op: el.getAttribute("data-op") ?? undefined, title: el.getAttribute("title") };
}

/** A Sheet crop's row's cells, as the change marks each: its column, its value, its mark and fill, its title and its guess's. */
export const sheetCells = (row: HTMLElement) => [...row.querySelectorAll<HTMLElement>("[data-preview-cell]")].map(el => ({
    column: el.getAttribute("data-preview-cell"), value: el.querySelector("[data-value]")?.textContent, op: el.getAttribute("data-op") ?? undefined,
    fill: el.getAttribute("data-fill") ?? undefined, title: el.getAttribute("title"),
    guess: el.querySelector("[data-preview-guess]")?.getAttribute("title") ?? undefined,
}));
/** A lanes crop's ruler: the times it labels. */
export const ruler = (frame: HTMLElement) => [...frame.querySelectorAll("[data-preview-ruler] span")].map(el => el.textContent).filter(text => text !== "");
/** One of a card's options, by the start of its name: its label. */
export const optionOf = (container: HTMLElement, key: string, label: RegExp) => within(card(container, key)).getByRole("option", { name: label });
/** A card's chip line: `Proposed` or `Modified`, and the summary — the head's part after the preview. */
export const chipLine = (container: HTMLElement, key: string) => head(container, key).children[3] as HTMLElement;
/** One of a card's actions. */
export const action = (container: HTMLElement, key: string, name: string) => within(card(container, key)).getByRole("button", { name });
/** One of the history item's buttons. */
export const history = (container: HTMLElement, name: string) => within(slot(container, "toolbar")).getByRole<HTMLButtonElement>("button", { name });

/**
 * Presses a control, and lets what it records and sends settle.
 *
 * @param el - The control
 */
export async function press(el: Element) {
    await act(async () => { fireEvent.click(el); });
    await settle();
}

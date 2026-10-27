/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The agenda keeps the keyboard as a card's own action takes its card away
 * (#1398). A narrow Calendar's cards carry their explicit actions outside
 * Details — Delete, Return to backlog, Move — and one that takes its card from
 * where it was drawn would leave the focus, on a control that went with the
 * card, on the page's body, where the next Tab starts again at the page's top.
 * The agenda keeps it, as Details keep theirs (`../shared/focus-home.ts`): once
 * the agenda is drawn again, the focus lands on the head of the card drawn in
 * its place — the same event's, a Move to another of the agenda's days — else
 * of the card that came after it, else of the one before it, else on the
 * Calendar's main. A focus that left the agenda — for another element, for the
 * page with the control it was on still there, or a press anywhere outside it —
 * is let be; one in a popover a card's control opened — Move's, Resize's — is
 * the agenda's still, so a Move that takes its card to another day lands on it
 * there.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useRef, type FocusEvent, type RefObject } from "react";

/** What marks a card, its event as `eventKey` prints it. */
const CARD = "data-calendar-card";

/** The card the keyboard was last in, and the cards either side of it then, by their events. */
interface LastCard {
    readonly card: string;
    readonly next: string | undefined;
    readonly previous: string | undefined;
}

/** What the agenda's element spreads: its ref, and its focus and blur listeners. */
export interface AgendaLanding<E extends HTMLElement> {
    /** The agenda's element. */
    readonly ref: RefObject<E | null>;
    /** Hears the focus enter the agenda, or move within it. */
    readonly onFocus: (event: FocusEvent<E>) => void;
    /** Hears the focus leave an element of the agenda. */
    readonly onBlur: (event: FocusEvent<E>) => void;
}

/**
 * The card after a card, or before it, in the agenda's order — the document's.
 *
 * @param region - The agenda
 * @param card - The card
 * @param forward - After it, else before it
 * @returns Its event; `undefined` at the agenda's end
 */
function adjacent(region: Element, card: Element, forward: boolean): string | undefined {
    const walker = region.ownerDocument.createTreeWalker(region, NodeFilter.SHOW_ELEMENT, {
        acceptNode: node => (node as Element).hasAttribute(CARD) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP,
    });
    walker.currentNode = card;
    const found = (forward ? walker.nextNode() : walker.previousNode()) as Element | null;
    return found?.getAttribute(CARD) ?? undefined;
}

/**
 * Whether an element is in a popover a control of the agenda opened — a card's Move or Resize — its trigger, open, in
 * the agenda.
 *
 * @param region - The agenda
 * @param element - The element
 * @returns Whether the popover's trigger is the agenda's
 */
function inAgendaLayer(region: Element, element: Element): boolean {
    const content = element.closest('[data-scope="popover"][data-part="content"]');
    if (content === null || content.id === "") return false;
    for (const trigger of region.querySelectorAll('[aria-expanded="true"][aria-controls]')) {
        if (trigger.getAttribute("aria-controls") === content.id) return true;
    }
    return false;
}

/**
 * A card's head: the control its title is on, which selects its event.
 *
 * @param region - The agenda
 * @param event - The card's event, as `eventKey` prints it
 * @returns The head; `null` with no such card drawn
 */
function headOf(region: Element, event: string | undefined): HTMLElement | null {
    if (event === undefined) return null;
    for (const card of region.querySelectorAll(`[${CARD}]`)) {
        if (card.getAttribute(CARD) === event) return card.querySelector<HTMLElement>("button");
    }
    return null;
}

/**
 * Keeps the keyboard in the agenda (see the module docs).
 *
 * @returns What the agenda's element spreads
 */
export function useAgendaLanding<E extends HTMLElement = HTMLDivElement>(): AgendaLanding<E> {
    const ref = useRef<E | null>(null);
    // Whether the keyboard is the agenda's: set as the focus enters it; let go as the focus leaves for another element,
    // or for the page with the control it was on still there, and at a press outside it.
    const held = useRef(false);
    const last = useRef<LastCard | undefined>(undefined);
    useEffect(() => {
        const region = ref.current;
        if (region === null || typeof MutationObserver === "undefined") return undefined;
        const doc = region.ownerDocument;
        // The agenda drawn again: a control it held the focus on gone, the focus lands on the card drawn in its place, or
        // the one after it, or before it — else on the Calendar's main.
        const observer = new MutationObserver(() => {
            if (!held.current) return;
            const active = doc.activeElement;
            if (active !== null && active !== doc.body) {
                if (!region.contains(active) && !inAgendaLayer(region, active)) held.current = false;
                return;
            }
            const was = last.current;
            const landing = headOf(region, was?.card) ?? headOf(region, was?.next) ?? headOf(region, was?.previous)
                ?? region.querySelector<HTMLElement>(`[${CARD}] button`) ?? region.closest<HTMLElement>("[data-calendar-main]");
            landing?.focus();
        });
        observer.observe(region, { childList: true, subtree: true });
        // A press outside the agenda and the popovers its cards opened is the viewer's move elsewhere, whatever it focuses.
        const onDown = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Element) || (!region.contains(target) && !inAgendaLayer(region, target))) held.current = false;
        };
        doc.addEventListener("pointerdown", onDown, true);
        return () => {
            observer.disconnect();
            doc.removeEventListener("pointerdown", onDown, true);
        };
    }, []);
    const onFocus = useCallback((event: FocusEvent<E>) => {
        held.current = true;
        const region = ref.current;
        const card = event.target instanceof Element ? event.target.closest(`[${CARD}]`) : null;
        if (region === null || card === null || !region.contains(card)) return;
        const id = card.getAttribute(CARD);
        if (id !== null) last.current = { card: id, next: adjacent(region, card, true), previous: adjacent(region, card, false) };
    }, []);
    const onBlur = useCallback((event: FocusEvent<E>) => {
        const region = ref.current;
        const next = event.relatedTarget;
        if (next instanceof Element && region !== null && (region.contains(next) || inAgendaLayer(region, next))) return;
        if (next !== null) {
            held.current = false;
            return;
        }
        // To the page: let go where the control is still there — a click on nothing — and kept where it went with its card.
        const left = event.target;
        queueMicrotask(() => { if (left.isConnected) held.current = false; });
    }, []);
    return { ref, onFocus, onBlur };
}

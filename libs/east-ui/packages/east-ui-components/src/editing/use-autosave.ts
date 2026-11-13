/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * An automatic Save (`autosave.ts`) bound to the page, and to the choice its
 * builder keeps.
 *
 * - **The choice** is each builder's own: what its author begins it at — off,
 *   said nothing — until its viewer chooses, and then the viewer's, kept in
 *   the browser (`autosave-choice.ts`).
 * - **Never on where it cannot be turned off.** Every form of the bar shows
 *   the choice's control: the chevron beside Save, and in a phone's row too
 *   short for it, More, which holds the switch in its place (`HistoryBar.tsx`).
 *   So an author's on stands wherever a bar is drawn.
 * - **One a session or history.** Every history bar that shows a session —
 *   the toolbar draws the bar in each of its forms — shares the one automatic
 *   Save made for it, there while a bar shows it.
 * - **What it hears of the person.** A key pressed or a pointer let go
 *   anywhere in the page starts its pause again; a pointer held, a drag in
 *   flight (the shared drag layer's, a keyboard's included), an editor open
 *   and a run of the optimiser out hold it, each said by the bars that know;
 *   and a tab hidden, or a page left, sends at once what is due. A pointer is
 *   held only while it is down, as far as the page can know: a finger whose
 *   lift is never heard — a phone does not always say a finger ended — is let
 *   go of as the page's next first finger lands, as a mouse presses, and as the
 *   window is left (the fingers' own record, `../pointer/touches.ts`). Held
 *   on, it would hold every Save back until the page was left.
 *
 * @packageDocumentation
 */
import { useEffect, useId, useSyncExternalStore } from "react";
import { useDragLayerOptional } from "../dnd/drag-layer.js";
import { keptFlag, useKeptValue } from "../platform/kept.js";
import { makeTouches } from "../pointer/touches.js";
import { createAutosave, type Autosave, type AutosaveHold, type AutosaveTarget } from "./autosave.js";
import type { AutosaveKept } from "./autosave-choice.js";

/** One target's automatic Save, while a bar shows it: who shows it, and who holds it for what. */
interface Bound {
    readonly autosave: Autosave;
    readonly users: Set<string>;
    readonly holders: Map<AutosaveHold, Set<string>>;
    readonly unbind: () => void;
}

const bound = new WeakMap<object, Bound>();

/**
 * Binds an automatic Save to what the page hears of the person: keys,
 * pointers, and the page going.
 *
 * @param autosave - The automatic Save
 * @returns What unbinds it
 */
function bindPage(autosave: Autosave): () => void {
    if (typeof document === "undefined") return () => undefined;
    // The pointers down on the page, as far as it can know. The fingers are the shared record of them
    // (`../pointer/touches.ts`): one whose lift is never heard is let go of as the page's next first finger lands — the
    // browser's primary pointer, down while no other finger is on the page. A mouse or a pen is one pointer.
    const fingers = makeTouches();
    const others = new Set<number>();
    const held = (): void => { autosave.hold("pointer", fingers.size + others.size > 0); };
    const onDown = (event: PointerEvent): void => {
        if (event.pointerType === "touch") {
            fingers.down(event.pointerId, { x: event.clientX, y: event.clientY }, event.isPrimary);
        } else {
            // A mouse or a pen presses alone, as on a surface (`../pointer/gestures.ts`): a press its release was not heard
            // of — let go outside the window — is not held on, nor is a finger whose lift was never heard.
            fingers.clear();
            others.clear();
            others.add(event.pointerId);
        }
        held();
    };
    const onUp = (event: PointerEvent): void => {
        fingers.end(event.pointerId);
        others.delete(event.pointerId);
        autosave.touch();
        held();
    };
    // A pointer the page stopped hearing of — its window left, its tab hidden: none is held.
    const onLost = (): void => {
        if (fingers.size + others.size === 0) return;
        fingers.clear();
        others.clear();
        held();
    };
    const onKey = (): void => { autosave.touch(); };
    const onHidden = (): void => {
        if (document.visibilityState !== "hidden") return;
        onLost();
        autosave.flush();
    };
    const onLeave = (): void => { autosave.flush(); };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onUp, true);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("blur", onLost);
    window.addEventListener("pagehide", onLeave);
    return () => {
        document.removeEventListener("pointerdown", onDown, true);
        document.removeEventListener("pointerup", onUp, true);
        document.removeEventListener("pointercancel", onUp, true);
        document.removeEventListener("keydown", onKey, true);
        document.removeEventListener("visibilitychange", onHidden);
        window.removeEventListener("blur", onLost);
        window.removeEventListener("pagehide", onLeave);
    };
}

/** A target's automatic Save, made as its first bar shows it. */
function bind(target: AutosaveTarget & object, user: string): Bound {
    let entry = bound.get(target);
    if (entry === undefined) {
        const autosave = createAutosave(target);
        entry = { autosave, users: new Set(), holders: new Map(), unbind: bindPage(autosave) };
        bound.set(target, entry);
    }
    entry.users.add(user);
    return entry;
}

/** A bar shows a target no more: what it held is let go, and the automatic Save goes with its last bar. */
function release(target: object, user: string): void {
    const entry = bound.get(target);
    if (entry === undefined) return;
    for (const [reason, holders] of entry.holders) {
        if (holders.delete(user)) entry.autosave.hold(reason, holders.size > 0);
    }
    entry.users.delete(user);
    if (entry.users.size > 0) return;
    entry.unbind();
    entry.autosave.dispose();
    bound.delete(target);
}

/** A bar holds a target's automatic Save for something, or lets it go: held while any bar holds it. */
function hold(target: object, user: string, reason: AutosaveHold, on: boolean): void {
    const entry = bound.get(target);
    if (entry === undefined) return;
    let holders = entry.holders.get(reason);
    if (holders === undefined) { holders = new Set(); entry.holders.set(reason, holders); }
    if (on) holders.add(user);
    else holders.delete(user);
    entry.autosave.hold(reason, holders.size > 0);
}

/** What a bar knows that no automatic Save is sent under. */
export interface AutosaveHolds {
    /** An editor is open: what it holds is no draft yet. */
    readonly editing: boolean;
    /** A run of the app's optimiser is out. */
    readonly locked: boolean;
}

/** A builder's choice, as a bar shows it and sets it. */
export interface AutosaveChoice {
    /** Whether its changes are saved by themselves: the viewer's own choice, else what its author begins it at. */
    readonly on: boolean;
    /** Turn it on, or off: kept for the builder. */
    readonly set: (on: boolean) => void;
}

/**
 * A session's, or a history's, automatic Save, for a history bar that shows
 * it: bound to the page while the bar is mounted, on while its builder's
 * choice is, and held for what the bar knows of.
 *
 * @param target - The session, or the history, the bar shows
 * @param choice - Its builder's choice (`autosaveChoiceOf`): where it is kept, and what its author begins it at
 * @param holds - What the bar knows that no Save is sent under
 * @returns The choice, and what sets it
 */
export function useAutosave(target: AutosaveTarget & object, choice: AutosaveKept, holds: AutosaveHolds): AutosaveChoice {
    // The viewer's own choice, once made; until then what the builder's author says, as it stands now.
    const [chosen, set] = useKeptValue(choice.key, keptFlag);
    const begins = useSyncExternalStore(choice.subscribe, choice.begins, choice.begins);
    const on = chosen ?? begins;
    const user = useId();
    const dragging = useDragLayerOptional()?.active ?? false;
    useEffect(() => {
        bind(target, user);
        return () => release(target, user);
    }, [target, user]);
    useEffect(() => { bound.get(target)?.autosave.enable(on); }, [target, on]);
    useEffect(() => { hold(target, user, "editor", holds.editing); }, [target, user, holds.editing]);
    useEffect(() => { hold(target, user, "run", holds.locked); }, [target, user, holds.locked]);
    useEffect(() => { hold(target, user, "drag", dragging); }, [target, user, dragging]);
    return { on, set };
}

/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Elara eye as a builder's optimise tests watch it (#1409): what it draws
 * for a moment — its one blink as a run lands with nothing to change — is
 * watched as the DOM moves from before the run, so a slow machine that spends
 * that moment before the test looks still sees it.
 *
 * @packageDocumentation
 */

/**
 * Whether the eye blinks from now on, watched as the DOM moves: its one blink (560 ms) is still seen when the answer's
 * banner lands after it has gone again on a slow machine — an attribute that came and went before the observer heard
 * of it by the old value its removal leaves.
 *
 * @param container - What the builder rendered into, the eye its `[data-optimise-button]`
 * @returns Whether a blink was seen, and how to stop watching
 */
export function blinks(container: HTMLElement): { seen: () => boolean; stop: () => void } {
    let seen = false;
    const note = (records: readonly MutationRecord[] = []) => {
        const eye = container.querySelector("[data-optimise-button]");
        if (eye?.hasAttribute("data-blink") === true || records.some(record => record.oldValue !== null)) seen = true;
    };
    const observer = new MutationObserver(note);
    observer.observe(container, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-blink"], attributeOldValue: true });
    note();
    return { seen: () => seen, stop: () => observer.disconnect() };
}

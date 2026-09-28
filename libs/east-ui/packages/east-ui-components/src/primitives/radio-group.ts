/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The WAI-ARIA radio group's arrow keys, shared by the Plan's segment strips
 * (#632) and the Sheet's context switch (#860). The group is ONE tab stop,
 * on its checked radio; ← / ↑ and → / ↓ move to the previous and next radio,
 * wrapping, and Home / End to the first and last. The radio a key lands on
 * takes focus and is picked, as the pattern has it. A click, Enter or Space
 * picks the radio it is on — that is the radio's own button.
 *
 * @packageDocumentation
 */

import type { KeyboardEvent } from "react";

/**
 * Move a radio group to the radio a key names, focus it, and pick it.
 *
 * @param e - The group's keydown: its `currentTarget` holds the radios (`role="radio"`), its `target` the focused one
 * @param pick - Picks the radio at an index, in the group's DOM order
 * @returns Whether the key was the group's — it is then handled, so the page does not scroll
 */
export function radioGroupKey(e: KeyboardEvent<HTMLElement>, pick: (index: number) => void): boolean {
    const radios = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[role='radio']"));
    const i = radios.indexOf(e.target as HTMLElement);
    if (i < 0) return false;
    const last = radios.length - 1;
    let j: number;
    switch (e.key) {
        case "ArrowRight": case "ArrowDown": j = i === last ? 0 : i + 1; break;
        case "ArrowLeft": case "ArrowUp": j = i === 0 ? last : i - 1; break;
        case "Home": j = 0; break;
        case "End": j = last; break;
        default: return false;
    }
    e.preventDefault();
    radios[j]!.focus();
    pick(j);
    return true;
}

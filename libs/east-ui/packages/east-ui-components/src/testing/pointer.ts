/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A press's release as a browser runs it (east-workspace#1779): the pointer's
 * release, the mouse's and the click it makes, each run to its end — the work
 * it queues, Zag's machines' and React's, with it — before the next, as a
 * page's own events are. A test that dispatches the three as one, as
 * user-event's release does, runs no queued work between them, so a click
 * there hears nothing a part did as the press let go (`usePressRelease`): a
 * tags input's tag, made from what was typed in it.
 *
 * Shared through `@elaraai/east-ui-components/testing` with the sibling
 * renderer packages' tests; it needs React's `act` and a DOM.
 *
 * @packageDocumentation
 */

import { act } from "react";

/**
 * Releases a mouse press held on an element as a browser does: `pointerup`, `mouseup`, then the `click` it makes, each
 * with the work it queued run before the next.
 *
 * @param target - What the press is held on, and what it clicks
 * @param pointerId - The pressing pointer's id: user-event's mouse is 1
 */
export async function releasePress(target: Element, pointerId = 1): Promise<void> {
    const events: readonly (() => Event)[] = [
        () => new PointerEvent("pointerup", { pointerId, pointerType: "mouse", bubbles: true, cancelable: true, composed: true }),
        () => new MouseEvent("mouseup", { bubbles: true, cancelable: true, composed: true }),
        () => new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }),
    ];
    for (const made of events) await act(async () => { target.dispatchEvent(made()); });
}

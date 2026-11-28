/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A combobox's text, held by React, committed at once (east-workspace#1779).
 *
 * Zag's React adapter runs each event of its machine in a microtask after the
 * DOM event (`useMachine`'s `send`), so the `onInputValueChange` a typed key
 * reaches a renderer through is an update outside the key's event: React
 * renders it later, at default priority, and runs that render's passive
 * effects later still. Zag writes the input's text from the value it is given
 * in one of those effects (`syncInputValue`, a `track` of `inputValue`),
 * reading the value of the render it follows. A key typed between that render
 * and its effect is written over with the text before it, and the next key
 * lands on that: typed `keys`, the box holds `kes`. Whether a key lands there
 * is the page's scheduling's to say: a loaded test runner lets one in every
 * time (the key search's flake in CI); Chromium, typed into at full speed and
 * slowed sixfold, let none in.
 *
 * Committed through {@link commitTypedText}, the render and its passive
 * effects run before the microtask ends — React runs a synchronous render's
 * passive effects at its commit — so Zag writes the text just typed, before
 * any later key, however the page's tasks are scheduled. It is what Zag does
 * for its own synchronous bindings (the tags input's `inputValue`,
 * `sync: true`), which the combobox's lacks.
 *
 * Every combobox whose text a renderer holds — the shared combobox, the
 * rail's and a record slice's search, the Sheet's enum and person editor —
 * commits it through here. Zag tells of a change only from its microtasks and
 * its own `flushSync`, never while React renders or commits, so the commit
 * never runs inside one.
 *
 * @packageDocumentation
 */

import { flushSync } from "react-dom";

/**
 * Commits what a combobox's `onInputValueChange` does to the text its renderer holds — at once, so the render and
 * Zag's write of the input's text land before any later key (see the module docs).
 *
 * @param update - The state updates the change makes: the renderer's own text, or its host's
 */
export function commitTypedText(update: () => void): void {
    flushSync(update);
}

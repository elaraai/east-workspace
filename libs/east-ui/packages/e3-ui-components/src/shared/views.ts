/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Which of a component's views an instance offers (e3-ui's `views` prop,
 * `utils/views.ts`): the component's own, in its own order, kept to those the
 * payload lists. An empty list, or one holding none of them, leaves every view:
 * nothing to show is no way to draw a component.
 *
 * @packageDocumentation
 */

/**
 * The views offered, in the component's order.
 *
 * @param order - The component's views, in its switch's order
 * @param views - The payload's list, each entry a case of the component's view variant
 * @returns Those of `order` the list holds; every one where it holds none
 */
export function shownViews<K extends string>(order: readonly K[], views: readonly { readonly type: string }[]): readonly K[] {
    const shown = order.filter(view => views.some(entry => entry.type === view));
    return shown.length === 0 ? order : shown;
}

/**
 * The view to draw: the one held while it is offered, else the first offered. Whatever holds it — storage, state — is
 * left as it stands, so the view comes back should the list offer it again.
 *
 * @param held - The view held
 * @param shown - The views offered
 * @returns The view to draw
 */
export function shownView<K extends string>(held: K, shown: readonly K[]): K {
    return shown.includes(held) ? held : shown[0]!;
}

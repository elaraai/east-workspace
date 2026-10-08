/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * East UI draws Font Awesome's solid icons only (#1263): an icon's `prefix` is
 * `"fas"`. Each factory that takes an icon by value refuses another prefix as
 * it builds, naming the icon and its remedy. An icon given as an East
 * expression is known only when it runs; the renderers register the solid set
 * alone, so an icon of another set draws nothing.
 *
 * @packageDocumentation
 */

import { Expr } from "@elaraai/east";

/** Font Awesome's solid set: the one prefix an East UI icon takes (#1263). */
export const SOLID_PREFIX = "fas";

/**
 * The one prefix an East UI icon takes: Font Awesome's solid set (#1263).
 */
export type SolidIconPrefix = typeof SOLID_PREFIX;

/**
 * Refuses an icon given by value that is not of Font Awesome's solid set
 * (#1263), naming it and its remedy.
 *
 * @param where - The factory taking it, as the message names it: `Icon`, `TreeView.Item`, …
 * @param icon - The icon as the factory took it: a `{ prefix, name }`, an Icon value, an East expression, or none
 * @throws {Error} When the icon is a value whose `prefix` is not `"fas"`
 *
 * @remarks
 * An East expression, or a value whose prefix is one, passes: what it holds
 * is known only when it runs.
 */
export function refuseNonSolid(where: string, icon: unknown): void {
    if (icon === undefined || icon === null || typeof icon !== "object" || icon instanceof Expr) return;
    const { prefix, name } = icon as { prefix?: unknown; name?: unknown };
    if (typeof prefix !== "string" || prefix === SOLID_PREFIX) return;
    const named = typeof name === "string" ? name : "<icon>";
    throw new Error(
        `${where}: \`${prefix} ${named}\` is not a Font Awesome solid icon (#1263) — East UI draws solid icons only: ` +
        `use a solid one, as \`{ prefix: "fas", name: "${named}" }\``);
}

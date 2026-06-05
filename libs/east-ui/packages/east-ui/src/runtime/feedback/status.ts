/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Status>` tag — see the export's JSDoc.
 */

import { Status as StatusFactory, type StatusOptions } from "../../feedback/status/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/**
 * Compact classification chip — a `label` paired with a semantic `value` that
 * sets the dot colour and an auto-injected icon. Use it for freshness
 * indicators, per-row health, and recompute markers, with `pulsing` to signal
 * an in-flight update. Provide an explicit `icon` to override the paired
 * default, or a rich `label` node to add a secondary detail such as a
 * timestamp. Every option is a flat prop ({@link StatusOptions}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Status, HStack, UIComponentType } from "@elaraai/east-ui";
 *
 * const health = East.function([], UIComponentType, _$ => (
 *     <HStack gap="3">
 *         <Status label="Up to date" value="success" />
 *         <Status label="Stale" value="warning" />
 *         <Status label="Recomputing" value="danger" pulsing />
 *     </HStack>
 * ));
 * ```
 *
 * @remarks
 * Carries `Status.Types` — the East data type, the semantic-value enum, and
 * the style struct. `label` accepts a string (coerced to `<Text>`) or any UI
 * node. Desugars to `Status.Root(options)`.
 */
export const Status: JsxTag<StatusOptions> & { Types: typeof StatusFactory.Types } =
    Object.assign(optionsTag(StatusFactory.Root), { Types: StatusFactory.Types });

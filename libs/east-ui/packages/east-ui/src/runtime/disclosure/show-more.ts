/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Disclosure JSX tag for {@link DisclosureFactory | Disclosure} — a block of
 * text clamped to a fixed number of lines with a "show more" / "show less"
 * toggle. Use it to keep long rationale, narrative, or descriptions compact
 * while still letting the reader expand the full text in place.
 */

import { Disclosure as DisclosureFactory } from "../../disclosure/show-more/index.js";
import { content, type ContentProps, type JsxTag } from "../combinators.js";

/**
 * Text truncated to `lines` rows with a show-more / show-less toggle. The text
 * is the children — a plain string or any node. Customise the toggle wording
 * with `moreLabel` / `lessLabel`. Remaining options follow `DisclosureOptions`.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Disclosure, UIComponentType } from "@elaraai/east-ui";
 *
 * const rationale = East.function([], UIComponentType, _$ => (
 *     <Disclosure lines={3n}>
 *         {"Stage 1 was delayed ~6h due to setpoint drift since 02:00. Redirecting feedstock to Stage 2 reduces unmet demand at the cost of 1.2% yield."}
 *     </Disclosure>
 * ));
 * ```
 *
 * @remarks
 * Carries `Disclosure.Types` — the East data type and style struct. Desugars to
 * `Disclosure.Root(text, options)`.
 */
export const Disclosure: JsxTag<ContentProps<typeof DisclosureFactory.Root>> & { Types: typeof DisclosureFactory.Types } =
    Object.assign(content(DisclosureFactory.Root), { Types: DisclosureFactory.Types });

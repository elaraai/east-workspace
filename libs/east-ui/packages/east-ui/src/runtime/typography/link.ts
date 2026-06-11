/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Typography tag for a hyperlink — a navigable run of text pointing at a
 * URL or route. Use it inline within prose or standalone; set `external`
 * for links that should open in a new tab.
 */

import { Link as LinkFactory } from "../../typography/link/index.js";
import { content, type ContentProps, type JsxTag } from "../combinators.js";

/**
 * Link — a hyperlink whose anchor text is the child. `href` is required;
 * set `external` to open in a new tab and pick a `variant` (`underline`,
 * `plain`) or `colorPalette` via flat props ({@link LinkStyle}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Link, UIComponentType } from "@elaraai/east-ui";
 *
 * const docs = East.function([], UIComponentType, _$ => (
 *     <Link href="https://docs.example.com" external variant="underline" colorPalette="blue">
 *         View Documentation
 *     </Link>
 * ));
 * ```
 *
 * @remarks
 * Carries `Link.Types` — the East data type and style struct. Desugars to
 * `Link.Root(text, options)`.
 */
export const Link: JsxTag<ContentProps<typeof LinkFactory.Root>> & { Types: typeof LinkFactory.Types } =
    Object.assign(content(LinkFactory.Root), { Types: LinkFactory.Types });

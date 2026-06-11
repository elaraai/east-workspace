/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Banner>` tag — see the export's JSDoc.
 */

import { Banner as BannerFactory, type BannerOptions } from "../../feedback/banner/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/**
 * Full-width, page-level feedback surface — a persistent notice anchored to a
 * region rather than a transient overlay. Use it for stale-data warnings,
 * frozen-scenario notices, run guardrails, and the confirmations that would
 * otherwise be a toast (save landed, sync in progress). The `status` drives the
 * paired icon and palette; `title` and `description` carry the message and
 * `actions` an optional trailing affordance row. Set `dismissible` with an
 * `onDismiss` callback to add a close button. Every option is a flat prop
 * ({@link BannerOptions}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Banner, Button, UIComponentType } from "@elaraai/east-ui";
 *
 * const stale = East.function([], UIComponentType, _$ => (
 *     <Banner
 *         status="stale"
 *         title="Data last refreshed 48m ago"
 *         description="Some metrics may be stale."
 *         actions={<Button variant="outline">Refresh</Button>}
 *     />
 * ));
 * ```
 *
 * @remarks
 * Carries `Banner.Types` — the East data type, the status enum, and the style
 * struct. `title` / `description` / `actions` accept a string (coerced to
 * `<Text>`) or any UI node. Desugars to `Banner.Root(options)`.
 */
export const Banner: JsxTag<BannerOptions> & { Types: typeof BannerFactory.Types } =
    Object.assign(optionsTag(BannerFactory.Root), { Types: BannerFactory.Types });

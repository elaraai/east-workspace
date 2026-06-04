/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Container `<Card>` tag — card container. Maps to `Card.Root`. */

import { Card as CardFactory } from "../../container/card/index.js";
import { container, type ContainerProps, type JsxTag } from "../combinators.js";

/** Compound builders surfaced on the `<Card>` tag (mirrors the `Card` factory namespace). */
type CardBuilders = {
    Section: typeof CardFactory.Section;
    Header: typeof CardFactory.Header;
};

/**
 * `<Card>` — card container. Body content is the children; `header` /
 * `footer` / `state` and the visual style fields are flat props. `header`
 * takes a `CardHeaderOptions` object (`{ eyebrow, title, meta, description }`)
 * and `footer` a `{ content, actions }` object — the factory composes both.
 * `Card.Section(…)` builds a hairline-separated body section. Maps to
 * `Card.Root`.
 */
export const Card: JsxTag<ContainerProps<typeof CardFactory.Root>> & CardBuilders =
    Object.assign(container(CardFactory.Root), {
        Section: CardFactory.Section,
        Header: CardFactory.Header,
    });

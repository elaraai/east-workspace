/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Card>` tag — see the export's JSDoc.
 */

import { Card as CardFactory } from "../../container/card/index.js";
import { container, type ContainerProps, type JsxTag } from "../combinators.js";

/** Compound builders surfaced on the `<Card>` tag (mirrors the `Card` factory namespace). */
type CardBuilders = {
    Section: typeof CardFactory.Section;
    Header: typeof CardFactory.Header;
    Types: typeof CardFactory.Types;
};

/**
 * Card — a bordered container that groups related content under an optional
 * header and footer. Use it to frame a self-contained unit (a summary, a
 * record, a decision panel) with a consistent surface. Body content is the
 * children; the header strip, footer, runtime `state`, and the visual style
 * fields are all flat props ({@link CardOptions}). `header` takes a
 * {@link CardHeaderOptions} object (`{ eyebrow, title, meta, description }`)
 * and `footer` a `{ content, actions }` object — the factory composes both
 * into the framed surface. `state` swaps the body for a loading / empty /
 * error / permission-denied fallback.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Card, Button, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const panel = East.function([], UIComponentType, _$ => (
 *     <Card
 *         header={{ eyebrow: "Forecast · SE region", title: "Per plan week", meta: "14s ago" }}
 *         footer={{ actions: [<Button variant="subtle">Export</Button>] }}
 *     >
 *         <Text>Scenario vs baseline — per-plan week comparison.</Text>
 *     </Card>
 * ));
 * ```
 *
 * @remarks
 * Carries `Card.Types` (the East data type and style struct) plus two
 * body-content builders mirrored from the factory namespace:
 * - `Card.Section(children, options?)` — a hairline-separated body section
 *   with its own optional title; place its result among the children.
 * - `Card.Header(options)` — composes a standalone header strip, for when a
 *   header is built outside the `header` prop.
 * Desugars to `Card.Root(body, options)`.
 */
export const Card: JsxTag<ContainerProps<typeof CardFactory.Root>> & CardBuilders =
    Object.assign(container(CardFactory.Root), {
        Section: CardFactory.Section,
        Header: CardFactory.Header,
        Types: CardFactory.Types,
    });

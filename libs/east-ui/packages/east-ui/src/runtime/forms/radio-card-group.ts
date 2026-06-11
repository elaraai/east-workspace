/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<RadioCardGroup>` tag — see the export's JSDoc.
 */

import { RadioCardGroup as RadioCardGroupFactory, type RadioCardGroupStyle } from "../../forms/radio-card-group/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/**
 * Single-select card list — like {@link RadioGroup}, but each option renders as a
 * selectable card carrying a `label` plus a `description`. Reach for it when the
 * choices need more explanation (pricing tiers, plan options) than a plain radio
 * label affords. `items` is the `{ value, label, description?, disabled? }` list,
 * `value` the current selection, `orientation` lays cards in a column or row, and
 * `onChange` carries the picked value. See {@link RadioCardGroupStyle}.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { RadioCardGroup, UIComponentType } from "@elaraai/east-ui";
 *
 * const plan = East.function([], UIComponentType, _$ => (
 *     <RadioCardGroup
 *         value="team"
 *         items={[
 *             { value: "starter", label: "Starter", description: "Up to 5 users" },
 *             { value: "team", label: "Team", description: "Up to 50 users" },
 *             { value: "business", label: "Business", description: "Unlimited" },
 *         ]}
 *     />
 * ));
 * ```
 *
 * @remarks
 * Carries `RadioCardGroup.Types`. Bind `value` to a `String` state and wire
 * `onChange` inside a `<Reactive>` block for a live control. Desugars to
 * `RadioCardGroup.Root(options)`.
 */
export const RadioCardGroup: JsxTag<RadioCardGroupStyle> & { Types: typeof RadioCardGroupFactory.Types } =
    Object.assign(optionsTag(RadioCardGroupFactory.Root), { Types: RadioCardGroupFactory.Types });

/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Typography tag for body text — the workhorse run of copy used for
 * paragraphs, labels, captions, and any general-purpose text. It exposes
 * the full type-scale and styling surface and carries seven curated
 * presets (eyebrows, mono labels, leads, the KPI number) as nested tags so
 * recurring typographic roles need no repeated styling.
 */

import { Text as TextFactory } from "../../typography/text/index.js";
import { content, type ContentProps, type JsxTag } from "../combinators.js";

/**
 * The members hung on the `<Text>` tag — its `Types` and `Presets` factory
 * namespaces plus the seven preset roles re-exposed as nested content tags,
 * so a single `Text` import yields `<Text>…</Text>`, the builder form
 * `Text.Presets.Eyebrow(…)`, and the tag form `<Text.Eyebrow>…</Text.Eyebrow>`.
 *
 * @property Types - The `Text` East data type and {@link TextStyle} struct.
 * @property Presets - The preset builder functions (string-in form) backing each nested tag.
 * @property Eyebrow - Mono uppercase eyebrow tag — section labels, status words, frame eyebrows.
 * @property EyebrowSm - Small eyebrow tag — sidebar group headers and dense section markers.
 * @property MonoSm - Inline mono tag — counts, IDs, schema keys, freshness meta.
 * @property MonoLabel - Mono label tag — sidebar items, active toggle labels, dense frame headers.
 * @property MetaSm - Small meta tag — trailing meta inside eyebrow rows and dense table headers.
 * @property Lead - Lead tag — larger introductory prose with relaxed line-height.
 * @property MonoKpi - Mono KPI tag — the big-number tabular-nums numeric display.
 */
type TextBuilders = {
    Types: typeof TextFactory.Types;
    Eyebrow: JsxTag<ContentProps<typeof TextFactory.Presets.Eyebrow>>;
    EyebrowSm: JsxTag<ContentProps<typeof TextFactory.Presets.EyebrowSm>>;
    MonoSm: JsxTag<ContentProps<typeof TextFactory.Presets.MonoSm>>;
    MonoLabel: JsxTag<ContentProps<typeof TextFactory.Presets.MonoLabel>>;
    MetaSm: JsxTag<ContentProps<typeof TextFactory.Presets.MetaSm>>;
    Lead: JsxTag<ContentProps<typeof TextFactory.Presets.Lead>>;
    MonoKpi: JsxTag<ContentProps<typeof TextFactory.Presets.MonoKpi>>;
};

/**
 * Body text — the general-purpose run of copy. The text is the child;
 * every typographic option (weight, size via `textStyle`, colour, family,
 * alignment, transforms, spacing, numeric variants) is a flat prop
 * ({@link TextStyle}). Reach for a nested preset (`<Text.Eyebrow>`,
 * `<Text.MonoLabel>`, `<Text.Lead>`, `<Text.MonoKpi>`, …) when the role is
 * a recurring one rather than restyling `<Text>` each time.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const styled = East.function([], UIComponentType, _$ => (
 *     <Text color="link" fontWeight="bold" fontStyle="italic" background="bg.brand.subtle">
 *         Styled Text
 *     </Text>
 * ));
 * ```
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East, IntegerType, NullType } from "@elaraai/east";
 * import { Text, Button, Reactive, State, VStack, UIComponentType } from "@elaraai/east-ui";
 *
 * const counter = East.function([], UIComponentType, _$ => (
 *     <Reactive>{$ => {
 *         const count = $.let(State.bind([IntegerType], "text_counter", 0n));
 *         const value = $.let(count.read());
 *         const bump = $.const(East.function([], NullType, $ => {
 *             const cur = $.let(count.read());
 *             $(count.write(cur.add(1n)));
 *         }));
 *         return (
 *             <VStack gap="3" align="stretch">
 *                 <Text>{East.str`Clicked ${East.print(value)} times`}</Text>
 *                 <Button onClick={bump}>Click me</Button>
 *             </VStack>
 *         );
 *     }}</Reactive>
 * ));
 * ```
 *
 * @remarks
 * Carries `Text.Types` (the East data type and {@link TextStyle} struct),
 * `Text.Presets` (the preset builder functions), and the seven preset
 * roles as nested tags — `Text.Eyebrow`, `Text.EyebrowSm`, `Text.MonoSm`,
 * `Text.MonoLabel`, `Text.MetaSm`, `Text.Lead`, `Text.MonoKpi`. Desugars
 * to `Text.Root(text, options)`.
 */
export const Text: JsxTag<ContentProps<typeof TextFactory.Root>> & TextBuilders =
    Object.assign(content(TextFactory.Root), {
        /** The `Text` East data type and {@link TextStyle} struct. */
        Types: TextFactory.Types,
        /**
         * Eyebrow — a mono, uppercase, wide-tracked label set in muted ink:
         * the small heading above a section, a status word, or a frame
         * eyebrow. The text is the child; override any field via flat props
         * ({@link TextStyle}, e.g. `color="fg"` for the strong-ink variant).
         *
         * @example
         * ```tsx
         * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
         * import { East } from "@elaraai/east";
         * import { Text, UIComponentType } from "@elaraai/east-ui";
         *
         * const eyebrow = East.function([], UIComponentType, _$ => (
         *     <Text.Eyebrow>SELECTED · TAB1</Text.Eyebrow>
         * ));
         * ```
         *
         * @remarks Desugars to `Text.Presets.Eyebrow(text, options)`.
         */
        Eyebrow: content(TextFactory.Presets.Eyebrow),
        /**
         * EyebrowSm — a smaller, tighter eyebrow for sidebar group headers
         * and dense section markers: muted, uppercase, even wider tracking.
         * The text is the child; tune via flat props ({@link TextStyle}).
         *
         * @example
         * ```tsx
         * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
         * import { East } from "@elaraai/east";
         * import { Text, UIComponentType } from "@elaraai/east-ui";
         *
         * const header = East.function([], UIComponentType, _$ => (
         *     <Text.EyebrowSm>NAVIGATION</Text.EyebrowSm>
         * ));
         * ```
         *
         * @remarks Desugars to `Text.Presets.EyebrowSm(text, options)`.
         */
        EyebrowSm: content(TextFactory.Presets.EyebrowSm),
        /**
         * MonoSm — small inline monospaced text for counts, IDs, schema
         * keys, and freshness meta, rendered in muted ink with tabular
         * figures. The text is the child; override `color` for tone variants
         * via flat props ({@link TextStyle}).
         *
         * @example
         * ```tsx
         * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
         * import { East } from "@elaraai/east";
         * import { Text, UIComponentType } from "@elaraai/east-ui";
         *
         * const meta = East.function([], UIComponentType, _$ => (
         *     <Text.MonoSm>id: 0x4f3a</Text.MonoSm>
         * ));
         * ```
         *
         * @remarks Desugars to `Text.Presets.MonoSm(text, options)`.
         */
        MonoSm: content(TextFactory.Presets.MonoSm),
        /**
         * MonoLabel — a mono, uppercase, semibold label for sidebar items,
         * active toggle labels, and dense frame headers. No default colour —
         * set `color` per state (active vs. resting) via flat props
         * ({@link TextStyle}). The text is the child.
         *
         * @example
         * ```tsx
         * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
         * import { East } from "@elaraai/east";
         * import { Text, UIComponentType } from "@elaraai/east-ui";
         *
         * const label = East.function([], UIComponentType, _$ => (
         *     <Text.MonoLabel color="fg">OVERVIEW</Text.MonoLabel>
         * ));
         * ```
         *
         * @remarks Desugars to `Text.Presets.MonoLabel(text, options)`.
         */
        MonoLabel: content(TextFactory.Presets.MonoLabel),
        /**
         * MetaSm — small, light uppercase meta that sits beside an eyebrow:
         * trailing meta in eyebrow rows, dense table headers. Lighter and
         * smaller than `Eyebrow` so it recedes alongside it. The text is the
         * child; tune via flat props ({@link TextStyle}).
         *
         * @example
         * ```tsx
         * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
         * import { East } from "@elaraai/east";
         * import { Text, UIComponentType } from "@elaraai/east-ui";
         *
         * const meta = East.function([], UIComponentType, _$ => (
         *     <Text.MetaSm>UPDATED 2m AGO</Text.MetaSm>
         * ));
         * ```
         *
         * @remarks Desugars to `Text.Presets.MetaSm(text, options)`.
         */
        MetaSm: content(TextFactory.Presets.MetaSm),
        /**
         * Lead — larger introductory prose for a section or page intro,
         * set in subtle ink with relaxed line-height. The text is the
         * child; tune via flat props ({@link TextStyle}).
         *
         * @example
         * ```tsx
         * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
         * import { East } from "@elaraai/east";
         * import { Text, UIComponentType } from "@elaraai/east-ui";
         *
         * const lede = East.function([], UIComponentType, _$ => (
         *     <Text.Lead>A concise summary that frames the section below.</Text.Lead>
         * ));
         * ```
         *
         * @remarks Desugars to `Text.Presets.Lead(text, options)`.
         */
        Lead: content(TextFactory.Presets.Lead),
        /**
         * MonoKpi — the big-number numeric display: large monospaced,
         * semibold, tabular-nums with tight tracking, for headline KPI
         * figures. The text is the child; tune via flat props
         * ({@link TextStyle}).
         *
         * @example
         * ```tsx
         * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
         * import { East } from "@elaraai/east";
         * import { Text, UIComponentType } from "@elaraai/east-ui";
         *
         * const kpi = East.function([], UIComponentType, _$ => (
         *     <Text.MonoKpi>$1,842,500</Text.MonoKpi>
         * ));
         * ```
         *
         * @remarks Desugars to `Text.Presets.MonoKpi(text, options)`.
         */
        MonoKpi: content(TextFactory.Presets.MonoKpi),
    });

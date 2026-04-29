/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    ArrayType,
    OptionType,
    StringType,
    StructType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { SizeType, OverflowType } from "../../style.js";
import { ElevationType } from "../../style/visual.js";
import { UIComponentType } from "../../component.js";
import {
    StateValueType,
    type StateValueLiteral,
} from "../../contracts/states.js";
import { Text } from "../../typography/text/index.js";
import { Heading } from "../../typography/heading/index.js";
import { Box } from "../../layout/box/index.js";
import { Stack } from "../../layout/stack/index.js";
import { Separator } from "../../layout/separator/index.js";
import {
    CardStyleType,
    CardVariantType,
    CardVariant,
    type CardStyle,
    type CardVariantLiteral,
} from "./types.js";

// Re-export types
export {
    CardStyleType,
    CardVariantType,
    CardVariant,
    type CardStyle,
    type CardVariantLiteral,
} from "./types.js";

// ============================================================================
// CardType — standalone mirror of the inline variant
// ============================================================================

/**
 * The concrete East type for Card — mirrors the inline `Card` variant in
 * `component.ts`. Renderers use this type for `equalFor` memoization.
 *
 * @remarks
 * Card is a container primitive. Its IR carries three content slots
 * (`header` / `body` / `footer`), a runtime `state` enum that drives the
 * renderer's fallback-body contract, and a visual-only `style`
 * sub-struct.
 *
 * @property header - Optional header UIComponent
 * @property body - Array of body UIComponents
 * @property footer - Optional footer UIComponent
 * @property state - Optional runtime state (drives fallback body render)
 * @property style - Optional visual-only style sub-struct
 */
export const CardType: StructType<{
    header: OptionType<UIComponentType>,
    body: ArrayType<UIComponentType>,
    footer: OptionType<UIComponentType>,
    state: OptionType<StateValueType>,
    style: OptionType<CardStyleType>,
}> = StructType({
    header: OptionType(UIComponentType),
    body: ArrayType(UIComponentType),
    footer: OptionType(UIComponentType),
    state: OptionType(StateValueType),
    style: OptionType(CardStyleType),
});

/** Type alias for `typeof CardType`. */
export type CardType = typeof CardType;

// ============================================================================
// Options
// ============================================================================

/**
 * TypeScript options bag for `Card.Root`.
 *
 * @remarks
 * Accepts both the new nested `style: {...}` sub-struct (0 preferred)
 * and legacy flat fields inherited from `CardStyle` for backward
 * compatibility. Flat fields are folded into the style sub-struct at the
 * factory boundary; the explicit `style` object takes precedence when both
 * are supplied.
 *
 * @property header - Optional header UIComponent (use `Card.Header(...)` for the composed shape)
 * @property footer - Optional footer UIComponent (use `Card.Footer(...)` for the composed shape)
 * @property state - Runtime state literal or expression — drives the fallback-body contract
 * @property style - Optional visual-only style (preferred shape)
 */
export interface CardOptions extends CardStyle {
    /** Optional header component. Use `Card.Header(...)` to compose title + actions. */
    header?: ExprType<UIComponentType>;
    /** Optional footer component. Use `Card.Footer(...)` to compose content + actions. */
    footer?: ExprType<UIComponentType>;
    /** Runtime state — `"ready" | "loading" | "empty" | "error" | "stale" | "disabled" | "permission-denied"`. */
    state?: StateValueLiteral | SubtypeExprOrValue<StateValueType>;
    /** Optional visual-only style (preferred over the inherited flat fields). */
    style?: CardStyle;
}

// ============================================================================
// Card Factory
// ============================================================================

/**
 * Internal — converts the TypeScript `CardStyle` options bag into the East
 * `CardStyleType` struct expression.
 *
 * @param style - Visual-only style options (variant, size, elevation,
 *   dimensions, colour slots)
 * @returns An East expression representing the style sub-struct
 */
function buildCardStyle(style: CardStyle): ExprType<CardStyleType> {
    const variantValue = style.variant
        ? (typeof style.variant === "string"
            ? East.value(variant(style.variant as CardVariantLiteral, null), CardVariantType)
            : style.variant)
        : undefined;
    const sizeValue = style.size
        ? (typeof style.size === "string"
            ? East.value(variant(style.size, null), SizeType)
            : style.size)
        : undefined;
    const elevationValue = style.elevation
        ? (typeof style.elevation === "string"
            ? East.value(variant(style.elevation, null), ElevationType)
            : style.elevation)
        : undefined;
    const overflowValue = style.overflow
        ? (typeof style.overflow === "string"
            ? East.value(variant(style.overflow, null), OverflowType)
            : style.overflow)
        : undefined;

    return East.value({
        variant: variantValue ? some(variantValue) : none,
        size: sizeValue ? some(sizeValue) : none,
        elevation: elevationValue ? some(elevationValue) : none,
        height: style.height !== undefined ? some(style.height) : none,
        minHeight: style.minHeight !== undefined ? some(style.minHeight) : none,
        maxHeight: style.maxHeight !== undefined ? some(style.maxHeight) : none,
        width: style.width !== undefined ? some(style.width) : none,
        minWidth: style.minWidth !== undefined ? some(style.minWidth) : none,
        maxWidth: style.maxWidth !== undefined ? some(style.maxWidth) : none,
        flex: style.flex !== undefined ? some(style.flex) : none,
        overflow: overflowValue ? some(overflowValue) : none,
        background: style.background !== undefined ? some(style.background) : none,
        borderColor: style.borderColor !== undefined ? some(style.borderColor) : none,
        headerBackground: style.headerBackground !== undefined ? some(style.headerBackground) : none,
        footerBackground: style.footerBackground !== undefined ? some(style.footerBackground) : none,
        accentColor: style.accentColor !== undefined ? some(style.accentColor) : none,
    }, CardStyleType);
}

/**
 * Creates a Card container with content slots + runtime state + visual style.
 *
 * @param children - Array of body UIComponents
 * @param options - Optional `header` / `footer` / `state` / `style` and (for
 *   backward compatibility) legacy flat visual fields
 * @returns An East expression representing the Card component
 *
 * @remarks
 * Card is the canonical state-contract consumer: the optional `state`
 * drives the renderer's fallback body for loading / empty / error / stale /
 * disabled / permission-denied — see `libs/east-ui-components/src/container/card/index.tsx`
 * for the dispatch table. All visual fields (variant, size, elevation,
 * dimensions, colour slots) now live in `style: {...}`; flat
 * fields on the top-level options bag continue to work as a migration aid.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Card, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Card.Root([Text.Root("Body copy")], {
 *         header: Card.Header({
 *             title: "Per plan week",
 *             description: "Scenario vs baseline",
 *         }),
 *         style: { variant: "elevated", elevation: "raised" },
 *     });
 * });
 * ```
 */
function createCard(
    children: SubtypeExprOrValue<ArrayType<UIComponentType>>,
    options?: CardOptions,
): ExprType<UIComponentType> {
    const flatStyle: CardStyle = {};
    let hasFlat = false;
    const copy = <K extends keyof CardStyle>(k: K) => {
        const v = (options as CardStyle | undefined)?.[k];
        if (v !== undefined) {
            (flatStyle as Record<string, unknown>)[k] = v as unknown;
            hasFlat = true;
        }
    };
    copy("variant");
    copy("size");
    copy("elevation");
    copy("height");
    copy("minHeight");
    copy("maxHeight");
    copy("width");
    copy("minWidth");
    copy("maxWidth");
    copy("flex");
    copy("overflow");
    copy("background");
    copy("borderColor");
    copy("headerBackground");
    copy("footerBackground");
    copy("accentColor");

    const resolvedStyle: CardStyle | undefined = options?.style
        ? { ...flatStyle, ...options.style }
        : (hasFlat ? flatStyle : undefined);

    const styleValue = resolvedStyle ? buildCardStyle(resolvedStyle) : undefined;

    const stateValue = typeof options?.state === "string"
        ? East.value(variant(options.state, null), StateValueType)
        : options?.state as ExprType<StateValueType> | undefined;

    return East.value(variant("Card", {
        header: options?.header ? some(options.header) : none,
        body: children,
        footer: options?.footer ? some(options.footer) : none,
        state: stateValue ? some(stateValue) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

// ============================================================================
// Compound helpers — pure factory output (no new UIComponentType variants)
// ============================================================================

type TextInput = string | ExprType<UIComponentType> | SubtypeExprOrValue<UIComponentType>;

/**
 * TypeScript options bag for `Card.Title`.
 *
 * @property textStyle - Heading text-style token (defaults to `"heading-sm"`)
 * @property color - Explicit text colour override
 */
export interface CardTitleOptions {
    /** Heading text-style token. Defaults to `"heading-sm"`. */
    textStyle?: "heading-lg" | "heading-md" | "heading-sm" | "heading-xs";
    /** Explicit text colour override. */
    color?: SubtypeExprOrValue<StringType>;
}

/**
 * Creates a card title — a Heading rendered at `heading-sm` by default.
 *
 * @param value - String (wrapped in a Heading) or an existing UIComponent
 * @param options - Optional `textStyle` / `color`
 * @returns An East expression representing the title
 *
 * @remarks
 * Strings are coerced to `Heading.Root(s, { textStyle })`. If a rich UIComp
 * is passed it is returned unchanged.
 *
 * @example
 * ```ts
 * Card.Title("Per plan week");
 * Card.Title("Small", { textStyle: "heading-xs" });
 * ```
 */
export function CardTitle(
    value: string | ExprType<UIComponentType>,
    options?: CardTitleOptions,
): ExprType<UIComponentType> {
    if (typeof value === "string") {
        // Modern dense cards (Linear / Stripe / Notion) use bold body-sm for
        // titles — `heading-*` tokens have generous line-height that feels
        // JUMBO inside a tight header. Callers can override via
        // `options.textStyle`.
        if (options?.textStyle !== undefined) {
            return Heading.Root(value, {
                textStyle: options.textStyle,
                fontWeight: "semibold",
                ...(options.color !== undefined ? { color: options.color } : {}),
            });
        }
        return Text.Root(value, {
            textStyle: "body-sm",
            fontWeight: "semibold",
            ...(options?.color !== undefined ? { color: options.color } : {}),
        });
    }
    return value;
}

/**
 * TypeScript options bag for `Card.Description`.
 *
 * @property color - Explicit text colour override (defaults to `"fg.muted"`)
 */
export interface CardDescriptionOptions {
    /** Explicit text colour override. Defaults to `"fg.muted"`. */
    color?: SubtypeExprOrValue<StringType>;
}

/**
 * Creates a card description — Text rendered at `body-sm` with muted colour.
 *
 * @param value - String (wrapped in a Text) or an existing UIComponent
 * @param options - Optional `color`
 * @returns An East expression representing the description
 *
 * @example
 * ```ts
 * Card.Description("Scenario vs baseline");
 * ```
 */
export function CardDescription(
    value: TextInput,
    options?: CardDescriptionOptions,
): ExprType<UIComponentType> {
    if (typeof value === "string") {
        return Text.Root(value, {
            textStyle: "caption",
            color: options?.color ?? "fg.muted",
        });
    }
    return value as ExprType<UIComponentType>;
}

/**
 * TypeScript options bag for `Card.Actions`.
 *
 * @property placement - Horizontal alignment of the action row — `"start"` or `"end"` (default)
 */
export interface CardActionsOptions {
    /** Horizontal alignment of the action row. Defaults to `"end"`. */
    placement?: "start" | "end";
}

/**
 * Creates a row of action buttons typically used inside `Card.Header` or
 * `Card.Footer`.
 *
 * @param buttons - Array of Button UIComponents
 * @param options - Optional `placement`
 * @returns An East expression representing the action row
 *
 * @example
 * ```ts
 * Card.Actions([Button.Root("Export"), Button.Root("Share")]);
 * ```
 */
export function CardActions(
    buttons: Array<ExprType<UIComponentType>>,
    options?: CardActionsOptions,
): ExprType<UIComponentType> {
    return Stack.HStack(buttons, {
        gap: "2",
        justify: options?.placement === "start" ? "flex-start" : "flex-end",
    });
}

/**
 * TypeScript options bag for `Card.Header`.
 *
 * @property title - Card title (string wrapped in `Card.Title`, or an existing UIComp)
 * @property description - Optional secondary description
 * @property actions - Optional trailing action row (e.g. `Card.Actions([...])`)
 * @property eyebrow - Optional small uppercase label above the title
 */
export interface CardHeaderOptions {
    /** Card title. Strings are wrapped in `Card.Title`. */
    title?: string | ExprType<UIComponentType>;
    /** Optional secondary description line. */
    description?: TextInput;
    /** Optional trailing action row — typically `Card.Actions([...])`. */
    actions?: ExprType<UIComponentType>;
    /** Optional small uppercase label rendered above the title. */
    eyebrow?: TextInput;
}

/**
 * Creates a composed card header — eyebrow + title + description on the left,
 * optional actions on the right.
 *
 * @param options - Options bag (at least one of `title` / `description` / `actions` expected)
 * @returns An East expression representing the header
 *
 * @example
 * ```ts
 * Card.Header({
 *     title: "Per plan week",
 *     description: "Scenario vs baseline",
 *     actions: Card.Actions([Button.Root("Export")]),
 * });
 * ```
 */
export function CardHeader(options: CardHeaderOptions): ExprType<UIComponentType> {
    const leftChildren: Array<ExprType<UIComponentType>> = [];
    if (options.eyebrow !== undefined) {
        leftChildren.push(Text.Root(typeof options.eyebrow === "string" ? options.eyebrow : "", {
            textStyle: "label-sm",
            color: "fg.muted",
            textTransform: "uppercase",
        }));
    }
    if (options.title !== undefined) {
        leftChildren.push(CardTitle(options.title));
    }
    if (options.description !== undefined) {
        leftChildren.push(CardDescription(options.description));
    }
    const left = leftChildren.length === 1
        ? leftChildren[0]!
        : Stack.VStack(leftChildren, { gap: "0", align: "stretch" });

    if (options.actions !== undefined) {
        return Stack.HStack([left, options.actions], {
            gap: "3",
            align: "center",
            justify: "space-between",
        });
    }
    return left;
}

/**
 * TypeScript options bag for `Card.Body`.
 *
 * @property padded - Whether to apply default padding (default `true`).
 *   Set to `false` for flush content like tables.
 */
export interface CardBodyOptions {
    /** Whether to apply default padding. Default `true`. */
    padded?: boolean;
}

/**
 * Creates a card body wrapper — a padded Box.
 *
 * @param children - Body UIComponents
 * @param options - Optional `padded`
 * @returns An East expression representing the body box
 *
 * @example
 * ```ts
 * Card.Body([Text.Root("Main content")]);
 * Card.Body([Table.Root(...)], { padded: false });
 * ```
 */
export function CardBody(
    children: Array<ExprType<UIComponentType>>,
    options?: CardBodyOptions,
): ExprType<UIComponentType> {
    void options;
    return Box.Root(children);
}

/**
 * TypeScript options bag for `Card.Footer`.
 *
 * @property actions - Optional trailing action row — typically `Card.Actions([...])`
 */
export interface CardFooterOptions {
    /** Optional trailing action row — typically `Card.Actions([...])`. */
    actions?: ExprType<UIComponentType>;
}

/**
 * Creates a composed card footer — content row with optional trailing actions.
 *
 * @param children - Footer content UIComponents
 * @param options - Optional `actions`
 * @returns An East expression representing the footer
 *
 * @example
 * ```ts
 * Card.Footer([Text.Root("Last updated 14:32")], {
 *     actions: Card.Actions([Button.Root("Refresh")]),
 * });
 * ```
 */
export function CardFooter(
    children: Array<ExprType<UIComponentType>>,
    options?: CardFooterOptions,
): ExprType<UIComponentType> {
    if (options?.actions !== undefined) {
        return Stack.HStack(
            [...children, options.actions],
            { gap: "3", align: "center", justify: "space-between" },
        );
    }
    return children.length === 1
        ? children[0]!
        : Stack.HStack(children, { gap: "3", align: "center" });
}

/**
 * TypeScript options bag for `Card.Section`.
 *
 * @property title - Optional section heading rendered above the separator
 */
export interface CardSectionOptions {
    /** Optional section heading rendered above the content. */
    title?: string | ExprType<UIComponentType>;
}

/**
 * Creates a hairline-separated section inside `Card.body` for multi-section
 * cards.
 *
 * @param children - Section content UIComponents
 * @param options - Optional `title`
 * @returns An East expression representing the section
 *
 * @example
 * ```ts
 * Card.Section([Text.Root("Scope A")], { title: "Scope" });
 * ```
 */
export function CardSection(
    children: Array<ExprType<UIComponentType>>,
    options?: CardSectionOptions,
): ExprType<UIComponentType> {
    const inner: Array<ExprType<UIComponentType>> = [];
    if (options?.title !== undefined) {
        inner.push(CardTitle(options.title, { textStyle: "heading-xs" }));
    }
    inner.push(...children);
    return Stack.VStack(
        [Separator.Root({ orientation: "horizontal" }), Stack.VStack(inner, { gap: "2", align: "stretch" })],
        { gap: "3", align: "stretch" },
    );
}

// ============================================================================
// Namespace export
// ============================================================================

/**
 * Card container primitive — groups related content with optional header +
 * footer + runtime state-fallback contract.
 *
 * @remarks
 * `Card.Root` builds the outer IR. Compound helpers (`Card.Header`, `Title`,
 * `Description`, `Body`, `Footer`, `Section`, `Actions`) produce plain
 * UIComponent IR — **no new variants in `UIComponentType`**.
 *
 * @example
 * ```ts
 * Card.Root(
 *     [Card.Body([Text.Root("Body copy")])],
 *     {
 *         header: Card.Header({
 *             title: "Per plan week",
 *             description: "Scenario vs baseline",
 *             actions: Card.Actions([Button.Root("Export")]),
 *         }),
 *         style: { variant: "elevated", elevation: "raised" },
 *     },
 * );
 * ```
 */
export const Card = {
    /**
     * Creates a Card container with content slots + runtime state + visual style.
     *
     * @param children - Array of body UIComponents
     * @param options - Optional `header` / `footer` / `state` / `style` + legacy flat fields
     *
     * @example
     * ```ts
     * Card.Root([Text.Root("Body")], { state: "loading" });
     * ```
     */
    Root: createCard,
    /**
     * Creates a composed card header — eyebrow + title + description + actions.
     *
     * @param options - Header options (`title` / `description` / `actions` / `eyebrow`)
     *
     * @example
     * ```ts
     * Card.Header({ title: "Plan week", actions: Card.Actions([Button.Root("Export")]) });
     * ```
     */
    Header: CardHeader,
    /**
     * Creates a card title — Heading at `heading-sm` by default.
     *
     * @param value - Title string or an existing UIComponent
     * @param options - Optional `textStyle` / `color`
     */
    Title: CardTitle,
    /**
     * Creates a card description — Text at `body-sm` muted.
     *
     * @param value - Description string or UIComponent
     * @param options - Optional `color`
     */
    Description: CardDescription,
    /**
     * Creates a card body wrapper — padded Box.
     *
     * @param children - Body content
     * @param options - Optional `padded`
     */
    Body: CardBody,
    /**
     * Creates a card footer — content row with optional trailing actions.
     *
     * @param children - Footer content
     * @param options - Optional `actions`
     */
    Footer: CardFooter,
    /**
     * Creates a hairline-separated section inside the card body.
     *
     * @param children - Section content
     * @param options - Optional `title`
     */
    Section: CardSection,
    /**
     * Creates a row of action buttons.
     *
     * @param buttons - Array of Button UIComponents
     * @param options - Optional `placement`
     */
    Actions: CardActions,
    /**
     * Helper to create a CardVariant expression (`elevated` / `outline` / `subtle`).
     *
     * @param v - The variant literal
     */
    Variant: CardVariant,
    Types: {
        /**
         * East StructType for a Card component value — the serialisable IR
         * shape used by renderers and assertion tooling.
         *
         * @remarks
         * Mirrors the inline `Card` variant in `component.ts`. Use this
         * alias for `ValueTypeOf<typeof Card.Types.Card>` and
         * `equalFor(Card.Types.Card)` without reaching into module
         * internals.
         *
         * @property header - Optional header slot (UIComponent)
         * @property body - Body children (array of UIComponents)
         * @property footer - Optional footer slot (UIComponent)
         * @property state - Runtime state enum state contract
         * @property style - Optional visual style sub-struct
         */
        Card: CardType,
        /**
         * East StructType holding every visual field for a Card.
         *
         * @remarks
         * Mirror of `CardStyleType` from `./types.js`. Covers visual
         * presets (`variant`, `size`, `elevation`), layout / dimension
         * fields, overflow, and the full set of colour slots
         * (`background`, `borderColor`, `headerBackground`,
         * `footerBackground`, `accentColor`) that renderers apply
         * alongside state-driven overrides.
         *
         * @property variant - Visual preset — `elevated` / `outline` / `subtle`
         * @property size - Card size token
         * @property elevation - Shadow elevation token
         * @property height - CSS height
         * @property minHeight - CSS min-height
         * @property maxHeight - CSS max-height
         * @property width - CSS width
         * @property minWidth - CSS min-width
         * @property maxWidth - CSS max-width
         * @property flex - Flex value (for use inside flex containers)
         * @property overflow - Overflow behaviour
         * @property background - Explicit card background override
         * @property borderColor - Explicit card border colour
         * @property headerBackground - Explicit header background override
         * @property footerBackground - Explicit footer background override
         * @property accentColor - Left-edge accent stripe colour
         */
        Style: CardStyleType,
        /**
         * East VariantType for the Card visual preset.
         *
         * @remarks
         * Mirror of `CardVariantType` from `./types.js`. Used as the value
         * type of `CardStyleType.variant`; consumers can construct a
         * variant expression via `Card.Variant("elevated")`.
         *
         * @property elevated - Raised card with prominent shadow
         * @property outline - Default — 1px border + subtle shadow
         * @property subtle - Flat card with background tint, no shadow
         */
        Variant: CardVariantType,
    },
} as const;

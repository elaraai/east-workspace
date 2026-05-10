/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Decision.Brief component — Decide-mode anchor pattern.
 *
 * @remarks
 * Presents the model's recommendation as a structured argument. Slots:
 * `claim`, `because[]`, `upside`, `risks`, `unknowns`, `stakes` (content),
 * `actions[]` + `aside` (composable UIComponentType slots — author wires
 * Button / Link primitives with onClick), `accent`.
 *
 * Declared via the `EastUI.component` extension API — the React renderer
 * lives in `@elaraai/east-ui-patterns-components` and is wired via
 * `implementUIComponent(Decision.Brief.Component, EastChakraDecisionBrief)`
 * at module load time.
 *
 * @packageDocumentation
 */

import {
    East,
    none,
    some,
    type ArrayType,
    type ExprType,
    type FunctionType,
    type NullType,
    type OptionType,
    type StringType,
    type SubtypeExprOrValue,
} from "@elaraai/east";
import {
    Button,
    EastUI,
    Text,
    type ButtonOptions,
    type UIComponentType,
} from "@elaraai/east-ui";

import {
    DecisionBriefAccentType,
    DecisionBriefAsideType,
    DecisionBriefReasonType,
    DecisionBriefStyleType,
    DecisionBriefValueType,
    StakesToneType,
    StakesType,
    StakesValueType,
} from "./types.js";

// ============================================================================
// Action input — the constrained TS-side shape for actions[] / aside.
// ============================================================================

/**
 * One commit-affordance entry for {@link BriefOptions.actions} or {@link BriefOptions.aside}.
 *
 * @remarks
 * The Decision.Brief slot's East type is the open `UIComponentType`, but in
 * practice every action is a button — so the TS-side input is constrained to
 * a button spec. The factory turns each entry into `Button.Root(label, options)`
 * before handing it to the renderer.
 *
 * @property label   - Plain string shown on the button. e.g. `"Apply"`.
 *                     East string expressions are also accepted for dynamic
 *                     labels.
 * @property options - The full {@link ButtonOptions} bag — `onClick`,
 *                     `disabled`, `loading`, `style: { variant, ... }`, etc.
 *                     Required for any meaningful action; the first action's
 *                     style is conventionally `{ variant: "solid" }`,
 *                     subsequent ones `{ variant: "outline" }` /
 *                     `{ variant: "ghost" }`.
 */
export interface BriefActionInput {
    /** Plain string label (e.g. `"Apply"`). Markdown is NOT parsed here. */
    label: SubtypeExprOrValue<StringType>;
    /** Full {@link ButtonOptions} bag — `onClick`, `style`, `disabled`, etc. */
    options?: ButtonOptions;
}

/**
 * The right-anchored "Why this?" / alternatives link in the action footer.
 *
 * @remarks
 * Distinct from {@link BriefActionInput} — this is a quiet text link
 * pinned far-right with brand-600 colour and underline-on-hover. Renderer
 * styles it directly.
 *
 * @property label   - Plain string shown as the link text. e.g. `"Why this?"`.
 * @property onClick - Click handler. Typically opens the alternatives panel.
 */
export interface BriefAsideInput {
    /** Plain string link text. */
    label: SubtypeExprOrValue<StringType>;
    /** Click handler — opens alternatives, audit trail, etc. */
    onClick?: SubtypeExprOrValue<FunctionType<[], NullType>>;
}

/**
 * Visual style escape hatches for `Decision.Brief`.
 *
 * @remarks
 * Mirrors the {@link BoxStyle}-style pattern from `@elaraai/east-ui` —
 * size + padding-related fields are optional CSS / Chakra tokens. Use
 * sparingly; the default 560 px max-width fits 95% of decisions.
 *
 * @property width    - Explicit width (Chakra size token or CSS value).
 * @property maxWidth - Cap (Chakra size token or CSS value). Defaults to
 *                      `"560px"` when omitted. e.g. `"720px"` for the
 *                      marketplace-clearance / partner-comm pattern.
 */
export interface BriefStyle {
    /** Explicit width — use sparingly; prefer maxWidth. */
    width?:    SubtypeExprOrValue<StringType>;
    /** Cap; defaults to `"560px"` when omitted. */
    maxWidth?: SubtypeExprOrValue<StringType>;
}

// ============================================================================
// EastUI.component carrier — renderers register against this.
// ============================================================================

/**
 * Internal `EastUI.component` carrier. Renderers register against this in
 * `@elaraai/east-ui-patterns-components`. Most callers should use
 * {@link Brief.Root} (the friendly factory) rather than touching this directly.
 */
export const DecisionBriefComponent = EastUI.component(
    "DecisionBrief",
    DecisionBriefValueType,
    { optional: true },
);

// ============================================================================
// User-facing factory.
// ============================================================================

/**
 * Options for {@link Brief.Root}.
 *
 * @property claim - Single concrete imperative sentence. Markdown-enabled.
 *   e.g. `"Move 3 SE shifts from **Patel** → **Cho** for week of May 11"`.
 * @property because - Up to 3 supporting reasons (renderer slices to 3).
 *   Each entry is `{ reason, accent? }`. Reason is markdown; accent is plain.
 * @property upside - Benefit of acting in the user's primary currency.
 *   Markdown-enabled. e.g. `"**−$8.4k** overtime saved this week"`.
 * @property risks - Named risks. None → row renders "none material".
 *   Markdown-enabled when present.
 * @property unknowns - What the model didn't have at decision time.
 *   Markdown-enabled when present.
 * @property stakes - Stakes communicated in human terms. Mandatory.
 * @property actions - Ordered row of commit-affordance buttons. Each entry is
 *   `{ label, options? }` — passed through to `Button.Root(label, options)`.
 *   First entry is conventionally the primary commit (style `{ variant: "solid" }`);
 *   subsequent ones use `outline` / `ghost`.
 * @property aside - Optional right-aligned auxiliary button (e.g. "Why this
 *   and not alternatives?"). Same `{ label, options? }` shape as `actions`.
 * @property accent - Left-rail tint. Defaults to brand.
 */
export interface BriefOptions {
    /** Single concrete imperative sentence. Markdown-enabled. */
    claim: SubtypeExprOrValue<StringType>;
    /** Up to 3 supporting reasons. Renderer slices to 3 if longer. */
    because: SubtypeExprOrValue<ArrayType<typeof DecisionBriefReasonType>>;
    /** Benefit of acting. Markdown-enabled. */
    upside: SubtypeExprOrValue<StringType>;
    /** Named risks; absent → "none material" row. */
    risks?: SubtypeExprOrValue<OptionType<StringType>>;
    /** What the model didn't know. */
    unknowns?: SubtypeExprOrValue<OptionType<StringType>>;
    /** Mandatory stakes chip — impact / affected / reversibility. */
    stakes: SubtypeExprOrValue<typeof StakesType>;
    /** Ordered row of commit-affordance buttons. */
    actions: BriefActionInput[];
    /** Right-aligned auxiliary text link. Quieter than the action buttons. */
    aside?: BriefAsideInput;
    /** Left-rail tint. Defaults to `brand`. */
    accent?: SubtypeExprOrValue<OptionType<typeof DecisionBriefAccentType>>;
    /** Visual style escape hatches (width / maxWidth). Defaults: `maxWidth: "560px"`. */
    style?: BriefStyle;
}

/**
 * The Decision.Brief component namespace. Decide-mode anchor pattern;
 * renders the model's recommendation as a structured argument.
 *
 * @remarks
 * Use `Decision.Brief.Root({ … })` to construct. The `Component` property
 * is the internal {@link EastUI.component} carrier that renderers register
 * against — most callers shouldn't need it.
 *
 * Family: `Decision.*` — Brief (Decide), Queue (Observe), Journal (Frame & trust).
 *
 * @example
 * ```ts
 * import { East, FunctionType, NullType, some, none, variant } from "@elaraai/east";
 * import { Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Decision } from "@elaraai/east-ui-patterns";
 *
 * const screen = East.function([], UIComponentType, (_$) => {
 *     return Reactive.Root(East.function([], UIComponentType, $ => {
 *         const onApply = $.const(East.function([], NullType, _$ => {
 *             // commit the patch, fire downstream, etc.
 *         }), FunctionType([], NullType));
 *         return Decision.Brief.Root({
 *             claim: "Move 3 SE shifts from **Patel** → **Cho** for week of May 11",
 *             because: [
 *                 { reason: "SE-1 forecast +14% vs base", accent: some("13.6k vs 11.9k units") },
 *                 { reason: "Cho 12h under cap; Patel at 38h", accent: some("weekend-pref Mar") },
 *                 { reason: "Past 5 similar moves all reduced overtime", accent: none },
 *             ],
 *             upside: "**−$8.4k** overtime saved this week · coverage 99.4%",
 *             stakes: {
 *                 impact:        { value: "$8.4k impact",  tone: variant("mid", null) },
 *                 affected:      some("3 workers"),
 *                 reversibility: some({ value: "reversible 24h", tone: variant("low", null) }),
 *             },
 *             actions: [
 *                 { label: "Apply",          options: { onClick: onApply, style: { variant: "solid"   } } },
 *                 { label: "Modify",         options: { style: { variant: "outline" } } },
 *                 { label: "Override + why", options: { style: { variant: "ghost"   } } },
 *             ],
 *             aside: { label: "Why this and not alternatives?", options: { style: { variant: "ghost", size: "sm" } } },
 *         });
 *     }));
 * });
 * ```
 */
export const Brief = {
    /**
     * Build a Decision.Brief component.
     *
     * @param options - {@link BriefOptions}. Required: `claim`, `because`,
     *   `upside`, `stakes`, `actions`. Optional: `risks`, `unknowns`,
     *   `aside`, `accent`.
     * @returns East expression of {@link UIComponentType} for the brief.
     *
     * @remarks
     * Each `actions[]` and the optional `aside` entry is a
     * {@link BriefActionInput} (`{ label, options? }`); the factory
     * materialises each into `Button.Root(Text.Root(label), options)` —
     * authors don't compose buttons themselves.
     *
     * @example
     * ```ts
     * import { East, FunctionType, NullType, some, variant } from "@elaraai/east";
     * import { Reactive, Toast, UIComponentType } from "@elaraai/east-ui";
     * import { Decision } from "@elaraai/east-ui-patterns";
     *
     * const screen = East.function([], UIComponentType, (_$) => {
     *     return Reactive.Root(East.function([], UIComponentType, $ => {
     *         const onApply = $.const(East.function([], NullType, $ => {
     *             $(Toast.emit(Toast.make("success", "Applied")));
     *         }), FunctionType([], NullType));
     *         return Decision.Brief.Root({
     *             claim:   "Pin worker S. Cho to morning shift Tue–Thu",
     *             because: [{ reason: "Stated preference confirmed", accent: variant("none", null) }],
     *             upside:  "Honours stated preference",
     *             stakes:  {
     *                 impact:        { value: "~$0", tone: variant("low", null) },
     *                 affected:      some("1 worker"),
     *                 reversibility: some({ value: "reversible anytime", tone: variant("low", null) }),
     *             },
     *             actions: [{ label: "Apply", options: { onClick: onApply, style: { variant: "solid" } } }],
     *         });
     *     }));
     * });
     * ```
     */
    Root(options: BriefOptions): ExprType<UIComponentType> {
        const actions = options.actions.map(a => Button.Root(Text.Root(a.label), a.options));
        const aside = options.aside
            ? some(East.value({
                label:   options.aside.label,
                onClick: options.aside.onClick !== undefined ? some(options.aside.onClick) : none,
            }, DecisionBriefAsideType))
            : none;
        const style = options.style
            ? some(East.value({
                width:    options.style.width    !== undefined ? some(options.style.width)    : none,
                maxWidth: options.style.maxWidth !== undefined ? some(options.style.maxWidth) : none,
            }, DecisionBriefStyleType))
            : none;
        return DecisionBriefComponent.Root({
            claim:    options.claim,
            because:  options.because,
            upside:   options.upside,
            risks:    options.risks    ?? none,
            unknowns: options.unknowns ?? none,
            stakes:   options.stakes,
            actions,
            aside,
            accent:   options.accent   ?? none,
            style,
        });
    },
    /**
     * The internal {@link EastUI.component} carrier. Renderers register
     * against this via
     * `implementUIComponent(Decision.Brief.Component, EastChakraDecisionBrief)`
     * in `@elaraai/east-ui-patterns-components`. Most callers should use
     * {@link Brief.Root} and never touch this directly.
     */
    Component: DecisionBriefComponent,
    Types: {
        /**
         * The Decision.Brief pattern's serialisable East value type.
         *
         * @remarks
         * Useful when authors want to derive `ValueTypeOf` for fixtures or
         * tests: `type Value = ValueTypeOf<typeof Decision.Brief.Types.Value>`.
         *
         * @property claim    - Single concrete imperative sentence. Markdown-enabled.
         * @property because  - Up to 3 supporting reasons. Renderer slices to 3 if longer.
         * @property upside   - Benefit of acting in the user's primary currency. Markdown-enabled.
         * @property risks    - Named risks. Absent → row renders "none material". Markdown-enabled when present.
         * @property unknowns - What the model didn't have at decision time. Markdown-enabled when present.
         * @property stakes   - Mandatory stakes chip — impact / affected / reversibility.
         * @property actions  - Ordered row of commit-affordance UIComponents (typically Button).
         * @property aside    - Optional right-aligned auxiliary UIComponent.
         * @property accent   - Left-rail tint. Defaults to `brand`.
         */
        Value: DecisionBriefValueType,
        /**
         * One supporting reason inside the `because[]` array.
         *
         * @remarks
         * Mirror of `DecisionBriefReasonType` from `./types.js`. Authors
         * compose entries as `{ reason: "...", accent: some("...") | none }`.
         *
         * @property reason - Single-sentence supporting reason. Markdown-enabled.
         * @property accent - Optional parenthetical accent rendered after the
         *                    reason in muted text. Plain text, not markdown.
         */
        Reason: DecisionBriefReasonType,
        /**
         * Stakes container — decision consequence in human terms.
         *
         * @remarks
         * Mandatory across every Decide pattern. Mirror of `StakesType`
         * from `./types.js`.
         *
         * @property impact        - Headline impact (money / units). Mandatory; carries tone.
         * @property affected      - Plain-text description of who/what is affected. No tone.
         * @property reversibility - How forgiving the decision is. Carries tone.
         */
        Stakes: StakesType,
        /**
         * One severity-toned stakes value (impact, reversibility).
         *
         * @remarks
         * Mirror of `StakesValueType` from `./types.js`. Used for both the
         * mandatory `impact` field and the optional `reversibility` field.
         *
         * @property value - Display string. Plain text.
         * @property tone  - Severity — drives renderer colour. {@link StakesToneType}
         */
        StakesValue: StakesValueType,
        /**
         * Severity tone enum for a {@link StakesValueType} value.
         *
         * @remarks
         * Drives renderer colour: `low` → green, `mid` → orange, `high` →
         * red. Mirror of `StakesToneType` from `./types.js`.
         *
         * @property low  - Low severity (green ink).
         * @property mid  - Medium severity (orange ink).
         * @property high - High severity (red ink).
         */
        StakesTone: StakesToneType,
        /**
         * Aside link struct — `{ label, onClick? }`. Distinct from the
         * action buttons; the renderer styles it as a quiet text link in
         * the action footer.
         *
         * Mirror of `DecisionBriefAsideType` from `./types.js`.
         *
         * @property label   - Plain string shown as the link text.
         * @property onClick - Optional click handler. `none` makes it a
         *                     non-interactive label.
         */
        Aside: DecisionBriefAsideType,
        /**
         * Visual style escape hatches — `width` / `maxWidth`.
         *
         * Mirror of `DecisionBriefStyleType` from `./types.js`. Defaults
         * to a 560 px max-width when omitted; widen to ~720 px for briefs
         * with longer body content.
         *
         * @property width    - Explicit width (Chakra size token or CSS value).
         * @property maxWidth - Cap (Chakra size token or CSS value).
         */
        Style: DecisionBriefStyleType,
        /**
         * Left-rail accent enum.
         *
         * @remarks
         * Auto-derives from commit-strength when omitted. Mirror of
         * `DecisionBriefAccentType` from `./types.js`.
         *
         * @property brand  - Default. Routine / Exception / standard Commitment.
         * @property warn   - Commitment / material Strategic. Apply opens Commit.Confirm.
         * @property danger - Irreversible. Apply opens Commit.Confirm with typed confirmation.
         */
        Accent: DecisionBriefAccentType,
    },
} as const;

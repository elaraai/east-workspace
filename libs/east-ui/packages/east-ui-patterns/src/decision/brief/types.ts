/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Decision.Brief — value-type contract.
 *
 * @remarks
 * The Decide-mode anchor pattern. Presents the model's recommendation as a
 * structured argument the user can read in 30 seconds and defend in a meeting.
 *
 * Slot shape:
 *  - **Content** slots (`claim`, `because`, `upside`, `risks`, `unknowns`,
 *    `stakes`, `accent`) carry the briefing's structured prose. Renderer
 *    has full control over their layout.
 *  - **Composable** slots (`actions`, `aside`) are `UIComponentType` —
 *    authors compose any east-ui component (typically `Button.Root({ label,
 *    onClick, ... })` for actions and `Link.Root(...)` for the aside link).
 *    The renderer dispatches them via the standard `EastChakraComponent`
 *    walker, so authors get full button/link mechanics for free (variants,
 *    sizes, palettes, keyboard hints, click handlers, commit-strength
 *    confirm flow).
 *
 * String-typed slots (`claim`, `because[].reason`, `upside`, `risks`,
 * `unknowns`) accept full GitHub-flavored inline markdown. Renderers parse
 * via the canonical `Markdown` primitive.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    FunctionType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
} from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";

/* ─── Aside link — small text-link in the action footer ───────────────── */

/**
 * The right-anchored "Why this?" / alternatives link in the action footer.
 *
 * Distinct from `actions[]` (which carry button hierarchy: solid →
 * outline → ghost). The aside is a quiet text link pinned far-right,
 * with brand-600 colour and underline-on-hover treatment. Renderer
 * styles it directly — it is NOT a `UIComponentType`, so it can't be
 * misused as a primary action.
 *
 * @property label   - Plain string shown as the link text.
 *                     e.g. `"Why this?"` or `"Why this and not alternatives?"`.
 * @property onClick - Click handler. Typically opens an alternatives
 *                     panel or opens the Judgement.Reason flow.
 */
export const DecisionBriefAsideType = StructType({
    label:   StringType,
    onClick: OptionType(FunctionType([], NullType)),
});

/* ─── Style — visual escape hatches ───────────────────────────────────── */

/**
 * Visual style options for Decision.Brief.
 *
 * @remarks
 * Most callers leave this as `none` and accept the default 560 px max
 * width. When a brief carries unusually long body content (long because
 * bullets, multi-line risks, etc.), set `maxWidth` to widen the card.
 *
 * @property width    - Explicit width (Chakra size token or CSS value).
 *                      Use sparingly; prefer maxWidth.
 * @property maxWidth - Cap (Chakra size token or CSS value). Defaults to
 *                      `560px` when omitted. e.g. `"720px"`.
 */
export const DecisionBriefStyleType = StructType({
    width:    OptionType(StringType),
    maxWidth: OptionType(StringType),
});

/* ─── Stakes (shared with Stakes.Tag) ─────────────────────────────────── */

/**
 * Severity tone for a stakes value. Drives renderer colour:
 *  - `low`  — green
 *  - `mid`  — orange
 *  - `high` — red
 */
export const StakesToneType = VariantType({
    low:  NullType,
    mid:  NullType,
    high: NullType,
});

/**
 * A single severity-toned stakes value (e.g. impact, reversibility).
 *
 * @property value - Display string. Plain text.
 * @property tone  - Severity — drives colour. {@link StakesToneType}
 */
export const StakesValueType = StructType({
    value: StringType,
    tone:  StakesToneType,
});

/**
 * Stakes — decision consequence in human terms. Mandatory across every
 * Decide pattern.
 *
 * @property impact        - Headline impact (money / units). Mandatory; carries tone.
 * @property affected      - Plain-text description of who/what is affected.
 *                           e.g. "3 workers", "partner + 4 brands". No tone — affected
 *                           count doesn't carry severity on its own.
 * @property reversibility - How forgiving the decision is. Carries tone.
 */
export const StakesType = StructType({
    impact:        StakesValueType,
    affected:      OptionType(StringType),
    reversibility: OptionType(StakesValueType),
});

/* ─── Decision.Brief sub-types ────────────────────────────────────────── */

/**
 * Left-rail accent. Auto-derives from commit-strength when omitted.
 *
 *  - `brand`  — default. Routine / Exception / standard Commitment.
 *  - `warn`   — Commitment / material Strategic. Apply opens Commit.Confirm.
 *  - `danger` — Irreversible. Apply opens Commit.Confirm with typed confirmation.
 */
export const DecisionBriefAccentType = VariantType({
    brand:  NullType,
    warn:   NullType,
    danger: NullType,
});

/**
 * One supporting reason within `because[]`.
 *
 * @property reason - Single-sentence supporting reason. Markdown-enabled.
 *                    e.g. "SE-1 forecast is +14% vs base, driven by holiday demand"
 * @property accent - Optional parenthetical accent rendered after the reason
 *                    in muted text. Plain text, not markdown.
 *                    e.g. "(13.6k vs 11.9k units)" or "(weekend-pref flag from Mar)"
 */
export const DecisionBriefReasonType = StructType({
    reason: StringType,
    accent: OptionType(StringType),
});

/* ─── The pattern's value type ────────────────────────────────────────── */

/**
 * Decision.Brief — the canonical Decide-mode pattern's value type.
 *
 * @property claim    - Single concrete imperative sentence. Markdown-enabled.
 * @property because  - Up to 3 supporting reasons, ordered by importance.
 *                      Renderer slices the array to 3 if longer.
 * @property upside   - Benefit of acting in the user's primary currency.
 *                      Markdown-enabled.
 * @property risks    - Named risks in plain language. None → row renders
 *                      "none material". Markdown-enabled when present.
 * @property unknowns - What the model didn't have at decision time.
 *                      Pairs with Judgement.Gap. Markdown-enabled.
 * @property stakes   - Stakes communicated in human terms — mandatory.
 * @property actions  - Ordered row of commit affordances. Authors typically
 *                      compose `Button.Root({ label, onClick, style: { variant: "solid"|"outline"|"ghost" } })`.
 *                      First button conventionally is the primary commit;
 *                      subsequent buttons are secondary / tertiary affordances.
 *                      Renderer left-aligns and flexes them.
 * @property aside    - Optional right-aligned auxiliary slot. Authors compose
 *                      `Link.Root("Why this and not alternatives?", { onClick })`
 *                      or any other UI component. Renderer right-aligns.
 * @property accent   - Left-rail tint. Auto-derives from commit-strength
 *                      when omitted.
 */
export const DecisionBriefValueType: StructType<{
    claim:    StringType,
    because:  ArrayType<typeof DecisionBriefReasonType>,
    upside:   StringType,
    risks:    OptionType<StringType>,
    unknowns: OptionType<StringType>,
    stakes:   typeof StakesType,
    actions:  ArrayType<UIComponentType>,
    aside:    OptionType<typeof DecisionBriefAsideType>,
    accent:   OptionType<typeof DecisionBriefAccentType>,
    style:    OptionType<typeof DecisionBriefStyleType>,
}> = StructType({
    claim:    StringType,
    because:  ArrayType(DecisionBriefReasonType),
    upside:   StringType,
    risks:    OptionType(StringType),
    unknowns: OptionType(StringType),
    stakes:   StakesType,
    actions:  ArrayType(UIComponentType),
    aside:    OptionType(DecisionBriefAsideType),
    accent:   OptionType(DecisionBriefAccentType),
    style:    OptionType(DecisionBriefStyleType),
});

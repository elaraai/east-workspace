# THEME-CONTRACT

East UI describes UI as serialisable East IR; the consumer's Chakra v3 theme
owns every concrete value (colour hex, shadow CSS, duration ms, easing
cubic-bezier, …). This document is the contract between the two layers.

Every token that east-ui references is listed below, grouped by category. If
the consumer's theme does not publish a token, the consuming surface will
render with Chakra defaults or — in some cases — no visible output.

**Scope:** this contract covers **plan 1.1** (the global style system). Other
tokens (component recipes, per-pattern escape hatches) are covered by their
own plans.

---

## 1. Semantic `colorPalette` (`ColorSchemeType`)

Five semantic palettes in addition to the ten existing hue palettes. Each
semantic palette is dichromacy-safe (deuteranopia + protanopia tested). The
theme must register a palette per key with at least the four sub-tokens
listed below.

| Palette | Meaning | Required sub-tokens |
|---|---|---|
| `success` | On-track / passed / ok | `fg.success`, `bg.success.subtle`, `bg.success.solid`, `border.success` |
| `warning` | At-risk / needs attention | `fg.warning`, `bg.warning.subtle`, `bg.warning.solid`, `border.warning` |
| `danger` | Off-spec / failed / blocked | `fg.danger`, `bg.danger.subtle`, `bg.danger.solid`, `border.danger` |
| `info` | Informational / neutral callout | `fg.info`, `bg.info.subtle`, `bg.info.solid`, `border.info` |
| `neutral` | Idle / inactive / unknown | `fg.neutral`, `bg.neutral.subtle`, `bg.neutral.solid`, `border.neutral` |

**Consequences of missing registration:** Chakra renders a transparent
surface. Host CI is strongly advised to assert presence at theme-load time.

---

## 2. `textStyles` (`TextStyleType`)

Seventeen named text styles. Each resolves to a bundle covering font family,
size, weight, line-height, letter-spacing, and (where applicable) font
variant numeric.

| Token | Suggested resolved value |
|---|---|
| `display-lg` | 48px / 1.15 / weight 700 / sans |
| `display-md` | 40px / 1.2 / weight 700 / sans |
| `display-sm` | 32px / 1.25 / weight 700 / sans |
| `heading-lg` | 24px / 1.3 / weight 700 / sans |
| `heading-md` | 20px / 1.35 / weight 600 / sans |
| `heading-sm` | 17px / 1.4 / weight 600 / sans |
| `heading-xs` | 15px / 1.4 / weight 600 / sans |
| `body-lg` | 17px / 1.6 / weight 400 / sans |
| `body-md` | 15px / 1.6 / weight 400 / sans (default) |
| `body-sm` | 13px / 1.55 / weight 400 / sans |
| `label-md` | 13px / 1.4 / weight 500 / sans |
| `label-sm` | 11px / 1.35 / weight 500 / sans |
| `caption` | 11px / 1.35 / weight 400 / sans / `color: fg.muted` |
| `overline` | 10px / 1.2 / weight 600 / sans / `letter-spacing: 0.06em` / uppercase |
| `code-sm` | 12px / 1.5 / weight 400 / mono |
| `code-md` | 14px / 1.5 / weight 400 / mono |
| `mono-kpi` | 32px / 1.1 / weight 600 / mono / `font-variant-numeric: tabular-nums` |

**Consequences of missing registration:** the text renders with Chakra's
default textStyle fallback (typically body-md) — visible but wrong.

---

## 3. Elevation (`ElevationType`)

Five surface-stacking semantics. Each resolves to three theme token paths.

| Token | `shadows.<tag>` | `zIndex.<tag>` | `colors.bg.<tag>` |
|---|---|---|---|
| `flat` | `none` | `base` (1) | `bg.surface` |
| `raised` | `shadows.raised` | `base` | `bg.raised` |
| `overlay` | `shadows.overlay` | `overlay` (1400) | `bg.overlay` |
| `floating` | `shadows.floating` | `popover` (1500) | `bg.floating` |
| `modal` | `shadows.modal` | `modal` (1600) | `bg.modal` |

**Suggested defaults.**
- `shadows.raised` — `0 1px 2px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)`
- `shadows.overlay` — `0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.06)`
- `shadows.floating` — `0 8px 24px rgba(0,0,0,0.1), 0 4px 8px rgba(0,0,0,0.06)`
- `shadows.modal` — `0 24px 64px rgba(0,0,0,0.16), 0 8px 16px rgba(0,0,0,0.08)`

---

## 4. Motion (`MotionDurationType` + `MotionEasingType`)

Duration and easing tokens are referenced from the renderer as CSS variables
(`var(--motion-duration-fast)`, `var(--motion-easing-standard)`). Define
them once on `:root` (or via a Chakra global CSS recipe).

### Duration

| Token | Suggested value |
|---|---|
| `instant` | `0ms` |
| `fast` | `120ms` |
| `normal` | `200ms` |
| `slow` | `320ms` |

### Easing

| Token | Suggested value |
|---|---|
| `standard` | `cubic-bezier(0.4, 0.0, 0.2, 1)` |
| `emphasized` | `cubic-bezier(0.2, 0.0, 0.0, 1)` |
| `decelerated` | `cubic-bezier(0.0, 0.0, 0.2, 1)` |
| `accelerated` | `cubic-bezier(0.4, 0.0, 1.0, 1)` |

---

## 5. Focus ring (`FocusStyleType`)

Four focus-ring policies. Resolved as a `{ outlineWidth, outlineOffset,
outlineColor }` triple when the helper wraps the Chakra `&:focus-visible`
selector.

| Token | `outlineWidth` | `outlineOffset` | `outlineColor` |
|---|---|---|---|
| `default` | `2px` | `2px` | `colors.focus.ring` |
| `emphasis` | `3px` | `2px` | `colors.focus.emphasis` |
| `subtle` | `1px` | `1px` | `colors.focus.subtle` |
| `none` | `0` | `0` | `transparent` |

**Suggested defaults.**
- `colors.focus.ring` — a contrast-safe accent at ≥3:1 against neighbouring
  surfaces (commonly `{colorPalette}.solid`).
- `colors.focus.emphasis` — stronger brand accent for editing-state cells.
- `colors.focus.subtle` — low-contrast ring for dense tables.

---

## 6. Hover intent (`HoverIntentType`)

Four named hover-open delays. Consumed by Tooltip / ToggleTip / HoverCard /
Menu-on-hover; a single source of truth for consistent timing.

| Token | `openDelay` (ms) | `closeDelay` (ms) |
|---|---|---|
| `instant` | 0 | 0 |
| `brief` | 100 | 50 |
| `standard` | 300 | 100 |
| `patient` | 700 | 200 |

Resolved by `east-ui-components/src/contracts/hover-intent.ts` (0-conventions
plan). Values are hard-coded in that helper, not theme-overridable —
intentionally kept uniform across the catalogue.

---

## 7. Animation keyframes (`AnimationPresetType`)

Six named keyframe animations. The renderer resolves tokens to names only
(`east-pulse`, `east-spin`, …); the theme must define `@keyframes` and
publish the globals.

| Token | Behaviour | Keyframe |
|---|---|---|
| `none` | No animation | — |
| `pulse` | Opacity pulse | `@keyframes east-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.4 } }` |
| `spin` | Continuous rotation | `@keyframes east-spin { to { transform: rotate(360deg) } }` |
| `bounce` | Vertical bounce | `@keyframes east-bounce { 0%,20%,50%,80%,100% { transform: translateY(0) } 40% { transform: translateY(-6px) } 60% { transform: translateY(-3px) } }` |
| `fade-in` | Opacity fade-in | `@keyframes east-fade-in { from { opacity: 0 } to { opacity: 1 } }` |
| `shimmer` | Highlight band | `@keyframes east-shimmer { 0% { background-position: -200% 0 } 100% { background-position: 200% 0 } }` |

**Reduced motion.** The renderer consults `prefers-reduced-motion` via
`east-ui-components/src/contracts/reduced-motion.ts` (0-conventions plan).
Every preset degrades to `"none"` when the media query matches.

---

## 8. Z-index layers (`ZIndexTokenType`)

Nine named stacking layers. Populate `theme.zIndex.<token>` values.

| Token | Suggested value |
|---|---|
| `base` | `1` |
| `dropdown` | `1000` |
| `sticky` | `1100` |
| `banner` | `1200` |
| `overlay` | `1300` |
| `modal` | `1400` |
| `popover` | `1500` |
| `toast` | `1700` |
| `tooltip` | `1800` |

---

## sample-theme.ts

A minimal Chakra v3 system extension covering every category in this
contract. The file you put at the top of your app should resemble:

```ts
import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

const config = defineConfig({
    globalCss: {
        ":root": {
            // Motion durations (§4)
            "--motion-duration-instant": "0ms",
            "--motion-duration-fast": "120ms",
            "--motion-duration-normal": "200ms",
            "--motion-duration-slow": "320ms",
            // Motion easings (§4)
            "--motion-easing-standard": "cubic-bezier(0.4, 0.0, 0.2, 1)",
            "--motion-easing-emphasized": "cubic-bezier(0.2, 0.0, 0.0, 1)",
            "--motion-easing-decelerated": "cubic-bezier(0.0, 0.0, 0.2, 1)",
            "--motion-easing-accelerated": "cubic-bezier(0.4, 0.0, 1.0, 1)",
        },
        // Animation keyframes (§7)
        "@keyframes east-pulse": {
            "0%, 100%": { opacity: 1 },
            "50%": { opacity: 0.4 },
        },
        "@keyframes east-spin": { to: { transform: "rotate(360deg)" } },
        "@keyframes east-bounce": {
            "0%, 20%, 50%, 80%, 100%": { transform: "translateY(0)" },
            "40%": { transform: "translateY(-6px)" },
            "60%": { transform: "translateY(-3px)" },
        },
        "@keyframes east-fade-in": {
            from: { opacity: 0 },
            to: { opacity: 1 },
        },
        "@keyframes east-shimmer": {
            "0%": { backgroundPosition: "-200% 0" },
            "100%": { backgroundPosition: "200% 0" },
        },
    },
    theme: {
        tokens: {
            colors: {
                // Semantic palettes (§1) — one subset shown; repeat for warning / danger / info / neutral
                fg: {
                    success: { value: "{colors.green.700}" },
                    warning: { value: "{colors.orange.700}" },
                    danger:  { value: "{colors.red.700}" },
                    info:    { value: "{colors.blue.700}" },
                    neutral: { value: "{colors.gray.700}" },
                },
                bg: {
                    surface:  { value: "white" },
                    raised:   { value: "white" },
                    overlay:  { value: "white" },
                    floating: { value: "white" },
                    modal:    { value: "white" },
                    success:  { subtle: { value: "{colors.green.50}" },  solid: { value: "{colors.green.600}" } },
                    warning:  { subtle: { value: "{colors.orange.50}" }, solid: { value: "{colors.orange.500}" } },
                    danger:   { subtle: { value: "{colors.red.50}" },    solid: { value: "{colors.red.600}" } },
                    info:     { subtle: { value: "{colors.blue.50}" },   solid: { value: "{colors.blue.600}" } },
                    neutral:  { subtle: { value: "{colors.gray.50}" },   solid: { value: "{colors.gray.500}" } },
                },
                focus: {
                    ring:     { value: "{colors.blue.500}" },
                    emphasis: { value: "{colors.blue.700}" },
                    subtle:   { value: "{colors.gray.400}" },
                },
            },
            shadows: {
                // Elevation (§3)
                raised:   { value: "0 1px 2px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)" },
                overlay:  { value: "0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.06)" },
                floating: { value: "0 8px 24px rgba(0,0,0,0.1), 0 4px 8px rgba(0,0,0,0.06)" },
                modal:    { value: "0 24px 64px rgba(0,0,0,0.16), 0 8px 16px rgba(0,0,0,0.08)" },
            },
            zIndex: {
                // Z-index layers (§8)
                base:     { value: 1 },
                dropdown: { value: 1000 },
                sticky:   { value: 1100 },
                banner:   { value: 1200 },
                overlay:  { value: 1300 },
                modal:    { value: 1400 },
                popover:  { value: 1500 },
                toast:    { value: 1700 },
                tooltip:  { value: 1800 },
            },
        },
        textStyles: {
            // TextStyle recipes (§2)
            "display-lg": { value: { fontSize: "48px", lineHeight: 1.15, fontWeight: 700, fontFamily: "sans" } },
            "display-md": { value: { fontSize: "40px", lineHeight: 1.2,  fontWeight: 700, fontFamily: "sans" } },
            "display-sm": { value: { fontSize: "32px", lineHeight: 1.25, fontWeight: 700, fontFamily: "sans" } },
            "heading-lg": { value: { fontSize: "24px", lineHeight: 1.3,  fontWeight: 700, fontFamily: "sans" } },
            "heading-md": { value: { fontSize: "20px", lineHeight: 1.35, fontWeight: 600, fontFamily: "sans" } },
            "heading-sm": { value: { fontSize: "17px", lineHeight: 1.4,  fontWeight: 600, fontFamily: "sans" } },
            "heading-xs": { value: { fontSize: "15px", lineHeight: 1.4,  fontWeight: 600, fontFamily: "sans" } },
            "body-lg":    { value: { fontSize: "17px", lineHeight: 1.6,  fontWeight: 400, fontFamily: "sans" } },
            "body-md":    { value: { fontSize: "15px", lineHeight: 1.6,  fontWeight: 400, fontFamily: "sans" } },
            "body-sm":    { value: { fontSize: "13px", lineHeight: 1.55, fontWeight: 400, fontFamily: "sans" } },
            "label-md":   { value: { fontSize: "13px", lineHeight: 1.4,  fontWeight: 500, fontFamily: "sans" } },
            "label-sm":   { value: { fontSize: "11px", lineHeight: 1.35, fontWeight: 500, fontFamily: "sans" } },
            "caption":    { value: { fontSize: "11px", lineHeight: 1.35, fontWeight: 400, fontFamily: "sans", color: "{colors.fg.muted}" } },
            "overline":   { value: { fontSize: "10px", lineHeight: 1.2,  fontWeight: 600, fontFamily: "sans", letterSpacing: "0.06em", textTransform: "uppercase" } },
            "code-sm":    { value: { fontSize: "12px", lineHeight: 1.5,  fontWeight: 400, fontFamily: "mono" } },
            "code-md":    { value: { fontSize: "14px", lineHeight: 1.5,  fontWeight: 400, fontFamily: "mono" } },
            "mono-kpi":   { value: { fontSize: "32px", lineHeight: 1.1,  fontWeight: 600, fontFamily: "mono", fontVariantNumeric: "tabular-nums" } },
        },
    },
});

export const system = createSystem(defaultConfig, config);
```

---

## Extension points

This contract grows. New tokens added by later plans (per-component colour
escape hatches, pattern-specific surfaces, etc.) are documented in their
respective plans. Authors who need a token that is not yet in the contract
can use the raw CSS escape hatches on primitives (`borderRadius: "12px"`,
`boxShadow: "..."`), pending a future token-promotion.

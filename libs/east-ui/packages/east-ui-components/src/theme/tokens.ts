/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Raw design tokens for the canonical Elara Chakra v3 system.
 *
 * Values are the East Design System's (`libs/east-ui/app_design_system/
 * tokens/*.css`, a read-only download of the claude.ai/design project); the
 * token guard (`design-system.test.ts`) fails, naming the token, when one
 * drifts. Don't introduce a value the design system doesn't have.
 *
 * @packageDocumentation
 */

import { defineTokens } from "@chakra-ui/react";

/* ─── Fonts ────────────────────────────────────────────────────────────── */

/* Variable-font names ("X Variable") come first — those are the names
 * registered by the `@fontsource-variable/*` stylesheets that the
 * `@elaraai/east-ui-components/fonts` entry (`src/fonts.ts`) imports for side
 * effects. Non-variable family names follow as fallback for any environment
 * that loads the static .woff2 separately. */
export const FONT_BRAND =
    '"DM Sans Variable", "DM Sans", system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
export const FONT_BODY =
    '"Inter Tight Variable", "Inter Tight", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
export const FONT_MONO =
    '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

/* ─── Colour scales ────────────────────────────────────────────────────── */

/** Brand — deep teal scale. Mid is `#488e97`; ink is `#111b22`. */
export const brandScale = {
    50:  { value: "#f0fffe" },
    100: { value: "#c2fcfc" },
    200: { value: "#94f9f9" },
    300: { value: "#79f8f8" },
    400: { value: "#5ce5e5" },
    500: { value: "#488e97" },
    600: { value: "#3a7780" },
    700: { value: "#2b4b55" },
    800: { value: "#1f363d" },
    900: { value: "#111b22" },
};

/** Neutrals — cool green-gray. Never warm-gray. */
export const grayScale = {
    50:  { value: "#f8fafa" },
    100: { value: "#f1f5f5" },
    200: { value: "#e2e8e8" },
    300: { value: "#cbd5d5" },
    400: { value: "#9bb0b0" },
    500: { value: "#6b8080" },
    600: { value: "#4a5f5f" },
    700: { value: "#374848" },
    800: { value: "#253333" },
    900: { value: "#1a2626" },
};

/* ─── Token bundle ─────────────────────────────────────────────────────── */

/**
 * Raw tokens for the Elara Chakra v3 system. Pass to `defineConfig({ theme: { tokens } })`.
 */
export const tokens = defineTokens({
    fonts: {
        heading: { value: FONT_BRAND },
        body:    { value: FONT_BODY },
        mono:    { value: FONT_MONO },
    },
    colors: {
        /* The raw scales feed the semantic tokens and are never referenced by
         * a recipe or renderer (component-rules §1). */
        brand: brandScale,
        gray:  grayScale,
        // Accent hues — chart marks only, never chrome. The design system's
        // comparison order after series 1 (`brand.solid`) is teal → purple →
        // blue → orange (`--teal-500` … `--orange-500`). Mid-vibrancy hues
        // that hold on light and dark surfaces alike, so they stay raw tokens
        // (mode-independent).
        accent: {
            teal:   { value: "#14b8a6" },
            purple: { value: "#8b5cf6" },
            blue:   { value: "#3b82f6" },
            orange: { value: "#f97316" },
            brand:  { value: "#488e97" },
            yellow: { value: "#eab308" },
            pink:   { value: "#ec4899" },
            slate:  { value: "#6b8080" },
        },
        /* The design system's colours — `fg` … `fg.faint`, the papers, the
         * rules, `brandMark` / `brand.solid` / `brandPressed` / `brandTint`,
         * `status.*`, the text steps and `heat.*` — are SEMANTIC tokens
         * (semantic-tokens.ts): they carry per-colour-mode values, which raw
         * tokens cannot. References (`{colors.status.pos}`,
         * `var(--chakra-colors-status-pos)`, …) resolve identically. */
    },
    radii: {
        xs:   { value: "3px" },   // small controls / chips (badge, meter, barStrip, checkbox)
        sm:   { value: "4px" },
        md:   { value: "6px" },   // buttons, inputs
        lg:   { value: "8px" },   // cards
        xl:   { value: "12px" },
        "2xl":{ value: "16px" },  // dialogs
        full: { value: "9999px" },
    },
    spacing: {
        // 4-pixel grid — multiples of 4 only. No 5/7/10/14/18/22.
        "0":  { value: "0" },
        "1":  { value: "4px" },
        "2":  { value: "8px" },
        "3":  { value: "12px" },
        "4":  { value: "16px" },
        "5":  { value: "20px" },
        "6":  { value: "24px" },
        "8":  { value: "32px" },
        "10": { value: "40px" },
        "12": { value: "48px" },
        "16": { value: "64px" },
        "20": { value: "80px" },
    },
    sizes: {
        // Container width caps used by layout primitives.
        container: {
            sm: { value: "640px" },
            md: { value: "800px" },
            lg: { value: "1040px" },
            xl: { value: "1200px" },  // marketing cap
        },
        // Density-driven control heights — the single source for the column
        // header band and one text row, per density (compact / cozy / comfortable
        // → sm / md / lg). Derived from the Table cell rhythm (cell padding-Y
        // 6/10/12 + font 12/13/14): 2·padY + round(font·1.25). Consumed by Table
        // rows and header bands. Recipes can reference these
        // (`{sizes.density.row.md}`); renderers read them as numbers via
        // `useDensityHeights`.
        density: {
            header: { sm: { value: "27px" }, md: { value: "36px" }, lg: { value: "42px" } },
            row:    { sm: { value: "27px" }, md: { value: "36px" }, lg: { value: "42px" } },
        },
    },
    shadows: {
        // Cool ink at low opacity — never warm, never black.
        xs: { value: "0 1px 2px rgba(17, 27, 34, 0.05)" },
        sm: { value: "0 1px 2px rgba(17, 27, 34, 0.06), 0 1px 3px rgba(17, 27, 34, 0.08)" },
        md: { value: "0 4px 6px -1px rgba(17, 27, 34, 0.08), 0 2px 4px -2px rgba(17, 27, 34, 0.06)" },
        lg: { value: "0 10px 15px -3px rgba(17, 27, 34, 0.10), 0 4px 6px -4px rgba(17, 27, 34, 0.08)" },
        xl: { value: "0 20px 25px -5px rgba(17, 27, 34, 0.12), 0 8px 10px -6px rgba(17, 27, 34, 0.10)" },
        // Focus ring — 3 px brand-tinted.
        focus: { value: "0 0 0 3px rgba(72, 142, 151, 0.35)" },
        // Focus ring for invalid controls — 3 px danger-tinted.
        focusError: { value: "0 0 0 3px rgba(184, 90, 74, 0.25)" },
    },
    durations: {
        fast:   { value: "120ms" },
        normal: { value: "200ms" },
        slow:   { value: "360ms" },
    },
    easings: {
        // Soft landing — the default.
        out:    { value: "cubic-bezier(0.16, 1, 0.3, 1)" },
        // Symmetric curve for slide-in dialogs.
        inOut:  { value: "cubic-bezier(0.65, 0, 0.35, 1)" },
    },
    fontWeights: {
        light:     { value: "300" },
        normal:    { value: "400" },
        medium:    { value: "500" },
        semibold:  { value: "600" },
        bold:      { value: "700" },
        extrabold: { value: "800" },
    },
    fontSizes: {
        // The design system's sizes, and no others (`--fs-*`). Chakra's own
        // `xs` … `9xl` scale stays in the merged system for Chakra's recipes;
        // ours never name it.
        //
        // Labels (mono): 9.5 annotation lines, section eyebrows · 10 eyebrows,
        // table headers, axis labels · 10.5 compact breadcrumb, legend · 11
        // breadcrumb, tabs, segmented control, tooltip, sidebar items.
        label: {
            xs: { value: "9.5px" },
            sm: { value: "10px" },
            md: { value: "10.5px" },
            lg: { value: "11px" },
        },
        // Running text (Inter Tight): 12.5 buttons, captions · 13 body, table
        // cells, controls · 14 ledes.
        body: {
            sm:      { value: "12.5px" },
            DEFAULT: { value: "13px" },
            lg:      { value: "14px" },
        },
        // Titles (DM Sans): 15 empty state · 16 condensed bar · 18 compact
        // bar, h3 · 20 dialog, h2 · 24 page, h1.
        title: {
            xs: { value: "15px" },
            sm: { value: "16px" },
            md: { value: "18px" },
            lg: { value: "20px" },
            xl: { value: "24px" },
        },
        // Large numbers (mono, tabular, 600): Stat values, data-rail cells.
        num: { value: "26px" },
        /** @deprecated `body` — the size the CommandPalette recipe still
         *  names (due for removal); nothing else may. */
        control: { value: "{fontSizes.body}" },
    },
    lineHeights: {
        tight:   { value: "1.25" },
        snug:    { value: "1.375" },
        normal:  { value: "1.5" },
        relaxed: { value: "1.625" },
    },
    letterSpacings: {
        // The design system's tracking. Titles track negative (h1 −0.02em,
        // h2 −0.015em, h3–h5 −0.01em); the caption 0.02em; the breadcrumb
        // 0.06em; labels — eyebrows, keys, statuses, tabs, table headers —
        // 0.1em to 0.18em.
        tighter: { value: "-0.02em" },
        tight:   { value: "-0.015em" },
        snug:    { value: "-0.01em" },
        normal:  { value: "0" },
        wide:    { value: "0.02em" },   // caption
        wider:   { value: "0.06em" },   // breadcrumb
        caps:    { value: "0.1em" },    // keys, the tightest label tracking
        widest:  { value: "0.12em" },   // eyebrow, sidebar items
        label:   { value: "0.14em" },   // a Frame's name, the state eyebrow
        wider2:  { value: "0.16em" },   // mode-id, table headerCell, scope label
        widest2: { value: "0.18em" },   // section eyebrows, cell labels
    },
});

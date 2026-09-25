/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan recipe's NARROW layout (§10 / #570) — below 480px of container width
 * the canvas is a review tool: chips, tabs, the shared ruler and the card list.
 *
 * One part of the Plan slot recipe (`../plan.ts`, #817), over semantic tokens
 * and the canvas's geometry variables (`collections/plan/geometry.ts`).
 *
 * @packageDocumentation
 */

import type { SystemStyleObject } from "@chakra-ui/react";

/** The slots this part styles. */
export const narrowSlots = [
    "narrowRoot", "narrowChips", "narrowTabCount", "narrowRuler", "narrowRulerTrack",
    "narrowRulerTick", "narrowSection", "narrowSectionTitle", "narrowSectionGo", "narrowScope",
    "narrowScopeTitle", "narrowScopeMeta", "narrowBack", "narrowList", "narrowCard",
    "narrowCardHead", "narrowCardTitle", "narrowCardSub", "narrowCardBody", "narrowCardFoot",
    "narrowRender", "narrowTicks", "narrowMore", "narrowEmpty",
] as const;

/** Their base styles. */
export const narrowBase = {
    // ── The narrow layout (§10 / #570) ──────────────────────────────
    // Below 480px of CONTAINER width the Plan is a review tool, not a
    // canvas: grouped cards on the paper-2 page, 52pt rows, 40pt targets,
    // a tab strip at the top of the frame. A row's gutter identity is the
    // card head; its plot (the same kind renderer) is the card body. The
    // list has NO left gutter column, so the shared ruler and every card
    // body share one inset — 12px list padding + 1px card border + 12px
    // body margin — and the bucket columns line up down the page.
    narrowRoot: {
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        background: "bg.panel",
        // A bounded frame: the header (chips · tabs · ruler) stays put
        // and the LIST scrolls inside the frame (see `narrowList`); an
        // unbounded one grows with its list.
        "&[data-plan-fill]": { flex: 1, minHeight: 0 },
    },
    // The slice chips + the resolution chip — one wrapping row on the
    // page. No fill and no rule of its own: the tab strip below carries
    // the header's one baseline (the `tabs` recipe's), so the header is
    // chips · tabs on the page, not a ladder of filled bands.
    narrowChips: {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "8px",
        padding: "10px 12px 8px",
        flexShrink: 0,
    },
    // The plain mono numeral beside a tab label (the spec's "counts":
    // never a tinted pill). It inherits the trigger's ink — active reads
    // ink, inactive muted — and drops the label's tracking.
    narrowTabCount: {
        fontSize: "10px",
        fontWeight: "medium",
        letterSpacing: "0.02em",
        textTransform: "none",
    },
    // The shared ruler — the LIST's sticky first row, in the desktop
    // ruler's vocabulary: the panel surface, a separator per bucket (the
    // same rhythm as the card grids beneath it), a strong bottom rule.
    // Full-bleed across the list's padding, so the rule spans the page
    // while the tick track keeps the card bodies' inset.
    narrowRuler: {
        position: "relative",
        zIndex: 3,
        height: "var(--plan-ruler-h)",
        flexShrink: 0,
        marginX: "-12px",
        background: "bg.panel",
        borderBottomWidth: "1px",
        borderBottomColor: "border.strong",
        overflow: "clip",
        // Sticky ONLY where the list is its own scroll container (a
        // bounded frame) — the desktop ruler's rule too. On an unbounded
        // page the scroll is the host's, and `top: 0` against it slides
        // the axis under whatever app bar the host pins there.
        "[data-plan-fill] &": { position: "sticky", top: 0 },
    },
    // The tick track — inset to the card bodies' inset so the bucket
    // columns line up down the page; a grid, one cell per bucket.
    narrowRulerTrack: {
        position: "absolute",
        top: 0,
        bottom: 0,
        left: "25px",
        right: "25px",
        display: "grid",
        alignItems: "stretch",
    },
    // One bucket: its separator on the right edge (every bucket has one,
    // labelled or not), its label centred over it when it carries one —
    // wider than the cell at day resolution, so it may overflow into the
    // unlabelled neighbours on purpose.
    narrowRulerTick: {
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "mono",
        fontSize: "10px",
        fontWeight: "medium",
        color: "fg.subtle",
        whiteSpace: "nowrap",
        minWidth: 0,
        overflow: "visible",
        borderRightWidth: "1px",
        borderRightColor: "border.subtle",
        "&:last-of-type": { borderRightWidth: 0 },
        // A 28px band has no lane for the NOW chip, and a chip laid over
        // the labels hides the two it straddles. The now BUCKET's label
        // wears the brand instead — the line beneath it says the rest.
        "&[data-now]": { color: "brand.fg", fontWeight: "semibold" },
    },
    // A group's section header on the unscoped Rows tab — the group's
    // band vocabulary (mono uppercase name + meta), a tap scopes to it.
    narrowSection: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "8px 4px 0",
        minWidth: 0,
        cursor: "pointer",
        "&:first-of-type": { paddingTop: "2px" },
    },
    narrowSectionTitle: {
        fontFamily: "mono",
        fontSize: "11px",
        fontWeight: "semibold",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "fg.muted",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        minWidth: 0,
    },
    narrowSectionGo: {
        fontSize: "14px",
        lineHeight: 1,
        color: "fg.subtle",
    },
    // The Rows tab's scope line — which group's rows these are, and the
    // way back to the group list.
    narrowScope: {
        display: "flex",
        alignItems: "baseline",
        gap: "10px",
        padding: "12px 12px 2px",
        minWidth: 0,
    },
    narrowScopeTitle: {
        fontSize: "15px",
        fontWeight: "semibold",
        color: "fg.default",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        minWidth: 0,
    },
    narrowScopeMeta: {
        fontFamily: "mono",
        fontSize: "9.5px",
        fontWeight: "medium",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "fg.subtle",
        marginLeft: "auto",
        whiteSpace: "nowrap",
        flexShrink: 0,
    },
    narrowBack: {
        fontFamily: "mono",
        fontSize: "10px",
        fontWeight: "semibold",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "brand.fg",
        background: "transparent",
        border: "none",
        padding: "2px 4px",
        marginLeft: "-4px",
        cursor: "pointer",
        whiteSpace: "nowrap",
        flexShrink: 0,
        _coarse: { minHeight: "40px" },
    },
    narrowList: {
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        // No top padding: the ruler is the first child and sits FLUSH
        // under the tab baseline, its separators meeting the rule the way
        // the desktop ruler meets the toolbar's (a 10px strip of bare page
        // between the rule and the top of the axis lines read as a
        // misalignment, not as breathing room). The list gap then puts
        // 10px between the ruler and the first card.
        padding: "0 12px 14px",
        minWidth: 0,
        // Vertical scroll is the page's; horizontal is the two-finger
        // window pan (§10) — leave it to the pointer handlers.
        touchAction: "pan-y",
        // In a bounded frame the list is what scrolls — the header above
        // it stays put (it used to be the whole root that scrolled, and a
        // flex column with a scrolling root shrank the ruler to 0px).
        "[data-plan-fill] &": { flex: 1, minHeight: 0, overflowY: "auto" },
        // A scrolling flex column must not SHRINK its cards to fit (an
        // `overflow: hidden` card has no content floor, so it collapsed
        // to a sliver instead of overflowing) — they keep their size and
        // the list scrolls.
        "& > *": { flexShrink: 0 },
    },
    // One card — a row's identity over its plot. Selection is the one
    // brand tint; a drilled card wears the brand rule.
    narrowCard: {
        background: "bg.surface",
        borderWidth: "1px",
        borderColor: "border.subtle",
        borderRadius: "8px",
        overflow: "hidden",
        position: "relative",
        cursor: "pointer",
        // A drafted row's card (#880) — the canvas row's marks: the warn wash
        // while a draft of its entry changed it, danger while a check refuses
        // the entry. Before the selection tint, which wins over both.
        "&[data-draft]": { background: "color-mix(in oklch, {colors.status.warn} 8%, {colors.bg.surface})" },
        "&[data-invalid]": { background: "color-mix(in oklch, {colors.status.neg} 8%, {colors.bg.surface})" },
        "&[data-selected]": { background: "{colors.brandTint}", borderColor: "color-mix(in srgb, {colors.brand.600} 40%, {colors.border.subtle})" },
        "&[data-expanded]": { borderColor: "{colors.brand.600}" },
    },
    narrowCardHead: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "10px 12px 6px",
        minHeight: "40px",
        minWidth: 0,
    },
    narrowCardTitle: {
        fontSize: "13px",
        fontWeight: "semibold",
        color: "fg.default",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        minWidth: 0,
        // Mono row-id treatment (`.nm.id`), and the group strip's name.
        "&[data-id]": { fontFamily: "mono", fontSize: "12px", letterSpacing: "0.02em" },
        "&[data-group]": { fontFamily: "mono", fontSize: "11px", letterSpacing: "0.12em", textTransform: "uppercase", color: "fg.muted" },
    },
    narrowCardSub: {
        fontFamily: "mono",
        fontSize: "9.5px",
        fontWeight: "medium",
        color: "fg.subtle",
        padding: "0 12px 6px",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    // The plot cell of a card — the row's kind renderer positions its
    // marks absolutely inside, exactly as in the desktop plot cell.
    narrowCardBody: {
        position: "relative",
        margin: "0 12px 10px",
        overflow: "hidden",
        minWidth: 0,
    },
    narrowCardFoot: {
        display: "flex",
        justifyContent: "flex-end",
        padding: "0 12px 10px",
    },
    // A drilled card's render region (§10: ~148pt in place).
    narrowRender: {
        position: "relative",
        margin: "0 12px 10px",
        overflow: "hidden",
        animation: "plan-settle-in 0.22s ease-out 0.3s backwards",
        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
    },
    // A chart card has no gutter to print its value ticks in — they
    // overlay the plot's left edge instead (`chartTickLeft` positions
    // against this box).
    narrowTicks: {
        position: "absolute",
        left: 0,
        top: 0,
        bottom: 0,
        width: "34px",
        pointerEvents: "none",
        zIndex: 5,
    },
    // `9 MORE GROUPS · 378 RS` — the load-more card.
    narrowMore: {
        fontFamily: "mono",
        fontSize: "10px",
        fontWeight: "semibold",
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: "fg.muted",
        background: "bg.surface",
        borderWidth: "1px",
        borderStyle: "dashed",
        borderColor: "border.strong",
        borderRadius: "8px",
        padding: "14px 12px",
        textAlign: "center",
        cursor: "pointer",
        width: "100%",
        _coarse: { minHeight: "44px" },
        "&:hover": { color: "fg.default" },
    },
    narrowEmpty: {
        fontFamily: "mono",
        fontSize: "10px",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "fg.subtle",
        padding: "24px 12px",
        textAlign: "center",
    },
} satisfies Record<(typeof narrowSlots)[number], SystemStyleObject>;

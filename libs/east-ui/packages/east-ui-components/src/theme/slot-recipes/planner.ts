/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Planner slot recipe — the discrete `rows × ordered slots` scheduling grid.
 *
 * Values mirror `design/spec.css` (`.planner-*` / `.evt-*`) and the planner
 * article's inline header styles exactly. Event appearance is driven by two
 * variants — `shape` (point chip vs span bar) and `state` (the committed /
 * proposed{added,model,removed} / rejected grammar); conflict markers by a
 * `severity` variant; row/header rhythm by `size`. The renderer carries no
 * inline design values — it only consumes these slots.
 *
 * The optional review chrome (trailing decision column + quiet status dot)
 * lives on the shared `reviewChrome` slot recipe — one definition for every
 * review adopter (Planner, Gantt, Table, Roster) — and the batch foot reuses
 * the shared `commitBar` recipe rather than a planner slot.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const plannerSlotRecipe = defineSlotRecipe({
    className: "elara-planner",
    slots: [
        "root", "header", "colHeader", "headerCell", "leftPanel",
        "row", "groupHead", "groupHeadCell", "rowHeader", "rowHeaderName", "rowHeaderSub",
        "cell",
        "bucketedCell", "bucket", "bucketLabel",
        "event", "grip", "nowLine", "nowPip", "nowHint", "markerRing", "markerIcon", "axis",
    ],
    base: {
        root: { display: "flex", flexDirection: "column", overflowX: "auto", overflowY: "hidden", background: "bg.surface", width: "100%" },
        // Header band — paper-2 wash. The strong bottom rule lives on each header
        // cell (so column headers + day headers share one continuous line);
        // `stretch` makes the cells fill the band so that rule sits flush.
        header: {
            background: "bg.panel",
            alignItems: "stretch",
        },
        // Left column header (`.planner` lhs header) — mono 11px / 0.18em / ink-4.
        // The divider between columns is the shared resize-grip bar (centred on
        // the boundary), not a border; the strong bottom rule matches the band.
        colHeader: {
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "semibold",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "{colors.gray.500}",
            padding: "10px 14px",
            display: "flex",
            alignItems: "center",
            borderBottomWidth: "1px",
            borderBottomColor: "border.strong",
            whiteSpace: "nowrap",
            overflow: "hidden",
            minWidth: 0,
        },
        // Axis (day) header cell — same type, centred, tighter padding. The
        // divider is the shared grip bar (centred on the boundary); the strong
        // bottom rule matches the column headers so the band reads as one line.
        headerCell: {
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "semibold",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "{colors.gray.500}",
            padding: "10px 4px",
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderBottomWidth: "1px",
            borderBottomColor: "border.strong",
            whiteSpace: "nowrap",
            overflow: "hidden",
            minWidth: 0,
        },
        leftPanel: { background: "bg.surface" },
        // Data row — group-head rows opt into `groupHead`.
        row: {
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
        },
        groupHead: {
            background: "bg.panel",
            minHeight: "28px",
            fontFamily: "mono",
            fontSize: "9.5px",
            fontWeight: "bold",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "{colors.gray.600}",
            display: "flex",
            alignItems: "center",
            // A group head is still a row — it carries the same bottom rule.
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
        },
        // Group-head left cell — carries the left-pane right rule so the
        // 240px boundary continues unbroken through the group divider.
        groupHeadCell: {
            display: "flex",
            alignItems: "center",
            padding: "6px 12px",
            borderRightWidth: "1px",
            borderRightColor: "border.subtle",
        },
        // Row header (`.planner-rh`) — name + meta stacked, border-right rule.
        // `minWidth: 0` + `overflow: hidden` keep the value inside the column
        // (it truncates with ellipsis) instead of spilling into the neighbour.
        rowHeader: {
            fontFamily: "mono",
            padding: "8px 12px",
            borderRightWidth: "1px",
            borderRightColor: "border.subtle",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            minWidth: 0,
            overflow: "hidden",
        },
        rowHeaderName: {
            fontFamily: "mono",
            fontSize: "11.5px",
            fontWeight: "semibold",
            color: "fg.default",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        rowHeaderSub: {
            fontFamily: "mono",
            fontSize: "10px",
            color: "{colors.gray.500}",
            marginTop: "2px",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        // Slot cell (`.planner-cell`).
        cell: {
            position: "relative",
            borderRightWidth: "1px",
            borderRightColor: "border.subtle",
            display: "flex",
            alignItems: "center",
            gap: "3px",
            flexWrap: "wrap",
            padding: "3px 4px",
            minWidth: 0,
            boxSizing: "border-box",
        },
        // Bucketed cell — a vertical sub-grid of labelled buckets.
        bucketedCell: { display: "grid", gap: "2px", padding: "2px", gridAutoFlow: "row", alignItems: "stretch" },
        bucket: {
            position: "relative",
            background: "rgba(0,0,0,0.02)",
            borderRadius: "2px",
            display: "flex",
            alignItems: "center",
            gap: "3px",
            padding: "2px 4px",
            minWidth: 0,
            overflow: "hidden",
        },
        bucketLabel: {
            fontFamily: "mono",
            fontSize: "8.5px",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "{colors.gray.600}",
            fontWeight: "bold",
            flexShrink: 0,
            // Wide enough for the 3-glyph "N/A" orphan-lane label so every lane's
            // label gutter is the same width and the chips stay column-aligned.
            width: "24px",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        // Event chip (`.evt`) — base shared by every state; `shape` + `state` colour it.
        event: {
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            padding: "3px 8px",
            borderRadius: "2px",
            fontFamily: "mono",
            fontSize: "10.5px",
            fontWeight: "semibold",
            lineHeight: "1.4",
            whiteSpace: "nowrap",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "transparent",
            boxSizing: "border-box",
            // A chip never exceeds its cell — the label truncates instead of
            // spilling past the column (and getting clipped at the card edge).
            maxWidth: "100%",
            minWidth: 0,
            overflow: "hidden",
        },
        // Drag grip on proposed events (`.grip`) — FontAwesome icon, currentColor.
        grip: {
            display: "inline-flex",
            alignItems: "center",
            marginRight: "2px",
            fontSize: "11px",
            flexShrink: 0,
            color: "{colors.brand.600}",
        },
        // "Now" divider — 1px brand-600 rule with a small cap pip.
        nowLine: {
            position: "absolute",
            top: 0,
            bottom: 0,
            width: 0,
            borderLeftWidth: "1px",
            borderLeftColor: "{colors.brand.600}",
            pointerEvents: "none",
            zIndex: 2,
        },
        nowPip: {
            position: "absolute",
            top: "2px",
            width: "5px",
            height: "5px",
            marginLeft: "-3px",
            borderRadius: "full",
            background: "{colors.brand.600}",
        },
        nowHint: { position: "absolute", top: 0, bottom: 0, width: "12px", marginLeft: "-6px", zIndex: 2, cursor: "help" },
        // Status ring around the marked cell — colour set by the `status` variant.
        markerRing: {
            position: "absolute",
            inset: "1px",
            borderWidth: "1.5px",
            borderStyle: "solid",
            borderRadius: "2px",
            pointerEvents: "none",
            zIndex: 1,
        },
        // A bare status icon in the cell's top-right corner (no filled box).
        // Hovering it surfaces the marker message as a tooltip; colour by status.
        markerIcon: {
            position: "absolute",
            top: "3px",
            right: "3px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "12px",
            lineHeight: 1,
            cursor: "help",
            zIndex: 3,
        },
        axis: { fontFamily: "mono", fontSize: "11px", letterSpacing: "0.18em", textTransform: "uppercase", color: "{colors.gray.500}" },
        // (Review decision-column chrome — `decisionHeader` / `decisionCol` /
        // `statusDot` — moved to the shared `reviewChrome` slot recipe so every
        // review adopter wears identical chrome. The foot stays on `commitBar`.)
    },
    variants: {
        size: {
            // NB no `row.minHeight` here: the row takes its height from the
            // per-cell `unitH` the renderer sets (the density `sizes.density.row`
            // token). A separate `row.minHeight` floor (formerly 36/56) exceeded
            // that cell height at compact/comfortable and left an uncovered strip
            // at the bottom of every row that no cell wash filled (#120 item 2).
            sm: { rowHeader: { paddingY: "{spacing.1}" }, colHeader: { paddingY: "{spacing.1.5}" }, headerCell: { paddingY: "{spacing.1.5}" } },
            md: {},
            lg: { rowHeader: { paddingY: "{spacing.3}" }, colHeader: { paddingY: "{spacing.3}" }, headerCell: { paddingY: "{spacing.3}" } },
        },
        // Event geometry — slot-bound chip vs multi-slot bar.
        shape: {
            point: {},
            span: {
                event: {
                    // Flex (not block) so the label is a shrinkable flex item and
                    // truncates with an ellipsis when the bar is narrower than it.
                    display: "flex",
                    alignItems: "center",
                    width: "100%",
                    // Fill the row height (the renderer now sizes span cells to the
                    // density `unitH` and wraps the bar top:0/bottom:0), leaving a
                    // ~6px gutter top/bottom so stacked bars don't visually fuse —
                    // no longer a fixed 22px that reads short in taller rows (#120).
                    height: "calc(100% - 6px)",
                    padding: "0 8px",
                    fontSize: "11px",
                    overflow: "hidden",
                },
            },
        },
        // Event audit state — the committed / proposed / rejected grammar.
        state: {
            committed: {
                event: { background: "{colors.brand.700}", color: "{colors.white}", borderColor: "{colors.brand.700}" },
            },
            proposedAdded: {
                event: { background: "{colors.brandTint}", color: "{colors.brand.700}", borderColor: "{colors.brand.600}", borderStyle: "dashed", cursor: "grab" },
            },
            proposedModel: {
                event: { background: "transparent", color: "{colors.brand.700}", borderColor: "{colors.brand.600}", borderStyle: "dashed", fontStyle: "italic", cursor: "grab" },
            },
            proposedRemoved: {
                event: {
                    // Diagonal stripe (spec `.evt-proposed.removed`): brand-tint with a thin neg-tinted hatch.
                    backgroundImage: "repeating-linear-gradient(45deg, {colors.brandTint} 0 4px, rgba(184,90,74,0.10) 4px 5px)",
                    color: "{colors.gray.600}", borderColor: "{colors.brand.600}", borderStyle: "dashed", textDecoration: "line-through",
                },
            },
            rejected: {
                event: { background: "transparent", color: "{colors.gray.500}", borderColor: "{colors.gray.400}", textDecoration: "line-through" },
            },
        },
        // Conflict severity — colours the ring border + badge fill. (The review
        // chrome's quiet row dot rides the same axis on the shared `reviewChrome`
        // recipe's `status` variant.)
        status: {
            success: { markerRing: { borderColor: "{colors.status.pos}",  background: "bg.success.subtle" }, markerIcon: { color: "{colors.status.pos}"  } },
            warning: { markerRing: { borderColor: "{colors.status.warn}", background: "bg.warning.subtle" }, markerIcon: { color: "{colors.status.warn}" } },
            danger:  { markerRing: { borderColor: "{colors.status.neg}",  background: "bg.danger.subtle"  }, markerIcon: { color: "{colors.status.neg}"  } },
            info:    { markerRing: { borderColor: "{colors.status.info}", background: "bg.info.subtle"    }, markerIcon: { color: "{colors.status.info}" } },
            neutral: { markerRing: { borderColor: "border.strong",        background: "transparent"       }, markerIcon: { color: "fg.subtle"            } },
        },
        // Per-event attention animation (`event.animation`). `pulse` is the shared
        // `elara-pulse` opacity keyframe; gated behind `prefers-reduced-motion`.
        // (The per-event `tone` tint is data-driven, applied inline by the renderer
        // from the shared status tokens.)
        animation: {
            none:  {},
            pulse: { event: { animation: "elara-pulse 1.6s ease-in-out infinite", "@media (prefers-reduced-motion: reduce)": { animation: "none" } } },
        },
        // Opt-in row hover affordance (`root.rowHover`). A dark brand (cyan) ring
        // drawn as a `::after` overlay over BOTH panes (zIndex above the sticky
        // panes), `inset: 0` so the planner root's `overflow: hidden` never clips
        // it. Mirrors the selection overlay the renderer draws, but on hover —
        // pointer-events: none so it never blocks a click.
        rowHover: {
            true: {
                row: {
                    _hover: {
                        _after: {
                            content: '""',
                            position: "absolute",
                            inset: "0",
                            pointerEvents: "none",
                            borderWidth: "2px",
                            borderStyle: "solid",
                            borderColor: "{colors.brand.600}",
                            borderRadius: "2px",
                            zIndex: 4,
                        },
                    },
                },
            },
            false: {},
        },
        // Vertical scroll (opt-in via the IR `maxHeight`) — the plan body scrolls
        // within the bound and the header row stays pinned (sticky-top), forming a
        // frozen corner with the existing sticky-left pane. zIndex sits above the
        // event/marker overlays so a scrolled row never bleeds over the header.
        scroll: {
            true: {
                root: { overflowY: "auto" },
                header: { position: "sticky", top: 0, zIndex: 5 },
            },
            false: {},
        },
    },
    defaultVariants: { size: "md", shape: "point", animation: "none", rowHover: false, scroll: false },
});

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
 * The optional review chrome adds a trailing per-row decision column
 * (`decisionHeader` / `decisionCol` — the Approve/Reject pair hangs off it) and
 * a quiet `statusDot` beside the resource. The dot rides the existing `status`
 * variant so one axis drives the marker ring, icon, and dot together; the batch
 * foot reuses the shared `commitBar` recipe rather than a planner slot.
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
        "decisionHeader", "decisionCol", "statusDot",
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
            color: "{colors.gray.400}",
            fontWeight: "bold",
            flexShrink: 0,
            width: "18px",
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
        // Review decision-column header — mirrors the column-header type rhythm
        // but right-anchored, with a left rule fencing the column off from the
        // timeline (the way `rowHeader` fences the left pane). Width comes from
        // the grid template the renderer builds, not from this slot.
        decisionHeader: {
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "semibold",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "{colors.gray.500}",
            padding: "10px 12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            borderBottomWidth: "1px",
            borderBottomColor: "border.strong",
            borderLeftWidth: "1px",
            borderLeftColor: "border.subtle",
            whiteSpace: "nowrap",
            overflow: "hidden",
            minWidth: 0,
        },
        // Per-row decision cell — the Approve/Reject pair, right-aligned and
        // fenced by the same left rule. Vertical rhythm comes from the row's
        // own min-height; sticky-right pinning + wash are applied by the renderer.
        decisionCol: {
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: "6px",
            padding: "0 12px",
            borderLeftWidth: "1px",
            borderLeftColor: "border.subtle",
            boxSizing: "border-box",
        },
        // The quiet status dot beside the resource name (some ⇒ flagged). Colour
        // rides the `status` variant; this is just the 8px disc geometry. Reads
        // as one flag per row, not a per-cell ring (which is too busy weekly).
        statusDot: {
            display: "inline-block",
            width: "8px",
            height: "8px",
            borderRadius: "{radii.full}",
            marginRight: "6px",
            flexShrink: 0,
            verticalAlign: "middle",
            background: "fg.subtle",
        },
    },
    variants: {
        size: {
            sm: { rowHeader: { paddingY: "{spacing.1}" }, row: { minHeight: "36px" }, colHeader: { paddingY: "{spacing.1.5}" }, headerCell: { paddingY: "{spacing.1.5}" }, decisionHeader: { paddingY: "{spacing.1.5}" } },
            md: {},
            lg: { rowHeader: { paddingY: "{spacing.3}" }, row: { minHeight: "56px" }, colHeader: { paddingY: "{spacing.3}" }, headerCell: { paddingY: "{spacing.3}" }, decisionHeader: { paddingY: "{spacing.3}" } },
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
                    height: "22px",
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
        // Conflict severity — colours the ring border + badge fill, and (review
        // chrome) the quiet row `statusDot`, so one axis drives all three.
        status: {
            success: { markerRing: { borderColor: "{colors.status.pos}",  background: "bg.success.subtle" }, markerIcon: { color: "{colors.status.pos}"  }, statusDot: { background: "{colors.status.pos}"  } },
            warning: { markerRing: { borderColor: "{colors.status.warn}", background: "bg.warning.subtle" }, markerIcon: { color: "{colors.status.warn}" }, statusDot: { background: "{colors.status.warn}" } },
            danger:  { markerRing: { borderColor: "{colors.status.neg}",  background: "bg.danger.subtle"  }, markerIcon: { color: "{colors.status.neg}"  }, statusDot: { background: "{colors.status.neg}"  } },
            info:    { markerRing: { borderColor: "{colors.status.info}", background: "bg.info.subtle"    }, markerIcon: { color: "{colors.status.info}" }, statusDot: { background: "{colors.status.info}" } },
            neutral: { markerRing: { borderColor: "border.strong",        background: "transparent"       }, markerIcon: { color: "fg.subtle"            }, statusDot: { background: "fg.subtle"            } },
        },
    },
    defaultVariants: { size: "md", shape: "point" },
});

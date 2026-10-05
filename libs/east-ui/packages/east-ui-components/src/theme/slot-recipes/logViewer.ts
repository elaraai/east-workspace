/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * LogViewer slot recipe — a task's log as e3-ui-components' log view draws it:
 * a dark band holding the stdout/stderr tabs, the search with its match count
 * and chevrons, and Copy, over the log's dark surface, its lines numbered in
 * a mono face and the search's matches marked, the current one strongest. The
 * band and the surface make one card, inset in the view.
 *
 * `data-bare` (on the root and the surface) is a view whose host draws its
 * controls (#1209): no band, and the surface fills the view edge to edge,
 * with no inset, corners or border, for the host's frame to hold.
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const logViewerSlotRecipe = defineSlotRecipe({
    className: "elara-log-viewer",
    slots: [
        "root", "band", "tabList", "trigger", "search", "searchInput", "count",
        "bandButton", "body", "surface", "line", "gutter", "text", "match",
        "newLogs", "newLogsBadge",
    ],
    base: {
        root: {
            height: "100%",
            display: "flex",
            flexDirection: "column",
            padding: "{spacing.4}",
            "&[data-bare]": { padding: "0" },
        },
        /* The card's top: the tabs at the start, the search and Copy at the end. */
        band: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "{spacing.2}",
            flexShrink: 0,
            paddingX: "{spacing.3}",
            paddingY: "{spacing.2}",
            background: "bg.inverse",
            borderTopRadius: "{radii.md}",
        },
        tabList: {
            borderBottom: "none",
        },
        trigger: {
            color: "fg.subtle",
            _selected: { color: "fg.inverse" },
        },
        search: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.1}",
        },
        searchInput: {
            background: "bg.inverse",
            border: "none",
            color: "fg.inverse",
            width: "min(150px, 40vw)",
            _placeholder: { color: "fg.subtle" },
        },
        /* "3/17" beside the search. */
        count: {
            fontSize: "{fontSizes.body.sm}",
            color: "fg.subtle",
            minWidth: "50px",
            textAlign: "center",
        },
        bandButton: {
            color: "fg.subtle",
            _hover: { color: "fg.inverse" },
        },
        body: {
            position: "relative",
            flex: "1",
            minHeight: 0,
        },
        /* The scrolling log, the card's bottom. */
        surface: {
            layerStyle: "surface.log.dark",
            height: "100%",
            overflow: "auto",
            borderBottomRadius: "{radii.md}",
            borderTopWidth: "0",
            fontFamily: "mono",
            fontSize: "{fontSizes.body.lg}",
            color: "fg.inverse",
            "&[data-bare]": { borderRadius: "0", borderWidth: "0" },
        },
        line: {
            display: "flex",
            paddingX: "{spacing.3}",
            paddingY: "2px",
            _hover: { background: "bg.inverse" },
        },
        /* The line's number, outside a selection of the text. */
        gutter: {
            color: "fg.muted",
            minWidth: "50px",
            textAlign: "right",
            marginRight: "{spacing.3}",
            userSelect: "none",
            flexShrink: 0,
        },
        text: {
            whiteSpace: "pre",
            wordBreak: "break-all",
            flex: "1",
        },
        /* A search match; `data-current` the one the chevrons are on. */
        match: {
            background: "status.warnSubtle",
            color: "fg.default",
            borderRadius: "2px",
            "&[data-current]": {
                background: "status.warn",
                outline: "2px solid",
                outlineColor: "status.warn",
            },
        },
        /* "New logs", over the log's foot while the view is scrolled up. */
        newLogs: {
            position: "absolute",
            bottom: "{spacing.3}",
            right: "{spacing.3}",
            cursor: "pointer",
        },
        newLogsBadge: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            paddingX: "{spacing.3}",
            paddingY: "{spacing.1}",
            borderRadius: "{radii.full}",
            boxShadow: "md",
        },
    },
});

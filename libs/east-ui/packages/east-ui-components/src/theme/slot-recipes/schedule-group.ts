/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** Calendar and Roster share one full-width, collapsible group band. */
import { fontAwesomeSize } from "../icon-size.js";
import { planRowFocus } from "./plan/focus.js";

export const scheduleGroupSlots = ["group", "groupContent", "groupLabel", "groupMeta"] as const;
export const scheduleGroupBase = {
    group: { display: "flex", width: "100%", minWidth: 0, minHeight: "38px", padding: 0, textAlign: "left", alignItems: "center",
        background: "bg.panel", borderBottomWidth: "1px", borderColor: "border.subtle", ...planRowFocus },
    groupContent: { position: "sticky", left: 0, display: "flex", alignItems: "center", gap: "8px", padding: "7px 16px", width: "max-content", maxWidth: "100%", minWidth: 0,
        whiteSpace: "nowrap", overflow: "hidden", "& > svg": { ...fontAwesomeSize("10px"), flexShrink: 0 } },
    groupLabel: { textStyle: "h5", whiteSpace: "nowrap", flexShrink: 0 },
    groupMeta: { textStyle: "mono.xs", color: "fg.muted", whiteSpace: "nowrap", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
} as const;

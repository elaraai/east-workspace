/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * The Calendar's, the Roster's and the Allocation's Library pane (#1330): a
 * tab's body over its feet — the foot's hint, what a card does where it is
 * dragged, and the picked card's action, its note over its button. The
 * Sheet's library tabs take its body alone (#1345).
 */
export const schedulePaneSlots = ["pane", "paneFoot", "paneHint", "paneAction"] as const;
export const schedulePaneBase = {
    pane: { display: "flex", flexDirection: "column", minHeight: 0, height: "100%", minWidth: 0 },
    paneFoot: { flexShrink: 0, padding: "12px", borderTopWidth: "1px", borderColor: "border.subtle" },
    paneHint: { textStyle: "mono.xs", color: "fg.muted", overflowWrap: "anywhere", "&[data-tone=warning]": { color: "fg.warning" } },
    paneAction: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "8px", minWidth: 0 },
} as const;

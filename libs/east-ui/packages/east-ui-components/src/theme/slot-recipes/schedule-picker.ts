/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * The Roster's and the Allocation's date picker (#1595): a period's mark under its number, told apart by shape as well
 * as colour — a published period's filled, a draft's a hollow ring, one not started a muted ring — and the legend that
 * draws each beside its word: each item its mark, then its word at the middle of the mark's line, 5px on in the
 * Roster's and 8px in the Allocation's, as each builder's legend sets its marks. The item is the picker's own: a
 * builder's footer is the shared rail's, and lays out no legend of the picker's.
 */
export const schedulePickerSlots = ["pickerDot", "pickerLegend", "pickerLegendItem"] as const;
export const schedulePickerBase = {
    pickerDot: {
        display: "inline-block", flexShrink: 0, width: "6px", height: "6px", borderRadius: "50%", border: "1px solid", borderColor: "fg.subtle",
        "&[data-state=published]": { background: "fg.success", borderColor: "fg.success" },
        "&[data-state=draft]": { background: "transparent", borderColor: "brand.solid" },
    },
    pickerLegend: { display: "flex", flexWrap: "wrap", columnGap: "12px" },
    pickerLegendItem: { display: "inline-flex", alignItems: "center", gap: "5px", flexShrink: 0, "&[data-allocation-picker-legend]": { gap: "8px" } },
} as const;

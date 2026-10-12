/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** The shared status rail used by framed builders, extracted from Plan. */
import type { SystemStyleObject } from "@chakra-ui/react";

/** The 28px panel rail, wrapping only when the host's main is narrow. */
export const builderFooter = {
    minHeight: "28px",
    display: "flex",
    alignItems: "center",
    gap: "14px",
    padding: "0 12px",
    background: "bg.panel",
    borderTopWidth: "1px",
    borderTopColor: "border.subtle",
    // In a narrow main area there is no 28px band to fit a
    // status line into — the same items wrap onto as many lines as they
    // need.
    "&[data-builder-narrow]": { flexWrap: "wrap", minHeight: "auto", padding: "6px 12px", rowGap: "2px", columnGap: "10px" },
} satisfies SystemStyleObject;

/** Status text and end-aligned/tone variants within the rail. */
export const builderFooterItem = {
    fontFamily: "mono",
    fontSize: "10px",
    fontWeight: "semibold",
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "fg.subtle",
    whiteSpace: "nowrap",
    "&[data-tone='warning']": { color: "{colors.status.warn}" },
    "&[data-tone='danger']":  { color: "{colors.status.neg}" },
    "&[data-tone='success']": { color: "{colors.status.pos}" },
    "&[data-tone='info']":    { color: "{colors.status.info}" },
    "&[data-end]": { marginLeft: "auto" },
} satisfies SystemStyleObject;

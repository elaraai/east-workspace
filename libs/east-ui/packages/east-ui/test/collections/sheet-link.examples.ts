/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, StringType, example, none, some, variant } from "@elaraai/east";
import { Sheet } from "@elaraai/east-ui";

// ============================================================================
// The link grammar (B§4.1 / B§4.2) — `Sheet.link.print` and `Sheet.link.parse`
// are East functions: a task, a fill or a slice's search text calls them
// exactly as the Sheet does.
// ============================================================================

export const sheetLinkPrint = example({
    keywords: ["Sheet", "link", "print", "Link", "Member", "identified", "range", "counted", "placeholder", "grammar", "text"],
    description: "Print a link as the planner types it — from > to, members comma-separated, a range as from-to, a count as N x key and the placeholder as TBC",
    fn: East.function([], StringType, ($) => {
        const link = $.const({
            from: [variant("identified", { key: "M2140" }), variant("range", { from: "M2141", to: "M2145" })],
            to:   [variant("counted", { n: 4n, key: "CNC lathe" }), variant("placeholder", null)],
        }, Sheet.Types.Link);
        return Sheet.link.print(link);
    }),
    inputs: [],
    returns: "M2140, M2141-M2145 > 4 x CNC lathe, TBC",
});

export const sheetLinkParse = example({
    keywords: ["Sheet", "link", "parse", "Link", "RegisterMembers", "register", "alias", "identified", "counted", "range", "placeholder", "text", "grammar"],
    description: "Parse the planner's text into a typed link against a register — codes and aliases resolve case-insensitively, N x kind counts a family, a short range completes from its lower bound, TBC is the placeholder and anything else is kept as text",
    fn: East.function([], Sheet.Types.Link, ($) => {
        const members = $.const([
            { key: "M2140", label: "M2140", kind: "machine", aliases: [], meta: some("CNC lathe"), parent: some("Line 2"), tone: none },
            { key: "CNC lathe", label: "CNC lathe", kind: "family", aliases: ["lathe", "lathes"], meta: some("family"), parent: none, tone: none },
        ], Sheet.Types.RegisterMembers);
        return Sheet.link.parse("m2140 > 4 x lathe, M2141-45, TBC, paint shop", members);
    }),
    inputs: [],
    returns: {
        from: [variant("identified", { key: "M2140" })],
        to: [variant("counted", { n: 4n, key: "CNC lathe" }), variant("range", { from: "M2141", to: "M2145" }), variant("placeholder", null), variant("text", "paint shop")],
    },
});

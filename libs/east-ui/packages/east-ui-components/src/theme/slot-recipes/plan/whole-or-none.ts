/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan recipe's rule for words that are drawn whole or not at all: a
 * number in its cell, a label on its segment, a value in the gutter.
 *
 * @packageDocumentation
 */

import type { SystemStyleObject } from "@chakra-ui/react";

/**
 * A box that draws its words whole or not at all (#1269): a wrapping row whose
 * first line a strut holds at the box's height, so words wider than the line
 * wrap below it, out of sight in the box's clip — never cut, never
 * ellipsized. The box is a flex row of a set height, and it clips.
 */
export const wholeOrNone = {
    flexWrap: "wrap",
    alignContent: "flex-start",
    "&::before": { content: '""', height: "100%" },
} satisfies SystemStyleObject;

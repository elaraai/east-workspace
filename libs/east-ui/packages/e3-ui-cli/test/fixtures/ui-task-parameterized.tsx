/** @jsxImportSource @elaraai/east-ui */
/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// Test fixture: an e3 ui() task WITH a compute-time input — not renderable
// standalone (the browser app cannot supply the argument), so the loader must
// reject it with the --from-task remediation.
import { East, StringType } from "@elaraai/east";
import e3 from "@elaraai/e3";
import { ui } from "@elaraai/e3-ui";
import { UIComponentType, Text } from "@elaraai/east-ui";

const name = e3.input("name", StringType, "world");

export const surface = ui(
    "surface",
    [name],
    East.function([StringType], UIComponentType, (_$, n) => (
        <Text>{East.str`Hello, ${n}!`}</Text>
    )),
);

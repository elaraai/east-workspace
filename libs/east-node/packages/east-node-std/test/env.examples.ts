/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, example } from "@elaraai/east";
import { Env } from "@elaraai/east-node-std";

export const envGet = example({
    keywords: ["env", "Env", "get", "environment", "variable", "credential", "secret", "config", "password"],
    description: "Read an environment variable as an option — some when set, none when not (keep credentials out of East source)",
    fn: East.asyncFunction([], BooleanType, ($) => {
        // PATH is set in every process environment; the sentinel is not.
        const path = $.let(Env.get("PATH"));
        const missing = $.let(Env.get("EAST_EXAMPLE_UNSET_VARIABLE"));
        return path.hasTag("some").and(_$ => missing.hasTag("none"));
    }),
    inputs: [],
    returns: true,
});

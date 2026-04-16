/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
import { East, example } from "@elaraai/east";
import { Field, Stack, UIComponentType } from "../../src/index.js";

export const fieldBasic = example({
    keywords: ["Field", "StringInput", "label", "helperText", "errorText", "required", "invalid"],
    description: "Wraps controls with labels and messages",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Field.StringInput(
                "Email",
                "",
                { helperText: "We'll never share your email.", placeholder: "you@example.com" }
            ),
            Field.StringInput(
                "Password",
                "",
                { required: true, errorText: "Password is required", invalid: true, placeholder: "Enter password" }
            ),
        ], { gap: "4", align: "stretch", width: "100%" });
    }),
    inputs: [],
});

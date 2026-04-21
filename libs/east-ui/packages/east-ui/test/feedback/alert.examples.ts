/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { Alert, Button, Reactive, Stack, State, UIComponentType } from "@elaraai/east-ui";

export const alertInfo = example({
    keywords: ["Alert", "Root", "info", "title", "description"],
    description: "Informational message",
    fn: East.function([], UIComponentType, (_$) => {
        return Alert.Root("info", {
            title: "New update available",
            description: "A new version of the application is ready to install.",
        });
    }),
    inputs: [],
});

export const alertSuccess = example({
    keywords: ["Alert", "Root", "success"],
    description: "Confirmation message",
    fn: East.function([], UIComponentType, (_$) => {
        return Alert.Root("success", {
            title: "Changes saved",
            description: "Your settings have been updated successfully.",
        });
    }),
    inputs: [],
});

export const alertWarning = example({
    keywords: ["Alert", "Root", "warning"],
    description: "Warning message",
    fn: East.function([], UIComponentType, (_$) => {
        return Alert.Root("warning", {
            title: "Session expiring",
            description: "Your session will expire in 5 minutes.",
        });
    }),
    inputs: [],
});

export const alertError = example({
    keywords: ["Alert", "Root", "error"],
    description: "Error message",
    fn: East.function([], UIComponentType, (_$) => {
        return Alert.Root("error", {
            title: "Connection failed",
            description: "Unable to connect to the server. Please try again.",
        });
    }),
    inputs: [],
});

export const alertVariants = example({
    keywords: ["Alert", "Root", "variant", "solid", "subtle", "outline"],
    description: "Solid, subtle, and outline styles",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Alert.Root("info", { title: "Solid variant", variant: "solid" }),
            Alert.Root("info", { title: "Subtle variant", variant: "subtle" }),
            Alert.Root("info", { title: "Outline variant", variant: "outline" }),
        ], { gap: "3", align: "stretch", width: "100%" });
    }),
    inputs: [],
});

export const alertTitleOnly = example({
    keywords: ["Alert", "Root", "title"],
    description: "Simple alert without description",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Alert.Root("success", { title: "File uploaded successfully" }),
            Alert.Root("error", { title: "Invalid email address" }),
        ], { gap: "3", align: "stretch", width: "100%" });
    }),
    inputs: [],
});

export const alertInteractive = example({
    keywords: ["Alert", "Reactive", "State", "interactive", "title"],
    description: "Alert whose title increments from a reactive counter",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const counter = $.let(State.bind([IntegerType], "alert_counter", 0n));
            const value = $.let(counter.read());
            const inc = $.const(East.function([], NullType, $ => {
                const cur = $.let(counter.read());
                $(counter.write(cur.add(1n)));
            }));
            return Stack.VStack([
                Alert.Root("info", {
                    title: East.str`Notification ${East.print(value)}`,
                    description: "Click the button to bump the alert title",
                }),
                Button.Root("Bump", { onClick: inc }),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});

/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, NullType, BooleanType, example } from "@elaraai/east";
import { Alert, Button, Input, Reactive, Stack, State, Text, UIComponentType } from "@elaraai/east-ui";

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

export const alertNeutral = example({
    keywords: ["Alert", "Root", "neutral", "status"],
    description: "Neutral-status alert with muted colour and the paired circle icon",
    fn: East.function([], UIComponentType, (_$) => {
        return Alert.Root("neutral", {
            title: "Draft",
            description: "This plan has not been reviewed yet.",
        });
    }),
    inputs: [],
});

export const alertVariants = example({
    keywords: ["Alert", "Root", "variant", "solid", "subtle", "outline"],
    description: "Solid, subtle, and outline styles",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Alert.Root("info", { title: "Solid variant", style: { variant: "solid" } }),
            Alert.Root("info", { title: "Subtle variant", style: { variant: "subtle" } }),
            Alert.Root("info", { title: "Outline variant", style: { variant: "outline" } }),
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

export const alertEmbeddedInput = example({
    keywords: ["Alert", "body", "Input", "embedded", "Reactive", "State"],
    description: "Warn alert with an embedded integer input inside body",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const bind = $.let(State.bind([IntegerType], "n_trials", 0n));
            const value = $.let(bind.read());
            const onChange = $.const(East.function([IntegerType], NullType, ($, next) => {
                $(bind.write(next));
            }));
            return Alert.Root("warning", {
                title: "n_trials = 0",
                description: "Bayesian draws will be skipped until this is > 0.",
                body: [
                    Input.Integer(value, { onChange, size: "xs" }),
                ],
            });
        }));
    }),
    inputs: [],
});

export const alertWithActions = example({
    keywords: ["Alert", "actions", "Button"],
    description: "Warn alert with Accept / Dismiss buttons in the trailing actions slot",
    fn: East.function([], UIComponentType, (_$) => {
        return Alert.Root("warning", {
            title: "Plan drift detected",
            description: "Current plan has drifted from baseline.",
            actions: Stack.HStack([
                Button.Root("Accept", { style: { variant: "subtle", colorPalette: "blue" } }),
                Button.Root("Dismiss", { style: { variant: "ghost" } }),
            ], { gap: "2" }),
        });
    }),
    inputs: [],
});

export const alertDismissible = example({
    keywords: ["Alert", "closable", "onClose", "Reactive"],
    description: "Success alert with a close button wired to State.bind",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const bind = $.let(State.bind([BooleanType], "alert_dismissed", false));
            const onClose = $.const(East.function([], NullType, $ => {
                $(bind.write(true));
            }));
            return Alert.Root("success", {
                title: "Saved",
                description: "Your changes have been saved.",
                closable: true,
                onClose,
            });
        }));
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
                    title: Text.Root(East.str`Notification ${East.print(value)}`),
                    description: "Click the button to bump the alert title",
                }),
                Button.Root("Bump", { onClick: inc }),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});

/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, NullType, example } from "@elaraai/east";
import { Toast, Button, Reactive, Stack, UIComponentType } from "@elaraai/east-ui";

export const toastBasic = example({
    keywords: ["Toast", "emit", "button", "success", "Reactive"],
    description: "Button that emits a 4s success toast",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const onClick = $.const(East.function([], NullType, $ => {
                $(Toast.emit(Toast.make("success", "Scenario saved", { duration: 4000n })));
            }));
            return Button.Root("Save scenario", { onClick, style: { variant: "solid", colorPalette: "green" } });
        }));
    }),
    inputs: [],
});

export const toastWithActions = example({
    keywords: ["Toast", "emit", "actions", "Reactive"],
    description: "Button that emits a toast with Undo + View actions",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const onUndo = $.const(East.function([], NullType, _$ => { /* noop */ }));
            const onView = $.const(East.function([], NullType, _$ => { /* noop */ }));
            const onClick = $.const(East.function([], NullType, $ => {
                $(Toast.emit(Toast.make("info", "Commit landed", {
                    description: "Build #1842 is green.",
                    duration: 6000n,
                    actions: [
                        { label: "Undo", onClick: onUndo, variant: "subtle" },
                        { label: "View", onClick: onView, variant: "solid" },
                    ],
                })));
            }));
            return Button.Root("Land commit", { onClick });
        }));
    }),
    inputs: [],
});

export const toastPersistent = example({
    keywords: ["Toast", "emit", "persistent", "no duration", "Reactive"],
    description: "Persistent info toast (no duration) — dismissable by close button",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const onClick = $.const(East.function([], NullType, $ => {
                $(Toast.emit(Toast.make("info", "Background sync in progress", {
                    description: "Stays visible until dismissed.",
                })));
            }));
            return Stack.HStack([
                Button.Root("Emit persistent toast", { onClick }),
            ], { gap: "2" });
        }));
    }),
    inputs: [],
});

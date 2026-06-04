/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, BooleanType, NullType, example } from "@elaraai/east";
import { Hotkey, State, UIComponentType } from "@elaraai/east-ui";
import { CommandPalette, Reactive, VStack } from "@elaraai/east-ui/jsx";

export const commandPaletteBasic = example({
    keywords: ["CommandPalette", "Root", "launcher", "cmdk"],
    description: "Basic palette with three flat commands",
    fn: East.function([], UIComponentType, ($) => {
        const noop = $.const(East.function([], NullType, (_$) => { /* run command */ }));
        return (
            <CommandPalette commands={[
                { id: "save", label: "Save", shortcut: "⌘S", action: noop },
                { id: "open", label: "Open…", shortcut: "⌘O", action: noop },
                { id: "find", label: "Find in files", shortcut: "⌘⇧F", action: noop },
            ]} />
        );
    }),
    inputs: [],
});

export const commandPaletteGrouped = example({
    keywords: ["CommandPalette", "group", "navigation", "actions"],
    description: "Grouped commands — Navigate / Actions / Settings",
    fn: East.function([], UIComponentType, ($) => {
        const noop = $.const(East.function([], NullType, (_$) => { /* run command */ }));
        return (
            <CommandPalette
                placeholder="Search commands…"
                commands={[
                    { id: "go.home", label: "Go to Home", shortcut: "G H", group: "Navigate", action: noop },
                    { id: "go.scenarios", label: "Go to Scenarios", shortcut: "G S", group: "Navigate", action: noop },
                    { id: "act.run", label: "Run scenario", shortcut: "⌘↵", group: "Actions", action: noop },
                    { id: "act.export", label: "Export current view", group: "Actions", action: noop },
                    { id: "set.theme", label: "Toggle theme", group: "Settings", action: noop },
                ]}
            />
        );
    }),
    inputs: [],
});

export const commandPaletteWithKeywords = example({
    keywords: ["CommandPalette", "keywords", "synonyms", "search"],
    description: "Commands with extra keywords for synonym search",
    fn: East.function([], UIComponentType, ($) => {
        const noop = $.const(East.function([], NullType, (_$) => { /* run command */ }));
        return (
            <CommandPalette commands={[
                { id: "audit", label: "Show audit trail", keywords: ["logs", "history", "events"], action: noop },
                { id: "perm", label: "Manage permissions", keywords: ["roles", "access"], action: noop },
            ]} />
        );
    }),
    inputs: [],
});

export const commandPaletteCustomTrigger = example({
    keywords: ["CommandPalette", "triggerKey", "shortcut"],
    description: "Custom keyboard chord — opens with ⌘/ instead of ⌘K",
    fn: East.function([], UIComponentType, ($) => {
        const noop = $.const(East.function([], NullType, (_$) => { /* run command */ }));
        return (
            <CommandPalette triggerKey="mod+/" commands={[
                { id: "help", label: "Show help", action: noop },
            ]} />
        );
    }),
    inputs: [],
});

export const commandPaletteColours = example({
    keywords: ["CommandPalette", "colour", "color", "escape", "hatches"],
    description: "Explicit colour overrides for branded palette chrome",
    fn: East.function([], UIComponentType, ($) => {
        const noop = $.const(East.function([], NullType, (_$) => { /* run command */ }));
        return (
            <CommandPalette
                size="md"
                background="bg"
                borderColor="blue.300"
                inputBackground="bg.subtle"
                selectedBackground="blue.100"
                groupLabelColor="blue.700"
                commands={[
                    { id: "a", label: "Action A", group: "Group", action: noop },
                    { id: "b", label: "Action B", group: "Group", action: noop },
                ]}
            />
        );
    }),
    inputs: [],
});

export const commandPaletteWithHotkey = example({
    keywords: ["CommandPalette", "Hotkey", "Reactive", "State", "mod+k", "ctrl+k", "shortcut"],
    description: "⌘K opens the palette via Hotkey + State.bind — controlled-open pattern",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const openBind = $.let(State.bind([BooleanType], "cmdk.example.open", false));
            const open = $.let(openBind.read(), BooleanType);
            const noop = $.const(East.function([], NullType, (_$) => { /* run command */ }));
            const trigger = $.const(East.function([], NullType, ($) => {
                $(openBind.write(true));
            }));
            const onOpenChange = $.const(East.function([BooleanType], NullType, ($, next) => {
                $(openBind.write(next));
            }));
            return (
                <VStack gap="2" align="flex-start">
                    {Hotkey.Root("mod+k", trigger)}
                    <CommandPalette
                        open={open}
                        onOpenChange={onOpenChange}
                        triggerKey="mod+k"
                        commands={[
                            { id: "go.home", label: "Go to Home", shortcut: "G H", group: "Navigate", action: noop },
                            { id: "act.run", label: "Run scenario", shortcut: "⌘↵", group: "Actions", action: noop },
                            { id: "set.theme", label: "Toggle theme", group: "Settings", action: noop },
                        ]}
                    />
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, BooleanType, NullType, example } from "@elaraai/east";
import { Hotkey, State, UIComponentType } from "@elaraai/east-ui";
import { CommandPalette, Reactive, Text, VStack } from "@elaraai/east-ui";

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
                    <Hotkey chord="mod+k" onTrigger={trigger} />
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

// ============================================================================
// Variants — static enumeration panel (consolidation epic #455).
// ============================================================================

export const commandPaletteVariants = example({
    keywords: ["CommandPalette", "group", "navigation", "actions", "keywords", "synonyms", "search", "triggerKey", "shortcut", "colour", "color", "escape", "hatches"],
    description: "CommandPalette variant panel — palette grouped (Navigate / Actions / Settings), palette with keywords (extra keywords for synonym search), palette custom trigger (opens with ⌘/ instead of ⌘K), palette colours (explicit colour overrides for branded chrome)",
    fn: East.function([], UIComponentType, ($) => {
        const noop = $.const(East.function([], NullType, (_$) => { /* run command */ }));
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">PALETTE GROUPED</Text>
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
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">PALETTE WITH KEYWORDS</Text>
                    <CommandPalette commands={[
                        { id: "audit", label: "Show audit trail", keywords: ["logs", "history", "events"], action: noop },
                        { id: "perm", label: "Manage permissions", keywords: ["roles", "access"], action: noop },
                    ]} />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">PALETTE CUSTOM TRIGGER</Text>
                    <CommandPalette triggerKey="mod+/" commands={[
                        { id: "help", label: "Show help", action: noop },
                    ]} />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">PALETTE COLOURS</Text>
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
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});

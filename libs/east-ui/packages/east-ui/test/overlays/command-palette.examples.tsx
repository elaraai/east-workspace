/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, IntegerType, NullType, StringType, StructType, example } from "@elaraai/east";
import { Hotkey, State, UIComponentType } from "@elaraai/east-ui";
import { CommandPalette, Configurator, Reactive, SegmentGroup, Text, VStack } from "@elaraai/east-ui";

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
// CommandPalette — live configurator over the command + chrome axes
// ============================================================================

export const commandPaletteVariants = example({
    keywords: ["CommandPalette", "group", "navigation", "actions", "keywords", "synonyms", "search", "triggerKey", "shortcut", "colour", "color", "escape", "hatches", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "CommandPalette configurator — command-set, trigger-chord and colour axes driving one live palette behind its trigger",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                const noop = $.const(East.function([], NullType, (_$) => { /* run command */ }));

                // The trigger chord is a plain combo string, so the axis is a
                // bare array of the value itself.
                const chords = $.const(["mod+k", "mod+/"], ArrayType(StringType));

                // Colour slots come as a set — the recipe row mirrors the slot
                // recipe's defaults, branded shows the escape hatches.
                const colors = $.const([
                    { label: "recipe",  background: "bg.surface", borderColor: "border.strong", inputBackground: "bg.surface", selectedBackground: "bg.subtle", groupLabelColor: "fg.subtle" },
                    { label: "branded", background: "bg",         borderColor: "border.brand",  inputBackground: "bg.subtle",  selectedBackground: "bg.brand.subtle", groupLabelColor: "link" },
                ], ArrayType(StructType({ label: StringType, background: StringType, borderColor: StringType, inputBackground: StringType, selectedBackground: StringType, groupLabelColor: StringType })));

                const commandsBind = $.let(State.bind([StringType], "commandpalette_commands", "grouped"));
                const triggerBind  = $.let(State.bind([StringType], "commandpalette_trigger", "mod+k"));
                const colorBind    = $.let(State.bind([StringType], "commandpalette_color", "recipe"));

                const sKey = $.let(commandsBind.read());
                const kKey = $.let(triggerBind.read());
                const cKey = $.let(colorBind.read());

                const onCommands = $.const(East.function([StringType], NullType, ($, next) => { $(commandsBind.write(next)); }));
                const onTrigger  = $.const(East.function([StringType], NullType, ($, next) => { $(triggerBind.write(next)); }));
                const onColor    = $.const(East.function([StringType], NullType, ($, next) => { $(colorBind.write(next)); }));

                // Each selection is a lookup into the same array the control renders.
                const chord = $.let(chords.filter((_$, s) => s.equal(kKey)).get(0n));
                const color = $.let(colors.filter((_$, o) => o.label.equal(cKey)).get(0n));

                // The factory takes a TS command array (each action is wired at
                // build time), so each set carries its pre-built palette over
                // the SAME chord + colour expressions.
                const sets = $.const([
                    {
                        label: "flat", count: 3n,
                        palette: (
                            <CommandPalette
                                placeholder="Search commands…" triggerKey={chord}
                                background={color.background} borderColor={color.borderColor} inputBackground={color.inputBackground}
                                selectedBackground={color.selectedBackground} groupLabelColor={color.groupLabelColor}
                                commands={[
                                    { id: "help", label: "Show help", action: noop },
                                    { id: "act.export", label: "Export current view", action: noop },
                                    { id: "set.theme", label: "Toggle theme", action: noop },
                                ]}
                            />
                        ),
                    },
                    {
                        label: "grouped", count: 5n,
                        palette: (
                            <CommandPalette
                                placeholder="Search commands…" triggerKey={chord}
                                background={color.background} borderColor={color.borderColor} inputBackground={color.inputBackground}
                                selectedBackground={color.selectedBackground} groupLabelColor={color.groupLabelColor}
                                commands={[
                                    { id: "go.home", label: "Go to Home", shortcut: "G H", group: "Navigate", action: noop },
                                    { id: "go.scenarios", label: "Go to Scenarios", shortcut: "G S", group: "Navigate", action: noop },
                                    { id: "act.run", label: "Run scenario", shortcut: "⌘↵", group: "Actions", action: noop },
                                    { id: "act.export", label: "Export current view", group: "Actions", action: noop },
                                    { id: "set.theme", label: "Toggle theme", group: "Settings", action: noop },
                                ]}
                            />
                        ),
                    },
                    {
                        label: "keywords", count: 2n,
                        palette: (
                            <CommandPalette
                                placeholder="Search commands…" triggerKey={chord}
                                background={color.background} borderColor={color.borderColor} inputBackground={color.inputBackground}
                                selectedBackground={color.selectedBackground} groupLabelColor={color.groupLabelColor}
                                commands={[
                                    { id: "audit", label: "Show audit trail", keywords: ["logs", "history", "events"], action: noop },
                                    { id: "perm", label: "Manage permissions", keywords: ["roles", "access"], action: noop },
                                ]}
                            />
                        ),
                    },
                ], ArrayType(StructType({ label: StringType, count: IntegerType, palette: UIComponentType })));

                const commandSet = $.let(sets.filter((_$, o) => o.label.equal(sKey)).get(0n));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Commands", sKey,
                                <SegmentGroup value={sKey} onChange={onCommands} size="sm"
                                    items={sets.map((_$, o) => SegmentGroup.Item(o.label, <Text>{o.label.upperCase()}</Text>))} />,
                                "keywords adds synonym search targets"),
                            Configurator.Control("Trigger", kKey,
                                <SegmentGroup value={kKey} onChange={onTrigger} size="sm"
                                    items={chords.map((_$, s) => SegmentGroup.Item(s, <Text>{s.upperCase()}</Text>))} />,
                                "triggerKey combo that opens the palette"),
                            Configurator.Control("Colour", cKey,
                                <SegmentGroup value={cKey} onChange={onColor} size="sm"
                                    items={colors.map((_$, o) => SegmentGroup.Item(o.label, <Text>{o.label.upperCase()}</Text>))} />,
                                "dialog · input · selection · group-label slots"),
                        ]}
                        preview={commandSet.palette}
                        spec={[
                            Configurator.Spec("Commands", East.print(commandSet.count)),
                            Configurator.Spec("Search", sKey.equal("keywords").ifElse(_$ => "labels + keywords", _$ => "labels")),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

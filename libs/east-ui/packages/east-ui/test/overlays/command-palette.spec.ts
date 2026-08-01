/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { CommandPalette } from "@elaraai/east-ui/internal";
import { East, BooleanType, NullType, type ExprType } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./command-palette.examples.js";

describeEast("CommandPalette", (test) => {
    Assert.examples(test, {
        commandPaletteBasic: ex.commandPaletteBasic,
        commandPaletteWithHotkey: ex.commandPaletteWithHotkey,
        commandPaletteVariants: ex.commandPaletteVariants,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#463).
    // =========================================================================

    test("commandPaletteVariants panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.commandPaletteVariants.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 4n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "PALETTE GROUPED"));
        $(Assert.equal(rows.get(1n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "PALETTE WITH KEYWORDS"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "PALETTE CUSTOM TRIGGER"));
        $(Assert.equal(rows.get(3n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "PALETTE COLOURS"));
    });

    const noop = East.function([], NullType, (_$) => { /* noop */ });

    test("commands array round-trips", $ => {
        const r = $.let(CommandPalette.Root([
            { id: "a", label: "Alpha", action: noop },
            { id: "b", label: "Beta", action: noop },
        ]));
        const cmds = $.let(r.unwrap().unwrap("CommandPalette").commands);
        $(Assert.equal(cmds.size(), 2n));
        $(Assert.equal(cmds.get(0n).id, "a"));
        $(Assert.equal(cmds.get(0n).label, "Alpha"));
        $(Assert.equal(cmds.get(1n).id, "b"));
    });

    test("placeholder + triggerKey round-trip on main", $ => {
        const r = $.let(CommandPalette.Root(
            [{ id: "x", label: "X", action: noop }],
            { placeholder: "Search…", triggerKey: "mod+/" },
        ));
        $(Assert.equal(r.unwrap().unwrap("CommandPalette").placeholder.unwrap("some"), "Search…"));
        $(Assert.equal(r.unwrap().unwrap("CommandPalette").triggerKey.unwrap("some"), "mod+/"));
    });

    test("per-command shortcut / group / keywords round-trip", $ => {
        const r = $.let(CommandPalette.Root([
            { id: "save", label: "Save", shortcut: "⌘S", group: "File", keywords: ["write", "store"], action: noop },
        ]));
        const cmd = $.let(r.unwrap().unwrap("CommandPalette").commands.get(0n));
        $(Assert.equal(cmd.shortcut.unwrap("some"), "⌘S"));
        $(Assert.equal(cmd.group.unwrap("some"), "File"));
        const kws = $.let(cmd.keywords.unwrap("some"));
        $(Assert.equal(kws.size(), 2n));
        $(Assert.equal(kws.get(0n), "write"));
    });

    test("controlled open + onOpenChange round-trip", $ => {
        const onOpenChange = East.function([BooleanType], NullType, (_$, _next) => { /* noop */ });
        const r = $.let(CommandPalette.Root(
            [{ id: "x", label: "X", action: noop }],
            { open: true, onOpenChange },
        ));
        $(Assert.equal(r.unwrap().unwrap("CommandPalette").open.unwrap("some"), true));
        $(Assert.equal(r.unwrap().unwrap("CommandPalette").onOpenChange.hasTag("some"), true));
    });

    test("style colour overrides round-trip", $ => {
        const r = $.let(CommandPalette.Root(
            [{ id: "x", label: "X", action: noop }],
            {
                size: "md",
                background: "bg",
                borderColor: "blue.300",
                inputBackground: "bg.subtle",
                selectedBackground: "blue.100",
                groupLabelColor: "blue.700",
            },
        ));
        const style = $.let(r.unwrap().unwrap("CommandPalette").style.unwrap("some"));
        $(Assert.equal(style.size.unwrap("some").hasTag("md"), true));
        $(Assert.equal(style.background.unwrap("some"), "bg"));
        $(Assert.equal(style.borderColor.unwrap("some"), "blue.300"));
        $(Assert.equal(style.inputBackground.unwrap("some"), "bg.subtle"));
        $(Assert.equal(style.selectedBackground.unwrap("some"), "blue.100"));
        $(Assert.equal(style.groupLabelColor.unwrap("some"), "blue.700"));
    });

    test("style absent when no visual fields set", $ => {
        const r = $.let(CommandPalette.Root([{ id: "x", label: "X", action: noop }]));
        $(Assert.equal(r.unwrap().unwrap("CommandPalette").style.hasTag("none"), true));
    });
}, { platformFns: TestImpl });

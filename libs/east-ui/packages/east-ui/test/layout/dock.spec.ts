/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Dock, Text } from "@elaraai/east-ui/internal";
import * as ex from "./dock.examples.js";

describeEast("Dock", (test) => {
    // Compiling each example validates the Dock IR — the `body` children +
    // config struct encode + round-trip as valid East IR.
    Assert.examples(test, {
        dockExpanded: ex.dockExpanded,
        dockCollapsedRail: ex.dockCollapsedRail,
        dockBesidePlanner: ex.dockBesidePlanner,
        dockVertical: ex.dockVertical,
        dockNested: ex.dockNested,
    });

    test("Dock.Root lowers config + collapsed state onto the variant", $ => {
        const dock = $.let(Dock.Root([Text.Root("x")], {
            icon: "book", label: "Bookings", badge: "3",
            orientation: "horizontal", side: "start",
            expandedSize: "25%", railSize: "44px",
            persist: "local", defaultCollapsed: true, keepMounted: true,
        }));
        const d = $.const(dock.unwrap().unwrap("Dock"));
        $(Assert.equal(d.body.size(), 1n));
        $(Assert.equal(d.defaultCollapsed.unwrap("some"), true));
        $(Assert.equal(d.collapsed.hasTag("none"), true));
        const style = $.const(d.style.unwrap("some"));
        $(Assert.equal(style.icon.unwrap("some"), "book"));
        $(Assert.equal(style.label.unwrap("some"), "Bookings"));
        $(Assert.equal(style.badge.unwrap("some"), "3"));
        $(Assert.equal(style.orientation.unwrap("some").hasTag("horizontal"), true));
        $(Assert.equal(style.side.unwrap("some").hasTag("start"), true));
        $(Assert.equal(style.expandedSize.unwrap("some"), "25%"));
        $(Assert.equal(style.railSize.unwrap("some"), "44px"));
        $(Assert.equal(style.persist.unwrap("some").hasTag("local"), true));
        $(Assert.equal(style.keepMounted.unwrap("some"), true));
    });

    test("Dock vertical + controlled collapsed lowers onto the variant", $ => {
        const dock = $.let(Dock.Root([Text.Root("y")], {
            orientation: "vertical", side: "end", collapsed: false,
        }));
        const d = $.const(dock.unwrap().unwrap("Dock"));
        $(Assert.equal(d.collapsed.unwrap("some"), false));
        const style = $.const(d.style.unwrap("some"));
        $(Assert.equal(style.orientation.unwrap("some").hasTag("vertical"), true));
        $(Assert.equal(style.side.unwrap("some").hasTag("end"), true));
    });
}, { platformFns: TestImpl });

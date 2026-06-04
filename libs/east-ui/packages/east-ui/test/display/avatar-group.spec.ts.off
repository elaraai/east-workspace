/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { AvatarGroup } from "@elaraai/east-ui";
import * as ex from "./avatar-group.examples.js";

describeEast("AvatarGroup", (test) => {
    Assert.examples(test, {
        avatarGroupBasic: ex.avatarGroupBasic,
        avatarGroupOverflow: ex.avatarGroupOverflow,
        avatarGroupLarge: ex.avatarGroupLarge,
    });

    test("creates an AvatarGroup with three avatars", $ => {
        const g = $.let(AvatarGroup.Root([
            { name: "Alice" },
            { name: "Bob" },
            { name: "Carol" },
        ]));
        $(Assert.equal(g.unwrap().unwrap("AvatarGroup").avatars.size(), 3n));
        $(Assert.equal(g.unwrap().unwrap("AvatarGroup").max.hasTag("none"), true));
        $(Assert.equal(g.unwrap().unwrap("AvatarGroup").style.hasTag("none"), true));
    });

    test("creates an AvatarGroup with max overflow", $ => {
        const g = $.let(AvatarGroup.Root([
            { name: "A" },
            { name: "B" },
            { name: "C" },
        ], { max: 2n }));
        $(Assert.equal(g.unwrap().unwrap("AvatarGroup").max.unwrap("some"), 2n));
    });

    test("creates an AvatarGroup with shared size + border colour", $ => {
        const g = $.let(AvatarGroup.Root([
            { name: "Sol" },
        ], { size: "lg", borderColor: "blue.200" }));
        $(Assert.equal(g.unwrap().unwrap("AvatarGroup").style.unwrap("some").size.unwrap("some").hasTag("lg"), true));
        $(Assert.equal(g.unwrap().unwrap("AvatarGroup").style.unwrap("some").borderColor.unwrap("some"), "blue.200"));
    });

    test("AvatarGroup builds nested AvatarType values from plain options", $ => {
        const g = $.let(AvatarGroup.Root([
            { name: "Kai", src: "https://example.com/kai.jpg" },
        ]));
        const a = g.unwrap().unwrap("AvatarGroup").avatars.get(0n);
        $(Assert.equal(a.name.unwrap("some"), "Kai"));
        $(Assert.equal(a.src.unwrap("some"), "https://example.com/kai.jpg"));
    });
}, { platformFns: TestImpl });

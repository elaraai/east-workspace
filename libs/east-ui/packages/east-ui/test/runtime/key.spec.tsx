/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** @jsxImportSource @elaraai/east-ui */

/**
 * A tag's `key` (`src/runtime/runtime.ts`): the compiler hands it to the
 * runtime apart from the tag's other props, and the runtime hands it on as one
 * of them, so a component that declares `key` among its props is given it.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Text as TextF } from "@elaraai/east-ui/internal";

/** A component that declares `key` among its props, and shows what it was given. */
const Keyed = (props: { key?: string; label?: string }) => TextF.Root(`${props.label ?? ""}:${props.key ?? "no key"}`);

describeEast("JSX key", (test) => {
    test("ruling 7 — a tag's key reaches its component as a prop, beside its other props", ($) => {
        $(Assert.equal(<Keyed label="rack" key="R-1" />, TextF.Root("rack:R-1")));
    });

    test("ruling 7 — a tag given no key hands its component none", ($) => {
        $(Assert.equal(<Keyed label="rack" />, TextF.Root("rack:no key")));
    });

    // The compiler hands a key written after a spread to `createElement`, of the import source's root, among the props.
    test("ruling 7 — a key written after a spread reaches its component too, as one written before it does", ($) => {
        const shared = { label: "rack" };
        $(Assert.equal(<Keyed {...shared} key="R-1" />, TextF.Root("rack:R-1")));
        $(Assert.equal(<Keyed key="R-1" {...shared} />, TextF.Root("rack:R-1")));
    });
}, { platformFns: TestImpl });

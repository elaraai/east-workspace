/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** @jsxImportSource @elaraai/e3-ui */

/**
 * A tag's `key` under e3-ui's pragma, which a `<Record>` and a `<Sheet>` build
 * each row's key with: it reaches its component as a prop wherever it is
 * written on the tag. The compiler hands a key written after a spread to
 * `createElement`, of the import source's own root, so e3-ui gives one as
 * east-ui does.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Text as TextF } from "@elaraai/east-ui/internal";

/** A component that declares `key` among its props, and shows what it was given. */
const Keyed = (props: { key?: string; label?: string }) => TextF.Root(`${props.label ?? ""}:${props.key ?? "no key"}`);

describeEast("JSX key, under e3-ui's pragma", (test) => {
    test("ruling 7 — a tag's key reaches its component as a prop: written alone, before a spread, and after one", ($) => {
        const shared = { label: "rack" };
        $(Assert.equal(<Keyed label="rack" key="R-1" />, TextF.Root("rack:R-1")));
        $(Assert.equal(<Keyed key="R-1" {...shared} />, TextF.Root("rack:R-1")));
        $(Assert.equal(<Keyed {...shared} key="R-1" />, TextF.Root("rack:R-1")));
    });
}, { platformFns: TestImpl });

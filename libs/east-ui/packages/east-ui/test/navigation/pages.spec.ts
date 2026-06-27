/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Navigation } from "@elaraai/east-ui/internal";
import { IntegerType, NullType, StringType, StructType } from "@elaraai/east";
import * as ex from "./pages.examples.js";

const ItemRow = StructType({ id: StringType, value: IntegerType });
const routes = Navigation.config({
    overview: { value: NullType, label: "Overview" },
    detail: { value: ItemRow, label: "Item" },
});

describeEast("Pages", (test) => {
    // Both examples compile + evaluate to valid UIComponentType IR (the body-local
    // `$.const` page closures referenced by the Pages `render` function included).
    Assert.examples(test, {
        pagesBasic: ex.pagesBasic,
        pagesAppShell: ex.pagesAppShell,
    });

    test("Page constructor builds an argless route variant", $ => {
        const seg = $.let(routes.Page.overview());
        $(Assert.equal(seg.hasTag("overview"), true));
    });

    test("Page constructor carries the typed payload", $ => {
        const seg = $.let(routes.Page.detail({ id: "item-1", value: 42n }));
        $(Assert.equal(seg.unwrap("detail").id, "item-1"));
        $(Assert.equal(seg.unwrap("detail").value, 42n));
    });

    // `<Pages>` builds a Pages content-switcher from a bound nav handle — the
    // `pagesBasic` / `pagesAppShell` examples (wired above) exercise the full
    // build (handle bound in the enclosing Reactive, shared with the switcher).
}, { platformFns: TestImpl });

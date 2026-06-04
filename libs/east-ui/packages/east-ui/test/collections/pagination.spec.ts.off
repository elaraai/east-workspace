/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { East, IntegerType, NullType } from "@elaraai/east";
import { Pagination, UIComponentType } from "@elaraai/east-ui";
import * as ex from "./pagination.examples.js";

describeEast("Pagination", (test) => {
    Assert.examples(test, {
        paginationBasic: ex.paginationBasic,
        paginationOutlineLarge: ex.paginationOutlineLarge,
        paginationSiblings: ex.paginationSiblings,
        paginationColourOverrides: ex.paginationColourOverrides,
    });

    // =========================================================================
    // Pagination.Root - Basic Creation
    // =========================================================================

    test("creates pagination with main-struct fields", $ => {
        const noop = $.const(East.function([IntegerType], NullType, (_$, _p) => { }));
        const p = $.let(Pagination.Root(0n, 20n, 500n, noop), UIComponentType);

        $(Assert.equal(p.unwrap().unwrap("Pagination").page, 0n));
        $(Assert.equal(p.unwrap().unwrap("Pagination").pageSize, 20n));
        $(Assert.equal(p.unwrap().unwrap("Pagination").count, 500n));
        $(Assert.equal(p.unwrap().unwrap("Pagination").style.hasTag("none"), true));
    });

    test("creates pagination at a non-zero page", $ => {
        const noop = $.const(East.function([IntegerType], NullType, (_$, _p) => { }));
        const p = $.let(Pagination.Root(5n, 10n, 100n, noop), UIComponentType);

        $(Assert.equal(p.unwrap().unwrap("Pagination").page, 5n));
        $(Assert.equal(p.unwrap().unwrap("Pagination").pageSize, 10n));
        $(Assert.equal(p.unwrap().unwrap("Pagination").count, 100n));
    });

    // =========================================================================
    // Pagination.Root - Style: size & variant
    // =========================================================================

    test("applies size preset via style struct", $ => {
        const noop = $.const(East.function([IntegerType], NullType, (_$, _p) => { }));
        const p = $.let(Pagination.Root(0n, 10n, 100n, noop, { size: "lg" }), UIComponentType);

        $(Assert.equal(
            p.unwrap().unwrap("Pagination").style.unwrap("some").size.unwrap("some").hasTag("lg"),
            true,
        ));
    });

    test("applies variant via style struct", $ => {
        const noop = $.const(East.function([IntegerType], NullType, (_$, _p) => { }));
        const p = $.let(Pagination.Root(0n, 10n, 100n, noop, { variant: "outline" }), UIComponentType);

        $(Assert.equal(
            p.unwrap().unwrap("Pagination").style.unwrap("some").variant.unwrap("some").hasTag("outline"),
            true,
        ));
    });

    // =========================================================================
    // Pagination.Root - Style: siblings & boundaries
    // =========================================================================

    test("applies siblings and boundaries", $ => {
        const noop = $.const(East.function([IntegerType], NullType, (_$, _p) => { }));
        const p = $.let(
            Pagination.Root(0n, 10n, 500n, noop, { siblings: 2n, boundaries: 3n }),
            UIComponentType,
        );

        const style = p.unwrap().unwrap("Pagination").style.unwrap("some");
        $(Assert.equal(style.siblings.unwrap("some"), 2n));
        $(Assert.equal(style.boundaries.unwrap("some"), 3n));
    });

    // =========================================================================
    // Pagination.Root - Style: colour escape hatches
    // =========================================================================

    test("applies colour escape hatches", $ => {
        const noop = $.const(East.function([IntegerType], NullType, (_$, _p) => { }));
        const p = $.let(Pagination.Root(0n, 10n, 100n, noop, {
            color: "gray.700",
            background: "white",
            activeBackground: "blue.500",
            activeColor: "white",
        }), UIComponentType);

        const style = p.unwrap().unwrap("Pagination").style.unwrap("some");
        $(Assert.equal(style.color.unwrap("some"), "gray.700"));
        $(Assert.equal(style.background.unwrap("some"), "white"));
        $(Assert.equal(style.activeBackground.unwrap("some"), "blue.500"));
        $(Assert.equal(style.activeColor.unwrap("some"), "white"));
    });

}, { platformFns: TestImpl });

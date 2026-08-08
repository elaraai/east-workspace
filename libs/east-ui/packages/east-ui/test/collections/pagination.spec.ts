/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { East, IntegerType, NullType, type ExprType } from "@elaraai/east";
import { Pagination, UIComponentType } from "@elaraai/east-ui/internal";
import * as ex from "./pagination.examples.js";

describeEast("Pagination", (test) => {
    Assert.examples(test, {
        paginationBasic: ex.paginationBasic,
        paginationVariants: ex.paginationVariants,
        paginationCustomColours: ex.paginationCustomColours,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#461).
    // The mono-uppercase Text captions are the stable per-mini anchors.
    // =========================================================================

    test("paginationVariants drives its preview from inline option tables", $ => {
        // Everything the configurator needs — the variant / size / siblings /
        // palette tables — is declared inside the example body, because the
        // documentation capture only extracts `fn`. That puts the tables
        // inside the Reactive body, which TestImpl does not execute, so they
        // cannot be asserted from here; `Assert.examples` above still
        // compiles and evaluates the outer function. The per-option coverage
        // lives in the Pagination.Root tests below, which construct each
        // option directly.
        const panel = $.const(ex.paginationVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });

    // =========================================================================
    // Pagination.Root - Basic Creation
    // =========================================================================

    test("creates pagination with main-struct fields", $ => {
        const noop = $.const(East.function([IntegerType], NullType, (_$, _p) => { }));
        const p = $.let(Pagination.Root({ page: 0n, pageSize: 20n, count: 500n, onPageChange: noop }), UIComponentType);

        $(Assert.equal(p.unwrap().unwrap("Pagination").page, 0n));
        $(Assert.equal(p.unwrap().unwrap("Pagination").pageSize, 20n));
        $(Assert.equal(p.unwrap().unwrap("Pagination").count, 500n));
        $(Assert.equal(p.unwrap().unwrap("Pagination").style.hasTag("none"), true));
    });

    test("creates pagination at a non-zero page", $ => {
        const noop = $.const(East.function([IntegerType], NullType, (_$, _p) => { }));
        const p = $.let(Pagination.Root({ page: 5n, pageSize: 10n, count: 100n, onPageChange: noop }), UIComponentType);

        $(Assert.equal(p.unwrap().unwrap("Pagination").page, 5n));
        $(Assert.equal(p.unwrap().unwrap("Pagination").pageSize, 10n));
        $(Assert.equal(p.unwrap().unwrap("Pagination").count, 100n));
    });

    // =========================================================================
    // Pagination.Root - Style: size & variant
    // =========================================================================

    test("applies size preset via style struct", $ => {
        const noop = $.const(East.function([IntegerType], NullType, (_$, _p) => { }));
        const p = $.let(Pagination.Root({ page: 0n, pageSize: 10n, count: 100n, onPageChange: noop, size: "lg" }), UIComponentType);

        $(Assert.equal(
            p.unwrap().unwrap("Pagination").style.unwrap("some").size.unwrap("some").hasTag("lg"),
            true,
        ));
    });

    test("applies variant via style struct", $ => {
        const noop = $.const(East.function([IntegerType], NullType, (_$, _p) => { }));
        const p = $.let(Pagination.Root({ page: 0n, pageSize: 10n, count: 100n, onPageChange: noop, variant: "outline" }), UIComponentType);

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
            Pagination.Root({ page: 0n, pageSize: 10n, count: 500n, onPageChange: noop, siblings: 2n, boundaries: 3n }),
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
        const p = $.let(Pagination.Root({ page: 0n, pageSize: 10n, count: 100n, onPageChange: noop,
            color: "fg.default",
            background: "bg.surface",
            activeBackground: "bg.brand.subtle",
            activeColor: "fg.inverse",
        }), UIComponentType);

        const style = p.unwrap().unwrap("Pagination").style.unwrap("some");
        $(Assert.equal(style.color.unwrap("some"), "fg.default"));
        $(Assert.equal(style.background.unwrap("some"), "bg.surface"));
        $(Assert.equal(style.activeBackground.unwrap("some"), "bg.brand.subtle"));
        $(Assert.equal(style.activeColor.unwrap("some"), "fg.inverse"));
    });

}, { platformFns: TestImpl });

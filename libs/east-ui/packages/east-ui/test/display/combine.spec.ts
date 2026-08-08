/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { type ExprType } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./combine.examples.js";

describeEast("Display density combination", (test) => {
    Assert.examples(test, {
        combineDensities: ex.combineDensities,
    });

    test("combineDensities drives its preview from inline option tables", $ => {
        // Everything the configurator needs — the density-preset table (each
        // row a Density variant plus its tuned column widths) and the
        // table-variant axis — is declared inside the example body, because
        // the documentation capture only extracts `fn`. That puts the tables
        // inside the Reactive body, which TestImpl does not execute, so they
        // cannot be asserted from here; `Assert.examples` above still compiles
        // and evaluates the outer function. Per-component density coverage
        // lives in each cell component's own spec.
        const panel = $.const(ex.combineDensities.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });
}, { platformFns: TestImpl });

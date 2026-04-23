/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * ReactiveDataset platform functions were moved out of `@elaraai/east-ui`.
 * For e3 dataset bindings, see `Data.bind` in `@elaraai/e3-ui-components`
 * and its tests under `libs/east-ui/packages/e3-ui-components/test/platform/`.
 *
 * This placeholder ensures the test runner does not fail on a missing file
 * while the spec remains tracked in source control.
 */

import { test, describe } from "node:test";

describe("ReactiveDataset (moved to @elaraai/e3-ui-components)", () => {
    test("platform moved — see e3-ui-components for dataset tests", () => {
        // Intentionally empty: the ReactiveDataset namespace, DatasetPathType,
        // and related runtime were relocated to e3-ui-components. Tests for
        // the dataset platform now live in that package.
    });
});

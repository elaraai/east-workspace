/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import * as ex from "./component.examples.js";

describeEast("Studio examples (#991)", (test) => {
    Assert.examples(test, {
        studioComponent: ex.studioComponent,
        studioDispatch: ex.studioDispatch,
    });
}, { platformFns: TestImpl });

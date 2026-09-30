/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import * as component from "./component.examples.js";
import * as page from "./page.examples.js";
import * as studio from "./studio.examples.js";

describeEast("Studio examples (#991–#1000)", (test) => {
    Assert.examples(test, {
        studioComponent: component.studioComponent,
        studioPage: page.studioPage,
        studioBuilder: studio.studioBuilder,
        studioLibrary: studio.studioLibrary,
        studioOpsConsole: studio.studioOpsConsole,
    });
}, { platformFns: TestImpl });

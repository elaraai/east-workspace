/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import * as ex from "./component.examples.js";
import * as pages from "./pages.examples.js";
import * as surfaces from "./page.examples.js";

describeEast("Studio examples (#991, #992, #993)", (test) => {
    Assert.examples(test, {
        studioComponent: ex.studioComponent,
        studioDispatch: ex.studioDispatch,
        studioChanges: pages.studioChanges,
        studioPublish: pages.studioPublish,
        studioNewPage: pages.studioNewPage,
        studioUsage: pages.studioUsage,
        studioStatus: pages.studioStatus,
        studioPage: surfaces.studioPage,
        studioSite: surfaces.studioSite,
        studioSiteRecord: surfaces.studioSiteRecord,
    });
}, { platformFns: TestImpl });

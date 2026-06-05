/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { East, NullType } from "@elaraai/east";
import { Download } from "@elaraai/east-ui";
import * as ex from "./download.examples.js";

describeEast("Download", (test) => {
    Assert.examples(test, {
        downloadCsvButton: ex.downloadCsvButton,
        downloadBlobButton: ex.downloadBlobButton,
    });

    test("Download.csv compiles with headers + rows", $ => {
        const fn = East.function([], NullType, $ => {
            $(Download.csv(East.value({
                filename: "test.csv",
                headers: ["a", "b"],
                rows: [["1", "2"], ["3", "4"]],
            }, Download.Types.CsvInput)));
        });
        const value = $.let(East.value("ok"));
        $(Assert.equal(value, "ok"));
        void fn;
    });

    test("Download.blob compiles with bytes payload", $ => {
        const fn = East.function([], NullType, $ => {
            $(Download.blob(East.value({
                filename: "data.bin",
                mimeType: "application/octet-stream",
                data: new Uint8Array([1, 2, 3]),
            }, Download.Types.BlobInput)));
        });
        const value = $.let(East.value("ok"));
        $(Assert.equal(value, "ok"));
        void fn;
    });
}, { platformFns: TestImpl });

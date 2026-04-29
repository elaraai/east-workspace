/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { East, NullType, variant } from "@elaraai/east";
import { Clipboard, Download, Share } from "@elaraai/east-ui";
import * as ex from "./platform.examples.js";

describeEast("Clipboard", (test) => {
    Assert.examples(test, {
        clipboardCopyButton: ex.clipboardCopyButton,
        clipboardCopyReactive: ex.clipboardCopyReactive,
    });

    test("Clipboard.copy compiles inside an East callback", $ => {
        const fn = East.function([], NullType, $ => {
            $(Clipboard.copy("hello"));
        });
        const value = $.let(East.value("ok"));
        $(Assert.equal(value, "ok"));
        // fn is referenced so it isn't tree-shaken; if it failed to type-check
        // the file wouldn't compile.
        void fn;
    });
}, { platformFns: TestImpl });

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

describeEast("Share", (test) => {
    Assert.examples(test, {
        shareLinkButton: ex.shareLinkButton,
    });

    test("Share.link compiles with required url + optional title", $ => {
        const fn = East.function([], NullType, $ => {
            $(Share.link(East.value({
                url: "https://example.com/x",
                title: variant("some", "Example"),
                text: variant("none", null),
            }, Share.Types.LinkInput)));
        });
        const value = $.let(East.value("ok"));
        $(Assert.equal(value, "ok"));
        void fn;
    });
}, { platformFns: TestImpl });

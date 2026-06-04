/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, NullType, example } from "@elaraai/east";
import {
    Button,
    Download,
    Reactive,
    UIComponentType,
} from "@elaraai/east-ui";

export const downloadCsvButton = example({
    keywords: ["Download", "csv", "Button", "onClick"],
    description: "Button that downloads a 2-column CSV with two body rows",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const onClick = $.const(East.function([], NullType, ($) => {
                $(Download.csv(East.value({
                    filename: "scenarios.csv",
                    headers: ["id", "name"],
                    rows: [
                        ["s1", "baseline"],
                        ["s2", "optimised"],
                    ],
                }, Download.Types.CsvInput)));
            }));
            return Button.Root("Download CSV", { onClick });
        }));
    }),
    inputs: [],
});

export const downloadBlobButton = example({
    keywords: ["Download", "blob", "Button", "binary"],
    description: "Button that downloads a small binary payload",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const onClick = $.const(East.function([], NullType, ($) => {
                $(Download.blob(East.value({
                    filename: "preview.bin",
                    mimeType: "application/octet-stream",
                    data: new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]),
                }, Download.Types.BlobInput)));
            }));
            return Button.Root("Download bytes", { onClick });
        }));
    }),
    inputs: [],
});

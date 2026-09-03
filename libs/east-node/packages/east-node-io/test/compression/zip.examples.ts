/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, StringType, some, none, example } from "@elaraai/east";
import { Compression } from "@elaraai/east-node-io";

export const zipCompress = example({
    keywords: ["zip", "Zip", "compress", "archive", "create"],
    description: "Create a ZIP archive from file entries",
    fn: East.asyncFunction([], StringType, ($) => {
        const entries = $.let([
            {
                name: "file1.txt",
                data: East.value("Hello from file1").encodeUtf8(),
            },
        ]);
        const options = $.let({ level: some(6n) }, Compression.Zip.Types.Options);
        const zipBlob = $.let(Compression.Zip.compress(entries, options));
        const files = $.let(Compression.Zip.decompress(zipBlob));
        return files.get("file1.txt").decodeUtf8();
    }),
    inputs: [],
    returns: "Hello from file1",
});

export const zipDecompress = example({
    keywords: ["zip", "Zip", "decompress", "extract", "archive"],
    description: "Create and extract a ZIP archive with multiple files",
    fn: East.asyncFunction([], StringType, ($) => {
        const entries = $.let([
            { name: "a.txt", data: East.value("Content A").encodeUtf8() },
            { name: "b.txt", data: East.value("Content B").encodeUtf8() },
        ]);
        const options = $.let({ level: none }, Compression.Zip.Types.Options);
        const zipBlob = $.let(Compression.Zip.compress(entries, options));
        const files = $.let(Compression.Zip.decompress(zipBlob));
        return files.get("b.txt").decodeUtf8();
    }),
    inputs: [],
    returns: "Content B",
});

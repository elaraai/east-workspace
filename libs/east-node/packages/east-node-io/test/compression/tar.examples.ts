/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, StringType, example } from "@elaraai/east";
import { Compression } from "@elaraai/east-node-io";

export const tarCreate = example({
    keywords: ["tar", "Tar", "create", "archive", "pack"],
    description: "Create a TAR archive from file entries",
    fn: East.asyncFunction([], StringType, ($) => {
        const entries = $.let([
            {
                name: "file1.txt",
                data: East.value("Hello from tar").encodeUtf8(),
            },
        ]);
        const tarBlob = $.let(Compression.Tar.create(entries));
        const files = $.let(Compression.Tar.extract(tarBlob));
        return files.get("file1.txt").decodeUtf8();
    }),
    inputs: [],
    returns: "Hello from tar",
});

export const tarExtract = example({
    keywords: ["tar", "Tar", "extract", "unpack", "archive"],
    description: "Create and extract a TAR archive with multiple files",
    fn: East.asyncFunction([], StringType, ($) => {
        const entries = $.let([
            { name: "dir/a.txt", data: East.value("File A").encodeUtf8() },
            { name: "dir/b.txt", data: East.value("File B").encodeUtf8() },
        ]);
        const tarBlob = $.let(Compression.Tar.create(entries));
        const files = $.let(Compression.Tar.extract(tarBlob));
        return files.get("dir/b.txt").decodeUtf8();
    }),
    inputs: [],
    returns: "File B",
});

/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, IntegerType, NullType, StringType, variant, none, example } from "@elaraai/east";
import { Storage } from "@elaraai/east-node-io";

const s3Config = {
    region: "us-east-1",
    bucket: "test-bucket",
    accessKeyId: variant('some', "minioadmin"),
    secretAccessKey: variant('some', "minioadmin"),
    endpoint: variant('some', "http://localhost:9000"),
};

export const s3PutObject = example({
    keywords: ["s3", "S3", "putObject", "upload", "write", "store"],
    description: "Upload data to S3",
    fn: East.asyncFunction([], NullType, ($) => {
        const config = $.let(s3Config);
        const data = $.let(new Uint8Array([1, 2, 3, 4, 5]));
        $(Storage.S3.putObject(config, "example-file.bin", data));
        $(Storage.S3.deleteObject(config, "example-file.bin"));
    }),
    inputs: [],
});

export const s3GetObject = example({
    keywords: ["s3", "S3", "getObject", "download", "read", "retrieve"],
    description: "Upload and download data from S3 roundtrip",
    fn: East.asyncFunction([], StringType, ($) => {
        const config = $.let(s3Config);
        const blob = $.let(East.value("Hello, S3!").encodeUtf8());
        $(Storage.S3.putObject(config, "example-download.txt", blob));
        const downloaded = $.let(Storage.S3.getObject(config, "example-download.txt"));
        $(Storage.S3.deleteObject(config, "example-download.txt"));
        return downloaded.decodeUtf8();
    }),
    inputs: [],
    returns: "Hello, S3!",
});

export const s3HeadObject = example({
    keywords: ["s3", "S3", "headObject", "metadata", "info", "head"],
    description: "Get object metadata from S3 without downloading",
    fn: East.asyncFunction([], IntegerType, ($) => {
        const config = $.let(s3Config);
        const data = $.let(new Uint8Array([1, 2, 3, 4, 5]));
        $(Storage.S3.putObject(config, "example-head.bin", data));
        const metadata = $.let(Storage.S3.headObject(config, "example-head.bin"));
        $(Storage.S3.deleteObject(config, "example-head.bin"));
        return metadata.size;
    }),
    inputs: [],
    returns: 5n,
});

export const s3DeleteObject = example({
    keywords: ["s3", "S3", "deleteObject", "delete", "remove"],
    description: "Delete an object from S3",
    fn: East.asyncFunction([], NullType, ($) => {
        const config = $.let(s3Config);
        const data = $.let(new Uint8Array([1, 2, 3]));
        $(Storage.S3.putObject(config, "example-delete.bin", data));
        $(Storage.S3.deleteObject(config, "example-delete.bin"));
    }),
    inputs: [],
});

export const s3ListObjects = example({
    keywords: ["s3", "S3", "listObjects", "list", "browse", "prefix"],
    description: "List objects in an S3 bucket with a prefix",
    fn: East.asyncFunction([], BooleanType, ($) => {
        const config = $.let(s3Config);
        const data = $.let(new Uint8Array([1, 2, 3]));
        $(Storage.S3.putObject(config, "example-list/a.bin", data));
        $(Storage.S3.putObject(config, "example-list/b.bin", data));
        const result = $.let(Storage.S3.listObjects(config, "example-list/", 100n, none));
        $(Storage.S3.deleteObject(config, "example-list/a.bin"));
        $(Storage.S3.deleteObject(config, "example-list/b.bin"));
        return result.objects.size().greaterEqual(2n);
    }),
    inputs: [],
    returns: true,
});

export const s3PresignUrl = example({
    keywords: ["s3", "S3", "presignUrl", "presign", "url", "share"],
    description: "Generate a presigned URL for an S3 object",
    fn: East.asyncFunction([], BooleanType, ($) => {
        const config = $.let(s3Config);
        const data = $.let(new Uint8Array([1, 2, 3]));
        $(Storage.S3.putObject(config, "example-presign.bin", data));
        const url = $.let(Storage.S3.presignUrl(config, "example-presign.bin", 3600n));
        $(Storage.S3.deleteObject(config, "example-presign.bin"));
        return url.length().greater(0n);
    }),
    inputs: [],
    returns: true,
});

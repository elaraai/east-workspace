/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, ArrayType, IntegerType, NullType, StringType, StructType, example } from "@elaraai/east";
import { FileUpload, Reactive, Stack, State, Text, UIComponentType } from "@elaraai/east-ui";

export const fileUploadBasic = example({
    keywords: ["FileUpload", "Root", "label", "dropzone", "maxFiles", "accept"],
    description: "File selection with drag and drop",
    fn: East.function([], UIComponentType, (_$) => {
        return FileUpload.Root({
            label: "Upload Files",
            dropzoneText: "or drag and drop",
            triggerText: "Choose files",
            maxFiles: 5,
            accept: "image/*",
        });
    }),
    inputs: [],
});

const FileInfoArrayType = ArrayType(StructType({
    name: StringType,
    size: IntegerType,
    type: StringType,
}));

const FileRejectionArrayType = ArrayType(StructType({
    file: StructType({
        name: StringType,
        size: IntegerType,
        type: StringType,
    }),
    errors: ArrayType(StringType),
}));

export const fileUploadInteractive = example({
    keywords: ["FileUpload", "Reactive", "State", "onFileAccept", "interactive"],
    description: "FileUpload whose onFileAccept records the number of accepted files",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const bind = $.let(State.bind([IntegerType], "fileupload_count", 0n));
            const value = $.let(bind.read());
            const onFileAccept = $.const(East.function([FileInfoArrayType], NullType, ($, files) => {
                $(bind.write(files.length()));
            }));
            return Stack.VStack([
                FileUpload.Root({
                    label: "Upload Files",
                    dropzoneText: "or drag and drop",
                    triggerText: "Choose files",
                    maxFiles: 5,
                    onFileAccept,
                }),
                Text.Presets.MonoLabel(East.str`ACCEPTED · ${value} FILES`),
            ], { gap: "3", align: "stretch", width: "100%" });
        }));
    }),
    inputs: [],
});

export const fileUploadOnFileReject = example({
    keywords: ["FileUpload", "Reactive", "State", "onFileReject", "interactive"],
    description: "FileUpload whose onFileReject records the number of rejected files (try uploading wrong type or oversize file)",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const bind = $.let(State.bind([IntegerType], "fileupload_rejected", 0n));
            const value = $.let(bind.read());
            const onFileReject = $.const(East.function([FileRejectionArrayType], NullType, ($, files) => {
                $(bind.write(files.length()));
            }));
            return Stack.VStack([
                FileUpload.Root({
                    label: "Images Only (max 100KB)",
                    dropzoneText: "or drag and drop",
                    triggerText: "Choose files",
                    accept: "image/*",
                    maxFileSize: 100000,
                    onFileReject,
                }),
                Text.Presets.MonoLabel(East.str`REJECTED · ${value} FILES`),
            ], { gap: "3", align: "stretch", width: "100%" });
        }));
    }),
    inputs: [],
});

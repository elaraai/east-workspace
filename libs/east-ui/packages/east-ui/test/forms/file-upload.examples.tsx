/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, IntegerType, NullType, StringType, StructType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { FileUpload, Text, VStack, Reactive } from "@elaraai/east-ui/jsx";

export const fileUploadBasic = example({
    keywords: ["FileUpload", "Root", "label", "dropzone", "maxFiles", "accept"],
    description: "File selection with drag and drop",
    fn: East.function([], UIComponentType, (_$) => {
        return <FileUpload label="Upload Files" dropzoneText="or drag and drop" triggerText="Choose files" maxFiles={5} accept="image/*" />;
    }),
    inputs: [],
});

export const fileUploadInteractive = example({
    keywords: ["FileUpload", "Reactive", "State", "onFileAccept", "interactive"],
    description: "FileUpload whose onFileAccept records the number of accepted files",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const FileInfoArrayType = ArrayType(StructType({ name: StringType, size: IntegerType, type: StringType }));
            const bind = $.let(State.bind([IntegerType], "fileupload_count", 0n));
            const value = $.let(bind.read());
            const onFileAccept = $.const(East.function([FileInfoArrayType], NullType, ($, files) => {
                $(bind.write(files.length()));
            }));
            return (
                <VStack gap="3" align="stretch" width="100%">
                    <FileUpload label="Upload Files" dropzoneText="or drag and drop" triggerText="Choose files" maxFiles={5} onFileAccept={onFileAccept} />
                    {Text.Presets.MonoLabel(East.str`ACCEPTED · ${value} FILES`)}
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const fileUploadOnFileReject = example({
    keywords: ["FileUpload", "Reactive", "State", "onFileReject", "interactive"],
    description: "FileUpload whose onFileReject records the number of rejected files (try uploading wrong type or oversize file)",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const FileRejectionArrayType = ArrayType(StructType({
                file: StructType({ name: StringType, size: IntegerType, type: StringType }),
                errors: ArrayType(StringType),
            }));
            const bind = $.let(State.bind([IntegerType], "fileupload_rejected", 0n));
            const value = $.let(bind.read());
            const onFileReject = $.const(East.function([FileRejectionArrayType], NullType, ($, files) => {
                $(bind.write(files.length()));
            }));
            return (
                <VStack gap="3" align="stretch" width="100%">
                    <FileUpload label="Images Only (max 100KB)" dropzoneText="or drag and drop" triggerText="Choose files" accept="image/*" maxFileSize={100000} onFileReject={onFileReject} />
                    {Text.Presets.MonoLabel(East.str`REJECTED · ${value} FILES`)}
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

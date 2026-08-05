/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, IntegerType, NullType, StringType, StructType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Configurator, FileUpload, HStack, Reactive, SegmentGroup, Text } from "@elaraai/east-ui";

export const fileUploadBasic = example({
    keywords: ["FileUpload", "Root", "label", "dropzone", "maxFiles", "accept"],
    description: "File selection with drag and drop",
    fn: East.function([], UIComponentType, (_$) => {
        return <FileUpload label="Upload Files" dropzoneText="or drag and drop" triggerText="Choose files" maxFiles={5} accept="image/*" />;
    }),
    inputs: [],
});

export const fileUploadVariants = example({
    keywords: ["FileUpload", "Root", "orientation", "vertical", "horizontal", "stacked", "inline", "maxFiles", "accept", "Reactive", "State", "onFileAccept", "onFileReject", "interactive", "SegmentGroup", "Configurator", "configurator"],
    description: "FileUpload configurator — an orientation axis on one live dropzone; the aside counts accepted and rejected files",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const FileInfoArrayType = ArrayType(StructType({ name: StringType, size: IntegerType, type: StringType }));
            const RejectionArrayType = ArrayType(StructType({ file: StructType({ name: StringType, size: IntegerType, type: StringType }), errors: ArrayType(StringType) }));
            const orientations = $.const(["vertical", "horizontal"], ArrayType(StringType));

            const orientationBind = $.let(State.bind([StringType], "fileupload_orientation", "vertical"));
            const acceptedBind = $.let(State.bind([IntegerType], "fileupload_count", 0n));
            const rejectedBind = $.let(State.bind([IntegerType], "fileupload_rejected", 0n));

            const oKey = $.let(orientationBind.read());
            const accepted = $.let(acceptedBind.read());
            const rejected = $.let(rejectedBind.read());

            const onOrientation = $.const(East.function([StringType], NullType, ($, next) => { $(orientationBind.write(next)); }));
            const onFileAccept = $.const(East.function([FileInfoArrayType], NullType, ($, files) => {
                $(acceptedBind.write(files.length()));
            }));
            const onFileReject = $.const(East.function([RejectionArrayType], NullType, ($, rejections) => {
                $(rejectedBind.write(rejections.length()));
            }));

            const preview = $.const(oKey.equal("horizontal").ifElse(
                _$ => <FileUpload orientation="horizontal" label="Evidence (inline)" dropzoneText="or drag and drop" triggerText="Attach file" maxFiles={5} accept="image/*" onFileAccept={onFileAccept} onFileReject={onFileReject} />,
                _$ => <FileUpload orientation="vertical" label="Upload Files" dropzoneText="or drag and drop" triggerText="Choose files" maxFiles={5} accept="image/*" onFileAccept={onFileAccept} onFileReject={onFileReject} />,
            ));

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Orientation", oKey,
                            <SegmentGroup value={oKey} onChange={onOrientation} size="sm"
                                items={orientations.map((_$, o) => SegmentGroup.Item(o, <Text>{o.upperCase()}</Text>))} />),
                    ]}
                    preview={preview}
                    aside={{
                        label: "Files · Reactive",
                        body: (
                            <HStack gap="4" align="center">
                                <Text.MonoLabel>{East.str`ACCEPTED · ${accepted}`}</Text.MonoLabel>
                                <Text.MonoLabel>{East.str`REJECTED · ${rejected}`}</Text.MonoLabel>
                            </HStack>
                        ),
                    }}
                    spec={[
                        Configurator.Spec("Accept", "image/* · max 5"),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
import { East, example } from "@elaraai/east";
import { FileUpload, UIComponentType } from "../../src/index.js";

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

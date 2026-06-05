/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Form `<FileUpload>` tag — file drop / picker. Maps to `FileUpload.Root`. */

import { FileUpload as FileUploadFactory } from "../../forms/file-upload/index.js";
import { optionsTag, type OptionsProps, type JsxTag } from "../combinators.js";

/** `<FileUpload accept="image/*" maxFiles={5n} />` — file drop zone / picker. Maps to `FileUpload.Root`. */
export const FileUpload: JsxTag<OptionsProps<typeof FileUploadFactory.Root>> & { Types: typeof FileUploadFactory.Types } =
    Object.assign(optionsTag(FileUploadFactory.Root), { Types: FileUploadFactory.Types });

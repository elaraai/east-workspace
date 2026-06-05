/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<FileUpload>` tag — see the export's JSDoc.
 */

import { FileUpload as FileUploadFactory } from "../../forms/file-upload/index.js";
import { optionsTag, type OptionsProps, type JsxTag } from "../combinators.js";

/**
 * File drop zone / picker — a labelled area accepting files via drag-and-drop or
 * a browse button. Reach for it to collect uploads. `accept` filters MIME types,
 * `maxFiles` / `maxFileSize` cap the selection, and `label` / `dropzoneText` /
 * `triggerText` set the chrome. `onFileAccept` carries the accepted file list and
 * `onFileReject` the rejected ones with their errors.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { FileUpload, UIComponentType } from "@elaraai/east-ui";
 *
 * const upload = East.function([], UIComponentType, _$ => (
 *     <FileUpload label="Upload Files" dropzoneText="or drag and drop" triggerText="Choose files" maxFiles={5} accept="image/*" />
 * ));
 * ```
 *
 * @remarks
 * Carries `FileUpload.Types`. Wire `onFileAccept` / `onFileReject` inside a
 * `<Reactive>` block to react to selections. Desugars to `FileUpload.Root(options)`.
 */
export const FileUpload: JsxTag<OptionsProps<typeof FileUploadFactory.Root>> & { Types: typeof FileUploadFactory.Types } =
    Object.assign(optionsTag(FileUploadFactory.Root), { Types: FileUploadFactory.Types });

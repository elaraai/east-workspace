/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    East,
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import {
    FileUploadType,
    FileUploadStyleType,
    FileCaptureType,
    FileUploadOrientationType,
    type FileUploadStyle,
} from "./types.js";

// Re-export types
export {
    FileUploadType,
    FileUploadStyleType,
    FileCaptureType,
    FileUploadOrientationType,
    type FileUploadStyle,
    type FileCaptureLiteral,
    type FileUploadOrientationLiteral,
} from "./types.js";

// ============================================================================
// FileUpload Factory
// ============================================================================

/**
 * Creates a FileUpload component.
 *
 * @param style - Configuration options for the file upload
 * @returns An East expression representing the FileUpload component
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { FileUpload, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return FileUpload.Root({
 *         accept: "image/*",
 *         maxFiles: 5n,
 *     });
 * });
 * ```
 */
export function createFileUpload_(
    style?: FileUploadStyle
): ExprType<FileUploadType> {
    // Convert number to bigint for IntegerType fields
    const maxFilesValue = style?.maxFiles !== undefined
        ? (typeof style.maxFiles === "number" ? BigInt(style.maxFiles) : style.maxFiles)
        : undefined;
    const maxFileSizeValue = style?.maxFileSize !== undefined
        ? (typeof style.maxFileSize === "number" ? BigInt(style.maxFileSize) : style.maxFileSize)
        : undefined;
    const minFileSizeValue = style?.minFileSize !== undefined
        ? (typeof style.minFileSize === "number" ? BigInt(style.minFileSize) : style.minFileSize)
        : undefined;

    // Convert capture string literal to variant
    const captureValue = style?.capture
        ? (typeof style.capture === "string"
            ? East.value(variant(style.capture, null), FileCaptureType)
            : style.capture)
        : undefined;

    // Convert orientation string literal to variant
    const orientationValue = style?.orientation
        ? (typeof style.orientation === "string"
            ? East.value(variant(style.orientation, null), FileUploadOrientationType)
            : style.orientation)
        : undefined;

    const hasStyle = !!style && (
        style.variant !== undefined ||
        style.size !== undefined ||
        style.background !== undefined ||
        style.borderColor !== undefined ||
        style.dropzoneBackground !== undefined ||
        style.dropzoneBorderColor !== undefined ||
        style.activeBackground !== undefined
    );

    const styleValue = hasStyle ? East.value({
        variant: style!.variant !== undefined ? some(style!.variant) : none,
        size: style!.size !== undefined ? some(style!.size) : none,
        background: style!.background !== undefined ? some(style!.background) : none,
        borderColor: style!.borderColor !== undefined ? some(style!.borderColor) : none,
        dropzoneBackground: style!.dropzoneBackground !== undefined ? some(style!.dropzoneBackground) : none,
        dropzoneBorderColor: style!.dropzoneBorderColor !== undefined ? some(style!.dropzoneBorderColor) : none,
        activeBackground: style!.activeBackground !== undefined ? some(style!.activeBackground) : none,
    }, FileUploadStyleType) : undefined;

    return East.value({
        accept: style?.accept !== undefined ? variant("some", style.accept) : variant("none", null),
        maxFiles: maxFilesValue !== undefined ? variant("some", maxFilesValue) : variant("none", null),
        maxFileSize: maxFileSizeValue !== undefined ? variant("some", maxFileSizeValue) : variant("none", null),
        minFileSize: minFileSizeValue !== undefined ? variant("some", minFileSizeValue) : variant("none", null),
        directory: style?.directory !== undefined ? variant("some", style.directory) : variant("none", null),
        disabled: style?.disabled !== undefined ? variant("some", style.disabled) : variant("none", null),
        required: style?.required !== undefined ? variant("some", style.required) : variant("none", null),
        allowDrop: style?.allowDrop !== undefined ? variant("some", style.allowDrop) : variant("none", null),
        capture: captureValue ? variant("some", captureValue) : variant("none", null),
        name: style?.name !== undefined ? variant("some", style.name) : variant("none", null),
        label: style?.label !== undefined ? variant("some", style.label) : variant("none", null),
        dropzoneText: style?.dropzoneText !== undefined ? variant("some", style.dropzoneText) : variant("none", null),
        triggerText: style?.triggerText !== undefined ? variant("some", style.triggerText) : variant("none", null),
        orientation: orientationValue !== undefined ? variant("some", orientationValue) : variant("none", null),
        onFileAccept: style?.onFileAccept !== undefined ? variant("some", style.onFileAccept) : variant("none", null),
        onFileReject: style?.onFileReject !== undefined ? variant("some", style.onFileReject) : variant("none", null),
        style: styleValue ? some(styleValue) : none,
    }, FileUploadType);
}


function createFileUpload(
    style?: FileUploadStyle
): ExprType<UIComponentType> {
    return East.value(variant("FileUpload", createFileUpload_(style)), UIComponentType);
}

// ============================================================================
// FileUpload Namespace Export
// ============================================================================

/**
 * FileUpload component namespace.
 *
 * @remarks
 * FileUpload provides a form control for uploading files with drag-and-drop support.
 */
export const FileUpload = {
    /**
     * Creates a FileUpload component.
     *
     * @param style - Configuration options for the file upload
     * @returns An East expression representing the FileUpload component
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { FileUpload, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return FileUpload.Root({
     *         accept: "image/*",
     *         maxFiles: 5n,
     *     });
     * });
     * ```
     */
    Root: createFileUpload,
    Types: {
        /**
         * Type for FileUpload component data.
         *
         * @remarks
         * FileUpload is a form control for uploading files with drag-and-drop support.
         *
         * @property accept - Accepted file types (MIME type pattern, e.g., "image/*" or ".pdf,.doc")
         * @property maxFiles - Maximum number of files allowed
         * @property maxFileSize - Maximum file size in bytes
         * @property minFileSize - Minimum file size in bytes
         * @property directory - Whether to allow folder/directory upload
         * @property disabled - Whether the upload is disabled
         * @property required - Whether file upload is required
         * @property allowDrop - Whether to allow drag-and-drop
         * @property capture - Camera capture mode for mobile devices
         * @property name - Form input name attribute
         * @property label - Label text for the upload area
         * @property dropzoneText - Text shown in the dropzone area
         * @property triggerText - Text for the upload trigger button
         */
        FileUpload: FileUploadType,
        /**
         * East StructType holding visual fields for `FileUpload`.
         *
         * @property variant - Visual style variant (`outline` / `subtle` / `solid`)
         * @property size - Component size (`xs` / `sm` / `md` / `lg`)
         * @property background - Explicit background colour for the container
         * @property borderColor - Explicit border colour for the container
         * @property dropzoneBackground - Background colour of the dashed-border dropzone region
         * @property dropzoneBorderColor - Border colour of the dropzone region
         * @property activeBackground - Background colour while dragging files over
         */
        Style: FileUploadStyleType,
        /**
         * Capture mode for camera access on mobile devices.
         *
         * @remarks
         * Controls which camera to use when capturing media files.
         *
         * @property user - Front-facing camera (selfie mode)
         * @property environment - Rear-facing camera
         */
        Capture: FileCaptureType,
    },
} as const;

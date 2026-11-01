/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The data set a page's editing reads and writes, under which its sessions are
 * held and their drafts kept. A host whose sources are one data set's — an e3
 * workspace's, by its server, repository and workspace — names it, so drafts
 * made over one never reach another whose sources share their names: not the
 * sessions the page holds, nor the drafts the tab keeps through a reload. With
 * none named, a page's sources are its own.
 *
 * @packageDocumentation
 */
import { createContext, useContext } from "react";

/** The data set the editing beneath reads and writes: empty where the host names none. */
export const EditingScope = createContext("");

/**
 * The data set the editing here reads and writes ({@link EditingScope}).
 *
 * @returns Its name: empty where the host names none
 */
export function useEditingScope(): string {
    return useContext(EditingScope);
}

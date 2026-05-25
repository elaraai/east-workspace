/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0-or-later. See LICENSE for details.
 */

import { basename } from "node:path";

export interface ProjectNames {
  /** kebab-case, npm-safe: "my-cool-app" */
  projectName: string;
  /** Title Case for display/docs: "My Cool App" */
  displayName: string;
  /** snake_case for e3 workspace identifiers: "my_cool_app" */
  workspaceName: string;
}

/**
 * Derive the project name variants from a raw input. `"."` resolves to the
 * basename of `cwd`. Mirrors the bash scaffolders: lowercase, spaces and
 * underscores collapse to hyphens, then Title-Case and snake_case views.
 */
export function deriveNames(rawName: string, cwd: string): ProjectNames {
  const source = rawName === "." ? basename(cwd) : rawName;
  const projectName = source
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (projectName === "") {
    throw new Error(`Could not derive a valid project name from "${rawName}"`);
  }

  const displayName = projectName
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  const workspaceName = projectName.replace(/-/g, "_");

  return { projectName, displayName, workspaceName };
}

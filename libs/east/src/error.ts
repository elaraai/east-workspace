/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type { SourceMap } from "./location.js";

/**
 * Internal error for invariant violations in the East compiler/runtime.
 * These indicate bugs in East itself, not user errors.
 */
export class InternalError extends Error {
  constructor(message: string) {
    super(`Internal East error: ${message}`);
    this.name = "InternalError";
  }
}

export class EastError extends Error {
  public loc_id: bigint;
  public source_map: SourceMap | null;
  public eastMessage: string;

  constructor(message: string, options: { cause?: any, loc_id: bigint, source_map: SourceMap | null }) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.eastMessage = message;
    this.loc_id = options.loc_id;
    this.source_map = options.source_map;
  }

  override toString(): string {
    const stack = this.source_map?.resolve(this.loc_id) ?? [];
    if (stack.length === 0) {
      return `<unknown>: ${this.eastMessage}`;
    }
    const loc = stack[0]!;
    const header = `${loc.filename}:${loc.line}:${loc.column}: ${this.eastMessage}`;

    if (stack.length <= 1) {
      return header;
    }

    // Build stack trace (skip first since it's in the header)
    const lines = [header, "Stack trace:"];
    for (let i = stack.length - 1; i >= 1; i--) {
      const frame = stack[i]!;
      lines.push(`  at ${frame.filename}:${frame.line}:${frame.column}`);
    }

    return lines.join("\n");
  }

  /** Format for use with Error.message */
  get formattedMessage(): string {
    return this.toString();
  }
}

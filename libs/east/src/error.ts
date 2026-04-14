/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type { Location } from "./location.js";

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
  public location: Location[];
  public eastMessage: string;

  constructor(message: string, options: { cause?: any, location?: Location[] } = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.eastMessage = message;
    this.location = options.location ?? [];
  }

  override toString(): string {
    if (this.location.length === 0) {
      return `<unknown>: ${this.eastMessage}`;
    }
    const loc = this.location[0]!;
    const header = `${loc.filename}:${loc.line}:${loc.column}: ${this.eastMessage}`;

    if (this.location.length <= 1) {
      return header;
    }

    const lines = [header, "Stack trace:"];
    for (let i = this.location.length - 1; i >= 1; i--) {
      const frame = this.location[i]!;
      lines.push(`  at ${frame.filename}:${frame.line}:${frame.column}`);
    }

    return lines.join("\n");
  }

  get formattedMessage(): string {
    return this.toString();
  }
}

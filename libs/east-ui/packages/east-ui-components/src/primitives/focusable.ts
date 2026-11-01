/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the focus can go to: a control that takes it, enabled, or an element in
 * the tab order — where a component sends the focus when what held it goes.
 *
 * @packageDocumentation
 */

/** A control the focus can go to: enabled, or in the tab order. */
export const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

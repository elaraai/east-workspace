/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// =============================================================================
// Side-effect imports — register platform implementations + UI extension
// renderers at module load. Keeping these as explicit imports (rather than
// relying on the package.json `sideEffects` field) makes registration
// bulletproof under bundlers that ignore or partially honour that field.
// =============================================================================
import './platform/bind-runtime.js';      // → registerPlatformImplementation(BindPlatform)
import './diff/index.js';                 // → implementUIComponent(Diff.Component, EastChakraDiff)

// Platform — reactive dataset cache, runtime, and React hooks for Data.bind
export * from './platform/index.js';

// Utilities
export { formatApiError, formatError } from './errors.js';

// Hooks
export * from './hooks/index.js';

// Diff renderer — registers itself against the Diff extension on import.
export { EastChakraDiff, type EastChakraDiffProps } from './diff/index.js';

// Components
export { ErrorBoundary, type ErrorBoundaryProps } from './components/ErrorBoundary.js';
export { InputPreview, type InputPreviewProps } from './components/InputPreview.js';
export { TaskPreview, type TaskPreviewProps } from './components/TaskPreview.js';
export { UITaskPreview, type UITaskPreviewProps } from './components/UITaskPreview.js';
export { DataTaskPreview, type DataTaskPreviewProps } from './components/DataTaskPreview.js';
export { DatasetPreview, type DatasetPreviewProps } from './components/DatasetPreview.js';
export { StatusDisplay, type StatusDisplayProps } from './components/StatusDisplay.js';
export { EastValueViewer, type EastValueViewerProps } from './components/EastValueViewer.js';
export { VirtualizedLogViewer, type VirtualizedLogViewerProps } from './components/VirtualizedLogViewer.js';

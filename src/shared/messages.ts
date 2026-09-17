import type { CaptureSlot, ContextStrategy, ExportFile, FillContext } from './types.js';
import type { StoredState } from '../shell/storage.js';

/**
 * Requests from trusted popup.html, palette.html, and options.html documents.
 * Ordinary pages and content scripts cannot use this library-reading boundary.
 * Each request receives a Response; rendering and clipboard access stay in the document.
 */
export type Request =
  /** Read the library, local settings, editor revision, and import generation. */
  | { type: 'state' }
  /** Read staged context separately; an empty slot requires Capture or Choose tab. */
  | { type: 'slot' }
  /** Read the palette route; reused palettes also observe session invocation changes. */
  | { type: 'invocation' }
  /** Snapshot the active tab in the last-focused normal window, including top-frame selection. */
  | { type: 'capture' }
  /** Explicitly discard staged context. */
  | { type: 'clear-capture' }
  /** List filtered normal-tab metadata; requires optional tabs permission. */
  | { type: 'tabs'; query: string }
  /** Rank against the last-focused normal window's active URL; unavailable URLs get no boost. */
  | { type: 'search'; query: string }
  /** Snapshot a source; a picked tab overrides this fill only and never changes the capture slot. */
  | { type: 'fill'; promptId: string; tabId?: number }
  /**
   * Save a full-library draft against an expected revision; stale saves require reload.
   * Referenced partial deletion/rename is blocked. Deleting prompts or disabling
   * remembering removes the corresponding stored values.
   */
  | { type: 'save'; revision: number; library: ExportFile }
  /**
   * Send only after validation, a counts summary, an Export offer, and explicit Replace.
   * Success preserves settings/capture, clears usage/remembered values, increments
   * generation, and broadcasts LibraryReplaced so open snapshots can be discarded.
   */
  | { type: 'import'; revision: number; text: string }
  /** Serialize only a valid library; invalid drafts block export. */
  | { type: 'export' }
  /**
   * Permission requests belong to explicit UI buttons; this request never grants them.
   * Sync is off by default and publishes only strategy. Received strategies must meet
   * local permission/host prerequisites. Disabling sync stops reads/writes without
   * erasing other devices' copies; sync failure does not prevent local settings saves.
   */
  | { type: 'settings'; revision: number; strategy: ContextStrategy; knownChatHosts: string[]; syncEnabled: boolean }
  /**
   * Acknowledge successful clipboard delivery only, with free-input values, never clipboard text.
   * Send nothing on cancellation or clipboard failure. Each successful copy counts,
   * including repeats; usage writes do not invalidate editor revisions. A usage-write
   * failure is separate from clipboard success and must not trigger another clipboard write.
   */
  | { type: 'copied'; revision: number; generation: number; promptId: string; values: Record<string, string> };
/**
 * Input for document-side prepareFill and renderFill. prepareFill freezes the snapshot;
 * changing sources requires a new fill. Use browserRegexExecutor with packaged regex.js:
 * the core owns the startup and per-rule execution budgets and the executor terminates its Web Worker.
 * Clipboard reads require consent in the focused document and remain fill-local; never
 * send or persist clipboard contents. Copy only valid rendered plain text.
 */
export interface FillData {
  library: ExportFile;
  promptId: string;
  context: FillContext;
  remembered: Record<string, string>;
  revision: number;
  generation: number;
}
/** Search/omnibox metadata deliberately excludes prompt bodies. */
export interface SearchResult { id: string; name: string }
/** Settings responses distinguish committed local state from best-effort sync publication. */
export type Payload = StoredState | CaptureSlot | CaptureSlot[] | SearchResult[] | FillData | string | null
  | { promptId?: string; query?: string }
  | { stored: StoredState; syncPublished: boolean };
/** Durable edits are saved only after an ok response; copied errors concern bookkeeping only. */
export type Response = { ok: true; data: Payload } | { ok: false; error: string };

/** Discard open fill snapshots on receipt; also compare generation when restoring a document. */
export interface LibraryReplaced { type: 'library-replaced'; generation: number }

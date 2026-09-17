export type UrlMatchPattern = string;
export type ContextName = "url" | "title" | "selection" | "date" | "clipboard";
export type ContextStrategy = "capture" | "last-non-chat" | "tab-picker";
export interface FreeVariable {
  kind: "free";
  name: string;
  label: string;
  defaultValue: string;
  rememberLast: boolean;
}
export type Variable =
  | { kind: "context"; name: ContextName; value: string | null }
  | { kind: "derived"; name: string; ruleId: string; value: string | null }
  | FreeVariable;
export interface Prompt {
  id: string;
  name: string;
  body: string;
  tags: string[];
  scope: UrlMatchPattern[];
  variables: FreeVariable[];
}
export interface Partial {
  name: string;
  body: string;
}
export interface SiteRule {
  id: string;
  match: UrlMatchPattern;
  regex: string;
  flags: "" | "i";
}
export interface CaptureSlot {
  url: string;
  title: string | null;
  selection: string | null;
  sourceTabId: number | null;
  source: "tab" | "link";
  capturedAt: string;
}
export interface FillContext {
  strategy: ContextStrategy;
  source: CaptureSlot;
  date: string;
  clipboard: string | null;
}
export interface Usage {
  count: number;
  lastUsedAt: string | null;
}
export interface LocalState {
  library: ExportFile;
  usage: Record<string, Usage>;
  remembered: Record<string, Record<string, string>>;
  knownChatHosts: string[];
  strategy: ContextStrategy;
}
export interface ExportFile {
  schemaVersion: 1;
  prompts: Prompt[];
  partials: Partial[];
  siteRules: SiteRule[];
}

import { parseInvocation } from './palette.js';
import type { LibraryReplaced, Payload, Request, Response, SearchResult } from '../shared/messages.js';
import { reconcileRemembered } from '../core/resolve.js';
import { buildSearchIndex, rankPrompts } from '../core/ranking.js';
import type { StorageAreas, StoredState, WriteQueue } from './storage.js';
import { isStrategy, publishStrategy, readState, safeClone, writeState } from './storage.js';
import { parseRequest, trustedSender } from './messages.js';
import type { Sender } from './messages.js';
import { editedLibrary, serializedExport, validatedImport } from './library.js';
import { createSlot } from './slot.js';
import type { SelectionAccess } from './slot.js';
import { listTabs, requireStrategy, resolveSource } from './sources.js';
import type { Sources } from './sources.js';

export interface ControllerDependencies extends Sources {
  areas: StorageAreas;
  queue: WriteQueue;
  selection: SelectionAccess;
  extensionId: string;
  origin: string;
  notify(message: LibraryReplaced): Promise<void>;
}
export interface Controller {
  handle(raw: unknown, sender: Sender): Promise<Response>;
  search(query: string): Promise<SearchResult[]>;
  receiveSync(): Promise<void>;
}
function localDate(at: string): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function createController(deps: ControllerDependencies): Controller {
  const slot = createSlot(deps.session, deps.queue, deps.selection, deps.now);
  const search = async (query: string): Promise<SearchResult[]> => {
    const stored = await readState(deps.areas.local);
    let url: string | null = null;
    try { url = (await deps.windows.getLastFocused({ populate: true, windowTypes: ['normal'] })).tabs?.find(tab => tab.active)?.url ?? null; }
    catch { /* Missing activeTab metadata must not disable search. */ }
    return rankPrompts(buildSearchIndex(stored.state.library), query, url, stored.state.usage)
      .map(({ prompt }) => ({ id: prompt.id, name: prompt.name }));
  };
  const mutate = async (request: Extract<Request, { revision: number }>): Promise<Payload> => deps.queue(async () => {
    let stored = await readState(deps.areas.local);
    if (request.type !== 'copied' && request.revision !== stored.revision) throw new Error('Stale editor or fill; reload before saving');
    if (request.type === 'save' || request.type === 'import') {
      stored = editedLibrary(stored, request.type === 'save' ? request.library : validatedImport(request.text), request.type === 'import');
    } else if (request.type === 'settings') {
      await requireStrategy(request.strategy, request.knownChatHosts, deps.permissions);
      stored.state.strategy = request.strategy;
      stored.state.knownChatHosts = [...new Set(request.knownChatHosts)];
      stored.syncEnabled = request.syncEnabled;
    } else {
      if (request.generation !== stored.generation) throw new Error('Library replaced; discard this fill');
      const prompt = stored.state.library.prompts.find(p => p.id === request.promptId);
      if (!prompt) throw new Error('Prompt no longer exists');
      // Only the focused UI can acknowledge successful clipboard delivery; clipboard text never crosses this boundary.
      const values = safeClone(reconcileRemembered(prompt, stored.state.remembered[prompt.id] ?? {}));
      for (const variable of prompt.variables) if (variable.rememberLast && Object.hasOwn(request.values, variable.name)) {
        values[variable.name] = request.values[variable.name] ?? '';
      }
      stored.state.remembered[prompt.id] = values;
      stored.state.usage[prompt.id] = { count: (stored.state.usage[prompt.id]?.count ?? 0) + 1, lastUsedAt: deps.now() };
    }
    if (request.type !== 'copied') stored.revision++;
    await writeState(deps.areas.local, stored);
    if (request.type === 'import') await deps.notify({ type: 'library-replaced', generation: stored.generation }).catch(() => undefined);
    return request.type === 'settings' ? { stored, syncPublished: await publishStrategy(deps.areas, stored) } : stored;
  });
  const dispatch = async (request: Request): Promise<Payload> => {
    if ('revision' in request) return mutate(request);
    if (request.type === 'slot') return slot.read();
    if (request.type === 'invocation') {
      const raw = (await deps.session.get('invocation')).invocation;
      return parseInvocation(raw);
    }
    if (request.type === 'capture') {
      const tab = (await deps.windows.getLastFocused({ populate: true, windowTypes: ['normal'] })).tabs?.find(tab => tab.active);
      if (!tab) throw new Error('No active normal tab; open the toolbar on a source tab');
      return slot.capture(tab);
    }
    if (request.type === 'clear-capture') { await slot.clear(); return null; }
    if (request.type === 'tabs') return listTabs(deps, request.query);
    if (request.type === 'search') return search(request.query);
    const stored = await readState(deps.areas.local);
    if (request.type === 'state') return stored;
    if (request.type === 'export') return serializedExport(stored);
    const prompt = stored.state.library.prompts.find(p => p.id === request.promptId);
    if (!prompt) throw new Error('Prompt not found');
    const source = await resolveSource(deps, stored.state.strategy, stored.state.knownChatHosts, request.tabId);
    return { library: stored.state.library, promptId: prompt.id,
      context: { strategy: request.tabId === undefined ? stored.state.strategy : 'tab-picker', source, date: localDate(deps.now()), clipboard: null },
      remembered: safeClone(stored.state.remembered[prompt.id] ?? {}), revision: stored.revision, generation: stored.generation };
  };
  return {
    search,
    handle: async (raw: unknown, sender: Sender): Promise<Response> => {
      let copied = false;
      try {
        if (!trustedSender(sender, deps.extensionId, deps.origin)) throw new Error('Untrusted message sender');
        const request = parseRequest(raw);
        copied = request.type === 'copied';
        return { ok: true, data: await dispatch(request) };
      } catch (error) {
        // Storage/platform errors can include sensitive values; expose only our bounded protocol errors.
        const message = error instanceof Error ? error.message : '';
        const safe = /^(Untrusted message sender$|Invalid|Stale|Library replaced|Prompt|No |Tabs permission|Configure|Choose|Selected tab|Capture requires|Update partial|Fix library)/.test(message);
        return { ok: false, error: copied ? 'Clipboard delivery succeeded, but usage and remembered values were not saved. Do not retry the clipboard write.' : safe ? message : 'Operation failed; storage or browser access is unavailable. No success was recorded.' };
      }
    },
    receiveSync: (): Promise<void> => deps.queue(async () => {
      const stored = await readState(deps.areas.local);
      if (!stored.syncEnabled) return;
      let strategy: unknown;
      try { strategy = (await deps.areas.sync.get('strategy')).strategy; } catch { return; }
      if (!isStrategy(strategy) || strategy === stored.state.strategy) return;
      try { await requireStrategy(strategy, stored.state.knownChatHosts, deps.permissions); } catch { return; }
      const next: StoredState = { ...stored, revision: stored.revision + 1, state: { ...stored.state, strategy } };
      await writeState(deps.areas.local, next);
    }),
  };
}

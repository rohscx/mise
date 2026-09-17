import { createWriteQueue, restrictStorage } from './shell/storage.js';
import { createActivity } from './shell/slot.js';
import { createController } from './shell/controller.js';
import { openPalette } from './shell/palette.js';
import { createEvents } from './shell/events.js';

const areas = { local: chrome.storage.local, session: chrome.storage.session, sync: chrome.storage.sync };
const queue = createWriteQueue();
const now = (): string => new Date().toISOString();
const ready = restrictStorage(areas).catch(() => {
  // Report the protection failure without disabling unrelated worker operations.
  console.error('Storage access restriction failed. Reload the extension to retry.');
  void chrome.action.setBadgeText({ text: '!' }).catch(() => {
    console.error('Storage warning badge could not be displayed.');
  });
});
const controller = createController({ areas, queue, session: areas.session, tabs: chrome.tabs,
  windows: chrome.windows, permissions: chrome.permissions, now, extensionId: chrome.runtime.id,
  notify: async (message): Promise<void> => { await chrome.runtime.sendMessage(message); },
  origin: chrome.runtime.getURL(''), selection: { read: async (tabId: number): Promise<string | null> => {
    const results = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] },
      func: (): string | null => window.getSelection()?.toString() ?? null });
    const result: unknown = results[0]?.result;
    return typeof result === 'string' ? result : null;
  } },
});
const activity = createActivity(areas.session, chrome.permissions, queue);
const events = createEvents(controller, areas.session, queue, {
  badge: (text: string): Promise<void> => chrome.action.setBadgeText({ text }),
  menu: async (): Promise<void> => {
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({ id: 'capture-link', title: 'Capture link for Mise', contexts: ['link'],
      targetUrlPatterns: ['http://*/*', 'https://*/*'] });
  },
  openPalette: (route): Promise<void> => openPalette(chrome.windows, areas.session, queue, chrome.runtime.getURL('palette.html'), route),
}, now);
const run = (operation: () => Promise<unknown>): void => {
  void ready.then(operation).catch(() => chrome.action.setBadgeText({ text: '!' }).catch(() => undefined));
};
chrome.runtime.onMessage.addListener((message: unknown, sender, respond): true => {
  void ready.then(() => controller.handle(message, sender)).then(respond,
    () => respond({ ok: false, error: 'Storage initialization failed' }));
  return true;
});
chrome.runtime.onInstalled.addListener(details => run(async () => {
  try { await events.installed(details.reason); }
  catch (error) {
    console.error('Mise installation failed', error);
    throw error;
  }
}));
chrome.commands.onCommand.addListener(command => run(() => events.command(command)));
chrome.tabs.onActivated.addListener(info => run(() => activity.activated(info.tabId)));
chrome.tabs.onRemoved.addListener(id => run(() => activity.removed(id)));
chrome.permissions.onRemoved.addListener(permissions => {
  if (permissions.permissions?.includes('tabs')) run(() => activity.reset());
});
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'sync') run(() => controller.receiveSync());
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'capture-link' && info.linkUrl) run(() => events.link(info.linkUrl ?? '', tab));
});
chrome.omnibox.onInputChanged.addListener((query, suggest) => {
  void ready.then(() => events.suggestions(query)).then(suggest, () => suggest([]));
});
chrome.omnibox.onInputEntered.addListener(text => run(() => events.entered(text)));

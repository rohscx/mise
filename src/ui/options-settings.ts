import type { StoredState } from '../shell/storage.js';
import type { Request } from '../shared/messages.js';
import { isStrategy } from '../shell/storage.js';
import { button } from './dom.js';
import { check, field, lines, node } from './options-dom.js';

export function renderSettings(parent: HTMLElement, stored: StoredState,
  save: (request: Extract<Request, { type: 'settings' }>) => void, announce: (message: string) => void): void {
  parent.replaceChildren(node('h2', 'Settings'));
  let strategy = stored.state.strategy, hosts = [...stored.state.knownChatHosts], sync = stored.syncEnabled;
  const label = node('label', 'Source strategy'), select = node('select');
  for (const [value, title] of [['capture', 'Explicit capture'], ['last-non-chat', 'Last non-chat tab'], ['tab-picker', 'Explicit tab picker']]) {
    const option = node('option', title); option.value = value ?? ''; select.append(option);
  }
  select.value = strategy; select.addEventListener('change', () => { if (isStrategy(select.value)) strategy = select.value; });
  label.append(select); parent.append(label);
  field(parent, 'Known chat hosts (one exact lowercase hostname per line, no wildcards)', hosts.join('\n'), value => { hosts = lines(value); }, true);
  check(parent, 'Sync source strategy through Chrome (opt in)', sync, value => { sync = value; });
  parent.append(node('p', 'Only the strategy setting syncs. Disabling sync stops reads and writes but does not erase copies on other devices. Tabs permission is required for alternate strategies; last non-chat also requires configured chat hosts.'));
  parent.append(button('Save settings', () => save({ type: 'settings', revision: stored.revision, strategy, knownChatHosts: hosts, syncEnabled: sync })));
  parent.append(node('h3', 'Optional permissions'));
  for (const permission of ['tabs', 'clipboardRead']) {
    parent.append(button(permission === 'tabs' ? 'Enable tabs permission' : 'Enable clipboard reading', () => {
      // Calling request directly in this click handler preserves Chrome's user activation.
      void chrome.permissions.request({ permissions: [permission] }).then(granted => {
        announce(`${permission} permission ${granted ? 'enabled' : 'denied'}.`);
      }).catch(() => announce(`${permission} permission request failed.`));
    }));
  }
  parent.append(node('p', 'Tabs permission exposes other tabs’ URL and title for source selection; it does not grant page-DOM access. Clipboard permission enables an explicit Read clipboard action in a fill; this page never reads it.'));
  parent.append(node('h3', 'Privacy'));
  parent.append(node('p', 'Mise processes prompts, URLs, captured text and remembered inputs on-device. It makes no network requests for content, analytics, errors or model calls. Opted-in settings sync sends the strategy through Chrome’s sync service.'));
  parent.append(node('p', 'Export files and the OS clipboard can expose internal text to other applications or people. Clipboard history or cloud sync may retain or transmit copied text independently of Mise. Pasting into chat shares it with that provider under its policies. Local storage is not promised to be encrypted or securely deleted; uninstall removes local data. Export files are your backups.'));
}

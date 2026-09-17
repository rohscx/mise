export function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag); result.textContent = text; return result;
}
export function field(parent: HTMLElement, label: string, value: string, update: (value: string) => void,
  multiline = false): HTMLInputElement | HTMLTextAreaElement {
  const wrapper = node('label', label);
  const control = multiline ? node('textarea') : node('input');
  control.value = value;
  control.addEventListener('input', () => update(control.value));
  wrapper.append(control); parent.append(wrapper); return control;
}
export function check(parent: HTMLElement, label: string, value: boolean, update: (value: boolean) => void): HTMLInputElement {
  const wrapper = node('label'); wrapper.className = 'check';
  const control = node('input'); control.type = 'checkbox'; control.checked = value;
  control.addEventListener('change', () => update(control.checked));
  wrapper.append(control, document.createTextNode(label)); parent.append(wrapper); return control;
}
export function lines(value: string): string[] { return value.split('\n').filter(v => v.length > 0); }

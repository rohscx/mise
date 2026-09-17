export function element<T extends HTMLElement>(id: string, kind: { new(): T }): T {
  const node = document.getElementById(id);
  if (!(node instanceof kind)) throw new Error(`Missing control: ${id}`);
  return node;
}
export function button(text: string, action: () => void): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button'; node.textContent = text;
  node.addEventListener('click', action);
  return node;
}

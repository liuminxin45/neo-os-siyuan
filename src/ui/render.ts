export const clearElement = (element: HTMLElement): void => {
  while (element.firstChild) {
    element.firstChild.remove();
  }
};

export const createElement = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

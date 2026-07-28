export function blurActiveElement(): void {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
}

export function blurTrigger(element: EventTarget | null): void {
  if (element instanceof HTMLElement) {
    element.blur();
    return;
  }

  blurActiveElement();
}

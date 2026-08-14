export const CONTEXT_MENU_TRIGGER_DATASET = { pcontextmenu: "trigger" } as const;

export function findContextMenuTrigger(elements: readonly Element[]): HTMLElement | null {
  for (const element of elements) {
    const trigger = element.closest('[data-pcontextmenu="trigger"]');
    if (trigger instanceof HTMLElement) {
      return trigger;
    }
  }
  return null;
}

export function getContextMenuTriggerAtPoint(clientX: number, clientY: number): HTMLElement | null {
  return findContextMenuTrigger(document.elementsFromPoint(clientX, clientY));
}

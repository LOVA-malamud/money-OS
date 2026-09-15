import { useEffect, useRef, type RefObject } from 'react';

export function cycleDialogFocus(event: KeyboardEvent, root: HTMLElement | null) {
  if (event.key !== 'Tab' || !root) return;
  const elements = [...root.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(element => element.getClientRects().length > 0);
  event.preventDefault();
  if (!elements.length) { root.focus(); return; }
  const index = elements.indexOf(document.activeElement as HTMLElement);
  elements[index < 0 ? (event.shiftKey ? elements.length - 1 : 0) : (index + (event.shiftKey ? -1 : 1) + elements.length) % elements.length].focus();
}

// Dialogs live outside #root so the background can be inert for touch,
// keyboard and assistive technology. Fixed body locking also works on iOS.
export function useDialog(ref: RefObject<HTMLDivElement | null>, onClose: () => void, busy = false, initialFocus = false) {
  const state = useRef({ onClose, busy });
  state.current = { onClose, busy };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = document.getElementById('root');
    const wasInert = root?.inert ?? false;
    const scrollY = window.scrollY;
    const styles = { position: document.body.style.position, top: document.body.style.top, width: document.body.style.width, overflow: document.body.style.overflow };
    Object.assign(document.body.style, { position: 'fixed', top: `-${scrollY}px`, width: '100%', overflow: 'hidden' });
    if (root) root.inert = true;
    const frame = requestAnimationFrame(() => {
      const target = initialFocus ? ref.current?.querySelector<HTMLElement>('[data-initial-focus], input, select, textarea') ?? ref.current : ref.current;
      target?.focus({ preventScroll: true });
      if (target instanceof HTMLInputElement && target.hasAttribute('data-initial-focus')) target.select();
    });
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !state.current.busy) { event.preventDefault(); state.current.onClose(); }
      cycleDialogFocus(event, ref.current);
    };
    document.addEventListener('keydown', key);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', key);
      Object.assign(document.body.style, styles);
      if (root) root.inert = wasInert;
      window.scrollTo({ top: scrollY, behavior: 'instant' });
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [ref, initialFocus]);
}

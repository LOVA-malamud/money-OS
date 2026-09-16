import { useEffect } from 'react';

export function useMobileViewport() {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    let frame = 0;
    const update = () => {
      // Leave pinch zoom to the browser. Resample when it returns to scale 1.
      if (viewport && viewport.scale !== 1) return;
      const layoutHeight = root.clientHeight;
      const height = Math.min(viewport?.height ?? layoutHeight, layoutHeight);
      // Dismissal can restore height before offsetTop. Bound stale pan values
      // by the actual space remaining in the layout viewport.
      const top = Math.min(Math.max(viewport?.offsetTop ?? 0, 0), Math.max(0, layoutHeight - height));
      root.style.setProperty('--viewport-height', `${height}px`);
      // Absolute portal: convert visual viewport to document coordinates once.
      root.style.setProperty('--viewport-page-top', `${window.scrollY + top}px`);
      root.dataset.keyboard = String(layoutHeight - height > 100);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule);
    window.addEventListener('pageshow', schedule);
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', schedule);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('pageshow', schedule);
      document.removeEventListener('focusin', schedule);
      document.removeEventListener('focusout', schedule);
      root.style.removeProperty('--viewport-height');
      root.style.removeProperty('--viewport-page-top');
      delete root.dataset.keyboard;
    };
  }, []);
}

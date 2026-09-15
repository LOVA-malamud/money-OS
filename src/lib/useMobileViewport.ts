import { useEffect } from 'react';

export function useMobileViewport() {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const update = () => {
      // Do not counteract pinch zoom. Only follow the keyboard's visual viewport.
      if (viewport && viewport.scale === 1) {
        root.style.setProperty('--viewport-height', `${viewport.height}px`);
        root.style.setProperty('--viewport-top', `${viewport.offsetTop}px`);
        root.dataset.keyboard = String(window.innerHeight - viewport.height > 100);
      }
    };
    update();
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      root.style.removeProperty('--viewport-height');
      root.style.removeProperty('--viewport-top');
      delete root.dataset.keyboard;
    };
  }, []);
}

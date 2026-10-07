import { useLayoutEffect, type RefObject } from "react";

export function usePureNoteSize(root: RefObject<HTMLElement | null>, active: boolean, onError: () => void, minimumHeight: number): void {
  useLayoutEffect(() => {
    const shell = root.current;
    if (!active || !shell) return;
    let frame = 0;
    let disposed = false;
    let pending: number | null = null;
    let sending = false;
    let lastHeight = 0;
    const send = async (): Promise<void> => {
      if (sending) return;
      sending = true;
      try {
        while (!disposed && pending !== null) {
          const height = pending;
          pending = null;
          await window.desktopTabs.fitNoteContent(height);
        }
      } catch { if (!disposed) onError(); }
      finally { sending = false; }
    };
    const measure = (): void => {
      frame = 0;
      const page = shell.querySelector<HTMLElement>(".note-page");
      if (!page) return;
      const feedback = shell.querySelector<HTMLElement>(".feedback-stack");
      if (feedback) observer.observe(feedback);
      const feedbackStyle = feedback ? getComputedStyle(feedback) : null;
      const gutter = parseFloat(getComputedStyle(document.getElementById("root")!).paddingTop) || 0;
      const height = Math.max(minimumHeight, Math.ceil(page.getBoundingClientRect().height + (feedback ? feedback.getBoundingClientRect().height
        + parseFloat(feedbackStyle!.marginTop) + parseFloat(feedbackStyle!.marginBottom) : 0) + 2 * gutter));
      if (height === lastHeight) return;
      lastHeight = height;
      pending = height;
      void send();
    };
    const schedule = (): void => { if (!frame) frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    const page = shell.querySelector(".note-page");
    if (page) observer.observe(page);
    const mutations = new MutationObserver(schedule);
    mutations.observe(shell, { childList: true, subtree: true });
    const resize = (): void => { lastHeight = 0; schedule(); };
    window.addEventListener("resize", resize);
    schedule();
    return () => { disposed = true; cancelAnimationFrame(frame); observer.disconnect(); mutations.disconnect(); window.removeEventListener("resize", resize); };
  }, [root, active, onError, minimumHeight]);
}

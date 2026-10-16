import { useLayoutEffect, type RefObject } from 'react';

/**
 * Grows a text box with what's typed in it, so a long message or post can be read back while it's
 * written instead of scrolling inside one line. Its CSS `max-height` caps it; past that it scrolls.
 * Measured again when the text changes and when the box's width does (a narrower window wraps
 * more lines). The message box, the feed's post box, comments and the edit boxes all use it.
 */
export function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>, value: string): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) fit(el);
  }, [ref, value]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      // Only a change of width re-wraps the text; fit() itself changes the height.
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fit(el);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
}

/** Sets the box's height to its content's: `auto` first, so it can shrink again too. */
function fit(el: HTMLTextAreaElement): void {
  el.style.height = 'auto';
  // scrollHeight leaves out the border, which a border-box height includes.
  const border = el.offsetHeight - el.clientHeight;
  el.style.height = `${el.scrollHeight + border}px`;
}

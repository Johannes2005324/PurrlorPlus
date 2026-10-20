import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useBackCloses } from '../app/navigationHistory';
import './Lightbox.css';

const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 30;
/** A pointer moving further than this is a drag, not a tap: it doesn't close the viewer. */
const TAP_SLOP = 6;

type View = { scale: number; x: number; y: number };
type Point = { x: number; y: number };
const AT_REST: View = { scale: 1, x: 0, y: 0 };

/** Full-screen in-app image viewer — click the backdrop, the close button, press Escape, or Back.
 *  Portalled out like Modal.tsx: an ancestor with a transform, filter or backdrop-filter would
 *  otherwise become what its `position: fixed` is relative to, and it would fill only that box.
 *
 *  Zooms in on its own: the app turns the browser's pinch zoom off (index.html's viewport, and a
 *  page that never scrolls on a phone), which left no way to look closer at a picture. Pinch, or
 *  double-tap, to zoom; drag to move around; the wheel or a trackpad pinch on a computer. */
export function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useBackCloses(onClose);
  useEffect(() => {
    const onKeyDown = (evt: KeyboardEvent) => {
      if (evt.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const zoom = usePinchZoom();

  const lightbox = (
    <div
      className="nu-lightbox"
      data-nu-role="lightbox"
      ref={zoom.stageRef}
      onClick={onClose}
      onClickCapture={zoom.onClickCapture}
      onPointerDown={zoom.onPointerDown}
      onPointerMove={zoom.onPointerMove}
      onPointerUp={zoom.onPointerUp}
      onPointerCancel={zoom.onPointerUp}
    >
      <button
        type="button"
        className="nu-lightbox__close"
        data-nu-role="lightbox-close"
        onClick={onClose}
        onPointerDown={(evt) => evt.stopPropagation()}
        aria-label="Close"
      >
        ×
      </button>
      <img
        ref={zoom.imageRef}
        className={zoom.view.scale > 1 ? 'nu-lightbox__image nu-lightbox__image--zoomed' : 'nu-lightbox__image'}
        src={src}
        alt={alt}
        draggable={false}
        style={{ transform: `translate(${zoom.view.x}px, ${zoom.view.y}px) scale(${zoom.view.scale})` }}
        data-nu-zoom={zoom.view.scale.toFixed(2)}
        onClick={(evt) => evt.stopPropagation()}
      />
    </div>
  );
  return createPortal(lightbox, document.getElementById('portalContainer') ?? document.body);
}

/**
 * Pinch, drag, double-tap and wheel zoom for one image in a stage, as a translate and a scale about
 * the image's centre. `x`/`y` are how far the image's centre has moved from the stage's.
 */
function usePinchZoom() {
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [view, setViewState] = useState<View>(AT_REST);
  const viewRef = useRef(view);
  const pointers = useRef(new Map<number, Point>());
  // Where the current gesture started: the view then, and the pinch's spread and midpoint (or the
  // one finger's place), so each move is worked out from the start rather than piling up errors.
  const gesture = useRef<{ view: View; spread: number; mid: Point } | null>(null);
  const moved = useRef(false);
  const lastTap = useRef<{ at: number; point: Point } | null>(null);

  const setView = (next: View) => {
    const clamped = clamp(next);
    viewRef.current = clamped;
    setViewState(clamped);
  };

  // Never smaller than the fitted picture, and never dragged so far that its edge comes in past the
  // stage's (on an axis where it's bigger than the stage; centred on one where it isn't).
  const clamp = (next: View): View => {
    const scale = Math.min(MAX_SCALE, Math.max(1, next.scale));
    if (scale <= 1.001) return AT_REST;
    const stage = stageRef.current?.getBoundingClientRect();
    const image = imageRef.current;
    if (!stage || !image) return { scale, x: next.x, y: next.y };
    const maxX = Math.max(0, (image.offsetWidth * scale - stage.width) / 2);
    const maxY = Math.max(0, (image.offsetHeight * scale - stage.height) / 2);
    return { scale, x: Math.min(maxX, Math.max(-maxX, next.x)), y: Math.min(maxY, Math.max(-maxY, next.y)) };
  };

  /** A point on screen, from the stage's centre. */
  const fromCentre = (clientX: number, clientY: number): Point => {
    const stage = stageRef.current?.getBoundingClientRect();
    if (!stage) return { x: 0, y: 0 };
    return { x: clientX - (stage.left + stage.width / 2), y: clientY - (stage.top + stage.height / 2) };
  };

  /** Scaled from `from` to `scale` keeping the picture's point that was under `anchor` (as of
   *  `from`) under `to`. */
  const zoomed = (from: View, scale: number, anchor: Point, to: Point = anchor): View => {
    const ratio = scale / from.scale;
    return { scale, x: to.x - (anchor.x - from.x) * ratio, y: to.y - (anchor.y - from.y) * ratio };
  };

  const startGesture = () => {
    const points = [...pointers.current.values()];
    if (points.length === 0) {
      gesture.current = null;
      return;
    }
    const [a, b] = points;
    gesture.current = {
      view: viewRef.current,
      spread: b ? Math.hypot(b.x - a.x, b.y - a.y) : 0,
      mid: b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a,
    };
  };

  const onPointerDown = (evt: ReactPointerEvent<HTMLDivElement>) => {
    if (pointers.current.size === 0) moved.current = false;
    pointers.current.set(evt.pointerId, fromCentre(evt.clientX, evt.clientY));
    // A second finger is a pinch, never a tap.
    if (pointers.current.size > 1) moved.current = true;
    startGesture();
  };

  const onPointerMove = (evt: ReactPointerEvent<HTMLDivElement>) => {
    const start = gesture.current;
    if (!pointers.current.has(evt.pointerId) || !start) return;
    const point = fromCentre(evt.clientX, evt.clientY);
    pointers.current.set(evt.pointerId, point);
    const [a, b] = [...pointers.current.values()];
    if (b) {
      const spread = Math.hypot(b.x - a.x, b.y - a.y);
      if (start.spread > 0) {
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        setView(zoomed(start.view, start.view.scale * (spread / start.spread), start.mid, mid));
      }
      return;
    }
    const dx = point.x - start.mid.x;
    const dy = point.y - start.mid.y;
    if (Math.hypot(dx, dy) > TAP_SLOP) moved.current = true;
    if (start.view.scale > 1) setView({ ...start.view, x: start.view.x + dx, y: start.view.y + dy });
  };

  const onPointerUp = (evt: ReactPointerEvent<HTMLDivElement>) => {
    const point = pointers.current.get(evt.pointerId);
    if (!point) return;
    pointers.current.delete(evt.pointerId);
    // The fingers left carry on from where things are now.
    startGesture();
    if (pointers.current.size > 0 || moved.current || evt.type === 'pointercancel') return;
    // A tap. The second of two close together zooms in there, or back out.
    const now = Date.now();
    const previous = lastTap.current;
    if (
      previous &&
      now - previous.at < DOUBLE_TAP_MS &&
      Math.hypot(point.x - previous.point.x, point.y - previous.point.y) < DOUBLE_TAP_SLOP
    ) {
      lastTap.current = null;
      moved.current = true; // not a click that closes the viewer
      const current = viewRef.current;
      setView(current.scale > 1 ? AT_REST : zoomed(current, DOUBLE_TAP_SCALE, point));
      return;
    }
    lastTap.current = { at: now, point };
  };

  // A drag, a pinch or a double-tap ends in a click like any other: it isn't one that closes.
  const onClickCapture = (evt: ReactMouseEvent) => {
    if (!moved.current) return;
    moved.current = false;
    evt.stopPropagation();
  };

  // The wheel, and a trackpad's pinch (a wheel with Ctrl held), zoom toward the pointer. Not
  // through React: its wheel listener is passive, and Ctrl+wheel would zoom the whole page too.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const onWheel = (evt: WheelEvent) => {
      evt.preventDefault();
      const current = viewRef.current;
      const scale = current.scale * Math.exp(-evt.deltaY * (evt.ctrlKey ? 0.01 : 0.002));
      setView(zoomed(current, scale, fromCentre(evt.clientX, evt.clientY)));
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
    // setView/zoomed/fromCentre read only refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { stageRef, imageRef, view, onPointerDown, onPointerMove, onPointerUp, onClickCapture };
}

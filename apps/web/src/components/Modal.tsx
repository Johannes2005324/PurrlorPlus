import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useBackCloses } from '../app/navigationHistory';
import './Modal.css';

type ModalProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Wider panel for content that needs more room — a message thread, say — than the default
   *  420px (used by settings-style forms/lists). */
  wide?: boolean;
};

/** Shared centered-panel overlay — click the backdrop, the close button, press Escape, or Back
 *  (app/navigationHistory.ts; the phone's Back button in the Android app). */
export function Modal({ title, onClose, children, wide }: ModalProps) {
  useBackCloses(onClose);
  useEffect(() => {
    const onKeyDown = (evt: KeyboardEvent) => {
      if (evt.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Portaled into #portalContainer (a sibling of #root, see index.html) rather than rendered
  // inline — a modal can be opened from deep inside the composer's own <form> (e.g. the emoji/
  // emote picker's "Manage Emotes & Stickers"), and a modal with its own <form> (most settings
  // screens) would otherwise land physically nested inside that outer form: invalid HTML that
  // makes browsers mishandle which form a submit button's click actually belongs to entirely,
  // bypassing React's onSubmit and falling through to a real (broken) native GET navigation.
  // React's event system still dispatches through the *logical* tree regardless of the portal,
  // so onClose/onClick here work exactly as if this were rendered inline.
  const portalTarget = document.getElementById('portalContainer');
  const modal = (
    <div className="nu-modal" data-nu-role="modal" onClick={onClose}>
      <div
        className={wide ? 'nu-modal__panel nu-modal__panel--wide' : 'nu-modal__panel'}
        onClick={(evt) => evt.stopPropagation()}
      >
        <div className="nu-modal__header">
          <h2 className="nu-modal__title">{title}</h2>
          <button
            type="button"
            className="nu-modal__close"
            data-nu-role="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="nu-modal__body">{children}</div>
      </div>
    </div>
  );
  return portalTarget ? createPortal(modal, portalTarget) : modal;
}

import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { updateOwnPresence, type UserPresence } from '../../matrix/account';
import './StatusMenu.css';

const PRESENCE_OPTIONS: { value: UserPresence; label: string; hint: string }[] = [
  { value: 'online', label: 'Online', hint: 'Show that you’re around' },
  { value: 'unavailable', label: 'Away', hint: 'Around, but not watching' },
  { value: 'offline', label: 'Invisible', hint: 'Appear offline to everyone' },
];

/** Popover for changing presence in one click, instead of digging through Account Settings.
 *  The status *message* stays in Account Settings; this is the fast path for the common case. */
export function StatusMenu({
  current,
  onClose,
  onViewProfile,
  onEditProfile,
  style,
}: {
  current: string | undefined;
  onClose: () => void;
  onViewProfile: () => void;
  onEditProfile: () => void;
  /** Where it sits (position: fixed), set by whatever opened it. */
  style?: React.CSSProperties;
}) {
  const mx = useMatrixClient();
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const choose = (presence: UserPresence) => {
    updateOwnPresence(mx, presence)
      .then(onClose)
      .catch((err) => setError(err instanceof Error ? err.message : 'Couldn’t change your status'));
  };

  return (
    <div className="nu-status-menu__menu" data-nu-role="status-menu-menu" role="menu" ref={ref} style={style}>
      <button type="button" role="menuitem" className="nu-status-menu__menu-item" data-nu-role="status-menu-view-profile" onClick={onViewProfile}>
        <Icon name="users" size={14} />
        <span className="nu-status-menu__menu-label">View profile</span>
      </button>
      <div className="nu-status-menu__menu-divider" />
      {PRESENCE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="menuitemradio"
          aria-checked={current === option.value}
          className="nu-status-menu__menu-item"
          data-nu-role="status-menu-option"
          onClick={() => choose(option.value)}
        >
          <span className={`nu-status-menu__menu-dot nu-status-menu__menu-dot--${option.value}`} aria-hidden="true" />
          <span className="nu-status-menu__menu-text">
            <span className="nu-status-menu__menu-label">{option.label}</span>
            <span className="nu-status-menu__menu-hint">{option.hint}</span>
          </span>
        </button>
      ))}
      {error && <p className="nu-status-menu__menu-error">{error}</p>}
      <div className="nu-status-menu__menu-divider" />
      <button type="button" role="menuitem" className="nu-status-menu__menu-item" data-nu-role="status-menu-edit-profile" onClick={onEditProfile}>
        <Icon name="pencil" size={14} />
        <span className="nu-status-menu__menu-label">Edit profile</span>
      </button>
    </div>
  );
}


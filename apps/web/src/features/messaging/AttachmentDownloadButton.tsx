import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { saveAttachment, type AttachmentSource } from '../../matrix/hooks/useAttachmentUrl';
import './AttachmentDownloadButton.css';

/** Saves a video or audio attachment under its own name. Takes the place of the player's built-in
 *  download, which can't send the token (see saveAttachment). */
export function AttachmentDownloadButton({ source, name, className }: { source: AttachmentSource; name: string; className?: string }) {
  const mx = useMatrixClient();
  const [state, setState] = useState<'idle' | 'saving' | 'failed'>('idle');

  const save = () => {
    if (state === 'saving') return;
    setState('saving');
    saveAttachment(mx, source, name).then(
      () => setState('idle'),
      () => setState('failed')
    );
  };

  const label = state === 'saving' ? `Downloading ${name}…` : state === 'failed' ? `Couldn't download ${name}. Try again` : `Download ${name}`;
  return (
    <button
      type="button"
      className={`nu-attachment-download${className ? ` ${className}` : ''}`}
      data-nu-role="attachment-download"
      title={label}
      aria-label={label}
      disabled={state === 'saving'}
      onClick={save}
    >
      <Icon name="download" size={16} />
      {state === 'failed' && <span className="nu-attachment-download__failed">Failed</span>}
    </button>
  );
}

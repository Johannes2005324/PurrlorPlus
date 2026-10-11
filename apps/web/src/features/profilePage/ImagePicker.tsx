import { useState, type ChangeEvent } from 'react';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { useMediaUrl } from '../../matrix/hooks/useMediaUrl';
import { PAGE_IMAGE_TYPES, uploadPageImage } from '../../matrix/profilePageStore';

/** One small preview of an uploaded page image. */
export function ImageThumb({ mxc, onRemove }: { mxc: string; onRemove?: () => void }) {
  const src = useMediaUrl(mxc, { width: 160, height: 160, method: 'crop' });
  return (
    <span className="nu-page-editor__thumb">
      {src && <img src={src} alt="" />}
      {onRemove && (
        <button type="button" className="nu-page-editor__thumb-remove" aria-label="Remove image" onClick={onRemove}>
          ✕
        </button>
      )}
    </span>
  );
}

/**
 * "Upload…" for page images: uploads straight away and hands back mxc:// URLs, one per file.
 * `multiple` lets a gallery take several at once, up to `max`.
 */
export function ImagePicker({
  label,
  multiple = false,
  max = 1,
  disabled = false,
  onUploaded,
}: {
  label: string;
  multiple?: boolean;
  max?: number;
  disabled?: boolean;
  onUploaded: (mxcUrls: string[]) => void;
}) {
  const mx = useMatrixClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();

  const onChange = async (evt: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(evt.target.files ?? []);
    const files = picked.slice(0, Math.max(0, max));
    evt.target.value = '';
    setNote(picked.length > files.length ? `Only ${files.length} more ${files.length === 1 ? 'fits' : 'fit'}, so the other ${picked.length - files.length} weren’t added.` : undefined);
    if (files.length === 0) return;
    setBusy(true);
    setError(undefined);
    try {
      const urls: string[] = [];
      for (const file of files) urls.push(await uploadPageImage(mx, file));
      onUploaded(urls);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That image couldn’t be uploaded.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="nu-page-editor__picker">
      <label className={`nu-button nu-button--secondary nu-file-picker${disabled || busy ? ' nu-page-editor__disabled' : ''}`}>
        {busy ? 'Uploading…' : label}
        <input
          type="file"
          accept={PAGE_IMAGE_TYPES.join(',')}
          multiple={multiple}
          disabled={disabled || busy}
          onChange={(evt) => void onChange(evt)}
        />
      </label>
      {note && <span className="nu-field__hint">{note}</span>}
      {error && <span className="nu-field__error">{error}</span>}
    </span>
  );
}

import { useState, type FormEvent } from 'react';
import { useSetAtom } from 'jotai';
import { selectedRoomIdAtom, selectedSpaceIdAtom, profileUserIdAtom, railSectionAtom } from '../../app/state/selection';
import { Modal } from '../../components/Modal';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { COMMISSION_LIMITS, sendCommissionRequest, type CommissionType } from '../../matrix/commissions';
import { handleFor } from '../../matrix/roles';

/**
 * "Request a commission": the filled-in form goes to the artist as an encrypted DM, which opens so
 * you can carry on the conversation there. Purrlor takes no payments.
 */
export function CommissionRequestModal({ artistId, types, onClose }: { artistId: string; types: CommissionType[]; onClose: () => void }) {
  const mx = useMatrixClient();
  const setSpaceId = useSetAtom(selectedSpaceIdAtom);
  const setRoomId = useSetAtom(selectedRoomIdAtom);
  const setRailSection = useSetAtom(railSectionAtom);
  const setProfileUserId = useSetAtom(profileUserIdAtom);
  const [typeId, setTypeId] = useState(types[0]?.id ?? '');
  const [description, setDescription] = useState('');
  const [references, setReferences] = useState('');
  const [budget, setBudget] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (evt: FormEvent) => {
    evt.preventDefault();
    if (sending) return;
    setSending(true);
    setError(undefined);
    try {
      const type = types.find((t) => t.id === typeId);
      const roomId = await sendCommissionRequest(mx, artistId, { typeName: type ? `${type.name} (${type.price})` : undefined, description, references, budget });
      setProfileUserId(null);
      setSpaceId(null);
      setRoomId(roomId);
      setRailSection('messages');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t send your request');
      setSending(false);
    }
  };

  return (
    <Modal title={`Request a commission from ${handleFor(artistId)}`} onClose={onClose}>
      <form className="nu-modal-form" onSubmit={(evt) => void submit(evt)} data-nu-role="commission-request-form">
        {types.length > 0 && (
          <label className="nu-field">
            Type
            <select className="nu-field__input" value={typeId} onChange={(evt) => setTypeId(evt.target.value)}>
              {types.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name} · {type.price}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="nu-field">
          What would you like?
          <textarea
            className="nu-field__input nu-field__textarea"
            rows={5}
            maxLength={COMMISSION_LIMITS.request}
            value={description}
            onChange={(evt) => setDescription(evt.target.value)}
            data-nu-role="commission-request-description"
            required
            autoFocus
          />
        </label>
        <label className="nu-field">
          References (optional)
          <input className="nu-field__input" value={references} onChange={(evt) => setReferences(evt.target.value)} placeholder="Links to pictures or a ref sheet" />
        </label>
        <label className="nu-field">
          Budget (optional)
          <input className="nu-field__input" value={budget} maxLength={40} onChange={(evt) => setBudget(evt.target.value)} />
        </label>
        <p className="nu-field__hint">Sent as an encrypted message to {handleFor(artistId)}. Purrlor takes no payments: they’ll tell you how to pay.</p>
        {error && <p className="nu-field__error">{error}</p>}
        <div className="nu-form-actions">
          <button type="button" className="nu-button nu-button--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="nu-button nu-button--primary" disabled={sending || !description.trim()} data-nu-role="commission-request-send">
            {sending ? 'Sending…' : 'Send request'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

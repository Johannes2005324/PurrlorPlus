import { useState, type FormEvent } from 'react';
import type { MatrixClient, SearchResult } from 'matrix-js-sdk';
import { useSetAtom } from 'jotai';
import { pendingJumpTargetAtom, selectedRoomIdAtom, selectedSpaceIdAtom, railSectionAtom } from '../../app/state/selection';
import { Modal } from '../../components/Modal';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { searchMessages } from '../../matrix/search';
import { findParentSpaceId } from '../../matrix/spaceChildren';
import './MessageSearchModal.css';

function ResultRow({ mx, result, showRoomName, onOpen }: { mx: MatrixClient; result: SearchResult; showRoomName: boolean; onOpen: () => void }) {
  const event = result.context.ourEvent;
  const senderName = event.sender?.name ?? event.getSender() ?? '?';
  const roomName = showRoomName ? mx.getRoom(event.getRoomId() ?? '')?.name : undefined;
  return (
    <button type="button" className="nu-search-result" data-nu-role="search-result" onClick={onOpen}>
      <div className="nu-search-result__meta">
        <span className="nu-search-result__sender">{senderName}</span>
        {roomName && <span className="nu-search-result__room">in {roomName}</span>}
        <span className="nu-search-result__time">{new Date(event.getTs()).toLocaleString()}</span>
      </div>
      <div className="nu-search-result__body">{String(event.getContent().body ?? '')}</div>
    </button>
  );
}

/**
 * Server-side `/search` over message bodies — see matrix/search.ts. A result takes you to the
 * room the match is in and asks MessageTimeline (via pendingJumpTargetAtom) to scroll to and
 * highlight the exact message once it can show it, backfilling further history first if the
 * match is older than what's currently loaded.
 */
export function MessageSearchModal({ roomId, onClose }: { roomId: string | null; onClose: () => void }) {
  const mx = useMatrixClient();
  const setSelectedRoomId = useSetAtom(selectedRoomIdAtom);
  const setRailSection = useSetAtom(railSectionAtom);
  const setSelectedSpaceId = useSetAtom(selectedSpaceIdAtom);
  const setPendingJump = useSetAtom(pendingJumpTargetAtom);
  const [term, setTerm] = useState('');
  const [scopeToRoom, setScopeToRoom] = useState(!!roomId);
  const [results, setResults] = useState<SearchResult[]>();
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string>();

  const handleSearch = async (evt: FormEvent) => {
    evt.preventDefault();
    const trimmed = term.trim();
    if (!trimmed || searching) return;
    setSearching(true);
    setError(undefined);
    try {
      const found = await searchMessages(mx, trimmed, scopeToRoom && roomId ? roomId : undefined);
      setResults(found);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const handleOpenResult = (result: SearchResult) => {
    const targetRoomId = result.context.ourEvent.getRoomId();
    const targetEventId = result.context.ourEvent.getId();
    if (!targetRoomId || !targetEventId) return;
    setSelectedSpaceId(findParentSpaceId(mx, targetRoomId));
    setSelectedRoomId(targetRoomId);
    setRailSection('messages');
    setPendingJump({ roomId: targetRoomId, eventId: targetEventId });
    onClose();
  };

  return (
    <Modal title="Search Messages" onClose={onClose} wide>
      <form className="nu-modal-form" onSubmit={handleSearch}>
        <label className="nu-field">
          Search term
          <input
            className="nu-field__input"
            data-nu-role="message-search-input"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            autoFocus
            required
          />
        </label>
        {roomId && (
          <label className="nu-field__checkbox-row">
            <input type="checkbox" checked={scopeToRoom} onChange={(e) => setScopeToRoom(e.target.checked)} />
            This channel only
          </label>
        )}
        {error && (
          <p className="nu-field__error" data-nu-role="message-search-error">
            {error}
          </p>
        )}
        <div className="nu-form-actions">
          <button type="submit" className="nu-button nu-button--primary" disabled={!term.trim() || searching}>
            {searching ? 'Searching…' : 'Search'}
          </button>
        </div>
      </form>
      {results && (
        <div className="nu-search-results" data-nu-role="message-search-results">
          {results.length === 0 ? (
            <p className="nu-search-results__empty">No messages found.</p>
          ) : (
            results.map((result) => (
              <ResultRow
                key={result.context.ourEvent.getId()}
                mx={mx}
                result={result}
                showRoomName={!(scopeToRoom && roomId)}
                onOpen={() => handleOpenResult(result)}
              />
            ))
          )}
        </div>
      )}
    </Modal>
  );
}

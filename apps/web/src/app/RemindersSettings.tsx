import { useState } from 'react';
import { useSetAtom } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { pendingJumpTargetAtom, selectedRoomIdAtom, selectedSpaceIdAtom, selectedSpaceViewAtom, railSectionAtom } from './state/selection';
import { useMatrixClient } from '../matrix/MatrixClientContext';
import { readCalendarEvents, readOwnRsvp, setRsvp, upcomingEvents, type CalendarEvent } from '../matrix/calendar';
import { useReminders } from '../matrix/hooks/useReminders';
import { useSpaces } from '../matrix/hooks/useSpaces';
import { EVENT_REMINDER_LEAD_MS, removeReminder, type MessageReminder } from '../matrix/reminders';
import { findParentSpaceId } from '../matrix/spaceChildren';

const when = (ts: number) => new Date(ts).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Events you're going to that haven't finished, each with its Space (they remind you 15 minutes before). */
function goingEvents(spaces: Room[], myUserId: string): { space: Room; event: CalendarEvent }[] {
  return spaces
    .flatMap((space) => upcomingEvents(readCalendarEvents(space)).map((event) => ({ space, event })))
    .filter(({ space, event }) => readOwnRsvp(space, myUserId, event.id) === 'going')
    .sort((a, b) => a.event.start - b.event.start);
}

/**
 * Account Settings → Reminders: what's going to remind you, and a way to cancel it. Message
 * reminders (matrix/reminders.ts) are cancelled outright; an event's reminder comes from your RSVP,
 * so cancelling it means no longer going. Both stop for every device, since both are account data
 * or Space state.
 */
export function RemindersSettings({ onClose }: { onClose: () => void }) {
  const mx = useMatrixClient();
  const myUserId = mx.getUserId() ?? '';
  const reminders = useReminders();
  const spaces = useSpaces();
  const events = goingEvents(spaces, myUserId);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const setSelectedSpaceId = useSetAtom(selectedSpaceIdAtom);
  const setSelectedRoomId = useSetAtom(selectedRoomIdAtom);
  const setRailSection = useSetAtom(railSectionAtom);
  const setSpaceView = useSetAtom(selectedSpaceViewAtom);
  const setPendingJump = useSetAtom(pendingJumpTargetAtom);

  const run = async (id: string, action: () => Promise<void>) => {
    setBusy(id);
    setError(undefined);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t cancel that');
    } finally {
      setBusy(undefined);
    }
  };

  const openMessage = (reminder: MessageReminder) => {
    setSpaceView(null);
    setSelectedSpaceId(findParentSpaceId(mx, reminder.roomId));
    setSelectedRoomId(reminder.roomId);
    setRailSection('messages');
    setPendingJump({ roomId: reminder.roomId, eventId: reminder.eventId });
    onClose();
  };

  return (
    <div className="nu-reminders-settings" data-nu-role="reminders-settings">
      <h3 className="nu-reminders-settings__heading">Messages</h3>
      {reminders.length === 0 ? (
        <p className="nu-field__hint" data-nu-role="reminders-empty">
          Nothing set. Use a message’s bell to be reminded about it.
        </p>
      ) : (
        <ul className="nu-reminders-settings__list">
          {reminders.map((reminder) => (
            <li key={reminder.id} className="nu-reminders-settings__item" data-nu-role="reminders-item">
              <div className="nu-reminders-settings__text">
                <strong>{when(reminder.remindAt)}</strong>
                <span>
                  {reminder.preview || 'A message'} · #{mx.getRoom(reminder.roomId)?.name ?? 'a channel you’ve left'}
                </span>
              </div>
              <button type="button" className="nu-button nu-button--secondary" disabled={!mx.getRoom(reminder.roomId)} onClick={() => openMessage(reminder)}>
                Open
              </button>
              <button
                type="button"
                className="nu-button nu-button--secondary"
                data-nu-role="reminders-cancel"
                disabled={busy === reminder.id}
                onClick={() => void run(reminder.id, () => removeReminder(mx, reminder.id))}
              >
                Cancel
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3 className="nu-reminders-settings__heading">Events you’re going to</h3>
      {events.length === 0 ? (
        <p className="nu-field__hint">None. Say you’re going to an event and it reminds you {EVENT_REMINDER_LEAD_MS / 60_000} minutes before.</p>
      ) : (
        <ul className="nu-reminders-settings__list">
          {events.map(({ space, event }) => (
            <li key={event.id} className="nu-reminders-settings__item" data-nu-role="reminders-event">
              <div className="nu-reminders-settings__text">
                <strong>{event.title}</strong>
                <span>
                  {space.name} · reminds you at {when(event.start - EVENT_REMINDER_LEAD_MS)}
                </span>
              </div>
              <button
                type="button"
                className="nu-button nu-button--secondary"
                data-nu-role="reminders-not-going"
                disabled={busy === event.id}
                onClick={() => void run(event.id, () => setRsvp(mx, space, event.id, undefined))}
              >
                Not going
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="nu-field__error">{error}</p>}
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { useSetAtom } from 'jotai';
import { ClientEvent, RoomStateEvent, type MatrixEvent } from 'matrix-js-sdk';
import { pendingJumpTargetAtom, selectedRoomIdAtom, selectedSpaceIdAtom, selectedSpaceViewAtom, railSectionAtom } from '../../app/state/selection';
import { Icon } from '../../components/Icon';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { CALENDAR_EVENT, readCalendarEvents, readOwnRsvp } from '../../matrix/calendar';
import {
  dueReminders,
  EVENT_REMINDER_LEAD_MS,
  readReminders,
  REMINDERS_ACCOUNT_DATA,
  removeReminder,
} from '../../matrix/reminders';
import { findParentSpaceId } from '../../matrix/spaceChildren';
import { PUSH_GATEWAY_ACCOUNT_DATA_EVENT } from '../../matrix/push';
import { syncRemindersToGateway } from '../../matrix/reminderPush';
import { useJoinVoiceChannel } from '../calendar/useJoinVoiceChannel';
import './ReminderWatcher.css';

/** Event reminders already shown on this device, so a reload doesn't show them again. */
const SHOWN_KEY = 'nekous_event_reminders_shown';

function readShown(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SHOWN_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function markShown(id: string) {
  try {
    // Only the recent ones matter: an event's reminder can't come round again once it's started.
    const shown = [...readShown(), id].slice(-200);
    localStorage.setItem(SHOWN_KEY, JSON.stringify(shown));
  } catch {
    // Storage unavailable: at worst the reminder shows again after a reload.
  }
}

type Toast =
  | { kind: 'message'; key: string; reminderId: string; roomId: string; eventId: string; text: string }
  | { kind: 'event'; key: string; spaceId: string; title: string; start: number }
  /** A watch party's start: the same reminder at zero minutes, with a button that joins its channel. */
  | { kind: 'party'; key: string; channelId: string; title: string };

/**
 * Shows reminders when they're due (matrix/reminders.ts): "remind me about this message" ones
 * from account data, and calendar events you're going to, 15 minutes before they start. Each
 * comes up as a card in the corner, and as a desktop notification when the browser allows them.
 * A message reminder is removed from account data once shown, so other devices don't show it too.
 * With a push gateway set up, the same reminders are handed to it (matrix/reminderPush.ts), so they
 * also arrive as Web Push when no tab is open. Mounted once in AppShell.
 */
export function ReminderWatcher() {
  const mx = useMatrixClient();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const setSelectedSpaceId = useSetAtom(selectedSpaceIdAtom);
  const setSelectedRoomId = useSetAtom(selectedRoomIdAtom);
  const setRailSection = useSetAtom(railSectionAtom);
  const setSpaceView = useSetAtom(selectedSpaceViewAtom);
  const setPendingJump = useSetAtom(pendingJumpTargetAtom);
  const joinVoiceChannel = useJoinVoiceChannel();

  const show = useCallback((toast: Toast, body: string) => {
    setToasts((current) => (current.some((t) => t.key === toast.key) ? current : [...current, toast]));
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification('Reminder', { body, tag: toast.key });
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = () => {
      clearTimeout(timer);
      const now = Date.now();
      const nextTimes: number[] = [];

      const messages = dueReminders(readReminders(mx), now);
      if (messages.nextAt) nextTimes.push(messages.nextAt);
      for (const reminder of messages.due) {
        show(
          { kind: 'message', key: `message:${reminder.id}`, reminderId: reminder.id, roomId: reminder.roomId, eventId: reminder.eventId, text: reminder.preview },
          reminder.preview || 'A message you asked to be reminded about'
        );
        removeReminder(mx, reminder.id).catch(() => undefined);
      }

      const shown = readShown();
      const myUserId = mx.getUserId() ?? '';
      for (const space of mx.getRooms().filter((room) => room.isSpaceRoom() && room.getMyMembership() === 'join')) {
        for (const event of readCalendarEvents(space)) {
          if (readOwnRsvp(space, myUserId, event.id) !== 'going') continue;
          const remindAt = event.start - EVENT_REMINDER_LEAD_MS;
          const key = `event:${event.id}`;
          if (shown.has(key)) continue;
          // Not for an event that's well under way: opening the app an hour in isn't the moment.
          if (now >= remindAt && now < event.start + 10 * 60 * 1000) {
            markShown(key);
            const when = new Date(event.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
            show({ kind: 'event', key, spaceId: space.roomId, title: event.title, start: event.start }, `${event.title} starts at ${when}`);
          } else if (now < remindAt) {
            nextTimes.push(remindAt);
          }
          // A watch party also pings when it starts, with a way straight in.
          const startKey = `event-start:${event.id}`;
          if (event.watch && event.channelId && !shown.has(startKey)) {
            if (now >= event.start && now < event.start + 10 * 60 * 1000) {
              markShown(startKey);
              show({ kind: 'party', key: startKey, channelId: event.channelId, title: event.title }, `${event.title} is starting. Join the watch party`);
            } else if (now < event.start) {
              nextTimes.push(event.start);
            }
          }
        }
      }

      // Timers far in the future are unreliable (and capped by browsers); re-check hourly instead.
      const next = nextTimes.length > 0 ? Math.min(...nextTimes) - now : Infinity;
      timer = setTimeout(check, Math.max(1000, Math.min(next, 60 * 60 * 1000)));
    };

    const onAccountData = (event: MatrixEvent) => {
      if (event.getType() === REMINDERS_ACCOUNT_DATA) check();
    };
    const onState = (event: MatrixEvent) => {
      const type = event.getType();
      if (type === CALENDAR_EVENT || (type === 'm.room.member' && event.getStateKey() === mx.getUserId())) check();
    };

    check();
    mx.on(ClientEvent.AccountData, onAccountData);
    mx.on(RoomStateEvent.Events, onState);
    return () => {
      clearTimeout(timer);
      mx.removeListener(ClientEvent.AccountData, onAccountData);
      mx.removeListener(RoomStateEvent.Events, onState);
    };
  }, [mx, show]);

  // Keeps the push gateway's copy current: at start, and whenever reminders, events or RSVPs change.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const syncSoon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        syncRemindersToGateway(mx).catch((err: unknown) => console.warn('Couldn’t hand reminders to the push gateway', err));
      }, 2000);
    };
    const onAccountData = (event: MatrixEvent) => {
      if (event.getType() === REMINDERS_ACCOUNT_DATA || event.getType() === PUSH_GATEWAY_ACCOUNT_DATA_EVENT) syncSoon();
    };
    const onState = (event: MatrixEvent) => {
      const type = event.getType();
      if (type === CALENDAR_EVENT || (type === 'm.room.member' && event.getStateKey() === mx.getUserId())) syncSoon();
    };
    syncSoon();
    mx.on(ClientEvent.AccountData, onAccountData);
    mx.on(RoomStateEvent.Events, onState);
    return () => {
      clearTimeout(timer);
      mx.removeListener(ClientEvent.AccountData, onAccountData);
      mx.removeListener(RoomStateEvent.Events, onState);
    };
  }, [mx]);

  const dismiss = (key: string) => setToasts((current) => current.filter((t) => t.key !== key));

  const open = (toast: Toast) => {
    if (toast.kind === 'party') {
      joinVoiceChannel(toast.channelId);
    } else if (toast.kind === 'message') {
      // Out of Posts or Events: those take the main pane over whatever room is selected.
      setSpaceView(null);
      setSelectedSpaceId(findParentSpaceId(mx, toast.roomId));
      setSelectedRoomId(toast.roomId);
      setRailSection('messages');
      setPendingJump({ roomId: toast.roomId, eventId: toast.eventId });
    } else {
      setSelectedSpaceId(toast.spaceId);
      setSelectedRoomId(null);
      setRailSection('messages');
      setSpaceView('events');
    }
    dismiss(toast.key);
  };

  if (toasts.length === 0) return null;
  return (
    <div className="nu-reminders" data-nu-role="reminders" role="status">
      {toasts.map((toast) => (
        <div key={toast.key} className="nu-reminders__card" data-nu-role="reminder">
          <Icon name="bell" size={16} />
          <div className="nu-reminders__text">
            <strong>{toast.kind === 'message' ? 'Reminder' : toast.title}</strong>
            <span>
              {toast.kind === 'message'
                ? toast.text || 'A message you asked to be reminded about'
                : toast.kind === 'party'
                  ? 'Watch party starting now'
                  : `Starts at ${new Date(toast.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}
            </span>
          </div>
          <button type="button" className="nu-button nu-button--secondary" data-nu-role="reminder-open" onClick={() => open(toast)}>
            {toast.kind === 'party' ? 'Join' : 'Open'}
          </button>
          <button
            type="button"
            className="nu-reminders__dismiss"
            data-nu-role="reminder-dismiss"
            title="Dismiss"
            aria-label="Dismiss"
            onClick={() => dismiss(toast.key)}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

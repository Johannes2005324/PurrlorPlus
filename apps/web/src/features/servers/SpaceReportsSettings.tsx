import { useEffect, useState } from 'react';
import { useSetAtom } from 'jotai';
import { RoomEvent, type Room } from 'matrix-js-sdk';
import { pendingJumpTargetAtom, selectedRoomIdAtom, selectedSpaceIdAtom, railSectionAtom } from '../../app/state/selection';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { banMember, kickMember } from '../../matrix/moderation';
import { canSendStateEvent } from '../../matrix/permissions';
import {
  MODERATION_EVENT,
  readModerationConfig,
  readReports,
  resolveReport,
  setBlockedWords,
  setUpReviewRoom,
  type Report,
  type Resolution,
} from '../../matrix/reports';
import { redactMessage } from '../../matrix/redaction';
import { useOpenPost } from '../feed/useOpenPost';
import { fallbackName } from '../../matrix/displayName';

const RESOLUTION_LABELS: Record<Resolution, string> = {
  deleted: 'Message deleted',
  removed: 'Author removed from the Space',
  banned: 'Author banned from the Space',
  dismissed: 'Dismissed',
};

/** A review room's reports, with enough of its history loaded to show the recent queue. */
function useReports(reviewRoom: Room | null): Report[] {
  const mx = useMatrixClient();
  const [reports, setReports] = useState<Report[]>(() => (reviewRoom ? readReports(reviewRoom) : []));

  useEffect(() => {
    if (!reviewRoom) return undefined;
    const update = () => setReports(readReports(reviewRoom));
    update();
    // A few pages back, so reports filed while nobody had the room open are there too.
    void (async () => {
      for (let page = 0; page < 5 && reviewRoom.getLiveTimeline().getPaginationToken('b' as any); page++) {
        await mx.scrollback(reviewRoom, 50).catch(() => undefined);
      }
      update();
    })();
    reviewRoom.on(RoomEvent.Timeline, update);
    // A report this client filed gets its real id here, with no new timeline event.
    reviewRoom.on(RoomEvent.LocalEchoUpdated, update);
    return () => {
      reviewRoom.removeListener(RoomEvent.Timeline, update);
      reviewRoom.removeListener(RoomEvent.LocalEchoUpdated, update);
    };
  }, [mx, reviewRoom]);

  return reports;
}

function ReportCard({ report, space, reviewRoomId }: { report: Report; space: Room; reviewRoomId: string }) {
  const mx = useMatrixClient();
  const setSelectedSpaceId = useSetAtom(selectedSpaceIdAtom);
  const setSelectedRoomId = useSetAtom(selectedRoomIdAtom);
  const setRailSection = useSetAtom(railSectionAtom);
  const setPendingJump = useSetAtom(pendingJumpTargetAtom);
  const openPost = useOpenPost();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const channel = mx.getRoom(report.room_id);
  const nameOf = (userId: string) => space.getMember(userId)?.name ?? fallbackName(userId);

  const act = async (action: Resolution) => {
    setBusy(true);
    setError(undefined);
    try {
      if (action === 'deleted') await redactMessage(mx, report.room_id, report.event_id);
      if (action === 'removed') await kickMember(mx, space.roomId, report.reported_user, 'Removed after a report');
      if (action === 'banned') await banMember(mx, space.roomId, report.reported_user, 'Banned after a report');
      await resolveReport(mx, reviewRoomId, report, action);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That didn’t work');
    } finally {
      setBusy(false);
    }
  };

  // A post or comment lives in a member's feed room, which isn't a channel: it opens as a post.
  const aboutPost = !!report.content_kind && !!report.post_id;
  const what = report.content_kind ?? 'message';

  const open = () => {
    if (aboutPost) {
      void openPost(report.room_id, report.post_id!);
      return;
    }
    setSelectedSpaceId(space.roomId);
    setSelectedRoomId(report.room_id);
    setRailSection('messages');
    setPendingJump({ roomId: report.room_id, eventId: report.event_id });
  };

  return (
    <li className="nu-reports__item" data-nu-role="space-report">
      <p className="nu-reports__summary">
        <strong>{nameOf(report.reported_user)}</strong>{' '}
        {aboutPost ? `wrote a ${what}` : `in #${channel?.name ?? 'a channel you’re not in'}`} ·{' '}
        {new Date(report.reported_at).toLocaleString()}
      </p>
      {report.excerpt && <blockquote className="nu-reports__excerpt">{report.excerpt}</blockquote>}
      <p className="nu-reports__reason">
        {report.automod
          ? `Automod: ${report.reason}${report.automod.deleted ? ' — deleted' : ''}`
          : `${nameOf(report.reporter)}: ${report.reason || 'no reason given'}`}
      </p>
      {report.resolution ? (
        <p className="nu-reports__resolution" data-nu-role="space-report-resolution">
          {RESOLUTION_LABELS[report.resolution.action]} by {nameOf(report.resolution.by)}
        </p>
      ) : (
        <div className="nu-reports__actions">
          <button type="button" className="nu-button nu-button--secondary" data-nu-role="space-report-open" onClick={open} disabled={!channel}>
            {aboutPost ? 'Go to post' : 'Go to message'}
          </button>
          {!report.automod?.deleted && (
            <button type="button" className="nu-button nu-button--secondary" data-nu-role="space-report-delete" disabled={busy} onClick={() => void act('deleted')}>
              {aboutPost ? `Delete ${what}` : 'Delete message'}
            </button>
          )}
          <button type="button" className="nu-button nu-button--secondary" data-nu-role="space-report-remove" disabled={busy} onClick={() => void act('removed')}>
            Remove author
          </button>
          <button type="button" className="nu-button nu-button--danger" data-nu-role="space-report-ban" disabled={busy} onClick={() => void act('banned')}>
            Ban author
          </button>
          <button type="button" className="nu-button nu-button--secondary" data-nu-role="space-report-dismiss" disabled={busy} onClick={() => void act('dismissed')}>
            Dismiss
          </button>
        </div>
      )}
      {error && <p className="nu-field__error">{error}</p>}
    </li>
  );
}

function BlockedWords({ space }: { space: Room }) {
  const mx = useMatrixClient();
  const canEdit = canSendStateEvent(space, mx.getUserId() ?? '', MODERATION_EVENT);
  const [text, setText] = useState(() => readModerationConfig(space).blockedWords.join('\n'));
  const [status, setStatus] = useState<string>();

  const save = async () => {
    setStatus(undefined);
    try {
      await setBlockedWords(mx, space, text.split('\n'));
      setStatus('Saved.');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Couldn’t save the list');
    }
  };

  return (
    <section className="nu-reports__automod">
      <h3>Automod</h3>
      <p className="nu-field__hint">
        Words or phrases this Space doesn’t allow, one per line. Purrlor won’t send a message containing one, and a moderator’s app
        deletes any that arrive from other apps and files them here. Whole words, ignoring case and accents.
      </p>
      <textarea
        className="nu-field__textarea"
        data-nu-role="space-automod-words"
        rows={5}
        value={text}
        disabled={!canEdit}
        onChange={(e) => setText(e.target.value)}
      />
      {canEdit && (
        <div className="nu-form-actions">
          <button type="button" className="nu-button nu-button--primary" data-nu-role="space-automod-save" onClick={() => void save()}>
            Save
          </button>
        </div>
      )}
      {status && <p className="nu-field__hint">{status}</p>}
    </section>
  );
}

/** Space Settings → Reports: the moderators' queue (matrix/reports.ts) and automod's word list. */
export function SpaceReportsSettings({ space }: { space: Room }) {
  const mx = useMatrixClient();
  const { reviewRoomId } = readModerationConfig(space);
  const reviewRoom = reviewRoomId ? mx.getRoom(reviewRoomId) : null;
  const joined = reviewRoom?.getMyMembership() === 'join';
  const reports = useReports(joined ? reviewRoom : null);
  const [settingUp, setSettingUp] = useState(false);
  const [error, setError] = useState<string>();
  const canSetUp = canSendStateEvent(space, mx.getUserId() ?? '', MODERATION_EVENT);
  const open = reports.filter((r) => !r.resolution);
  const resolved = reports.filter((r) => r.resolution);

  const setUp = async () => {
    setSettingUp(true);
    setError(undefined);
    try {
      await setUpReviewRoom(mx, space);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t set up report review');
    } finally {
      setSettingUp(false);
    }
  };

  return (
    <div className="nu-reports" data-nu-role="space-reports">
      {!reviewRoomId ? (
        <section>
          <p>
            With report review on, reports about messages in {space.name} come to its moderators here, as well as to the server’s
            admins. Only moderators can see them.
          </p>
          {canSetUp && (
            <button type="button" className="nu-button nu-button--primary" data-nu-role="space-reports-setup" disabled={settingUp} onClick={() => void setUp()}>
              {settingUp ? 'Turning on…' : 'Turn on report review'}
            </button>
          )}
          {error && <p className="nu-field__error">{error}</p>}
        </section>
      ) : !joined ? (
        <p data-nu-role="space-reports-pending">You’ll see reports here once you’ve been added to the review room, which happens when you become a moderator.</p>
      ) : (
        <section>
          <h3>Open reports</h3>
          {open.length === 0 ? (
            <p className="nu-field__hint" data-nu-role="space-reports-empty">Nothing to review.</p>
          ) : (
            <ul className="nu-reports__list">
              {open.map((report) => (
                <ReportCard key={report.report_id} report={report} space={space} reviewRoomId={reviewRoomId} />
              ))}
            </ul>
          )}
          {resolved.length > 0 && (
            <details>
              <summary>Resolved ({resolved.length})</summary>
              <ul className="nu-reports__list">
                {resolved.map((report) => (
                  <ReportCard key={report.report_id} report={report} space={space} reviewRoomId={reviewRoomId} />
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
      <BlockedWords space={space} />
    </div>
  );
}

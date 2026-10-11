import { useEffect, useRef, useState } from 'react';
import { useMatrixClient } from '../matrix/MatrixClientContext';
import { useOwnProfile } from '../matrix/hooks/useOwnProfile';
import { buildDataExport, type ExportProgress, type ExportResult } from '../matrix/dataExport';
import { deleteAccount, spacesOnlyYouRun, WrongPasswordError, type DeleteProgress } from '../matrix/deleteAccount';
import { Modal } from '../components/Modal';
import { clearDeviceCaches } from '../matrix/deviceCache';
import './YourDataSettings.css';

/** Set before the reload that follows deleting an account, so the sign-in screen can say it worked. */
export const ACCOUNT_DELETED_FLAG = 'purrlor_account_deleted';

function exportStatus(progress: ExportProgress | undefined): string {
  if (!progress) return 'Starting…';
  switch (progress.step) {
    case 'profile':
      return 'Reading your profile and settings…';
    case 'rooms':
      return `Reading what you sent: ${progress.done} of ${progress.total} conversations…`;
    case 'files':
      return `Downloading your files: ${progress.done} of ${progress.total}…`;
    case 'packing':
      return 'Packing it into one file…';
  }
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function saveFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function DownloadMyData() {
  const mx = useMatrixClient();
  const [includeFiles, setIncludeFiles] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ExportProgress>();
  const [result, setResult] = useState<ExportResult>();
  const [error, setError] = useState<string>();
  const abortRef = useRef<AbortController>();

  useEffect(() => () => abortRef.current?.abort(), []);

  const start = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setResult(undefined);
    setError(undefined);
    setProgress(undefined);
    try {
      const done = await buildDataExport(mx, { includeFiles, onProgress: setProgress, signal: controller.signal });
      setResult(done);
      saveFile(done.blob, done.fileName);
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="nu-your-data__section" data-nu-role="your-data-export">
      <h3 className="nu-your-data__heading">Download my data</h3>
      <p className="nu-field__hint">
        A ZIP file with your profile and page, your posts and comments, every message you sent (decrypted, in
        encrypted conversations too) and your settings. It's put together here in your browser, so it can take a few
        minutes if you've sent a lot.
      </p>
      <label className="nu-field__checkbox-row">
        <input
          type="checkbox"
          checked={includeFiles}
          disabled={running}
          data-nu-role="your-data-include-files"
          onChange={(evt) => setIncludeFiles(evt.target.checked)}
        />
        Include the files you uploaded (pictures, videos, music, other files)
      </label>
      <div className="nu-your-data__actions">
        {running ? (
          <>
            <span className="nu-your-data__status" role="status" data-nu-role="your-data-export-status">
              {exportStatus(progress)}
            </span>
            <button type="button" className="nu-button nu-button--secondary" onClick={() => abortRef.current?.abort()}>
              Stop
            </button>
          </>
        ) : (
          <button type="button" className="nu-button nu-button--primary" data-nu-role="your-data-export-start" onClick={() => void start()}>
            Download my data
          </button>
        )}
      </div>
      {result && (
        <p className="nu-field__hint" role="status" data-nu-role="your-data-export-done">
          Done: {plural(result.counts.messages, 'message', 'messages')}, {plural(result.counts.posts, 'post', 'posts')},{' '}
          {plural(result.counts.comments, 'comment', 'comments')}
          {includeFiles && `, ${plural(result.counts.files, 'file', 'files')}`}.{' '}
          {result.counts.filesFailed > 0 && `${plural(result.counts.filesFailed, 'file', 'files')} couldn't be downloaded (listed in the ZIP). `}
          {result.counts.undecryptable > 0 &&
            `${plural(result.counts.undecryptable, 'message', 'messages')} couldn't be decrypted in this session. `}
          <button type="button" className="nu-your-data__link" onClick={() => saveFile(result.blob, result.fileName)}>
            Save it again
          </button>
        </p>
      )}
      {error && <p className="nu-field__error">Couldn't make your download: {error}</p>}
    </section>
  );
}

function deleteStatus(progress: DeleteProgress | undefined): string {
  switch (progress?.step) {
    case 'checking':
    case undefined:
      return 'Checking your password…';
    case 'page':
      return 'Taking down your page…';
    case 'posts':
      return progress.total ? `Deleting your posts: ${progress.done ?? 0} of ${progress.total}…` : 'Finding your posts…';
    case 'notifications':
      return 'Stopping notifications and reminders…';
    case 'deleting':
      return 'Deleting your account…';
  }
}

/** Tells the sign-in screen, after the reload, that the account was deleted (or takes that back). */
function markAccountDeleted(deleted: boolean): void {
  try {
    if (deleted) sessionStorage.setItem(ACCOUNT_DELETED_FLAG, '1');
    else sessionStorage.removeItem(ACCOUNT_DELETED_FLAG);
  } catch {
    // Only the note on the sign-in screen is lost.
  }
}

/** Signs this browser out of the deleted account and back to the sign-in screen. */
async function leaveDeletedAccount(mx: ReturnType<typeof useMatrixClient>): Promise<void> {
  mx.stopClient();
  // Same reasoning as logoutClient: a store that won't clear mustn't keep the page here.
  await Promise.race([
    Promise.all([mx.clearStores().catch(() => undefined), clearDeviceCaches()]),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  try {
    localStorage.clear();
    sessionStorage.setItem(ACCOUNT_DELETED_FLAG, '1');
  } catch {
    // The reload still lands on the sign-in screen: the session it would restore is gone server-side.
  }
  window.location.reload();
}

function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const mx = useMatrixClient();
  const profile = useOwnProfile();
  const [password, setPassword] = useState('');
  const [deletePosts, setDeletePosts] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<DeleteProgress>();
  const [error, setError] = useState<string>();
  const [soleAdmin] = useState(() => spacesOnlyYouRun(mx));

  const confirm = async () => {
    setRunning(true);
    setError(undefined);
    try {
      await deleteAccount(mx, password, { deletePosts, displayName: profile.displayName || profile.userId }, (step) => {
        // Once the deletion itself is under way, a sync can find the token gone and reload to the
        // sign-in screen (App.tsx) before deleteAccount even returns: leave the note ahead of it.
        if (step.step === 'deleting') markAccountDeleted(true);
        setProgress(step);
      });
      await leaveDeletedAccount(mx);
    } catch (err) {
      markAccountDeleted(false);
      setRunning(false);
      setError(
        err instanceof WrongPasswordError
          ? err.message
          : `Your account wasn't deleted: ${err instanceof Error ? err.message : 'something went wrong'}. Nothing after the step it stopped at was changed.`
      );
    }
  };

  return (
    <Modal title="Delete my account" onClose={running ? () => undefined : onClose}>
      <div className="nu-your-data__dialog" data-nu-role="delete-account-dialog">
        <p>This can't be undone.</p>
        <ul className="nu-your-data__list">
          <li>
            You're signed out everywhere and can never sign in to <strong>{profile.userId}</strong> again. Nobody else
            can take that name.
          </li>
          <li>You leave every Space, channel and conversation, and your name and picture are removed.</li>
          <li>Your public page is taken down.</li>
          <li>
            Messages you sent stay with the people who have them, the way they would in any chat app. Delete any you
            want gone before you go.
          </li>
        </ul>
        {soleAdmin.length > 0 && (
          <div className="nu-field__error" data-nu-role="delete-account-sole-admin">
            You're the only admin of {soleAdmin.map((space) => space.name || space.roomId).join(', ')}. Nobody will be
            able to run {soleAdmin.length === 1 ? 'it' : 'them'} after you go: make someone else an admin first.
          </div>
        )}
        <label className="nu-field__checkbox-row">
          <input
            type="checkbox"
            checked={deletePosts}
            disabled={running}
            data-nu-role="delete-account-delete-posts"
            onChange={(evt) => setDeletePosts(evt.target.checked)}
          />
          Also delete all my posts and my profile page
        </label>
        <p className="nu-field__hint">Want a copy first? Close this and use Download my data.</p>
        <label className="nu-field">
          Your password
          <input
            type="password"
            className="nu-field__input"
            autoComplete="current-password"
            value={password}
            disabled={running}
            data-nu-role="delete-account-password"
            onChange={(evt) => setPassword(evt.target.value)}
          />
        </label>
        {running && (
          <p className="nu-your-data__status" role="status" data-nu-role="delete-account-status">
            {deleteStatus(progress)}
          </p>
        )}
        {error && (
          <p className="nu-field__error" role="alert" data-nu-role="delete-account-error">
            {error}
          </p>
        )}
        <div className="nu-your-data__actions">
          <button type="button" className="nu-button nu-button--secondary" disabled={running} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="nu-button nu-button--danger"
            disabled={running || !password}
            data-nu-role="delete-account-confirm"
            onClick={() => void confirm()}
          >
            Delete my account
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Account Settings → Your data: a copy of everything, and deleting the account. */
export function YourDataSettings() {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="nu-your-data" data-nu-role="your-data-settings">
      <DownloadMyData />
      <section className="nu-your-data__section nu-your-data__section--danger" data-nu-role="your-data-delete">
        <h3 className="nu-your-data__heading">Delete my account</h3>
        <p className="nu-field__hint">
          Closes your account for good: you're signed out everywhere, leave every Space and conversation, and your page
          and (if you choose) your posts are deleted.
        </p>
        <div className="nu-your-data__actions">
          <button type="button" className="nu-button nu-button--danger" data-nu-role="your-data-delete-start" onClick={() => setConfirming(true)}>
            Delete my account…
          </button>
        </div>
      </section>
      {confirming && <DeleteAccountDialog onClose={() => setConfirming(false)} />}
    </div>
  );
}

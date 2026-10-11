import { startMediaWorkerAuth, stopMediaWorkerAuth } from './mediaWorker';
import { clearDeviceCaches } from './deviceCache';
import { createClient, IndexedDBStore, IndexedDBCryptoStore, type MatrixClient } from 'matrix-js-sdk';
import type { Session } from './session';
import { secretStorageCallbacks } from './secretStorageCallbacks';
import { setHomeServer } from './homeServer';
import { installMemberNameFallback } from './displayName';
import { installDecryptionRetry } from './decryptRetry';
import { claimSession } from './sessionLock';

// All four databases below (this app's two, plus the Rust crypto engine's own two — see
// RUST_CRYPTO_DB_NAMES) are shared/global per browser, not scoped per account or device —
// matching cinny-voice's original single-account-per-browser assumption. That assumption breaks
// down the moment more than one account/device's crypto material ever touches this browser
// (switching accounts, or a previous login/registration attempt that got this far before failing
// or being abandoned without a clean logout — see logoutClient's own comment on clearStores()
// being able to hang and leave stale data behind): the Rust crypto engine hard-fails
// initRustCrypto() if its store already holds an Olm/Megolm account bound to a *different*
// device than the one this session is trying to use. See initClient's retry below for how
// that's recovered from.
const SYNC_DB_NAME = 'nekous-sync-store';
const CRYPTO_DB_NAME = 'nekous-crypto-store';
// The two databases above are the *legacy* JS-level stores passed into createClient() — but
// initRustCrypto() doesn't actually use `cryptoStore` for its own account data at all (confirmed
// by reading matrix-js-sdk's source: it's only consulted for a one-time legacy-to-Rust
// migration). The real Rust crypto engine manages its own separate IndexedDB databases, named
// `{prefix}::matrix-sdk-crypto` and `{prefix}::matrix-sdk-crypto-meta` with prefix defaulting to
// "matrix-js-sdk" (this app never overrides it) — confirmed directly from matrix-js-sdk's own
// `MatrixClient.clearStores()` implementation, which deletes exactly these four names together.
// Not importing that default from matrix-js-sdk/lib/rust-crypto/constants.js: that's a deep
// internal module path, not something its package exports guarantee stable across versions —
// hardcoding the literal name here (like livekitRoomName's cross-service duplication elsewhere
// in this repo) is more robust than depending on an internal import resolving at all. First
// attempt at this fix only wiped the two legacy names above and left the real Rust store
// completely untouched — confirmed live: the exact same mismatch recurred on every single retry,
// forever, because the actual stuck account was never being deleted at all.
const RUST_CRYPTO_DB_NAMES = ['matrix-js-sdk::matrix-sdk-crypto', 'matrix-js-sdk::matrix-sdk-crypto-meta'];
// A flag rather than an immediate delete-and-retry: `buildClient`'s failed attempt already opened
// live connections to all four databases (`indexedDBStore.startup()`/`cryptoStore.startup()`
// succeeded, and the Rust engine had to open its own two stores to even read the account it then
// rejected — only the final mismatch check failed), and nothing here exposes a way to close any
// of those connections. `indexedDB.deleteDatabase()` on a database with any open connection
// doesn't fail — it fires `onblocked` and stays pending until every connection closes, which
// never happens on its own within this same page (confirmed live, twice: retrying in-place after
// a "wipe" silently no-ops and hits the identical mismatch again, every time). Closing those
// connections deterministically means tearing down this page's whole JS realm —
// `location.reload()` (not just a fresh navigation, which Chrome's back/forward cache can
// sometimes serve without actually dropping old connections) reliably does that. So: mark that a
// wipe is owed, force a reload, and perform the actual delete at the very start of the next boot,
// before anything has had a chance to open any of the four databases yet.
const PENDING_WIPE_KEY = 'nekous_pending_store_wipe';

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const req = window.indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    // Shouldn't happen at this call site (see PENDING_WIPE_KEY's comment — this only ever runs
    // at the very start of a fresh boot, before anything here has opened a connection), but
    // resolve rather than hang forever if some other tab has the database open.
    req.onblocked = () => resolve();
  });
}

async function wipeStoresIfPending(): Promise<void> {
  if (window.sessionStorage.getItem(PENDING_WIPE_KEY) !== '1') return;
  window.sessionStorage.removeItem(PENDING_WIPE_KEY);
  await Promise.all(
    [SYNC_DB_NAME, CRYPTO_DB_NAME, ...RUST_CRYPTO_DB_NAMES].map((name) => deleteDatabase(name))
  );
}

/** The Rust crypto engine's own wording for this specific failure (matrix-sdk-crypto-wasm has no
 *  typed error class for it — just a plain Error with this message) — narrow enough to not
 *  accidentally swallow-and-retry a genuinely different init failure (a network blip, a bad
 *  access token, ...) behind an unhelpful, silently-wiped-storage retry. */
export function isCryptoStoreDeviceMismatch(err: unknown): boolean {
  return err instanceof Error && /account in the store doesn't match/i.test(err.message);
}

/**
 * Bootstrap pattern ported from cinny-voice's src/client/initMatrix.ts: IndexedDB-backed sync
 * store, Rust/WASM crypto (not legacy olm), lazy-loaded members. Session persistence is plain
 * localStorage (see session.ts) — deliberately simple for v1, matching cinny-voice.
 */
async function buildClient(session: Session): Promise<MatrixClient> {
  const indexedDBStore = new IndexedDBStore({
    indexedDB: window.indexedDB,
    localStorage: window.localStorage,
    dbName: SYNC_DB_NAME,
  });

  const cryptoStore = new IndexedDBCryptoStore(window.indexedDB, CRYPTO_DB_NAME);

  const mx = createClient({
    baseUrl: session.baseUrl,
    accessToken: session.accessToken,
    userId: session.userId,
    deviceId: session.deviceId,
    store: indexedDBStore,
    cryptoStore,
    timelineSupport: true,
    verificationMethods: ['m.sas.v1'],
    cryptoCallbacks: secretStorageCallbacks,
  });

  await indexedDBStore.startup();
  await cryptoStore.startup();
  await mx.initRustCrypto();
  mx.setMaxListeners(50);

  return mx;
}

// The client this tab runs, while it holds the session (sessionLock.ts), and who to tell when a
// newer tab takes the session over.
let lockedClient: MatrixClient | null = null;
let movedElsewhere = false;
const movedElsewhereListeners = new Set<() => void>();

/** Calls `listener` when another tab of this browser takes the session over and this tab's client
 *  has stopped. Returns a function that stops listening. */
export function onSessionMovedElsewhere(listener: () => void): () => void {
  movedElsewhereListeners.add(listener);
  return () => movedElsewhereListeners.delete(listener);
}

function sessionMovedElsewhere(): void {
  movedElsewhere = true;
  lockedClient?.stopClient();
  lockedClient = null;
  for (const listener of movedElsewhereListeners) listener();
}

async function initClientOnce(session: Session): Promise<MatrixClient> {
  // Before anything opens the stores: one tab at a time, or two copies of this device's crypto
  // overwrite each other's keys. Also what lets the wipe below go through, with no other tab
  // holding the databases open.
  await claimSession(sessionMovedElsewhere);
  await wipeStoresIfPending();

  try {
    const mx = await buildClient(session);
    if (movedElsewhere) {
      // Taken over while this tab was still starting: stop here, the way a running client would.
      mx.stopClient();
      return new Promise<MatrixClient>(() => {});
    }
    lockedClient = mx;
    return mx;
  } catch (err) {
    if (!isCryptoStoreDeviceMismatch(err)) throw err;
    // Not a "your account is broken" error — the account and its real E2EE state are fine on the
    // server (and on any other device); only *this browser's* local crypto state is stuck bound
    // to a device this session no longer matches (see PENDING_WIPE_KEY's comment for why a
    // same-tab delete-and-retry doesn't reliably work). Recovering means starting this device's
    // local state over, the same as if these databases had never existed — wipe all four (the
    // sync store too, since cached rooms may reference E2EE keys tied to the crypto state we're
    // discarding) and rebuild fresh on the next boot. If this device previously had "Unlock
    // message history" set up, that flow still works normally afterward to restore decryption of
    // history.
     
    console.error('initClient: local crypto store is stuck on a stale device, reloading to clear it', err);
    window.sessionStorage.setItem(PENDING_WIPE_KEY, '1');
    window.location.reload();
    // location.reload() doesn't synchronously halt execution — never resolve so nothing
    // downstream (App.tsx's boot effect) proceeds to use a client from a page that's unloading.
    return new Promise<MatrixClient>(() => {});
  }
}

// De-dupes concurrent calls within this one page/tab (there's realistically only ever one real
// session per tab, so collapsing overlapping calls into a single shared attempt is always
// correct here, never a case of two genuinely different sessions racing). This matters for
// exactly one reason found live while testing the recovery path above: React 18 StrictMode
// double-invokes effects in dev, which fired two concurrent initClient() calls for the same
// session — each with its own view of the PENDING_WIPE_KEY flag, so one call's wipe-then-rebuild
// could run concurrently with the other's `buildClient()` re-opening the databases mid-wipe,
// reproducing the exact same stuck mismatch the wipe was supposed to fix, in a loop. Confirmed
// this doesn't affect the production build (StrictMode's double-invoke is dev-only) — but two
// separate browser *tabs* booting the same account at the same moment against these
// still-global, unscoped-per-tab IndexedDB databases could race the same way, which this equally
// protects against for as long as at least one of those tabs is this one. Coordinating safely
// across genuinely separate tabs' JS realms would need a cross-tab primitive (a Web Lock) this
// fix doesn't attempt — a known, accepted limitation shared by matrix-js-sdk's Rust crypto in
// general, not something specific to this app.
let inFlightInit: Promise<MatrixClient> | null = null;

export function initClient(session: Session): Promise<MatrixClient> {
  if (!inFlightInit) {
    inFlightInit = initClientOnce(session).finally(() => {
      inFlightInit = null;
    });
  }
  return inFlightInit;
}

export async function startClient(mx: MatrixClient): Promise<void> {
  // threadSupport is an explicit opt-in (MatrixClient.supportsThreads() just reads this flag
  // back, matrix-js-sdk doesn't infer it from the homeserver) — without it, Room.eventShouldLiveIn
  // treats every event as living only in the main timeline, so thread-relation messages send
  // fine but never get aggregated into a Thread object at all (see ThreadPanel.tsx/useThreads.ts).
  // Before the first sync builds any RoomMember: names without a display name fall back to a
  // handle, which depends on knowing this server (matrix/displayName.ts).
  setHomeServer(mx.getDomain());
  installMemberNameFallback();
  // Before the first sync, so messages it brings in that can't be decrypted yet are retried too.
  installDecryptionRetry(mx);
  // 30 events per room from sync rather than the SDK's 8: with only 8, a room whose latest events
  // were reactions, edits or state changes opened empty and had to ask for history first.
  await mx.startClient({ lazyLoadMembers: true, threadSupport: true, initialSyncLimit: 30 });
  // The sync store (IndexedDBStore) is written at most every five minutes, so opening the app
  // again started from rooms as they were up to five minutes before, and caught up from there.
  // Leaving the tab (switching away, closing it, a phone locking) writes it now.
  document.addEventListener('visibilitychange', () => {
    // Not once another tab has the session: its sync position is newer than this tab's.
    if (document.visibilityState === 'hidden' && mx.clientRunning) void mx.store.save(true).catch(() => undefined);
  });
  // From here the service worker can sign this client's media requests (matrix/mediaWorker.ts).
  startMediaWorkerAuth(mx);
}

export async function logoutClient(mx: MatrixClient): Promise<void> {
  stopMediaWorkerAuth();
  mx.stopClient();
  try {
    await mx.logout();
  } catch {
    // Server-side logout failing shouldn't block clearing the local session.
  }
  // clearStores() can hang indefinitely rather than reject: matrix-js-sdk's own rust-crypto-store
  // deletion leaves its internal promise pending forever on an IndexedDB `onblocked` event (e.g.
  // another tab/connection still has the database open) instead of resolving or rejecting it.
  // That must never block the two lines below — mx.logout() above already invalidated this
  // access token server-side, so leaving it sitting in localStorage after a failed/stuck store
  // clear is far worse than a stale IndexedDB database (which just gets reused/overwritten by
  // whatever logs in next): the app would keep trying to restore a session with a token the
  // server now rejects, which matrix-js-sdk's own crypto-migration check retries forever with no
  // backoff — a permanent "stuck loading" for anyone who hits this until they manually clear
  // browser storage. A 3s race is generous; a healthy deletion completes in milliseconds.
  // The media and previews this device kept (matrix/deviceCache.ts) go with it.
  await Promise.race([
    Promise.all([mx.clearStores().catch(() => {}), clearDeviceCaches()]),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  window.localStorage.clear();
  window.location.reload();
}

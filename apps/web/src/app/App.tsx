import { useEffect, useState } from 'react';
import { ClientEvent, type MatrixClient, type SyncState, type SyncStateData } from 'matrix-js-sdk';
import { clearSession, getSession } from '../matrix/session';
import { initClient, onSessionMovedElsewhere, startClient } from '../matrix/client';
import { isDemoMode } from '../demo/demoMode';
import { MatrixClientContext } from '../matrix/MatrixClientContext';
import { LoginScreen } from './LoginScreen';
import { RegisterScreen } from './RegisterScreen';
import { RecoveryKeySetupScreen } from './RecoveryKeySetupScreen';
import { AppShell } from './AppShell';
import { PublicApp } from '../features/publicWeb/PublicApp';
import { parsePublicRoute } from '../matrix/publicWeb';
import { setHomeServer } from '../matrix/homeServer';

const MASCOT_URL = '/icon-192.png';

/** The mascot on the night sky while Purrlor starts. index.html draws the same markup before any
 *  script has run, so the page goes straight from it to this without a blank frame between. */
function BootSplash({ status }: { status?: string }) {
  return (
    <div className="nu-splash" data-nu-role="boot-splash">
      <img className="nu-splash__mascot" src={MASCOT_URL} alt="" />
      <p className="nu-splash__status" aria-live="polite">
        {status ?? 'Loading…'}
      </p>
    </div>
  );
}

type BootState =
  | { phase: 'checking-session' }
  | { phase: 'logged-out' }
  | { phase: 'starting'; mx: MatrixClient }
  | { phase: 'awaiting-recovery-setup'; mx: MatrixClient; recoveryKey: string }
  | { phase: 'ready'; mx: MatrixClient }
  | { phase: 'error'; message: string }
  | { phase: 'open-elsewhere' };

export function App() {
  const [boot, setBoot] = useState<BootState>({ phase: 'checking-session' });
  // A signed-out visitor at /@name, /@name/post/<id> or /feed sees the public web (docs/public-web.md)
  // until they choose to sign in or join; signing in reloads the same address into the app.
  const [publicRoute] = useState(() => (isDemoMode() ? undefined : parsePublicRoute(window.location.pathname, window.location.search)));
  const [authView, setAuthView] = useState<'public' | 'login' | 'register'>(publicRoute ? 'public' : 'login');

  // Another tab took the session (matrix/sessionLock.ts); this one's client has stopped.
  useEffect(() => onSessionMovedElsewhere(() => setBoot({ phase: 'open-elsewhere' })), []);

  useEffect(() => {
    // Demo mode short-circuits the whole real boot: no stored session is read, no homeserver is
    // contacted, and the fake world is pulled in through a dynamic import so it stays out of the
    // main bundle for everyone else. See src/demo/demoMode.ts.
    if (isDemoMode()) {
      let cancelledDemo = false;
      void import('../demo').then(({ startDemo }) => {
        if (!cancelledDemo) setBoot({ phase: 'ready', mx: startDemo() });
      });
      return () => {
        cancelledDemo = true;
      };
    }

    const session = getSession();
    if (!session) {
      setBoot({ phase: 'logged-out' });
      return undefined;
    }

    let cancelled = false;

    (async () => {
      let mx: MatrixClient;
      try {
        mx = await initClient(session);
      } catch (err) {
        // initClient already retries the one specific failure it knows how to self-heal (a
        // stale local crypto store — see client.ts) — anything that still throws here is a real,
        // unrecoverable-by-itself failure. Previously nothing caught this at all: the promise
        // rejected uncaught, and the app was stuck on the "Loading…" splash forever with no
        // indication anything had gone wrong.
        if (!cancelled) {
          setBoot({ phase: 'error', message: err instanceof Error ? err.message : 'Failed to start the client.' });
        }
        return;
      }
      if (cancelled) return;
      setBoot({ phase: 'starting', mx });

      const onSync = (state: SyncState, _prev: SyncState | null, data?: SyncStateData) => {
        if (cancelled) return;
        if (state === 'PREPARED') {
          setBoot({ phase: 'ready', mx });
          return;
        }
        // A stored access token the server no longer accepts (e.g. it was invalidated by a
        // logout that failed to clear localStorage — see logoutClient's comment in client.ts)
        // makes the SDK give up and report SyncState.Error with an M_UNKNOWN_TOKEN/401 here
        // rather than retry forever — but this app was doing nothing with that signal, so the
        // user just saw a permanent "Syncing…" instead of the SDK's own clean failure. Treat it
        // the same as a real logout: clear the dead session and reload to the login screen,
        // rather than leaving a boot phase nothing ever transitions out of.
        const err = data?.error as { errcode?: string; httpStatus?: number } | undefined;
        if (state === 'ERROR' && (err?.errcode === 'M_UNKNOWN_TOKEN' || err?.httpStatus === 401)) {
          mx.stopClient();
          clearSession();
          window.location.reload();
        }
      };
      mx.on(ClientEvent.Sync, onSync);
      await startClient(mx);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (boot.phase === 'checking-session') {
    return <BootSplash />;
  }

  if (boot.phase === 'error') {
    return (
      <div className="nu-splash" data-nu-role="boot-error">
        <div className="nu-splash__error">
          <img className="nu-splash__mascot nu-splash__mascot--still" src={MASCOT_URL} alt="" />
          <p>Couldn't start Purrlor: {boot.message}</p>
          <button
            type="button"
            className="nu-button nu-button--primary"
            onClick={() => {
              clearSession();
              window.location.reload();
            }}
          >
            Sign out and start over
          </button>
        </div>
      </div>
    );
  }

  if (boot.phase === 'open-elsewhere') {
    return (
      <div className="nu-splash" data-nu-role="open-elsewhere">
        <div className="nu-splash__error">
          <img className="nu-splash__mascot nu-splash__mascot--still" src={MASCOT_URL} alt="" />
          <p>Purrlor is open in another tab or window. It runs in one at a time, so your messages stay readable.</p>
          <button type="button" className="nu-button nu-button--primary" onClick={() => window.location.reload()}>
            Use Purrlor here
          </button>
        </div>
      </div>
    );
  }

  if (boot.phase === 'logged-out') {
    if (authView === 'public' && publicRoute) {
      return <PublicApp route={publicRoute} onSignIn={() => setAuthView('login')} onRegister={() => setAuthView('register')} />;
    }
    if (authView === 'register') {
      return (
        <RegisterScreen
          onSwitchToLogin={() => setAuthView('login')}
          onRegistered={(mx, recoveryKey) => setBoot({ phase: 'awaiting-recovery-setup', mx, recoveryKey })}
        />
      );
    }
    return (
      <LoginScreen onSwitchToRegister={() => setAuthView('register')} onLoggedIn={() => window.location.reload()} />
    );
  }

  if (boot.phase === 'starting') {
    return <BootSplash status="Syncing your chats…" />;
  }

  if (boot.phase === 'awaiting-recovery-setup') {
    const { mx, recoveryKey } = boot;
    return <RecoveryKeySetupScreen recoveryKey={recoveryKey} onContinue={() => setBoot({ phase: 'ready', mx })} />;
  }

  // Who counts as one of this server's people, for handles and addresses (matrix/homeServer.ts).
  setHomeServer(boot.mx.getDomain());
  return (
    <MatrixClientContext.Provider value={boot.mx}>
      <AppShell />
    </MatrixClientContext.Provider>
  );
}

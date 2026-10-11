import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { applyStoredThemeOnLoad } from './app/theme';
import { applyEffectsOnLoad } from './app/effects';
import { applyDensityOnLoad } from './app/density';
import { captureInstallPrompt } from './app/installApp';
import { loadRuntimeConfig } from './app/runtimeConfig';
import { installErrorReporting } from './app/errorReporting';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import './styles/tokens.css';
import './styles/base/shell.css';
import './styles/base/form.css';
// Last: the Ultimit frame over the component styles above (see its header comment).
import './styles/base/frame.css';
// After the frame: IRC mode (app/density.ts) tightens its sizes.
import './styles/base/density.css';

// Before anything renders, so a saved custom theme (see app/theme.ts) is already in place —
// no flash of the default look first.
applyStoredThemeOnLoad();
// The same for Full or Safe effects (app/effects.ts): a weak machine never draws the full frame first.
applyEffectsOnLoad();
// And IRC mode (app/density.ts), so the roomy layout never shows first.
applyDensityOnLoad();

// The browser offers installing once, early; kept for Account Settings and the phone hint.
captureInstallPrompt();

// The worker that catches pictures shared in from other apps (public/sw.js); it also serves push.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root element not found');
}

// Read before the first render so the login screen never flashes a homeserver field a
// deployment has locked (see app/runtimeConfig.ts). It never rejects.
void loadRuntimeConfig().then(() => {
  // Errors go to this deployment's own token server, for `purrlor errors` (app/errorReporting.ts).
  installErrorReporting();
  createRoot(container).render(
    <StrictMode>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </StrictMode>
  );
});

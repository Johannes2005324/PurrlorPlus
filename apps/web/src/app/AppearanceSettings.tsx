import { EmbedDisplaySetting } from './EmbedSettings';
import { FeedBackgroundSetting } from './FeedBackgroundSetting';
import { EffectsSettings } from './EffectsSettings';
import { useState, type ChangeEvent } from 'react';
import { getStoredThemeCss, saveThemeCss } from './theme';
import { FOXY_CSS } from './themes/foxy';
import { HALLOWEEN_CSS } from './themes/halloween';
import { NIGHTFUR_CSS } from './themes/nightfur';
import { AMBER_CSS, MINE_CSS, SAKURA_CSS, SILVER_CSS, VERDANT_CSS } from './themes/ultimit';
import { ROYAL_NEON_CSS } from './themes/royalNeon';
import './AppearanceSettings.css';

/** Condensed in-app copy of docs/theming.md's token table — a theme author working from this
 *  panel shouldn't have to go dig up the repo's own docs to know what's overridable. */
const TOKEN_REFERENCE: [string, string][] = [
  ['--nu-color-bg-app', 'Outermost app background (server rail)'],
  ['--nu-color-bg-primary', 'Channel list / member list background'],
  ['--nu-color-bg-secondary', 'Main content pane background'],
  ['--nu-color-bg-tertiary', 'Inputs, recessed surfaces'],
  ['--nu-color-bg-elevated', 'Popovers, menus'],
  ['--nu-color-text-primary / -secondary / -muted', 'Text hierarchy'],
  ['--nu-color-text-link', 'Links'],
  ['--nu-color-accent / -accent-hover', 'Primary action color'],
  ['--nu-color-on-accent', 'Text/icons drawn on the accent/danger/success/warning colors'],
  ['--nu-color-danger / -success / -warning', 'Status colors'],
  ['--nu-color-role-admin / -role-moderator', 'Role colors for names in the timeline and member list'],
  ['--nu-color-border / -border-strong', 'Hairline borders/dividers, and the stronger one for a focused panel'],
  ['--nu-color-panel / -panel-main / -rail', 'The glass panels (side columns / main pane) and the server rail'],
  ['--nu-frame-gap / -blur / -bracket / -shadow', 'Space between panels, glass blur, corner-bracket color, panel shadow'],
  ['--nu-clip-cut / --nu-clip-avatar', 'Cut corners on buttons and avatars (none for plain rectangles)'],
  ['--nu-wallpaper-opacity, --nu-wall-*', 'The shard wallpaper: 0 hides it; -ground-start/-end, -shard, -grid, -shade recolor it'],
  ['--nu-color-backdrop / -backdrop-strong', 'Modal / image-viewer dimming'],
  ['--nu-space-half … --nu-space-6', 'Spacing scale (2px–32px)'],
  ['--nu-radius-sm / -md / -lg / -tile / -avatar / -dot / -full', 'Corner radii (-tile: server rail icons)'],
  ['--nu-font-body', 'Base font stack'],
  ['--nu-font-display', 'Space names, channel titles, welcome headers'],
  ['--nu-font-mono / --nu-font-label', 'Code, and small console text (labels, times, the clock)'],
  ['--nu-font-size-xs / -sm / -md / -lg / -xl', 'Font sizes'],
];

const EXAMPLE_CSS = `:root {\n  --nu-color-accent: #ff5e8a;\n  --nu-color-accent-hover: #e14d76;\n}`;

/**
 * Ready-made starting points, loaded into the editor (not auto-applied — same as "Load from
 * file") so a user can tweak before hitting Apply. Most only override color tokens: every
 * gradient, radius, font, and animation is *derived* from these in tokens.css, so recoloring a
 * handful of variables reskins the whole app without touching shape/motion at all. Halloween
 * (themes/halloween.ts) shows how much further a theme can go.
 */
const THEME_PRESETS: { name: string; swatch: [string, string]; css: string }[] = [
  // The Ultimit desktop's four skins (themes/ultimit.ts); Mine is the default.
  { name: 'Mine', swatch: ['#050607', '#d4ebff'], css: MINE_CSS },
  { name: 'Amber', swatch: ['#b84d05', '#ffb04a'], css: AMBER_CSS },
  { name: 'Silver', swatch: ['#f6f7f9', '#2c5b88'], css: SILVER_CSS },
  { name: 'Verdant', swatch: ['#062a0c', '#b9ff8c'], css: VERDANT_CSS },
  { name: 'Sakura', swatch: ['#5c0f35', '#ff8fc4'], css: SAKURA_CSS },
  // A contributed theme, with its cat art as the wallpaper (themes/royalNeon.ts).
  { name: 'Royal Neon', swatch: ['#a900ff', '#ff00d9'], css: ROYAL_NEON_CSS },
  // The default look before the Ultimit redesign, with the frame turned off (themes/nightfur.ts).
  { name: 'Nightfur', swatch: ['#14101c', '#ffb547'], css: NIGHTFUR_CSS },
  {
    // The look before Nightfur. Brings its own fonts, since the app doesn't load Baloo 2/Nunito.
    name: 'Y2K Chatroom',
    swatch: ['#170a22', '#ff2f92'],
    css: `@import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;700;800&family=Nunito:wght@400;600;700;800&display=swap');\n\n:root {\n  --nu-color-bg-app: #170a22;\n  --nu-color-bg-primary: #20112f;\n  --nu-color-bg-secondary: #2a1640;\n  --nu-color-bg-tertiary: #3a1f52;\n  --nu-color-bg-elevated: #4b2a68;\n\n  --nu-color-text-primary: #fdf5ff;\n  --nu-color-text-secondary: #d8b8ee;\n  --nu-color-text-muted: #9c7eb3;\n  --nu-color-text-link: #4be0ff;\n\n  --nu-color-accent: #ff2f92;\n  --nu-color-accent-hover: #ff5cae;\n  --nu-color-accent-2: #00e0ff;\n  --nu-color-accent-2-hover: #3ce9ff;\n  --nu-color-danger: #ff4d67;\n  --nu-color-danger-2: #ff8a3d;\n  --nu-color-success: #39ff8a;\n  --nu-color-warning: #ffd23f;\n  --nu-color-on-accent: #fff8fd;\n  --nu-color-role-admin: #ffd23f;\n  --nu-color-role-moderator: #00e0ff;\n\n  --nu-color-border: #5a3478;\n\n  --nu-gradient-accent: linear-gradient(180deg, var(--nu-color-accent), var(--nu-color-accent-2));\n  --nu-gradient-accent-hover: linear-gradient(180deg, var(--nu-color-accent-hover), var(--nu-color-accent-2-hover));\n  --nu-gradient-accent-diagonal: linear-gradient(160deg, var(--nu-color-accent), var(--nu-color-accent-2));\n  --nu-gradient-danger: linear-gradient(180deg, var(--nu-color-danger), var(--nu-color-danger-2));\n\n  --nu-radius-sm: 8px;\n  --nu-radius-md: 11px;\n  --nu-radius-lg: 16px;\n  --nu-radius-tile: 16px;\n\n  --nu-font-body: 'Nunito', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;\n  --nu-font-display: 'Baloo 2', var(--nu-font-body);\n}`,
  },
  {
    name: 'Lola',
    swatch: ['#0a0508', '#ff1f8f'],
    css: `:root {\n  --nu-color-bg-app: #0a0508;\n  --nu-color-bg-primary: #120a10;\n  --nu-color-bg-secondary: #180e15;\n  --nu-color-bg-tertiary: #24141e;\n  --nu-color-bg-elevated: #2e1a27;\n\n  --nu-color-text-primary: #fff3f8;\n  --nu-color-text-secondary: #e2a8c4;\n  --nu-color-text-muted: #8f6577;\n  --nu-color-text-link: #ff7ab8;\n\n  --nu-color-accent: #ff1f8f;\n  --nu-color-accent-hover: #ff4aa8;\n  --nu-color-accent-2: #ff8ec4;\n  --nu-color-accent-2-hover: #ffb3d9;\n  --nu-color-on-accent: #fff3f8;\n\n  --nu-color-danger: #ff2d55;\n  --nu-color-danger-2: #ff5c7a;\n\n  --nu-color-border: #3a1f2c;\n  --nu-color-backdrop: rgba(0, 0, 0, 0.75);\n  --nu-color-backdrop-strong: rgba(0, 0, 0, 0.92);\n}`,
  },
  {
    name: 'Foxy',
    swatch: ['#fffaf5', '#e8590c'],
    css: FOXY_CSS,
  },
  {
    name: 'Halloween',
    swatch: ['#060408', '#ff7518'],
    css: HALLOWEEN_CSS,
  },
];

/**
 * The "Loading a theme" mechanism docs/theming.md planned ahead of time (Phase 4). Mostly a raw-
 * CSS editor — this is a single-user, self-hosted app, so "write your own :root overrides"
 * covers the real use case without needing to ship and maintain a big preset library. The couple
 * of THEME_PRESETS above are just convenience starting points, explicitly requested, not a
 * general picker system. See app/theme.ts for how the CSS is stored and injected.
 */
export function AppearanceSettings() {
  const [css, setCss] = useState(() => getStoredThemeCss());
  const [justApplied, setJustApplied] = useState(false);
  // Rules of the applied theme that were left out because they could read the page (themeSanitize.ts).
  const [leftOut, setLeftOut] = useState<string[]>([]);

  const handleApply = () => {
    setLeftOut(saveThemeCss(css));
    setJustApplied(true);
    setTimeout(() => setJustApplied(false), 1500);
  };

  const handleReset = () => {
    setCss('');
    setLeftOut(saveThemeCss(''));
  };

  const handleFile = (evt: ChangeEvent<HTMLInputElement>) => {
    const file = evt.target.files?.[0];
    evt.target.value = '';
    if (!file) return;
    file.text().then(setCss);
  };

  return (
    <div className="nu-appearance-settings" data-nu-role="appearance-settings">
      <EffectsSettings />
      <EmbedDisplaySetting />
      <FeedBackgroundSetting />
      <p className="nu-field__hint">
        Override any token below in a <code>:root</code> rule to reskin the app. Applied
        instantly, saved to this browser only (not synced to your account).
      </p>
      <div className="nu-appearance-settings__presets" data-nu-role="appearance-settings-presets">
        {THEME_PRESETS.map((preset) => (
          <button
            key={preset.name}
            type="button"
            className="nu-appearance-settings__preset"
            data-nu-role="appearance-settings-preset"
            onClick={() => setCss(preset.css)}
          >
            <span
              className="nu-appearance-settings__preset-swatch"
              style={{
                background: `linear-gradient(135deg, ${preset.swatch[0]}, ${preset.swatch[1]})`,
              }}
              aria-hidden="true"
            />
            {preset.name}
          </button>
        ))}
      </div>
      <textarea
        className="nu-appearance-settings__editor"
        data-nu-role="appearance-settings-editor"
        value={css}
        onChange={(e) => setCss(e.target.value)}
        placeholder={EXAMPLE_CSS}
        spellCheck={false}
        rows={8}
      />
      <div className="nu-appearance-settings__actions">
        <label className="nu-button nu-button--secondary nu-file-picker">
          Load from file
          <input
            type="file"
            accept=".css,text/css"
            data-nu-role="appearance-settings-file-input"
            onChange={handleFile}
          />
        </label>
        <button
          type="button"
          className="nu-button nu-button--secondary"
          data-nu-role="appearance-settings-reset"
          onClick={handleReset}
          disabled={!css}
        >
          Reset to default
        </button>
        <button
          type="button"
          className="nu-button nu-button--primary"
          data-nu-role="appearance-settings-apply"
          onClick={handleApply}
        >
          {justApplied ? 'Applied ✓' : 'Apply'}
        </button>
      </div>
      {leftOut.length > 0 && (
        <div className="nu-field__error" role="status" data-nu-role="appearance-settings-left-out">
          <p>
            {leftOut.length === 1 ? 'One rule was' : `${leftOut.length} rules were`} left out: they match on what an attribute
            holds (a typed value, a name, a link), which a theme can use to send what's on your screen elsewhere. Target
            parts of the app with <code>[data-nu-role="…"]</code> instead.
          </p>
          <ul>
            {leftOut.map((selector, i) => (
              <li key={i}>
                <code>{selector}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
      <details className="nu-appearance-settings__reference">
        <summary>Available tokens</summary>
        <ul className="nu-appearance-settings__reference-list">
          {TOKEN_REFERENCE.map(([token, description]) => (
            <li key={token}>
              <code>{token}</code> — {description}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

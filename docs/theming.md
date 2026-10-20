# Theming Purrlor

Purrlor supports fully custom CSS themes — not a fixed set of preset toggles. This document is
the contract theme authors (and future us) rely on. Treat renaming anything listed here as a
breaking change.

**Working on a theme?** Open the app with `?demo` (see the README's "Demo mode"). It renders the
whole UI — populated channel list, timeline with Markdown and reactions, member list, modals,
settings, voice join/error states — against fabricated data with no homeserver, so you can
iterate on a stylesheet without needing a live account or a Space full of real messages to look
at. The one thing it can't show you is the inside of a connected call.

## Two layers

1. **Token layer** (`apps/web/src/styles/tokens.css`) — CSS custom properties on `:root` for
   color, spacing, radius, and typography. Overriding a handful of variables reskins most of
   the app. This is the easy 90% case.
2. **Structural selectors** — every structurally meaningful element carries a stable `nu-`
   prefixed BEM class and/or a `data-nu-role="..."` attribute. These never come from CSS
   Modules or CSS-in-JS (no hashed class names), specifically so a theme's raw CSS can target
   them reliably across rebuilds. A full custom stylesheet, loaded at runtime after the base
   styles, can override anything reachable through these selectors — see "Loading a theme"
   below.

## Naming convention

- Prefix: `nu-` (namespaces against LiveKit's own default component CSS and any third-party
  CSS pulled in later). It comes from the project's old name, NekoUs, and stays as-is: it's the
  contract every saved custom theme targets.
- BEM: `nu-block`, `nu-block__element`, `nu-block--modifier`.
- `data-nu-role="..."` is added alongside classes for elements a theme is likely to select
  independent of current visual state (e.g. `data-nu-role="voice-tile"` regardless of
  mute/speaking modifier classes).
- Rule of thumb for what gets a hook: would a theme author plausibly want to select this?
  Pure implementation-detail styling (a one-off layout hack inside a settings modal nobody
  would reskin) can use scoped/local styles instead — the rule is "structural/component-identity
  classes must be stable strings," not "no build tooling ever."

## Current token reference

| Token | Purpose |
|---|---|
| `--nu-color-bg-app` | Outermost app background (server rail) |
| `--nu-color-bg-primary` | Channel list / member list background |
| `--nu-color-bg-secondary` | Main content pane background |
| `--nu-color-bg-tertiary` | Inputs, recessed surfaces |
| `--nu-color-bg-elevated` | Popovers, menus |
| `--nu-color-text-primary` / `-secondary` / `-muted` | Text hierarchy |
| `--nu-color-text-link` | Links |
| `--nu-color-accent` / `-accent-hover` | Primary action color (gradient's first stop) |
| `--nu-color-accent-2` / `-accent-2-hover` | Gradient's second stop — buttons, active rows, and gradient text are two-tone, not flat, so this is the other half of that gradient |
| `--nu-color-on-accent` | Text/icons drawn on top of accent/danger/success/warning — a button's label, a badge's count. One token so a theme that picks a light/pastel accent only has to repoint this once, not hunt down every button that happens to sit on that color |
| `--nu-color-scheme` | `dark` or `light`: which way the browser's own controls lean (checkboxes, `<select>` menus, date pickers, scrollbars). Every preset but Foxy is `dark`; a light theme sets `light`. Native checkboxes and sliders also take `--nu-color-accent` |
| `--nu-name-ink-mix` | How far a person's name color in chat (their chosen one, a custom role's, or the hue picked from their name) is mixed toward `--nu-color-text-primary`. `0%` on the dark themes, where those pale colors read as they are; a light theme raises it (Foxy: `55%`) so they darken enough to read |
| `--nu-color-danger` / `-danger-2` / `-success` / `-warning` | Status colors (`-danger-2` is danger's gradient second stop, same idea as `-accent-2`) |
| `--nu-color-role-admin` / `-role-moderator` | Name color (timeline and member list) and group swatch for members with that role — see `matrix/roles.ts` for the power-level tiers |
| `--nu-color-border` / `-border-strong` | Hairline borders/dividers; the stronger one edges the main pane, dialogs and outlined buttons |
| `--nu-color-panel` / `-panel-main` / `-rail` | The glass of the side panels, the main pane and the server rail (mixed from the `bg-*` colors by default) |
| `--nu-color-hover` | A row or button being pointed at |
| `--nu-frame-gap` / `-blur` / `-shadow` / `-bracket` | The Ultimit frame (`styles/base/frame.css`): space between the panels, their glass blur and shadow, and the corner brackets' color (`transparent` hides them) |
| `--nu-frame-status-space` | Room above the member list for the clock (`app/StatusClock.tsx`) |
| `--nu-clip-cut` / `--nu-clip-avatar` | Cut corners on buttons and on avatars; `none` gives plain shapes back |
| `--nu-label-transform` / `-tracking` | Buttons, tabs and section labels in spaced capitals (`none` / `0` for ordinary type) |
| `--nu-rail-label-display` / `--nu-rail-row-gap` | The names under the server rail's tiles (`none` hides them) and the gap that leaves room for them |
| `--nu-wallpaper-opacity` | The shard wallpaper (`components/Wallpaper.tsx`); `0` hides it |
| `--nu-post-background` / `-border` / `-divider` / `-radius` / `-padding` | A post in a feed: by default a row with a rule above it; Nightfur sets them back to cards |
| `--nu-composer-label` / `--nu-composer-label-display` | The label over the post composer's box (`none` hides it) |
| `--nu-ticker-height` | The notification ticker's strip along the bottom (`NotificationTicker.tsx`) |
| `--nu-width-feed-side` | The global feed's side column (your profile, trending tags), on screens 1180px and wider |
| `--nu-wall-ground-start` / `-ground-end` / `-shard` / `-edge` / `-grid` / `-shade` / `-blend` | The wallpaper's colors: its background gradient, the shards, their edges, the hex grid and ring, their shading, and how shards blend (`screen` on dark, `normal` on light) |
| `--nu-color-backdrop` | Dimming behind a modal / the recovery-key prompt |
| `--nu-color-backdrop-strong` | Darker dimming behind the image lightbox specifically |
| `--nu-gradient-accent` / `-accent-hover` / `-accent-diagonal` / `-accent-text` / `-danger` | Gradients built from the color tokens above — repoint the two flat colors rather than these directly unless you want a genuinely different gradient shape |
| `--nu-space-half` | 2px — tight list-row gaps (below the smallest step of the space scale) |
| `--nu-space-1` … `--nu-space-6` | Spacing scale (4px–24px) |
| `--nu-radius-sm` / `-md` / `-lg` / `-full` | Corner radii (all 0 by default, plus pill) |
| `--nu-radius-avatar` / `-dot` | People's pictures and presence/unread dots (square by default; `9999px` for circles) |
| `--nu-radius-tile` | The server rail's square space icons, and anything drawn to match them (the space card icon, a channel's welcome icon) |
| `--nu-font-body` | Base font stack — body copy, message text |
| `--nu-font-display` | Only where a name is the headline: the space name, channel titles, a channel's welcome header (Michroma by default) |
| `--nu-font-mono` | Code |
| `--nu-font-label` | Small console text: section labels, times, counts, the clock (the mono face by default) |
| `--nu-font-size-xs` / `-sm` / `-md` / `-lg` / `-xl` | Font sizes (11.5/13.5/15/17/24px) |
| `--nu-font-size-message` | Message text, the sender's name above it, and the composer (16px) |
| `--nu-width-server-rail` / `-channel-list` / `-member-list` | Shell column widths |
| `--nu-height-header` | Shared height of the three column headers, so their bottom borders line up |

The default theme also names eight reusable animation keyframes in `tokens.css` — `nu-spin`,
`nu-pulse-glow`, `nu-bounce-dot`, `nu-pop-in`, `nu-twinkle`, `nu-rise-in` (a card arriving),
`nu-fade-in` (a menu or backdrop), `nu-dialog-in` (a modal's panel) — a custom theme's own CSS can
reference any of them by name (`animation: nu-pop-in .4s ...`) instead of redefining them. `nu-ears-up` is the
selected server tile's cat-ear entrance.

Every icon is an inline SVG (`components/Icon.tsx`) drawn in `currentColor` and tagged
`data-nu-icon="<name>"`, so recoloring a button recolors its icon, and a theme can target one
icon (`[data-nu-icon="paw"]`) without a class of its own.

Two floating icon buttons — the image lightbox's close button and the voice panel's
screen-share pop-out button — deliberately do **not** use these tokens for their own
background/text color: they sit on top of an arbitrary photo or screen share, not app chrome,
so a translucent-white control that reads on any image is the right call regardless of theme.
See the comments on `.nu-lightbox__close` and `.nu-voice-panel__screen-share-popout`.

This table grows as new components ship — update it in the same change that adds a token.

## Current structural hooks

| Selector | Element |
|---|---|
| `data-nu-role="app-shell"` | Root shell grid (`.nu-shell`) |
| `data-nu-role="server-rail"` | Left server/space icon rail (`.nu-server-rail`) |
| `data-nu-role="server-rail-home"` | Home (the dashboard), first section tile on the rail |
| `data-nu-role="server-rail-global-feed"` / `-messages` | The Feed and Messages (DMs and Spaces) section tiles |
| `data-nu-role="server-rail-profile"` / `-settings` | Your profile and Account Settings, at the foot of the rail |
| `data-nu-role="server-rail-list"` | Container for per-Space icons |
| `data-nu-role="server-rail-item"` | One Space's icon button |
| `data-nu-role="server-rail-add"` | "Create a Space" button, pinned after the space list |
| `data-nu-role="channel-list"` | Second column, room list (`.nu-channel-list`) |
| `data-nu-role="channel-list-header"` / `-body` | Channel list header / scrollable body |
| `data-nu-role="channel-list-item"` | One room's row (channel or DM) in the channel list |
| `data-nu-role="channel-list-empty"` | Empty state when a space has no channels |
| `data-nu-role="channel-list-add"` | "Create Channel" button (space view only) |
| `data-nu-role="create-channel-type"` (`.nu-channel-type-choice`) | Text/Voice choice in the create-channel form |
| `data-nu-role="voice-panel"` (`.nu-voice-panel`) | Main pane content for a selected voice channel (join screen, connecting, error, or the live call) |
| `.nu-voice-participants` / `.nu-voice-participant` (`--speaking`) | Voice call's participant grid; speaking state is an outline modifier, not JS-driven inline style |
| `.nu-voice-participant__muted` | Mic-muted badge on a participant's tile |
| `.nu-voice-panel__screen-share` | Container for the active screen-share video, when present |
| `data-nu-role="voice-controls"` (`.nu-voice-controls`) | Mic/deafen/screen-share/leave control bar |
| `.nu-voice-control-button` (`--active`, `--leave`) | Individual control-bar buttons |
| `data-nu-role="channel-list-settings"` | "Space Settings" button (space view only, permission-gated) |
| `data-nu-role="main-pane"` | Timeline content area (`.nu-main-pane`) |
| `data-nu-role="main-pane-header"` | Selected channel's header bar |
| `data-nu-role="main-pane-empty"` | Empty state shown with no channel selected |
| `data-nu-role="main-pane-pins"` | Header button opening the Pinned Messages panel |
| `data-nu-role="topic-banner"` / `-dismiss` | Dismissible channel-topic announcement strip |
| `data-nu-role="typing-indicator"` | "X is typing…" strip above the composer |
| `data-nu-role="timeline"` | Scrollable message list |
| `data-nu-role="timeline-loading"` | Pagination "loading more" indicator at the top of the timeline |
| `data-nu-role="timeline-message"` | One rendered message |
| `data-nu-role="timeline-image"` | An `m.image` message's inline image |
| `data-nu-role="timeline-pinned-tag"` | "📌 Pinned" label on a pinned message |
| `data-nu-role="timeline-readers"` | Read-receipt avatar stack under a message |
| `data-nu-role="timeline-pin-action"` | Hover-revealed Pin/Unpin button on a message |
| `data-nu-role="pinned-messages-empty"` / `-list` / `-item` / `-unpin` | Pinned Messages panel contents |
| `data-nu-role="composer"` / `-input` | Message composer form / text input |
| `data-nu-role="emote"` (`.nu-emote`) | An inline custom emote image (animates natively for GIF/WebP) |
| `data-nu-role="emote-picker-toggle"` / `-panel` / `-manage` | Composer's emote-picker button, its popover, and the "Manage Emotes" entry inside it |
| `data-nu-role="emote-manager-list"` | Emote list inside the Manage Emotes modal |
| `data-nu-role="avatar"` (`.nu-avatar`) | Shared avatar — used in the server rail, channel list, timeline, and member list |
| `data-nu-role="avatar-status-dot"` | Online/offline presence dot overlaid on an avatar (member list, DM rows) |
| `data-nu-role="member-list-group"` | "Online"/"Offline" section label in the member list |
| `data-nu-role="lightbox"` / `-close` | Full-screen in-app image viewer opened from a timeline image |
| `data-nu-role="modal"` / `-close` (`.nu-modal`) | Shared centered-panel overlay used by create-space/create-channel/space-settings |
| `.nu-modal-form`, `.nu-field`, `.nu-button` (see `styles/base/form.css`) | Shared form/button classes used by any modal or settings form |
| `.nu-modal-tabs` / `.nu-modal-tab` (`--active`) (see `styles/base/form.css`) | Shared tab-strip styling for any multi-section modal (Space Settings, Account Settings) — each modal's tab *container* still carries its own specific `data-nu-role` below |
| `data-nu-role="space-settings-tabs"` | General/Members tab strip in Space Settings |
| `data-nu-role="account-settings-tabs"` | Account/Appearance tab strip in Account Settings |
| `data-nu-role="appearance-settings"` | Appearance tab body (`AppearanceSettings.tsx`) |
| `data-nu-role="appearance-settings-presets"` / `-preset` | Built-in preset row / one preset chip — loads that preset's CSS into the editor, same as "Load from file" |
| `data-nu-role="appearance-settings-editor"` | The custom-CSS textarea itself |
| `data-nu-role="appearance-settings-apply"` / `-reset` | Apply / Reset-to-default buttons |
| `data-nu-role="space-members"` / `-row` / `-set-role` | Member list, one row, and a role-assignment button in Space Settings → Members |
| `data-nu-role="member-list"` | Right member panel (`.nu-member-list`) |
| `data-nu-role="member-list-header"` / `-body` | Member list header / scrollable body |
| `data-nu-role="member-list-item"` | One member's row |
| `data-nu-role="login-screen"` | Login form container |
| `data-nu-role="login-error"` | Login error message |
| `data-nu-role="wallpaper"` (`.nu-wallpaper`) | The shard wallpaper behind the shell and the sign-in screen |
| `data-nu-role="status-clock"` (`.nu-status-clock`) | The 12-hour clock and status lines above the member list |
| `data-nu-role="rail-clock"` (`.nu-rail-clock`) | The small clock at the foot of the server rail, shown when there is no member list |
| `data-nu-role="notification-ticker"` (`.nu-ticker`) | The notification ticker along the bottom; opens Notifications |
| `data-nu-role="feed-side"` / `-profile` / `-trending` / `-tag` (`.nu-feed-side`) | The global feed's side column: your profile card, and trending tags |
| `data-nu-role="effects-settings"` | Appearance → Effects (Auto, Full, Safe) and the ticker switch |
| `data-nu-role="register-screen"` | Registration form container |
| `data-nu-role="register-error"` | Registration error message |
| `data-nu-role="modal"` (see `Modal.tsx`) | Also hosts the Terms-of-Service and email-verification prompts during registration |
| `data-nu-role="recovery-setup-screen"` | Post-registration "save your recovery key" full-screen takeover |
| `data-nu-role="recovery-setup-warning"` | The big warning box on that screen |
| `data-nu-role="recovery-setup-key"` | The displayed recovery key text |
| `data-nu-role="recovery-setup-continue"` | Continue button (disabled until the confirm checkbox is ticked) |
| `data-nu-role="recovery-prompt"` | Recovery-key decryption-unlock overlay |
| `data-nu-role="recovery-prompt-input"` / `-error` / `-success` | Recovery key field / error / result text |

## Loading a theme

Implemented: Account Settings → Appearance (`src/app/AppearanceSettings.tsx`) is a raw-CSS
editor — paste or load-from-file a stylesheet, hit Apply, and it's injected as a single
`<style id="nu-theme-override">` appended after the base stylesheet (`src/app/theme.ts`).
Cascade order does the overriding, no `!important` needed — a theme's own `:root { --nu-color-
accent: ...; }` beats the base token definition simply by loading later, and anything targeting
a `nu-` class or `data-nu-role` at equal-or-higher specificity than the base rule wins the same
way. The CSS is stored in `localStorage` (single browser, single user — not synced to the
Matrix account, not shared with anyone) and re-applied on every load via `applyStoredThemeOnLoad()`, called from `main.tsx` before React renders anything.

Mostly **not** a picker over a set of built-in presets: this is a single-user, self-hosted app,
so "write your own overrides" covers the real use case without this project shipping and
maintaining a big look-and-feel library. The panel embeds a condensed copy of the token table
above so a theme author doesn't have to come find this file to know what's overridable.

The one exception is `THEME_PRESETS` in `AppearanceSettings.tsx` — a couple of explicitly
requested, ready-made starting points ("Y2K Chatroom", the old default; "Lola", a
black-and-hot-pink palette; "Halloween") rendered as swatch chips above the editor. Clicking one
loads its CSS into the textarea (it still isn't applied until Apply, same as "Load from file")
rather than a hidden or hard-to-edit choice. Most presets only override *color* tokens — the
gradient/radius/font/animation tokens are derived from those in `tokens.css`, so a preset
reskins the whole app without redefining shape or motion.

"Halloween" (`src/app/themes/halloween.ts`) is the worked example of going further while staying
an ordinary theme: pumpkin and cat-eye colors and Creepster for display text, then rules on `nu-`
classes and `data-nu-role`s that dress the mascot up. The selected Space's cat ears turn black, a
black cat sits on the user panel swishing its tail, and eyes blink in the dark at the bottom of the
rail. The empty screen gets a cat under a harvest moon, channel welcomes a cat-faced
jack-o'-lantern, and the main pane a cobweb with a spider on its thread, fog, and bats now and then.
Every picture is an SVG in a `data:` URI (written out readably in the module, encoded when the
preset is built), so the CSS stands alone wherever it's pasted and stays inside the CSP. The
CSS-driven motion sits in `@media (prefers-reduced-motion: no-preference)`. Its test checks that
the sanitizer keeps every rule and that each SVG parses, and `e2e/security.spec.ts` applies it
under production's CSP.

The shipped default ("Y2K Chatroom") keeps Discord's layout — server rail, channel list, main
timeline, member list — but leans into a glossy, candy-gradient, early-2000s-internet look
(originally planned as a Claude Design canvas before being carried over into the real token/CSS
layer) rather than a flat/muted clone. It's still just *a* theme sitting on the same mechanism
described above: anyone who wants something else entirely — including a flatter, more
Discord-literal look — reskins it the same way any other custom theme would, by overriding the
tokens and selectors in this document, not by patching the shipped CSS.

**Themes from other people.** "Load from file" means a theme can come from anyone, and CSS can leak
what's on the page without running code: a rule like `input[value^="a"] { background: url(…) }`
fetches a different address for each letter typed. Two things stop that:

- The Content-Security-Policy (`apps/web/deploy/security-headers.conf`, docs/deployment.md,
  "Security headers") lets `@import` and fonts load only from the app and Google Fonts. Background
  images may come from any `https` address, since themes use them.
- `app/themeSanitize.ts` leaves out every rule whose selector matches on an attribute's value,
  unless the attribute is one of the app's own presentational ones: `data-nu-role`, `data-nu-icon`
  and the other `data-nu-*` (except `data-nu-event-id` and `data-nu-link`), `class`, `id`, `type`,
  ARIA states. Presence checks (`[title]`) are fine. Appearance settings lists any rule it left out.
  The theme is saved as written, so editing it later shows what you wrote.

A theme that targets the documented tokens and `[data-nu-role="…"]` selectors is never changed.

## Effects: Full and Safe

Appearance → Effects picks how much of the frame a device draws (`app/effects.ts`), kept per device. **Full** is the glass, blur, wallpaper and animations. **Safe** keeps the layout and colors but drops the wallpaper, every `backdrop-filter`, translucency, shadows and animation, for a machine without a graphics card. **Auto**, the default, picks Safe when the browser draws in software (WebGL's renderer is SwiftShader, llvmpipe and the like) or the system asks for less motion. It's `data-nu-effects="full|safe"` on `<html>`, so a theme can style either: `html[data-nu-effects='safe'] …`. Safe's rules outrank a theme's `:root`, so a theme can't turn the costly parts back on for a device that asked for Safe.

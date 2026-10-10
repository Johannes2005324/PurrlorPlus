/**
 * Royal Neon: a contributed theme, "inspired by the Purrlor crowned-cat logo". Black and violet
 * fur, electric purple, hot magenta, lavender and royal gold, with a purple cat looking out from
 * behind the panels.
 *
 * Worked into the Ultimit frame from the original (a theme for the flat columns before it):
 * - Its colors, glows and hovers are kept as they were.
 * - The cat art (public/themes/royal-neon-cat.webp, the contributed PNG as WebP) is the frame's
 *   wallpaper instead of the shards, so it shows through the glass panels and in the gaps between
 *   them; the original drew it darkened inside the chat pane. Safe effects leave it out like any
 *   wallpaper (app/effects.ts).
 * - Its slow purple aura breathes over the wallpaper; the chat pane's own ::before is the frame's
 *   corner bracket now.
 * - The frame's fonts and square shapes stay; the original's Figtree, Dela Gothic and rounded
 *   corners were the old default's.
 * - Its admin/moderator/online rules matched `[class*="…"]`, which the theme sanitizer
 *   (themeSanitize.ts) leaves out, so they name the classes instead.
 */
export const ROYAL_NEON_CSS = `/* Royal Neon: purple fur, hot magenta and royal gold, with the cat behind the glass. */
:root {
  --nu-color-bg-app: #08050d;
  --nu-color-bg-primary: #0d0813;
  --nu-color-bg-secondary: #130b1b;
  --nu-color-bg-tertiary: #1b0e25;
  --nu-color-bg-elevated: #261333;

  --nu-color-text-primary: #f8edff;
  --nu-color-text-secondary: #c9afd6;
  --nu-color-text-muted: #9a80a6;
  --nu-color-text-link: #e2a0ff;

  --nu-color-accent: #a900ff;
  --nu-color-accent-hover: #c600ff;
  --nu-color-accent-2: #ff00d9;
  --nu-color-accent-2-hover: #ff43e2;
  --nu-color-on-accent: #ffffff;

  --nu-color-danger: #ff3f91;
  --nu-color-danger-2: #ff6ab0;
  --nu-color-success: #c5ff72;
  --nu-color-warning: #ffc247;

  --nu-color-role-admin: #ffc329;
  --nu-color-role-moderator: #e05cff;

  --nu-color-border: rgba(183, 0, 255, 0.2);
  --nu-color-border-strong: rgba(214, 120, 255, 0.5);
  --nu-color-backdrop: rgba(6, 2, 10, 0.76);
  --nu-color-backdrop-strong: rgba(4, 2, 7, 0.94);

  --nu-gradient-accent: linear-gradient(180deg, var(--nu-color-accent-hover), var(--nu-color-accent));
  --nu-gradient-accent-hover: linear-gradient(180deg, #d500ff, #a900ff);
  --nu-gradient-accent-diagonal: linear-gradient(135deg, #8f00ff, #ff00d9);
  --nu-gradient-accent-text: linear-gradient(90deg, #e9b2ff, #ff55e8);
  --nu-gradient-danger: linear-gradient(180deg, #ff4c98, #ff2e7f);

  /* The frame in Royal Neon: magenta brackets, and glass dark enough over the cat to read on. */
  --nu-frame-bracket: #ff00d9;
  --nu-color-panel: color-mix(in srgb, var(--nu-color-bg-primary) 78%, transparent);
  --nu-color-panel-main: color-mix(in srgb, var(--nu-color-bg-primary) 82%, transparent);
  --nu-frame-shadow: 0 24px 70px rgba(0, 0, 0, 0.5), 0 0 45px rgba(169, 0, 255, 0.06);

  --purrlor-lavender: #e8b5ff;
  --purrlor-gold: #ffc329;
  --purrlor-pink: #ff67ec;

  scrollbar-color: #3a2050 transparent;
}

/* The cat, in place of the shard wallpaper: looking out from the right, behind the panels. */
.nu-wallpaper {
  background:
    radial-gradient(ellipse at 50% -20%, rgba(169, 0, 255, 0.08), transparent 45%),
    url("/themes/royal-neon-cat.webp") right bottom / cover no-repeat,
    var(--nu-color-bg-app);
}

.nu-wallpaper svg {
  display: none;
}

/* Its aura, breathing slowly over the cat. */
.nu-wallpaper::after {
  content: "";
  position: absolute;
  right: 8%;
  bottom: 6%;
  width: 46%;
  height: 56%;
  pointer-events: none;
  background: radial-gradient(ellipse, rgba(169, 0, 255, 0.1), transparent 68%);
  filter: blur(18px);
  animation: purrlor-cat-aura 8s ease-in-out infinite;
}

@keyframes purrlor-cat-aura {
  0%,
  100% {
    opacity: 0.3;
    transform: scale(1) translate3d(0, 0, 0);
  }
  50% {
    opacity: 0.52;
    transform: scale(1.018) translate3d(-4px, -2px, 0);
  }
}

.nu-server-rail {
  background: linear-gradient(180deg, rgba(169, 0, 255, 0.055), transparent 40%), var(--nu-color-rail);
}

/* Titles with a faint violet glow. */
.nu-main-pane__header-name,
.nu-channel-list h1,
.nu-channel-list h2,
.nu-channel-list h3 {
  text-shadow: 0 0 16px rgba(169, 0, 255, 0.22);
}

/* Channels: a violet-to-magenta wash and a magenta edge when pointed at. */
.nu-channel-list__item:hover {
  background: linear-gradient(90deg, rgba(169, 0, 255, 0.13), rgba(255, 0, 217, 0.035));
  box-shadow: inset 2px 0 0 rgba(255, 0, 217, 0.55);
}

/* Space hexagons lift and glow. */
.nu-server-rail__hex,
.nu-server-rail__glyph {
  transition: transform 0.18s ease, filter 0.18s ease;
}

.nu-server-rail__item:hover .nu-server-rail__hex,
.nu-server-rail__item:hover .nu-server-rail__glyph {
  transform: translateY(-2px) scale(1.045);
  filter: drop-shadow(0 0 6px rgba(255, 0, 217, 0.3)) drop-shadow(0 0 10px rgba(169, 0, 255, 0.18));
}

/* Messages: a faint violet wash when pointed at. */
[data-nu-role="timeline-message"]:hover {
  background: linear-gradient(90deg, rgba(169, 0, 255, 0.06), rgba(255, 0, 217, 0.015), transparent);
}

/* Links glow lavender. */
.nu-main-pane a:hover {
  color: var(--purrlor-lavender);
  text-shadow: 0 0 8px rgba(226, 160, 255, 0.2);
}

/* The composer and fields: violet edges, a magenta glow when typing. */
.nu-composer__input:focus,
.nu-field__input:focus,
.nu-field__textarea:focus {
  box-shadow: 0 0 0 1px rgba(255, 0, 217, 0.12), 0 0 20px rgba(169, 0, 255, 0.12);
}

.nu-button:hover:not(:disabled),
.nu-main-pane__header-action:hover {
  box-shadow: 0 0 12px rgba(169, 0, 255, 0.18);
}

/* Members: royal gold for admins, pink for moderators, a lime glow for who's online. */
.nu-member-list__item:hover {
  background: rgba(169, 0, 255, 0.055);
}

.nu-member-list__item--admin .nu-member-list__item-name {
  color: var(--purrlor-gold);
  text-shadow: 0 0 8px rgba(255, 195, 41, 0.16);
}

.nu-member-list__item--moderator .nu-member-list__item-name {
  color: var(--purrlor-pink);
  text-shadow: 0 0 7px rgba(255, 0, 217, 0.15);
}

.nu-avatar__status-dot--online {
  box-shadow: 0 0 8px rgba(197, 255, 114, 0.38);
}

/* Dialogs: deep violet glass. */
.nu-modal__panel {
  background: linear-gradient(145deg, rgba(34, 14, 45, 0.98), rgba(8, 4, 12, 0.98));
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.72), 0 0 45px rgba(169, 0, 255, 0.08);
}

/* Code: near-black with a violet edge. */
pre,
code {
  background: #09040d;
  border-color: rgba(169, 0, 255, 0.12);
  color: #e8d0f3;
}

pre {
  box-shadow: inset 0 0 25px rgba(169, 0, 255, 0.025);
}

/* Scrollbars: a purple-to-magenta thumb. */
*::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, #8f00ff, #ff00d9);
}

*::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(180deg, #c000ff, #ff55e9);
}

::selection {
  background: rgba(255, 0, 217, 0.35);
  color: #ffffff;
}
`;

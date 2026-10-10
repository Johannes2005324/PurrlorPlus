/**
 * The Ultimit desktop's skins (github.com/m0nnnna/ultimit, docs/design/mockup.html) as presets.
 * "Mine", black glass and white shards, is the default look (styles/tokens.css); these are the
 * other three. Each only repoints color tokens, the wallpaper's among them: the frame, fonts and
 * shapes stay the default's.
 */

/** Loading Mine just clears a custom theme back to the default. */
export const MINE_CSS = `/* Mine: the default look. Apply to go back to it. */
`;

export const AMBER_CSS = `/* Amber: Ultimit's sunset skin. */
:root {
  --nu-color-bg-app: #1c0d03;
  --nu-color-bg-primary: #221105;
  --nu-color-bg-secondary: #28150a;
  --nu-color-bg-tertiary: #3a2010;
  --nu-color-bg-elevated: #4a2a14;

  --nu-color-text-primary: #fff4e6;
  --nu-color-text-secondary: #f0d2b0;
  --nu-color-text-muted: #dcb48c;
  --nu-color-text-link: #ffc77a;

  --nu-color-accent: #ffb04a;
  --nu-color-accent-hover: #ffc275;
  --nu-color-accent-2: #ffa3bd;
  --nu-color-accent-2-hover: #ffbdd0;
  --nu-color-on-accent: #2a1404;
  --nu-color-role-admin: #ffb04a;
  --nu-color-role-moderator: #ffa3bd;

  --nu-color-border: rgba(255, 226, 196, 0.2);
  --nu-color-border-strong: rgba(255, 226, 196, 0.55);

  --nu-wall-ground-start: #b84d05;
  --nu-wall-ground-end: #f8cf96;
  --nu-wall-shard: #fffaf2;
  --nu-wall-grid: #fff0dc;
  --nu-wall-shade: #783200;
}
`;

export const SILVER_CSS = `/* Silver: Ultimit's light skin. */
:root {
  --nu-color-scheme: light;

  --nu-color-bg-app: #e8ebef;
  --nu-color-bg-primary: #f8f9fb;
  --nu-color-bg-secondary: #ffffff;
  --nu-color-bg-tertiary: #eceff3;
  --nu-color-bg-elevated: #ffffff;

  --nu-color-text-primary: #14171b;
  --nu-color-text-secondary: #3a414b;
  --nu-color-text-muted: #545c67;
  --nu-color-text-link: #2c5b88;

  --nu-color-accent: #2c5b88;
  --nu-color-accent-hover: #3a6fa0;
  --nu-color-accent-2: #a8325e;
  --nu-color-accent-2-hover: #bf4271;
  --nu-color-on-accent: #ffffff;
  --nu-color-danger: #b3322a;
  --nu-color-danger-2: #c4561f;
  --nu-color-success: #1f7a49;
  --nu-color-warning: #8a5a00;
  --nu-color-role-admin: #8a5a00;
  --nu-color-role-moderator: #a8325e;

  --nu-color-border: rgba(20, 24, 30, 0.16);
  --nu-color-border-strong: rgba(20, 24, 30, 0.5);
  --nu-color-backdrop: rgba(40, 50, 65, 0.35);

  --nu-frame-shadow: 0 24px 70px rgba(40, 50, 65, 0.22);
  --nu-name-ink-mix: 55%;

  --nu-wall-ground-start: #f6f7f9;
  --nu-wall-ground-end: #aeb5bf;
  --nu-wall-shard: #ffffff;
  --nu-wall-edge: rgba(70, 82, 98, 0.45);
  --nu-wall-grid: #283241;
  --nu-wall-shade: #3c485a;
  --nu-wall-blend: normal;
}
`;

export const VERDANT_CSS = `/* Verdant: Ultimit's forest skin. */
:root {
  --nu-color-bg-app: #031005;
  --nu-color-bg-primary: #051408;
  --nu-color-bg-secondary: #07180a;
  --nu-color-bg-tertiary: #0d2612;
  --nu-color-bg-elevated: #143219;

  --nu-color-text-primary: #effbe9;
  --nu-color-text-secondary: #cfe8c4;
  --nu-color-text-muted: #a3cc95;
  --nu-color-text-link: #b9ff8c;

  --nu-color-accent: #b9ff8c;
  --nu-color-accent-hover: #d0ffb0;
  --nu-color-accent-2: #ffe08a;
  --nu-color-accent-2-hover: #ffeaa8;
  --nu-color-on-accent: #082008;
  --nu-color-role-admin: #ffe08a;
  --nu-color-role-moderator: #d6c8ff;

  --nu-color-border: rgba(220, 255, 205, 0.18);
  --nu-color-border-strong: rgba(220, 255, 205, 0.5);

  --nu-wall-ground-start: #062a0c;
  --nu-wall-ground-end: #79d24f;
  --nu-wall-shard: #f2ffec;
  --nu-wall-grid: #e6ffdc;
  --nu-wall-shade: #002800;
}
`;

/** Sakura: a pink skin in the same family, for Purrlor (Ultimit itself has no pink one). */
export const SAKURA_CSS = `/* Sakura: blossom pink. */
:root {
  --nu-color-bg-app: #1a0610;
  --nu-color-bg-primary: #22091a;
  --nu-color-bg-secondary: #2a0c20;
  --nu-color-bg-tertiary: #3b1430;
  --nu-color-bg-elevated: #4c1c3e;

  --nu-color-text-primary: #fff0f6;
  --nu-color-text-secondary: #f6cfe1;
  --nu-color-text-muted: #e0a9c3;
  --nu-color-text-link: #ffb3d6;

  --nu-color-accent: #ff8fc4;
  --nu-color-accent-hover: #ffaed4;
  --nu-color-accent-2: #c9b8ff;
  --nu-color-accent-2-hover: #dacdff;
  --nu-color-on-accent: #2a0614;
  --nu-color-role-admin: #ffd98f;
  --nu-color-role-moderator: #c9b8ff;

  --nu-color-border: rgba(255, 210, 230, 0.2);
  --nu-color-border-strong: rgba(255, 210, 230, 0.55);

  --nu-wall-ground-start: #5c0f35;
  --nu-wall-ground-end: #ffb3d1;
  --nu-wall-shard: #fff5fa;
  --nu-wall-grid: #ffe6f1;
  --nu-wall-shade: #6b0a38;
}
`;

/**
 * The Halloween preset: pitch black, pumpkin orange and cat-eye green, and a black cat (the
 * mascot) all over: black ears on the selected Space, one sitting on the user panel swishing its
 * tail, one under a harvest moon on the empty screen, eyes blinking in the dark at the bottom of
 * the rail. Plus a cat-faced jack-o'-lantern on every channel's welcome, a cobweb with a spider
 * going up and down its thread, fog, and bats flying past now and then.
 *
 * It's still just a theme (docs/theming.md): token overrides, then rules on the app's classes and
 * `data-nu-role`s, which themeSanitize.ts leaves alone. Every picture is an SVG in a data: URI,
 * so the CSS works standing alone wherever it's pasted or saved, inside the CSP (images may be
 * data:, fonts come from Google Fonts). The SVGs are written out here and encoded once below, so
 * they stay editable. Anything that moves only moves for people who haven't asked for less
 * motion; the blinking and the tail are SVG animation, which is slow and small enough to keep.
 */

const svg = (viewBox: string, body: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='${viewBox}'>${body}</svg>`)}")`;

const FUR = '#050307';
const EYE = '#c6ff3d';
const PUMPKIN = '#ff7518';

/** Glowing eyes that blink every few seconds, then black slit pupils (which vanish into the fur when the eye shuts). */
const catEyes = (left: number, right: number, y: number) => `
  <g fill='${EYE}'>
    ${[left, right]
      .map(
        (x) =>
          `<ellipse cx='${x}' cy='${y}' rx='2.3' ry='2.4'><animate attributeName='ry' dur='5s' repeatCount='indefinite' values='2.4;2.4;0.2;2.4' keyTimes='0;0.9;0.95;1'/></ellipse>`
      )
      .join('')}
  </g>
  <g fill='${FUR}'><ellipse cx='${left}' cy='${y}' rx='0.7' ry='1.9'/><ellipse cx='${right}' cy='${y}' rx='0.7' ry='1.9'/></g>`;

/** A black cat sitting, seen from the front, its tail curling up beside it and swishing. 56 × 44. */
const SITTING_CAT = `
  <g fill='${FUR}'>
    <path d='M15.6 12 15 2l6.5 5.5zM32.4 12 33 2l-6.5 5.5z'/>
    <circle cx='24' cy='15' r='9'/>
    <path d='M18 20c-6 5-8 14-7 24h26c1-10-1-19-7-24z'/>
  </g>
  <path fill='none' stroke='${FUR}' stroke-width='3.5' stroke-linecap='round' d='M35 42c9 1 13-3 12-10s3-9 6-7'>
    <animate attributeName='d' dur='4s' repeatCount='indefinite'
      values='M35 42c9 1 13-3 12-10s3-9 6-7;M35 42c9 1 13-3 14-10s0-10 3-10;M35 42c9 1 13-3 12-10s3-9 6-7'/>
  </path>
  ${catEyes(20.4, 27.6, 15)}`;

/** One bat, wings flapping, centred on 0,0 and 24 wide. */
const bat = (x: number, y: number, scale: number, begin: string) => `
  <g transform='translate(${x} ${y}) scale(${scale})' fill='${FUR}'>
    <path>
      <animate attributeName='d' dur='0.36s' begin='${begin}' repeatCount='indefinite'
        values='M-12-6Q-8 2-3 1L0 3 3 1Q8 2 12-6Q9 4 0 7Q-9 4-12-6z;M-12 6Q-8 2-3 1L0 3 3 1Q8 2 12 6Q9 4 0 7Q-9 4-12 6z;M-12-6Q-8 2-3 1L0 3 3 1Q8 2 12-6Q9 4 0 7Q-9 4-12-6z'/>
    </path>
    <path d='M-2 1.5-2.2-1.5-.8.4h1.6l1.4-1.9L2 1.5 0 4z'/>
  </g>`;

const MOON_SCENE = svg(
  '0 0 100 100',
  `<defs><radialGradient id='moon' cx='0.42' cy='0.38'><stop offset='0' stop-color='#ffe6b0'/><stop offset='1' stop-color='#f59a3c'/></radialGradient></defs>
  <circle cx='50' cy='42' r='30' fill='url(#moon)'/>
  <g fill='#d9782a' opacity='0.35'><circle cx='38' cy='30' r='5'/><circle cx='63' cy='38' r='3.5'/><circle cx='56' cy='22' r='2.5'/></g>
  ${bat(30, 20, 0.45, '0s')}${bat(72, 26, 0.35, '0.12s')}
  <path d='M0 100V96Q50 88 100 96v4z' fill='${FUR}'/>
  <g transform='translate(19 52) scale(1.1)'>${SITTING_CAT}</g>`
);

/** A jack-o'-lantern carved with a cat's face (almond eyes, a little nose, a whiskery mouth), candle flickering. */
const CAT_LANTERN = svg(
  '0 0 64 64',
  `<path d='M30 14c0-5 2-8 6-10l2 3c-3 1-4 4-4 7z' fill='#3f6b22'/>
  <ellipse cx='21' cy='37' rx='14' ry='20' fill='#e8600c'/>
  <ellipse cx='43' cy='37' rx='14' ry='20' fill='#e8600c'/>
  <ellipse cx='32' cy='37' rx='13' ry='22' fill='${PUMPKIN}'/>
  <g fill='#ffd84a' stroke='#ffd84a' stroke-linecap='round'>
    <path stroke='none' d='M15 31q7-8 13 0q-6 5-13 0zM36 31q7-8 13 0q-7 5-13 0zM29.5 38h5l-2.5 3z'/>
    <path fill='none' stroke-width='1.6' d='M26 44q3 3 6 0q3 3 6 0M12 39l9 2M12 44l9-1M52 39l-9 2M52 44l-9-1'/>
    <animate attributeName='opacity' dur='1.7s' repeatCount='indefinite' values='1;0.72;0.95;0.66;1'/>
  </g>
  <g fill='#5a2a06'><ellipse cx='21.5' cy='30' rx='0.9' ry='2.6'/><ellipse cx='42.5' cy='30' rx='0.9' ry='2.6'/></g>`
);

/** Eyes in the dark, for the bottom of the rail: they glow, blink now and then, and look around. */
const EYES_IN_THE_DARK = svg(
  '0 0 40 16',
  `<defs><filter id='glow'><feGaussianBlur stdDeviation='1.2'/></filter></defs>
  <g fill='${EYE}'>
    <g filter='url(#glow)' opacity='0.8'><ellipse cx='12' cy='8' rx='5' ry='3.4'/><ellipse cx='28' cy='8' rx='5' ry='3.4'/></g>
    <path d='M7.5 8Q12 3.6 16.5 8Q12 12.4 7.5 8zM23.5 8Q28 3.6 32.5 8Q28 12.4 23.5 8z'/>
    <animate attributeName='opacity' dur='7s' repeatCount='indefinite' values='1;1;0;1;1;0;1' keyTimes='0;0.6;0.62;0.64;0.8;0.82;1'/>
  </g>
  <g fill='${FUR}'>
    <ellipse cx='12' cy='8' rx='0.9' ry='3'/><ellipse cx='28' cy='8' rx='0.9' ry='3'/>
    <animateTransform attributeName='transform' type='translate' dur='9s' repeatCount='indefinite' values='0 0;0 0;-1.6 0;-1.6 0;1.6 0;1.6 0;0 0' keyTimes='0;0.3;0.35;0.55;0.6;0.85;1'/>
  </g>`
);

const COBWEB = svg(
  '0 0 120 120',
  `<path fill='none' stroke='rgba(235,225,255,0.16)' stroke-width='0.6' d='M120 0L2 0M120 0L6.6 32.5M120 0L21 64.3M120 0L44.2 90.4M120 0L75.8 109.4M120 0L120 118M104 0Q107.3 1.8 104.6 4.4Q108.4 5.3 106.6 8.7Q110.4 8.5 109.7 12.3Q113.4 11 114 14.8Q117.6 12.6 120 16M87 0Q93.9 3.7 88.3 9.1Q96 10.9 92.3 18Q100.2 17.5 98.8 25.3Q106.4 22.6 107.6 30.6Q115 25.9 120 33M68 0Q78.8 5.8 70 14.3Q82.1 17.3 76.4 28.3Q88.8 27.6 86.6 39.8Q98.6 35.7 100.5 48.2Q112.1 40.8 120 52M47 0Q62.2 8.1 49.8 20.1Q66.9 24.2 58.8 39.8Q76.3 38.7 73.1 55.9Q89.9 50.1 92.7 67.7Q108.9 57.3 120 73M24 0Q43.9 10.7 27.7 26.5Q50.1 31.8 39.5 52.3Q62.5 50.9 58.3 73.5Q80.4 65.8 84 89Q105.3 75.4 120 96'/>`
);

/** A spider letting itself down on its thread and climbing back up, slowly. 16 × 130. */
const SPIDER_DROP = "calcMode='spline' keyTimes='0;0.5;1' keySplines='0.45 0 0.55 1;0.45 0 0.55 1' dur='22s' repeatCount='indefinite'";
const SPIDER = svg(
  '0 0 16 130',
  `<line x1='8' y1='0' x2='8' y2='20' stroke='rgba(235,225,255,0.28)' stroke-width='0.6'>
    <animate attributeName='y2' values='20;112;20' ${SPIDER_DROP}/>
  </line>
  <g>
    <animateTransform attributeName='transform' type='translate' values='0 20;0 112;0 20' ${SPIDER_DROP}/>
    <path fill='none' stroke='${FUR}' stroke-width='1' stroke-linecap='round' d='M5 3 1-1 0-5M5 5H0l-1 3M5 7l-4 3v4M11 3l4-4 1-4M11 5h5l1 3M11 7l4 3v4'/>
    <g fill='${FUR}'><circle cx='8' cy='2.6' r='2.6'/><circle cx='8' cy='8.6' r='4.2'/></g>
    <g fill='#ff3b4e'><circle cx='7' cy='2.2' r='0.6'/><circle cx='9' cy='2.2' r='0.6'/></g>
  </g>`
);

const BATS = svg('0 0 90 40', `${bat(14, 22, 0.9, '0s')}${bat(46, 10, 1, '0.1s')}${bat(74, 28, 0.7, '0.22s')}`);

export const HALLOWEEN_CSS = `/* Halloween: a black cat's night out. Creepster for titles, everything else as usual. */
@import url('https://fonts.googleapis.com/css2?family=Creepster&display=swap');

:root {
  --nu-color-bg-app: #060408;
  --nu-color-bg-primary: #0d0910;
  --nu-color-bg-secondary: #120c16;
  --nu-color-bg-tertiary: #1c1321;
  --nu-color-bg-elevated: #261a2d;

  --nu-color-text-primary: #f3eadb;
  --nu-color-text-secondary: #c9b59c;
  --nu-color-text-muted: #84707e;
  --nu-color-text-link: #ffa04d;

  --nu-color-accent: ${PUMPKIN};
  --nu-color-accent-hover: #ff8f40;
  --nu-color-accent-2: #a56cff;
  --nu-color-accent-2-hover: #bc92ff;
  --nu-color-on-accent: #160b05;

  --nu-color-danger: #ff3b4e;
  --nu-color-danger-2: #ff6a3d;
  --nu-color-success: #8fe33b;
  --nu-color-warning: #ffc23d;
  --nu-color-role-admin: #ffb347;
  --nu-color-role-moderator: #b98cff;

  --nu-color-border: #2b1d31;
  --nu-color-backdrop: rgba(4, 2, 6, 0.78);
  --nu-color-backdrop-strong: rgba(4, 2, 6, 0.94);

  --nu-gradient-accent: linear-gradient(180deg, #ff8a35, #e2560a);
  --nu-gradient-accent-hover: linear-gradient(180deg, #ffa057, #f0640f);
  --nu-gradient-accent-diagonal: linear-gradient(160deg, ${PUMPKIN}, #a56cff);

  --nu-font-display: 'Creepster', var(--nu-font-body);

  scrollbar-color: #3d2617 transparent;
}

::selection {
  background: ${PUMPKIN};
  color: #160b05;
}

/* The selected Space wears black cat ears, rimmed in pumpkin. */
.nu-server-rail__ear {
  fill: ${FUR};
  stroke: ${PUMPKIN};
  stroke-width: 0.8px;
}

.nu-server-rail__ear-inner {
  fill: #4a2a5c;
}

/* Eyes watching from the dark at the bottom of the rail; Spaces scroll over them. */
[data-nu-role="server-rail-list"] {
  background: ${EYES_IN_THE_DARK} center bottom 10px / 36px no-repeat;
}

/* A Space without a picture of its own gets a dusk sky with the moon up, in place of its colors. */
.nu-space-card__banner {
  background:
    radial-gradient(circle at 80% 32%, #ffe0ac 0 9px, rgba(255, 190, 110, 0.35) 10px, transparent 30px),
    radial-gradient(130% 80% at 30% 120%, rgba(255, 117, 24, 0.55), transparent 70%),
    linear-gradient(180deg, #1a0d2b, #3a1a3f);
}

/* The empty screen: a black cat under a harvest moon, in place of the paw. */
.nu-main-pane__empty-icon {
  padding: 40px;
  color: transparent;
  background: ${MOON_SCENE} center / cover no-repeat, #0b0710;
  box-shadow: 0 0 60px -10px rgba(255, 150, 60, 0.45);
}

/* A cat-faced jack-o'-lantern welcomes you to every channel. */
.nu-timeline__welcome-icon {
  color: transparent;
  background: ${CAT_LANTERN} center / 52px no-repeat, var(--nu-color-bg-tertiary);
  box-shadow: 0 0 28px -6px rgba(255, 117, 24, 0.6);
}

/* A cobweb in the corner under the header with its spider, behind the messages, and fog along the bottom. */
[data-nu-role="main-pane"] {
  background:
    ${SPIDER} right 72px top var(--nu-height-header) / 16px 130px no-repeat,
    ${COBWEB} right top var(--nu-height-header) / 220px no-repeat,
    radial-gradient(120% 38% at 50% 112%, rgba(165, 108, 255, 0.14), transparent 70%),
    radial-gradient(70% 28% at 12% 108%, rgba(255, 117, 24, 0.07), transparent 70%),
    var(--nu-color-bg-secondary);
}

.nu-button--primary {
  box-shadow: 0 0 16px -4px rgba(255, 117, 24, 0.6);
}

@media (prefers-reduced-motion: no-preference) {
  /* Home's paw glows like a lantern. */
  [data-nu-role="server-rail-home"] {
    animation: nu-halloween-lantern 3.2s ease-in-out infinite;
  }

  .nu-timeline__welcome-title,
  .nu-main-pane__empty-title {
    animation: nu-halloween-flicker 5s linear infinite;
  }

  /* Bats, every half minute or so. */
  [data-nu-role="app-shell"]::after {
    content: '';
    position: fixed;
    z-index: 50;
    top: 12vh;
    left: 0;
    width: 90px;
    height: 40px;
    background: ${BATS} center / contain no-repeat;
    filter: drop-shadow(0 0 4px rgba(255, 117, 24, 0.4));
    transform: translateX(-140px);
    pointer-events: none;
    animation: nu-halloween-bats 32s linear 6s infinite;
  }
}

@keyframes nu-halloween-lantern {
  0%, 100% { box-shadow: 0 0 10px -2px rgba(255, 117, 24, 0.45); }
  50% { box-shadow: 0 0 22px 2px rgba(255, 117, 24, 0.75); }
}

@keyframes nu-halloween-flicker {
  0%, 100% { text-shadow: 0 0 12px rgba(255, 117, 24, 0.7); }
  42% { text-shadow: 0 0 12px rgba(255, 117, 24, 0.7); }
  44% { text-shadow: 0 0 4px rgba(255, 117, 24, 0.3); }
  46% { text-shadow: 0 0 14px rgba(255, 117, 24, 0.8); }
  48% { text-shadow: 0 0 6px rgba(255, 117, 24, 0.35); }
  52% { text-shadow: 0 0 12px rgba(255, 117, 24, 0.7); }
}

@keyframes nu-halloween-bats {
  0% { transform: translate(-140px, 0); }
  6% { transform: translate(28vw, -5vh); }
  12% { transform: translate(55vw, 4vh); }
  18% { transform: translate(80vw, -3vh); }
  24%, 100% { transform: translate(calc(100vw + 140px), -8vh); }
}
`;

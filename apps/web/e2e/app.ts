import { expect, type Locator, type Page } from '@playwright/test';
import { HOMESERVER, type TestUser } from './matrix';

/**
 * Driving the app. Selectors are the `data-nu-role` attributes the components carry, which exist
 * for theming and tests and don't change with wording or layout.
 */

export const role = (page: Page | Locator, name: string) => page.locator(`[data-nu-role="${name}"]`);

/** Opens the app locked to the test homeserver, as a deployment's `/config.json` would, at `path`. */
export async function openApp(page: Page, path = '/'): Promise<void> {
  // Anything the Content-Security-Policy blocks (deploy/security-headers.conf) shows in the output.
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /Content Security Policy/i.test(msg.text())) console.log(`[csp] ${msg.text()}`);
  });
  await page.route('**/config.json', (route) => route.fulfill({ json: { homeserver: HOMESERVER } }));
  await page.goto(path);
}

export async function logIn(page: Page, user: TestUser): Promise<void> {
  await openApp(page);
  await expect(role(page, 'login-locked-homeserver')).toBeVisible();
  await page.getByLabel('Username').fill(user.localpart);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  // Signed in: the server rail on a wide screen, the bottom tab bar on a phone (which hides the rail).
  await expect(role(page, 'server-rail').or(role(page, 'mobile-tabs')).filter({ visible: true }).first()).toBeVisible();
}

/** Chat's top level (Direct messages and Spaces): the rail's Chat item, or the phone's Chat tab. */
export async function openChat(page: Page): Promise<void> {
  const tab = role(page, 'mobile-tab-chat');
  if (await tab.isVisible()) await tab.click();
  else await role(page, 'server-rail-chat').click();
  const back = role(page, 'chat-back');
  // Coming from Home or Feed, Chat returns to the Space you were in: go back up from it.
  await expect(back.or(role(page, 'chat-spaces'))).toBeVisible();
  if (await back.isVisible()) await back.click();
  await expect(role(page, 'chat-spaces')).toBeVisible();
}

/** Opens a Space from Chat's list. */
export async function openSpace(page: Page, spaceName: string): Promise<void> {
  await openChat(page);
  await page.locator(`[data-nu-role="chat-space"][aria-label="${spaceName}"]`).click();
}

export async function openChannel(page: Page, spaceName: string, channelName: string): Promise<void> {
  await openSpace(page, spaceName);
  // The name, not the row's middle: hovering a row shows its actions over its right half.
  await role(page, 'channel-list-item').filter({ hasText: channelName }).getByText(channelName, { exact: true }).click();
  await expect(role(page, 'composer-input')).toBeVisible();
}

export function message(page: Page, text: string): Locator {
  return role(page, 'timeline-message').filter({ hasText: text });
}

/**
 * Clicks one of a message's hover actions. Hovers again before each attempt: the timeline can still
 * be settling (scrolling to the newest message), which slides the message out from under the
 * pointer, and the actions only take clicks while their message is hovered — as for a person, who'd
 * just move the mouse back.
 */
export async function clickMessageAction(target: Locator, action: string): Promise<void> {
  await expect(async () => {
    await target.hover();
    await role(target, action).click({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
}

export async function send(page: Page, text: string): Promise<void> {
  const input = role(page, 'composer-input');
  await input.click();
  await input.fill(text);
  await input.press('Enter');
  await expect(message(page, text)).toBeVisible();
}

/** Waits for any window still opening (the `nu-window-in` animation, tokens.css) to settle, before
 *  measuring something inside it: mid-animation its box is still scaled. */
export async function windowsSettled(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => !(a instanceof CSSAnimation) || a.animationName !== 'nu-window-in' || a.playState === 'finished')
  );
}

/** Opens your own profile: the rail's Profile menu ("View profile"), or the phone's You tab. */
export async function openOwnProfile(page: Page): Promise<void> {
  const tab = role(page, 'mobile-tab-you');
  if (await tab.isVisible()) {
    await tab.click();
    return;
  }
  await role(page, 'server-rail-profile').click();
  await role(page, 'status-menu-view-profile').click();
}

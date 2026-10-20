import { expect, test } from '@playwright/test';
import { logIn, role, openSpace } from './app';
import { api, createSpaceWithChannel, createUser, eventually } from './matrix';

type Rules = { global: { override?: { rule_id: string }[]; room?: { rule_id: string }[] } };

const hasRule = (rules: Rules, kind: 'override' | 'room', roomId: string) =>
  (rules.global[kind] ?? []).some((rule) => rule.rule_id === roomId);

test('channel and Space notification levels become push rules', async ({ page }) => {
  const alice = await createUser('alice');
  const { channelId, spaceName } = await createSpaceWithChannel(alice);
  const rules = () => api<Rules>(alice, 'GET', '/pushrules/');

  await logIn(page, alice);
  await openSpace(page, spaceName);

  // The whole Space to "Only @mentions": a room rule on its channel.
  await role(page, 'space-notification-menu').click();
  await role(page, 'space-notification-mentions').click();
  await eventually(rules, (r) => hasRule(r, 'room', channelId) && !hasRule(r, 'override', channelId));
  const row = role(page, 'channel-list-item').filter({ hasText: 'general' });
  await expect(role(row, 'channel-list-item-level')).toHaveAttribute('title', 'Notifications: Only @mentions');

  // The channel to "Nothing": an override instead, and the row dims.
  await row.hover();
  await role(page, 'room-notification-menu').click();
  await role(page, 'room-notification-nothing').click();
  await eventually(rules, (r) => hasRule(r, 'override', channelId) && !hasRule(r, 'room', channelId));
  await expect(row).toHaveClass(/nu-channel-list__item--muted/);

  // Back to the Space's level, then the Space back to the default: no rules left.
  await row.hover();
  await role(page, 'room-notification-menu').click();
  await role(page, 'room-notification-inherit').click();
  await eventually(rules, (r) => hasRule(r, 'room', channelId) && !hasRule(r, 'override', channelId));
  await role(page, 'space-notification-menu').click();
  await role(page, 'space-notification-all').click();
  await eventually(rules, (r) => !hasRule(r, 'room', channelId) && !hasRule(r, 'override', channelId));
  await expect(role(row, 'channel-list-item-level')).toHaveCount(0);
});

test('a keyword becomes a content push rule, and removing it deletes the rule', async ({ page }) => {
  const alice = await createUser('alice');
  type ContentRules = { global: { content?: { rule_id: string; pattern?: string }[] } };
  const rules = () => api<ContentRules>(alice, 'GET', '/pushrules/');
  const hasKeyword = (r: ContentRules) => (r.global.content ?? []).some((rule) => rule.rule_id === 'movie night' && rule.pattern === 'movie night');

  await logIn(page, alice);
  await role(page, 'server-rail-settings').click();
  await role(page, 'keyword-input').fill('movie night');
  await role(page, 'keyword-add').click();
  await expect(role(page, 'keyword').filter({ hasText: 'movie night' })).toBeVisible();
  await eventually(rules, hasKeyword);

  await role(page, 'keyword-remove').click();
  await eventually(rules, (r) => !hasKeyword(r));
  await expect(role(page, 'keyword')).toHaveCount(0);
});

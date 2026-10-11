/** Notify's label for screen readers: what's new, and invites waiting (counted in the same badge). */
export function notifyAria(unread: number, invites: number): string {
  const parts = [unread > 0 && `${unread} new`, invites > 0 && (invites === 1 ? '1 invite' : `${invites} invites`)].filter(Boolean);
  return parts.length > 0 ? `Notifications, ${parts.join(', ')}` : 'Notifications';
}

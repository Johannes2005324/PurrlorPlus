import type { MatrixClient } from 'matrix-js-sdk';
import { isDemoMode } from '../demo/demoMode';
import { isDesktopApp } from '../desktop/desktopBridge';
import { getOpenIdTokenCached } from './openIdToken';

/**
 * `!bug <project> <what's wrong>`: a bug report for the server's admins, typed in any channel.
 * The composer catches it, so it's never sent as a message; it goes to the token server, whose
 * service bot passes it on (services/token-server/src/bugReports.ts, docs/bug-reports.md). The
 * project is the first word, one of the deployment's BUG_PROJECTS.
 */
export const BUG_USAGE = '!bug <project> <what’s wrong>, e.g. !bug purrlor emojis don’t work on mobile';

const BUG_API = '/api/public/bugs';
const VERSION: string | undefined = import.meta.env?.VITE_PURRLOR_VERSION || undefined;

export type ParsedBugCommand = { type: 'bug'; project: string; text: string } | { type: 'usage' };

/** A `!bug` message, or null for anything else ("!bugs", or "!bug" mid-message, are messages). */
export function parseBugCommand(body: string): ParsedBugCommand | null {
  const match = /^!bug(?:\s+|$)([\s\S]*)$/i.exec(body.trim());
  if (!match) return null;
  const [, project = '', text = ''] = /^(\S*)\s*([\s\S]*)$/.exec(match[1]) ?? [];
  return project && text.trim() ? { type: 'bug', project: project.toLowerCase(), text: text.trim() } : { type: 'usage' };
}

/** What the report says it was sent from, so the admins needn't ask. */
function platform(): string {
  if (isDesktopApp()) return 'desktop app';
  return typeof window !== 'undefined' && window.matchMedia?.('(max-width: 900px)').matches ? 'mobile' : 'browser';
}

/** Sends one report; resolves with the project it was filed under, or throws what went wrong. */
export async function sendBugReport(mx: MatrixClient, project: string, text: string): Promise<string> {
  if (isDemoMode()) throw new Error('Bug reports can’t be sent from the demo.');
  let response: Response;
  try {
    response = await fetch(BUG_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ openid_token: await getOpenIdTokenCached(mx), project, text, platform: platform(), ...(VERSION && { version: VERSION }) }),
    });
  } catch {
    throw new Error('Couldn’t reach the server to send the bug report. Try again in a moment.');
  }
  const answer = (await response.json().catch(() => ({}))) as { error?: unknown; project?: unknown };
  if (response.status === 404) throw new Error('This server doesn’t take bug reports.');
  if (!response.ok) throw new Error(typeof answer.error === 'string' ? answer.error : 'The bug report couldn’t be sent.');
  return typeof answer.project === 'string' ? answer.project : project;
}

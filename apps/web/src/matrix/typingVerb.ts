import { useEffect, useState } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { useMatrixClient } from './MatrixClientContext';
import { getExtendedProfile } from './extendedProfile';

/**
 * Your own word for "typing" — "Alice is yelling…" instead of "Alice is typing…". Set once on your
 * profile (the `xyz.nekous.typing_verb` extended-profile field, extendedProfile.ts), so it shows
 * the same in every room and DM, to people on any server.
 */
export const DEFAULT_TYPING_VERB = 'typing';
export const TYPING_VERB_MAX_LENGTH = 24;

/**
 * What a typing verb may be: one short line of plain text. Applied both when saving your own and
 * when reading anyone else's, since a profile field can be written by any client. Collapses
 * whitespace (no line breaks in the indicator), drops a leading "is " (the indicator supplies it)
 * and trailing dots (it adds its own "…"), and caps the length. Empty means the default.
 */
export function sanitizeTypingVerb(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const cleaned = raw
    // Whitespace first: line breaks and tabs are control characters too, and removing them
    // before this would glue the words either side together.
    .replace(/\s+/g, ' ')
    // Then any other control or format character (bidi overrides, zero-width joiners) — none has
    // any business in one line of someone else's text.
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .trim()
    .replace(/^is\s+/i, '')
    .replace(/[.…\s]+$/u, '');
  return [...cleaned].slice(0, TYPING_VERB_MAX_LENGTH).join('').trim();
}

/** What the indicator shows for someone: their verb, or "typing". */
export function typingVerbOrDefault(verb: string | undefined): string {
  return verb || DEFAULT_TYPING_VERB;
}

/**
 * "Alice is yelling…", "Alice is yelling and Bob is typing…", "Alice and Bob are typing…" (both
 * the same), "3 people are typing…". Past two people, individual verbs stop reading as anything
 * but noise, so it's the plain count.
 */
export function describeTyping(typers: { name: string; verb?: string }[]): string {
  if (typers.length === 0) return '';
  const [a, b] = typers.map((t) => ({ name: t.name, verb: typingVerbOrDefault(t.verb) }));
  if (typers.length === 1) return `${a.name} is ${a.verb}…`;
  if (typers.length === 2) {
    return a.verb === b.verb ? `${a.name} and ${b.name} are ${a.verb}…` : `${a.name} is ${a.verb} and ${b.name} is ${b.verb}…`;
  }
  return describeTypingCount(typers.length);
}

/** "3 people are typing…": the short form, also for two when their names don't fit one line. */
export function describeTypingCount(count: number): string {
  return `${count} people are ${DEFAULT_TYPING_VERB}…`;
}

// Someone typing is exactly when their verb is needed, and they type in bursts — so it's read once
// and remembered for a while, rather than fetched on every keystroke.
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { verb: string; at: number }>();
const pending = new Map<string, Promise<string>>();

async function fetchTypingVerb(mx: MatrixClient, userId: string): Promise<string> {
  const cached = cache.get(userId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.verb;
  const inFlight = pending.get(userId);
  if (inFlight) return inFlight;
  const request = getExtendedProfile(mx, userId)
    .then((profile) => {
      const verb = sanitizeTypingVerb(profile.typingVerb);
      cache.set(userId, { verb, at: Date.now() });
      return verb;
    })
    .finally(() => pending.delete(userId));
  pending.set(userId, request);
  return request;
}

/** After saving your own, so your next typing shows it without waiting out the cache. */
export function rememberTypingVerb(userId: string, verb: string): void {
  cache.set(userId, { verb: sanitizeTypingVerb(verb), at: Date.now() });
}

/** Typing verbs for these users, by user ID. Missing until loaded, which reads as "typing". */
export function useTypingVerbs(userIds: string[]): Record<string, string> {
  const mx = useMatrixClient();
  const [verbs, setVerbs] = useState<Record<string, string>>({});
  const key = userIds.join('|');

  useEffect(() => {
    let cancelled = false;
    for (const userId of userIds) {
      void fetchTypingVerb(mx, userId).then((verb) => {
        if (!cancelled) setVerbs((prev) => (prev[userId] === verb ? prev : { ...prev, [userId]: verb }));
      });
    }
    return () => {
      cancelled = true;
    };
    // `key` stands in for the array, whose identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mx, key]);

  return verbs;
}

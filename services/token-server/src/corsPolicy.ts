import type { CorsOptions, CorsOptionsDelegate } from 'cors';
import type { Request } from 'express';

/**
 * Which web pages may call this service from a browser (CORS).
 *
 * **Voice (`/api/livekit/…`) is open to any page.** A Space's voice server is called by everyone in
 * the Space, and someone in it from another Matrix server uses their own server's app (another
 * Purrlor at another address, or Element): limited to this deployment's own app, the browser refused
 * them, and they saw "Failed to fetch". Nothing is lost by opening it. These routes don't use
 * cookies or any credential a browser adds by itself; each request carries a Matrix OpenID token
 * proving who's asking, and a token is only given for a voice channel in a Space this server serves
 * to a member of it (server.ts, membership.ts, tenancy.ts), whichever page asked.
 *
 * **Bug reports (`/api/public/bugs`) too**, for the same reason: someone in one of this server's
 * Spaces from another server sends `!bug` from their own server's app, to here (bugReports.ts).
 * The same OpenID token proves who's asking, and only a member of a Space served here is taken.
 *
 * Everything else keeps to `ALLOWED_ORIGINS` (comma-separated; `*` for any; `https://*.example.com`
 * for its subdomains).
 */
export function parseAllowedOrigins(value: string | undefined): string[] {
  return (value ?? '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function originAllowed(origin: string | undefined, allowed: string[]): boolean {
  if (!origin || allowed.includes('*') || allowed.includes(origin)) return true;
  // A single leading-wildcard subdomain pattern, e.g. https://*.example.com: the * is one subdomain.
  return allowed.some((pattern) => {
    if (!pattern.includes('*')) return false;
    // Everything literal, the * included, so it can then be found and swapped for "one subdomain".
    // (Left unescaped, the * had quantified the character before it, and no subdomain ever matched.)
    const regex = `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\*', '[^./]+')}$`;
    return new RegExp(regex).test(origin);
  });
}

/** Routes any page may call: see above. */
export function openToAnyOrigin(path: string): boolean {
  return path === '/api/livekit' || path.startsWith('/api/livekit/') || path === '/api/public/bugs' || path === '/api/public/bugs/';
}

export function corsOptions(allowed: string[]): CorsOptionsDelegate<Request> {
  return (req, callback) => {
    const options: CorsOptions = openToAnyOrigin(req.path)
      ? { origin: true }
      : { origin: (origin, done) => done(null, originAllowed(origin, allowed)) };
    callback(null, options);
  };
}

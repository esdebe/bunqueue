/**
 * Resolve auth token with priority:
 *   1. explicitToken (from connection.token) - highest
 *   2. Bun.env.BQ_TOKEN
 *   3. Bun.env.BUNQUEUE_TOKEN
 *   4. undefined if none set
 *
 * Empty strings are treated as not set.
 */
export function resolveToken(explicitToken: string | undefined): string | undefined {
  if (explicitToken) return explicitToken;

  const bqToken = Bun.env.BQ_TOKEN;
  if (bqToken) return bqToken;

  const bunqueueToken = Bun.env.BUNQUEUE_TOKEN;
  if (bunqueueToken) return bunqueueToken;

  return undefined;
}

import { type FederatedIdentity, isUsableEmail, normalizeEmail } from './user.ts';

export const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'] as const;
export const GOOGLE_SIGNIN_SCOPES = ['openid', 'email', 'profile'] as const;

export type IdTokenClaims = {
  readonly iss: string;
  readonly aud: string;
  readonly exp: number;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly name: string;
  readonly picture: string | null;
};

export function decodeIdTokenClaims(idToken: string): IdTokenClaims | null {
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (typeof raw !== 'object' || raw === null) return null;
  const claims = raw as Record<string, unknown>;

  const iss = claims['iss'];
  const aud = claims['aud'];
  const exp = claims['exp'];
  const email = claims['email'];

  if (typeof iss !== 'string' || typeof aud !== 'string') return null;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return null;
  if (typeof email !== 'string') return null;

  const picture = claims['picture'];
  const name = claims['name'];

  return {
    iss,
    aud,
    exp,
    email,
    emailVerified: claims['email_verified'] === true || claims['email_verified'] === 'true',
    name: typeof name === 'string' ? name : '',
    picture: typeof picture === 'string' && picture.startsWith('https://') ? picture : null,
  };
}

export function identityFromClaims(
  claims: IdTokenClaims,
  expectedAudience: string,
  now: number,
): FederatedIdentity | null {
  if (!GOOGLE_ISSUERS.includes(claims.iss as (typeof GOOGLE_ISSUERS)[number])) return null;
  if (claims.aud !== expectedAudience) return null;
  if (claims.exp * 1000 <= now) return null;
  if (!claims.emailVerified) return null;
  if (!isUsableEmail(claims.email)) return null;

  return {
    email: normalizeEmail(claims.email),
    name: claims.name,
    pictureUrl: claims.picture,
    emailVerified: true,
  };
}

export function buildSigninUrl(input: {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly nonce: string;
  readonly challenge: string;
}): string {
  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_SIGNIN_SCOPES.join(' '));
  url.searchParams.set('state', input.state);
  url.searchParams.set('nonce', input.nonce);
  url.searchParams.set('code_challenge', input.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

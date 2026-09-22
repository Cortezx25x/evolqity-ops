export interface AccessTokenInput {
  userId: string;
  authSessionId: string;
}

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  typ: 'access';
  jti: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string | string[];
}

export interface GeneratedRefreshToken {
  tokenId: string;
  secret: string;
  token: string;
}

export interface ParsedRefreshToken {
  tokenId: string;
  secret: string;
}

export interface AuthenticatedRequestContext {
  userId: string;
  sessionId: string;
}

export interface AuthRequestMetadata {
  userAgent?: string;
  ip?: string;
}

export interface PublicAuthUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

export interface AuthOrganization {
  id: string;
  name: string;
  slug: string;
  type: string | null;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  membershipId?: string;
}

export interface AuthSessionResult {
  user: PublicAuthUser;
  organizations: AuthOrganization[];
  platformRole: 'PLATFORM_ADMIN' | null;
  sessionId: string;
  sessionExpiresAt: Date;
  refreshToken: string;
}

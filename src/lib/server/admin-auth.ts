import { timingSafeEqual } from "node:crypto";

import type { Auth, DecodedIdToken } from "firebase-admin/auth";

import { getServerAuth } from "@/lib/firebase/server";

export const ADMIN_SESSION_COOKIE = "rating_admin_session";
export const ADMIN_CSRF_COOKIE = "rating_admin_csrf";
export const ADMIN_ACTION_COOKIE = "rating_admin_action";
export const ADMIN_LINEUP_ACTION_COOKIE = "rating_admin_lineup_action";
export const ADMIN_LIFECYCLE_ACTION_COOKIE = "rating_admin_lifecycle_action";
export const ADMIN_MANUAL_VOTING_ACTION_COOKIE =
  "rating_admin_manual_voting_action";
export const ADMIN_PLAYER_IDENTITY_ACTION_COOKIE =
  "rating_admin_player_identity_action";
export const ADMIN_COACH_IDENTITY_ACTION_COOKIE =
  "rating_admin_coach_identity_action";
export const ADMIN_SESSION_MAX_AGE_MS = 60 * 60 * 1000;

type Environment = Readonly<Record<string, string | undefined>>;

export interface AdminIdentityConfig {
  ownerUid: string;
  allowedOrigin: string;
  secureCookies: boolean;
}

export interface AdminIdentity {
  uid: string;
}

export class AdminAuthorizationError extends Error {
  constructor(
    public readonly status: 401 | 403 | 429 | 503,
    message = "No fue posible autorizar la solicitud.",
  ) {
    super(message);
    this.name = "AdminAuthorizationError";
  }
}

export function readAdminIdentityConfig(
  environment: Environment = process.env,
): AdminIdentityConfig {
  const ownerUid = environment.ADMIN_OWNER_UID?.trim();
  if (!ownerUid || !/^[A-Za-z0-9:_-]{6,128}$/.test(ownerUid)) {
    throw new AdminAuthorizationError(503);
  }
  const originValue = environment.ADMIN_ALLOWED_ORIGIN?.trim();
  let origin: URL;
  try {
    origin = new URL(originValue ?? "");
  } catch {
    throw new AdminAuthorizationError(503);
  }
  const local = environment.NEXT_PUBLIC_FIREBASE_ENVIRONMENT === "local";
  const allowedLocalHttp =
    local &&
    origin.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(origin.hostname);
  if (
    (origin.protocol !== "https:" && !allowedLocalHttp) ||
    origin.username !== "" ||
    origin.password !== "" ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== ""
  ) {
    throw new AdminAuthorizationError(503);
  }
  return {
    ownerUid,
    allowedOrigin: origin.origin,
    secureCookies: !local,
  };
}

export async function authenticateAdminIdToken(
  idToken: string,
  auth: Auth | undefined = undefined,
  environment: Environment = process.env,
): Promise<AdminIdentity> {
  const config = readAdminIdentityConfig(environment);
  let decoded: DecodedIdToken;
  try {
    decoded = await (auth ?? getServerAuth()).verifyIdToken(idToken, true);
  } catch {
    throw new AdminAuthorizationError(401);
  }
  requireOwnerToken(decoded, config);
  return { uid: decoded.uid };
}

export async function verifyAdminSession(
  sessionCookie: string | undefined,
  auth: Auth | undefined = undefined,
  environment: Environment = process.env,
): Promise<AdminIdentity> {
  if (!sessionCookie) throw new AdminAuthorizationError(401);
  const config = readAdminIdentityConfig(environment);
  let decoded: DecodedIdToken;
  try {
    decoded = await (auth ?? getServerAuth()).verifySessionCookie(
      sessionCookie,
      true,
    );
  } catch {
    throw new AdminAuthorizationError(401);
  }
  requireOwnerToken(decoded, config);
  return { uid: decoded.uid };
}

export function requireAdminOrigin(
  origin: string | null,
  environment: Environment = process.env,
): void {
  const expected = readAdminIdentityConfig(environment).allowedOrigin;
  if (!origin || !constantTimeEqual(origin, expected)) {
    throw new AdminAuthorizationError(403);
  }
}

export function requireAdminCsrf(
  headerValue: string | null,
  cookieValue: string | undefined,
): void {
  if (
    !headerValue ||
    !cookieValue ||
    headerValue.length < 32 ||
    !constantTimeEqual(headerValue, cookieValue)
  ) {
    throw new AdminAuthorizationError(403);
  }
}

function requireOwnerToken(
  decoded: DecodedIdToken,
  config: AdminIdentityConfig,
): void {
  if (
    decoded.uid !== config.ownerUid ||
    decoded.email_verified !== true ||
    decoded.firebase?.sign_in_provider !== "password"
  ) {
    throw new AdminAuthorizationError(403);
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

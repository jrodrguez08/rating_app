import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { Timestamp, type Firestore } from "firebase-admin/firestore";
import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";

import { getServerFirestore } from "@/lib/firebase/server";

export const MCP_READ_SCOPE = "rating:read";
const CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TTL_MS = 60 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type Environment = Readonly<Record<string, string | undefined>>;

export interface McpOAuthConfig {
  origin: string;
  resource: string;
  clientId: string;
  clientSecret: string;
  redirectUris: ReadonlySet<string>;
}

interface StoredCode {
  ownerId: string;
  clientId: string;
  redirectUri: string;
  resource: string;
  scope: string;
  codeChallenge: string;
  expiresAt: Timestamp;
}

interface StoredToken {
  ownerId: string;
  clientId: string;
  resource: string;
  scopes: string[];
  kind: "access" | "refresh";
  expiresAt: Timestamp;
  createdAt: Timestamp;
  pairedTokenHash: string;
}

export function readMcpOAuthConfig(
  environment: Environment = process.env,
): McpOAuthConfig {
  const origin = environment.MCP_PUBLIC_ORIGIN?.trim();
  const clientId = environment.MCP_OAUTH_CLIENT_ID?.trim();
  const clientSecret = environment.MCP_OAUTH_CLIENT_SECRET?.trim();
  const redirectUris = (environment.MCP_OAUTH_REDIRECT_URIS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin ?? "");
  } catch {
    throw new Error("MCP OAuth is not configured.");
  }
  const local = environment.NEXT_PUBLIC_FIREBASE_ENVIRONMENT === "local";
  if (
    (!local && parsedOrigin.protocol !== "https:") ||
    (local && !["http:", "https:"].includes(parsedOrigin.protocol)) ||
    parsedOrigin.pathname !== "/" ||
    parsedOrigin.search ||
    parsedOrigin.hash ||
    !clientId ||
    clientId.length > 200 ||
    !clientSecret ||
    clientSecret.length < 32 ||
    redirectUris.length === 0
  ) {
    throw new Error("MCP OAuth is not configured.");
  }
  for (const uri of redirectUris) {
    const parsed = new URL(uri);
    if (parsed.protocol !== "https:" || parsed.hash) {
      throw new Error("MCP OAuth is not configured.");
    }
  }
  const normalizedOrigin = parsedOrigin.origin;
  return {
    origin: normalizedOrigin,
    resource: `${normalizedOrigin}/api/mcp`,
    clientId,
    clientSecret,
    redirectUris: new Set(redirectUris),
  };
}

export class McpOAuthStore implements OAuthTokenVerifier {
  constructor(private readonly configuredDatabase?: Firestore) {}

  private get database(): Firestore {
    return this.configuredDatabase ?? getServerFirestore();
  }

  async issueAuthorizationCode(input: {
    ownerId: string;
    clientId: string;
    redirectUri: string;
    resource: string;
    scope: string;
    codeChallenge: string;
  }): Promise<string> {
    const code = randomBytes(32).toString("base64url");
    const now = Date.now();
    await this.database.doc(`mcpOAuthCodes/${hashSecret(code)}`).create({
      ...input,
      expiresAt: Timestamp.fromMillis(now + CODE_TTL_MS),
      createdAt: Timestamp.fromMillis(now),
    });
    return code;
  }

  async exchangeAuthorizationCode(input: {
    code: string;
    clientId: string;
    redirectUri: string;
    resource: string;
    codeVerifier: string;
  }) {
    const codeReference = this.database.doc(
      `mcpOAuthCodes/${hashSecret(input.code)}`,
    );
    return this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(codeReference);
      if (!snapshot.exists) throw new OAuthRequestError("invalid_grant");
      const code = snapshot.data() as StoredCode;
      if (
        code.expiresAt.toMillis() <= Date.now() ||
        code.clientId !== input.clientId ||
        code.redirectUri !== input.redirectUri ||
        code.resource !== input.resource ||
        !constantTimeEqual(
          code.codeChallenge,
          pkceChallenge(input.codeVerifier),
        )
      ) {
        throw new OAuthRequestError("invalid_grant");
      }
      transaction.delete(codeReference);
      return createTokenPair(transaction, this.database, {
        ownerId: code.ownerId,
        clientId: code.clientId,
        resource: code.resource,
        scopes: code.scope.split(" "),
      });
    });
  }

  async refresh(refreshToken: string, clientId: string, resource: string) {
    const reference = this.database.doc(
      `mcpOAuthTokens/${hashSecret(refreshToken)}`,
    );
    return this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw new OAuthRequestError("invalid_grant");
      const token = snapshot.data() as StoredToken;
      if (
        token.kind !== "refresh" ||
        token.expiresAt.toMillis() <= Date.now() ||
        token.clientId !== clientId ||
        token.resource !== resource
      ) {
        throw new OAuthRequestError("invalid_grant");
      }
      transaction.delete(reference);
      return createTokenPair(transaction, this.database, token);
    });
  }

  async revoke(token: string, clientId: string): Promise<void> {
    const reference = this.database.doc(`mcpOAuthTokens/${hashSecret(token)}`);
    await this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (
        snapshot.exists &&
        (snapshot.data() as StoredToken).clientId === clientId
      ) {
        const stored = snapshot.data() as StoredToken;
        transaction.delete(reference);
        transaction.delete(
          this.database.doc(`mcpOAuthTokens/${stored.pairedTokenHash}`),
        );
      }
    });
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const snapshot = await this.database
      .doc(`mcpOAuthTokens/${hashSecret(token)}`)
      .get();
    if (!snapshot.exists)
      throw new OAuthError(
        OAuthErrorCode.InvalidToken,
        "Invalid access token.",
      );
    const stored = snapshot.data() as StoredToken;
    if (stored.kind !== "access" || stored.expiresAt.toMillis() <= Date.now()) {
      throw new OAuthError(
        OAuthErrorCode.InvalidToken,
        "Invalid access token.",
      );
    }
    return {
      token,
      clientId: stored.clientId,
      scopes: stored.scopes,
      expiresAt: Math.floor(stored.expiresAt.toMillis() / 1000),
      resource: new URL(stored.resource),
      extra: { ownerId: stored.ownerId },
    };
  }
}

export class OAuthRequestError extends Error {
  constructor(
    public readonly code:
      "invalid_request" | "invalid_client" | "invalid_grant",
  ) {
    super(code);
  }
}

export function validateClient(
  request: Request,
  config: McpOAuthConfig,
): boolean {
  const authorization = request.headers.get("authorization");
  let id: string | undefined;
  let secret: string | undefined;
  if (authorization?.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(authorization.slice(6), "base64").toString();
      const separator = decoded.indexOf(":");
      id = decodeURIComponent(decoded.slice(0, separator));
      secret = decodeURIComponent(decoded.slice(separator + 1));
    } catch {
      return false;
    }
  }
  return (
    id === config.clientId &&
    !!secret &&
    constantTimeEqual(secret, config.clientSecret)
  );
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function createTokenPair(
  transaction: FirebaseFirestore.Transaction,
  database: Firestore,
  identity: Pick<StoredToken, "ownerId" | "clientId" | "resource" | "scopes">,
) {
  const accessToken = randomBytes(32).toString("base64url");
  const refreshToken = randomBytes(32).toString("base64url");
  const accessTokenHash = hashSecret(accessToken);
  const refreshTokenHash = hashSecret(refreshToken);
  const now = Date.now();
  const createdAt = Timestamp.fromMillis(now);
  transaction.create(database.doc(`mcpOAuthTokens/${accessTokenHash}`), {
    ownerId: identity.ownerId,
    clientId: identity.clientId,
    resource: identity.resource,
    scopes: identity.scopes,
    kind: "access",
    createdAt,
    expiresAt: Timestamp.fromMillis(now + ACCESS_TTL_MS),
    pairedTokenHash: refreshTokenHash,
  } satisfies StoredToken);
  transaction.create(database.doc(`mcpOAuthTokens/${refreshTokenHash}`), {
    ownerId: identity.ownerId,
    clientId: identity.clientId,
    resource: identity.resource,
    scopes: identity.scopes,
    kind: "refresh",
    createdAt,
    expiresAt: Timestamp.fromMillis(now + REFRESH_TTL_MS),
    pairedTokenHash: accessTokenHash,
  } satisfies StoredToken);
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_MS / 1000,
    refresh_token: refreshToken,
    scope: identity.scopes.join(" "),
  };
}

function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

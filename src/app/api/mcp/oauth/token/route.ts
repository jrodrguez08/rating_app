import type { NextRequest } from "next/server";

import {
  McpOAuthStore,
  OAuthRequestError,
  readMcpOAuthConfig,
  validateClient,
} from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const config = readMcpOAuthConfig();
    if (!validateClient(request, config))
      return oauthError("invalid_client", 401);
    const form = await request.formData();
    const grantType = stringField(form, "grant_type");
    const store = new McpOAuthStore();
    const tokens =
      grantType === "authorization_code"
        ? await store.exchangeAuthorizationCode({
            code: stringField(form, "code"),
            clientId: config.clientId,
            redirectUri: stringField(form, "redirect_uri"),
            resource: stringField(form, "resource"),
            codeVerifier: stringField(form, "code_verifier"),
          })
        : grantType === "refresh_token"
          ? await store.refresh(
              stringField(form, "refresh_token"),
              config.clientId,
              stringField(form, "resource"),
            )
          : (() => {
              throw new OAuthRequestError("invalid_request");
            })();
    return Response.json(tokens, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return error instanceof OAuthRequestError
      ? oauthError(error.code, 400)
      : oauthError("server_error", 503);
  }
}

function stringField(form: FormData, name: string): string {
  const value = form.get(name);
  if (typeof value !== "string" || value.length > 2_000)
    throw new OAuthRequestError("invalid_request");
  return value;
}

function oauthError(error: string, status: number) {
  return Response.json(
    { error },
    { status, headers: { "cache-control": "no-store" } },
  );
}

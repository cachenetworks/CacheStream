import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, fetchHelixUser } from "@/lib/oauth";
import {
  SESSION_COOKIE,
  STATE_COOKIE,
  cookieOpts,
  sign,
  unsign,
} from "@/lib/cookies";
import { getStore } from "@/lib/store";
import { config } from "@/lib/config";
import { onTokensRefreshed, markRefreshTokenAlive } from "@/lib/twitch/tokens";

/**
 * GET /api/auth/twitch/callback?code=...&state=...
 *
 * Validates the OAuth state (CSRF defence), exchanges the code
 * for tokens, fetches the Twitch user, then:
 *   - requires the deployment owner to have been explicitly seeded
 *     with INITIAL_OWNER_LOGIN (no first-login-wins ownership claim)
 *   - if logged-in user matches the owner → issues a session,
 *     persists the broadcaster's tokens, kicks off chat + EventSub
 *   - otherwise → invite flow for moderators, or 403
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  if (error) {
    return renderError(
      `Twitch returned an error: ${escapeHtml(errorDescription || error)}`,
      400
    );
  }

  const signedState = req.cookies.get(STATE_COOKIE)?.value;
  const expected = unsign(signedState);
  if (!expected || expected !== state) {
    const res = renderError("OAuth state mismatch. Please try again.", 400);
    res.cookies.delete(STATE_COOKIE);
    return res;
  }

  if (!code) return renderError("Missing authorization code.", 400);

  let token;
  try {
    token = await exchangeCode(code);
  } catch {
    return renderError("Could not exchange code with Twitch.", 502);
  }

  let user;
  try {
    user = await fetchHelixUser(token.access_token);
  } catch {
    return renderError("Could not load your Twitch profile.", 502);
  }

  const store = getStore();
  const configuredOwner = store.getOwner();
  if (!configuredOwner) {
    return renderError(
      "This CacheStream instance has no configured owner. Set <b>INITIAL_OWNER_LOGIN</b> " +
        "to the intended broadcaster's Twitch login and restart CacheStream before signing in. " +
        "Ownership is never assigned to the first visitor.",
      503,
    );
  }

  const isOwner = store.isOwner({ id: user.id, login: user.login });

  // If the user isn't the owner, check whether they arrived carrying an invite
  // cookie. If so, consume it + add them as a moderator. If not (or the invite
  // is invalid), fall through to the 403 deny page.
  if (!isOwner) {
    const inviteSigned = req.cookies.get("cs_invite")?.value;
    const inviteCode = unsign(inviteSigned);
    if (inviteCode) {
      const result = store.consumeInvite(inviteCode, {
        id: user.id,
        login: user.login,
        displayName: user.display_name || user.login,
      });
      if (!result.ok) {
        const res = renderError(
          `That invite is no longer valid (${escapeHtml(result.reason)}). ` +
            `Ask the broadcaster for a fresh one.`,
          403,
        );
        res.cookies.delete("cs_invite");
        return res;
      }
      const { sid: modSid, expiresAt: modExpiresAt } = store.createSession(user);
      const res = NextResponse.redirect(`${config.web.publicUrl}/admin`);
      res.cookies.delete(STATE_COOKIE);
      res.cookies.delete("cs_oauth_origin");
      res.cookies.delete("cs_invite");
      res.cookies.set(
        SESSION_COOKIE,
        sign(modSid),
        cookieOpts(modExpiresAt - Date.now()),
      );
      return res;
    }

    return renderError(
      `This CacheStream instance is owned by another Twitch account. ` +
        `Logged-in user <b>${escapeHtml(user.display_name || user.login)}</b> is not authorised. ` +
        `Ask the broadcaster for an invite link if you should have access.`,
      403,
    );
  }

  store.upgradeOwnerFromUser(user);
  const { sid, expiresAt } = store.createSession(user);

  store.saveTokens({
    accessToken: token.access_token,
    refreshToken: token.refresh_token || null,
    expiresAt: Date.now() + (token.expires_in - 60) * 1000,
    scopes: token.scope || [],
    twitchUserId: user.id,
    updatedAt: Date.now(),
  });

  markRefreshTokenAlive();

  try { await onTokensRefreshed(); } catch (err) { console.warn("[oauth] post-token hook:", err); }

  try {
    const { startServicesIfReady } = await import("@/lib/boot");
    startServicesIfReady();
  } catch (err) { console.warn("[oauth] service-start hook:", err); }

  if (token.scope?.includes("channel:read:stream_key")) {
    (async () => {
      try {
        const { fetchStreamKey } = await import("@/lib/twitch/helix");
        const { setIngest } = await import("@/lib/twitchIngest");
        const k = await fetchStreamKey(user.id);
        if (k) {
          await setIngest({ streamKey: k });
          console.log("[oauth] auto-fetched stream key from Helix");
        }
      } catch (err) {
        console.warn("[oauth] auto-fetch stream key failed:", err);
      }
    })();
  }

  const originSigned = req.cookies.get("cs_oauth_origin")?.value;
  const origin = unsign(originSigned);
  if (origin === "setup") {
    try {
      const { markSetupComplete } = await import("@/lib/settings");
      markSetupComplete();
    } catch (err) {
      console.warn("[oauth] markSetupComplete failed:", err);
    }
  }

  const res = NextResponse.redirect(`${config.web.publicUrl}/admin`);
  res.cookies.delete(STATE_COOKIE);
  res.cookies.delete("cs_oauth_origin");
  res.cookies.delete("cs_invite");
  res.cookies.set(
    SESSION_COOKIE,
    sign(sid),
    cookieOpts(expiresAt - Date.now())
  );
  return res;
}

function renderError(message: string, status: number): NextResponse {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Auth error</title>
<style>
  html,body{margin:0;background:#05060a;color:#e6f7ff;font-family:Segoe UI,system-ui,sans-serif}
  main{max-width:560px;margin:8vh auto;padding:2rem;border:1px solid rgba(0,240,255,.25);border-radius:6px;background:rgba(10,13,24,.65)}
  h1{margin:0 0 .8rem;color:#ff2bd6;text-shadow:0 0 14px rgba(255,43,214,.45)}
  a{color:#00f0ff}
</style></head>
<body><main>
  <h1>Authentication failed</h1>
  <p>${message}</p>
  <p><a href="/">← back home</a></p>
</main></body></html>`;
  return new NextResponse(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

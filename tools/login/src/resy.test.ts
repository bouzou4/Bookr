import { describe, expect, it } from "vitest";
import { extractResySession, SessionExtractionError } from "./resy.ts";
import type { CapturedCookie, CapturedRequest } from "./resy.ts";

const API_KEY = "VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5";
const TOKEN = "opaque-session-token";
const REFRESH_TOKEN = "opaque-refresh-cookie-value";

/** A short-lived JWT-shaped token with a real `exp` claim, for expiry-decoding coverage. */
function makeJwt(exp: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "ES256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  return `${header}.${payload}.FAKESIGNATURE`;
}

function preLoginRequest(): CapturedRequest {
  return {
    url: "https://api.resy.com/3/venuesearch/search",
    headers: {
      Authorization: `ResyAPI api_key="${API_KEY}"`,
      "User-Agent": "Mozilla/5.0",
    },
  };
}

function authenticatedRequest(token: string): CapturedRequest {
  return {
    url: "https://api.resy.com/2/user",
    headers: {
      Authorization: `ResyAPI api_key="${API_KEY}"`,
      "X-Resy-Auth-Token": token,
      "X-Resy-Universal-Auth": token,
      "User-Agent": "Mozilla/5.0",
    },
  };
}

function refreshCookie(value = REFRESH_TOKEN): CapturedCookie {
  return { name: "production_refresh_token", value, domain: ".resy.com" };
}

describe("extractResySession", () => {
  it("builds an active session from a post-login request and the refresh cookie", () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = makeJwt(exp);
    const session = extractResySession([preLoginRequest(), authenticatedRequest(token)], [refreshCookie()]);

    expect(session.provider).toBe("resy");
    expect(session.state).toBe("active");
    expect(session.data).toEqual({ token, apiKey: API_KEY, refreshToken: REFRESH_TOKEN });
    expect(session.expiresAt).toBe(new Date(exp * 1000).toISOString());
    expect(session.updatedAt).toEqual(expect.any(String));
  });

  it("matches headers case-insensitively", () => {
    const session = extractResySession(
      [
        {
          url: "https://api.resy.com/2/user",
          headers: {
            authorization: `ResyAPI api_key="${API_KEY}"`,
            "x-resy-auth-token": TOKEN,
          },
        },
      ],
      [refreshCookie()],
    );
    expect((session.data as { token: string }).token).toBe(TOKEN);
  });

  it("falls back to X-Resy-Universal-Auth when X-Resy-Auth-Token is absent", () => {
    const session = extractResySession(
      [
        {
          url: "https://api.resy.com/2/user",
          headers: {
            Authorization: `ResyAPI api_key="${API_KEY}"`,
            "X-Resy-Universal-Auth": TOKEN,
          },
        },
      ],
      [refreshCookie()],
    );
    expect((session.data as { token: string }).token).toBe(TOKEN);
  });

  it("recovers the api_key from an earlier request if the authenticated one omits it", () => {
    const session = extractResySession(
      [
        preLoginRequest(),
        {
          url: "https://api.resy.com/2/user",
          headers: { "X-Resy-Auth-Token": TOKEN },
        },
      ],
      [refreshCookie()],
    );
    expect((session.data as { apiKey: string }).apiKey).toBe(API_KEY);
  });

  it("omits expiresAt when the token isn't a decodable JWT", () => {
    const session = extractResySession([authenticatedRequest("not-a-jwt")], [refreshCookie()]);
    expect(session.expiresAt).toBeUndefined();
  });

  it("omits expiresAt when the JWT payload has no exp claim", () => {
    const header = Buffer.from(JSON.stringify({ alg: "ES256" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: "guest" })).toString("base64url");
    const token = `${header}.${payload}.SIG`;
    const session = extractResySession([authenticatedRequest(token)], [refreshCookie()]);
    expect(session.expiresAt).toBeUndefined();
  });

  it("throws SessionExtractionError listing every missing piece", () => {
    expect(() => extractResySession([], [])).toThrowError(SessionExtractionError);
    try {
      extractResySession([], []);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SessionExtractionError);
      const error = err as SessionExtractionError;
      expect(error.missing).toEqual([
        "auth token (X-Resy-Auth-Token)",
        "api_key (Authorization header)",
        "refresh cookie (production_refresh_token)",
      ]);
      expect(error.message).toContain("missing");
    }
  });

  it("throws when the refresh cookie is missing even if the token/api_key were captured", () => {
    expect(() => extractResySession([authenticatedRequest(TOKEN)], [])).toThrowError(SessionExtractionError);
  });

  it("ignores unrelated cookies", () => {
    const session = extractResySession(
      [authenticatedRequest(TOKEN)],
      [{ name: "_ga", value: "GA1.2.123" }, refreshCookie()],
    );
    expect((session.data as { refreshToken: string }).refreshToken).toBe(REFRESH_TOKEN);
  });
});

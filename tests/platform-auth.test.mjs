import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import Database from "better-sqlite3";

import { createPlatformAuth } from "../server/platform-auth.mjs";

class FakeResponse {
  statusCode = 200;
  headers = {};
  chunks = [];

  writeHead(status, headers = {}) {
    this.statusCode = status;
    this.headers = headers;
  }

  end(chunk) {
    if (chunk) this.chunks.push(Buffer.from(chunk));
  }

  json() {
    return JSON.parse(Buffer.concat(this.chunks).toString("utf8"));
  }
}

function request({ cookie, origin, csrf, method = "GET", userAgent = "Story Scrolls test" } = {}) {
  return {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(origin ? { origin } : {}),
      ...(csrf ? { "x-csrf-token": csrf } : {}),
      "user-agent": userAgent,
    },
  };
}

function cookieValue(setCookie, name) {
  const headers = Array.isArray(setCookie) ? setCookie : [setCookie];
  const entry = headers.find((value) => value?.startsWith(`${name}=`));
  return entry?.split(";", 1)[0];
}

function signGoogleIdToken(privateKey, kid, claims) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

function setup() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE stories (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE
    ) STRICT;
  `);
  const clock = { now: Date.parse("2026-07-21T20:00:00.000Z") };
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = "story-scrolls-test-key";
  const jwk = publicKey.export({ format: "jwk" });
  jwk.kid = kid;
  jwk.alg = "RS256";
  jwk.use = "sig";
  let expectedNonce = "";
  const fetchCalls = [];
  const fetchImpl = async (url, options = {}) => {
    fetchCalls.push({ url, options });
    if (url === "https://oauth2.googleapis.com/token") {
      const nowSeconds = Math.floor(clock.now / 1_000);
      return new Response(JSON.stringify({
        id_token: signGoogleIdToken(privateKey, kid, {
          iss: "https://accounts.google.com",
          aud: "test-client.apps.googleusercontent.com",
          exp: nowSeconds + 600,
          iat: nowSeconds,
          nonce: expectedNonce,
          sub: "google-subject-123",
          email: "Creator@example.test",
          email_verified: true,
          name: "Ada Reader",
        }),
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url === "https://www.googleapis.com/oauth2/v3/certs") {
      return new Response(JSON.stringify({ keys: [jwk] }), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  const auth = createPlatformAuth({
    db,
    fetchImpl,
    now: () => clock.now,
    configuration: {
      publicOrigin: "https://thestoryscrolls.com",
      redirectUri: "https://thestoryscrolls.com/api/v2/auth/google/callback",
      clientId: "test-client.apps.googleusercontent.com",
      clientSecret: "test-client-secret",
      sessionSecret: "a-test-session-secret-that-is-well-over-thirty-two-characters",
      adminEmails: "creator@example.test",
    },
  });
  return {
    db,
    auth,
    clock,
    fetchCalls,
    setExpectedNonce(value) { expectedNonce = value; },
  };
}

test("Google OAuth uses state, nonce, PKCE, bounded fetches, and stronger cookies", async () => {
  const { db, auth, fetchCalls, setExpectedNonce } = setup();
  const start = new FakeResponse();
  await auth.handle(
    request(),
    start,
    new URL("https://thestoryscrolls.com/api/v2/auth/google?next=%2Fcreate%2F%3Fstep%3Dsource"),
  );
  assert.equal(start.statusCode, 302);
  const destination = new URL(start.headers.Location);
  assert.equal(destination.origin, "https://accounts.google.com");
  assert.equal(destination.searchParams.get("code_challenge_method"), "S256");
  assert.ok(destination.searchParams.get("code_challenge")?.length > 30);
  assert.ok(destination.searchParams.get("state")?.length > 30);
  assert.ok(destination.searchParams.get("nonce")?.length > 30);
  setExpectedNonce(destination.searchParams.get("nonce"));

  const oauthCookie = cookieValue(start.headers["Set-Cookie"], "__Secure-storyscrolls.oauth");
  assert.ok(oauthCookie);
  const callback = new FakeResponse();
  await auth.handle(
    request({ cookie: oauthCookie }),
    callback,
    new URL(`https://thestoryscrolls.com/api/v2/auth/google/callback?code=one-time-code&state=${encodeURIComponent(destination.searchParams.get("state"))}`),
  );
  assert.equal(callback.statusCode, 302);
  assert.equal(callback.headers.Location, "/create/?step=source&signed_in=1");
  const sessionCookie = cookieValue(callback.headers["Set-Cookie"], "__Host-storyscrolls.sid");
  assert.ok(sessionCookie);
  assert.match(callback.headers["Set-Cookie"].join("\n"), /HttpOnly/);
  assert.match(callback.headers["Set-Cookie"].join("\n"), /SameSite=Lax/);

  const me = new FakeResponse();
  await auth.handle(
    request({ cookie: sessionCookie }),
    me,
    new URL("https://thestoryscrolls.com/api/v2/auth/me"),
  );
  assert.equal(me.statusCode, 200);
  const profile = me.json();
  assert.deepEqual(profile.user, { id: profile.user.id, displayName: "Ada Reader", role: "admin" });
  assert.equal(profile.entitlement.plan, "admin");
  assert.equal(profile.publicListingQuota.limit, null);
  assert.equal(profile.publicListingQuota.remaining, null);
  assert.ok(profile.csrfToken.length > 30);
  assert.equal(fetchCalls.length, 2);
  assert.equal(fetchCalls.every(({ options }) => options.redirect === "error"), true);
  assert.equal(fetchCalls.every(({ options }) => options.signal instanceof AbortSignal), true);

  const userColumns = db.prepare("PRAGMA table_info(users)").all().map((column) => column.name);
  assert.equal(userColumns.includes("email"), false);
  assert.equal(db.prepare("SELECT email_fingerprint FROM users").get().email_fingerprint.includes("creator"), false);
});

test("OAuth transaction starts are throttled before database amplification", async () => {
  const { auth, db } = setup();
  for (let index = 0; index < 12; index += 1) {
    const response = new FakeResponse();
    await auth.handle(request(), response, new URL("https://thestoryscrolls.com/api/v2/auth/google"));
    assert.equal(response.statusCode, 302);
  }
  const limited = new FakeResponse();
  await auth.handle(request(), limited, new URL("https://thestoryscrolls.com/api/v2/auth/google"));
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.json().error.code, "oauth_rate_limited");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM oauth_transactions").get().count, 12);
});

test("public-listing quota is transactional and ownership is explicit", () => {
  const { db, auth } = setup();
  const timestamp = "2026-07-21T20:00:00.000Z";
  db.prepare(`
    INSERT INTO users (id, google_subject, email_fingerprint, display_name, role, created_at, last_login_at)
    VALUES ('user-1', 'subject-1', 'fingerprint', 'Test Creator', 'creator', ?, ?)
  `).run(timestamp, timestamp);
  db.prepare("INSERT INTO stories (id, slug) VALUES ('story-1', 'story-one')").run();
  auth.claimStoryOwnership("story-1", "user-1");
  assert.equal(
    db.prepare("SELECT role FROM creator_memberships WHERE story_id = 'story-1'").get().role,
    "owner",
  );
  assert.equal(auth.recordPublicListingRequest("user-1", "story-1").remaining, 0);
  assert.throws(
    () => auth.recordPublicListingRequest("user-1", "story-1"),
    (error) => error.code === "public_listing_quota_exhausted" && error.status === 429,
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM publication_quota_events").get().count, 1);
});

test("OAuth callback fails closed on state mismatch and consumes the transaction", async () => {
  const { auth } = setup();
  const start = new FakeResponse();
  await auth.handle(request(), start, new URL("https://thestoryscrolls.com/api/v2/auth/google"));
  const oauthCookie = cookieValue(start.headers["Set-Cookie"], "__Secure-storyscrolls.oauth");
  const callback = new FakeResponse();
  await auth.handle(
    request({ cookie: oauthCookie }),
    callback,
    new URL("https://thestoryscrolls.com/api/v2/auth/google/callback?code=code&state=wrong"),
  );
  assert.equal(callback.statusCode, 302);
  assert.equal(callback.headers.Location, "/create/?auth_error=invalid_oauth_state");
});

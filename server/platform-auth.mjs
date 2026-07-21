import crypto from "node:crypto";

const GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const SESSION_COOKIE = "__Host-storyscrolls.sid";
const OAUTH_COOKIE = "__Secure-storyscrolls.oauth";
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1_000;
const OAUTH_TTL_MS = 10 * 60 * 1_000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1_000;
const GOOGLE_FETCH_TIMEOUT_MS = 12_000;
const GOOGLE_TOKEN_MAX_BYTES = 128 * 1024;
const GOOGLE_JWKS_MAX_BYTES = 1024 * 1024;
const OAUTH_START_WINDOW_MS = 10 * 60 * 1_000;
const OAUTH_START_LIMIT_PER_CLIENT = 12;
const OAUTH_START_LIMIT_GLOBAL = 240;

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmac(secret, value) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

async function readBoundedJson(response, maxBytes, errorCode) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(errorCode);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > maxBytes) throw new Error(errorCode);
  const value = safeJsonParse(bytes.toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(errorCode);
  return value;
}

async function fetchGoogleJson(fetchImpl, url, options, maxBytes, errorCode) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GOOGLE_FETCH_TIMEOUT_MS);
  timeout.unref?.();
  try {
    const response = await fetchImpl(url, {
      ...options,
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(errorCode);
    return await readBoundedJson(response, maxBytes, errorCode);
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(errorCode);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseCookies(header = "") {
  const cookies = new Map();
  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (!name || cookies.has(name)) continue;
    try {
      cookies.set(name, decodeURIComponent(value));
    } catch {
      // Invalid cookie values are ignored and therefore fail closed.
    }
  }
  return cookies;
}

function cookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path || "/"}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  if (options.httpOnly !== false) parts.push("HttpOnly");
  if (options.secure !== false) parts.push("Secure");
  parts.push(`SameSite=${options.sameSite || "Lax"}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  return parts.join("; ");
}

function clearCookie(name, path = "/") {
  return cookie(name, "", { path, maxAge: 0, expires: new Date(0) });
}

function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

function safeNextPath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/create/";
  }
  try {
    const parsed = new URL(value, "https://thestoryscrolls.invalid");
    if (parsed.origin !== "https://thestoryscrolls.invalid") return "/create/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/create/";
  }
}

function appendQuery(pathname, name, value) {
  const parsed = new URL(pathname, "https://thestoryscrolls.invalid");
  parsed.searchParams.set(name, value);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function normalizeDisplayName(value) {
  const normalized = String(value || "The Story Scrolls Creator").replace(/\s+/g, " ").trim();
  return normalized.slice(0, 100) || "The Story Scrolls Creator";
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function emailFingerprint(secret, email) {
  return hmac(secret, `email:${normalizeEmail(email)}`);
}

function decodeJwtPart(value) {
  return safeJsonParse(Buffer.from(value, "base64url").toString("utf8"));
}

function verifyRs256Jwt(token, jwk, expected) {
  if (typeof token !== "string" || token.length > 16_384) throw new Error("invalid_id_token");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("invalid_id_token");
  const header = decodeJwtPart(parts[0]);
  const claims = decodeJwtPart(parts[1]);
  if (!header || !claims || header.alg !== "RS256" || header.kid !== jwk.kid) {
    throw new Error("invalid_id_token");
  }
  const key = crypto.createPublicKey({ key: jwk, format: "jwk" });
  const signatureValid = crypto.verify(
    "RSA-SHA256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    key,
    Buffer.from(parts[2], "base64url"),
  );
  if (!signatureValid) throw new Error("invalid_id_token_signature");

  const nowSeconds = Math.floor(expected.now / 1_000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!GOOGLE_ISSUERS.has(claims.iss)) throw new Error("invalid_id_token_issuer");
  if (!audiences.includes(expected.clientId)) throw new Error("invalid_id_token_audience");
  if (audiences.length > 1 && claims.azp !== expected.clientId) throw new Error("invalid_id_token_azp");
  if (!Number.isFinite(claims.exp) || claims.exp < nowSeconds - 60) throw new Error("expired_id_token");
  if (!Number.isFinite(claims.iat) || claims.iat > nowSeconds + 60) throw new Error("invalid_id_token_iat");
  if (claims.nonce !== expected.nonce) throw new Error("invalid_id_token_nonce");
  if (claims.email_verified !== true || !claims.sub || !claims.email) {
    throw new Error("unverified_google_identity");
  }
  return claims;
}

export function ensurePlatformAuthSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      google_subject TEXT NOT NULL UNIQUE,
      email_fingerprint TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'creator' CHECK (role IN ('creator', 'reviewer', 'admin')),
      created_at TEXT NOT NULL,
      last_login_at TEXT NOT NULL,
      disabled_at TEXT
    ) STRICT;

    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      csrf_secret_hash TEXT NOT NULL,
      revoked_at TEXT,
      device_label TEXT NOT NULL DEFAULT ''
    ) STRICT;
    CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id, expires_at);

    CREATE TABLE IF NOT EXISTS oauth_transactions (
      token_hash TEXT PRIMARY KEY,
      state_hash TEXT NOT NULL,
      nonce TEXT NOT NULL,
      code_verifier TEXT NOT NULL,
      next_path TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS subscriptions (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL DEFAULT 'manual',
      customer_ref TEXT,
      plan TEXT NOT NULL DEFAULT 'free',
      status TEXT NOT NULL DEFAULT 'inactive',
      current_period_end TEXT,
      webhook_event_id TEXT UNIQUE,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS publication_quota_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind = 'public_listing_requested'),
      requested_at TEXT NOT NULL,
      story_id TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS publication_quota_user_time_idx
      ON publication_quota_events(user_id, requested_at);

    CREATE TABLE IF NOT EXISTS creator_memberships (
      story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
      created_at TEXT NOT NULL,
      PRIMARY KEY (story_id, user_id)
    ) STRICT;
  `);
}

function defaultConfiguration(overrides = {}) {
  const publicOrigin = String(overrides.publicOrigin || process.env.STORYSCROLLS_PUBLIC_ORIGIN || "https://thestoryscrolls.com").replace(/\/$/, "");
  return {
    publicOrigin,
    redirectUri: overrides.redirectUri || process.env.GOOGLE_OAUTH_REDIRECT_URI || `${publicOrigin}/api/v2/auth/google/callback`,
    clientId: overrides.clientId || process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: overrides.clientSecret || process.env.GOOGLE_CLIENT_SECRET || "",
    sessionSecret: overrides.sessionSecret || process.env.STORYSCROLLS_SESSION_SECRET || "",
    adminEmails: new Set(
      String(overrides.adminEmails ?? process.env.STORYSCROLLS_ADMIN_EMAILS ?? "")
        .split(",")
        .map(normalizeEmail)
        .filter(Boolean),
    ),
  };
}

function publicUser(row) {
  return {
    id: row.id,
    displayName: row.display_name,
    role: row.role,
  };
}

export function createPlatformAuth({ db, fetchImpl = globalThis.fetch, now = Date.now, configuration = {} }) {
  ensurePlatformAuthSchema(db);
  const config = defaultConfiguration(configuration);
  if (process.env.NODE_ENV === "production" && config.sessionSecret.length < 32) {
    throw new Error("STORYSCROLLS_SESSION_SECRET must contain at least 32 characters in production.");
  }
  const runtimeSecret = config.sessionSecret || randomToken(48);
  let jwksCache = { expiresAt: 0, keys: [] };
  const oauthStarts = new Map();

  function oauthClientKey(req) {
    const forwarded = String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || "")
      .split(",")[0]
      .trim();
    return forwarded || req.socket?.remoteAddress || "unknown";
  }

  function admitOauthStart(req) {
    const timestamp = now();
    const floor = timestamp - OAUTH_START_WINDOW_MS;
    for (const [key, starts] of oauthStarts) {
      const active = starts.filter((value) => value > floor);
      if (active.length) oauthStarts.set(key, active);
      else oauthStarts.delete(key);
    }
    const allStarts = [...oauthStarts.values()].reduce((total, starts) => total + starts.length, 0);
    const key = oauthClientKey(req);
    const starts = oauthStarts.get(key) || [];
    if (starts.length >= OAUTH_START_LIMIT_PER_CLIENT || allStarts >= OAUTH_START_LIMIT_GLOBAL) {
      return false;
    }
    starts.push(timestamp);
    oauthStarts.set(key, starts);
    return true;
  }

  function googleConfigured() {
    return Boolean(config.clientId && config.clientSecret && config.redirectUri);
  }

  function cleanExpired() {
    const timestamp = new Date(now()).toISOString();
    db.prepare("DELETE FROM oauth_transactions WHERE expires_at <= ?").run(timestamp);
    db.prepare("DELETE FROM auth_sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL").run(timestamp);
  }

  function csrfTokenForSession(rawToken) {
    return hmac(runtimeSecret, `csrf:${rawToken}`);
  }

  function findSession(req) {
    const rawToken = parseCookies(req.headers.cookie).get(SESSION_COOKIE);
    if (!rawToken || rawToken.length > 256) return null;
    const row = db.prepare(`
      SELECT s.*, u.id, u.google_subject, u.display_name, u.role, u.disabled_at
      FROM auth_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?
    `).get(sha256(rawToken), new Date(now()).toISOString());
    if (!row || row.disabled_at) return null;
    const csrfToken = csrfTokenForSession(rawToken);
    if (sha256(csrfToken) !== row.csrf_secret_hash) return null;
    if (Date.parse(row.last_seen_at) < now() - 5 * 60 * 1_000) {
      db.prepare("UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?")
        .run(new Date(now()).toISOString(), row.token_hash);
    }
    return { rawToken, row, user: publicUser(row), csrfToken };
  }

  function sameOrigin(req) {
    const origin = req.headers.origin;
    const referer = req.headers.referer;
    const value = origin || referer;
    if (!value) return true;
    try {
      return new URL(value).origin === config.publicOrigin;
    } catch {
      return false;
    }
  }

  function requireSession(req, { mutation = false } = {}) {
    const session = findSession(req);
    if (!session) {
      const error = new Error("Sign in with Google to continue.");
      error.status = 401;
      error.code = "authentication_required";
      throw error;
    }
    if (mutation) {
      if (!sameOrigin(req)) {
        const error = new Error("Cross-origin request rejected.");
        error.status = 403;
        error.code = "origin_rejected";
        throw error;
      }
      const csrfHeader = req.headers["x-csrf-token"];
      const actual = Buffer.from(String(csrfHeader || ""));
      const expected = Buffer.from(session.csrfToken);
      if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
        const error = new Error("Refresh the page and try again.");
        error.status = 403;
        error.code = "csrf_rejected";
        throw error;
      }
    }
    return session;
  }

  function entitlementForUser(userId) {
    const user = db.prepare("SELECT role FROM users WHERE id = ?").get(userId);
    if (user?.role === "admin") {
      return { plan: "admin", publicRequestsPerWeek: null, privateAndUnlistedUnlimited: true };
    }
    const subscription = db.prepare(`
      SELECT plan, status, current_period_end
      FROM subscriptions WHERE user_id = ?
    `).get(userId);
    const active = subscription
      && ["active", "trialing"].includes(subscription.status)
      && (!subscription.current_period_end || Date.parse(subscription.current_period_end) > now());
    const plan = active ? subscription.plan : "free";
    const publicRequestsPerWeek = plan === "free" ? 1 : plan === "supporter" ? 10 : null;
    return { plan, publicRequestsPerWeek, privateAndUnlistedUnlimited: true };
  }

  function quotaForUser(userId) {
    const entitlement = entitlementForUser(userId);
    const since = new Date(now() - WEEK_MS).toISOString();
    const used = db.prepare(`
      SELECT COUNT(*) AS count FROM publication_quota_events
      WHERE user_id = ? AND kind = 'public_listing_requested' AND requested_at > ?
    `).get(userId, since).count;
    return {
      windowDays: 7,
      used,
      limit: entitlement.publicRequestsPerWeek,
      remaining: entitlement.publicRequestsPerWeek === null
        ? null
        : Math.max(0, entitlement.publicRequestsPerWeek - used),
    };
  }

  function recordPublicListingRequest(userId, storyId) {
    return db.transaction(() => {
      const quota = quotaForUser(userId);
      if (quota.limit !== null && quota.used >= quota.limit) {
        const error = new Error("Your next public-listing request becomes available after the rolling seven-day window.");
        error.status = 429;
        error.code = "public_listing_quota_exhausted";
        throw error;
      }
      db.prepare(`
        INSERT INTO publication_quota_events (id, user_id, kind, requested_at, story_id)
        VALUES (?, ?, 'public_listing_requested', ?, ?)
      `).run(crypto.randomUUID(), userId, new Date(now()).toISOString(), storyId);
      return quotaForUser(userId);
    })();
  }

  function claimStoryOwnership(storyId, userId) {
    db.prepare(`
      INSERT INTO creator_memberships (story_id, user_id, role, created_at)
      VALUES (?, ?, 'owner', ?)
      ON CONFLICT(story_id, user_id) DO UPDATE SET role = 'owner'
    `).run(storyId, userId, new Date(now()).toISOString());
  }

  function requireStoryMembership(req, storyId, roles = ["owner", "editor", "viewer"]) {
    const session = requireSession(req);
    const membership = db.prepare(`
      SELECT role FROM creator_memberships WHERE story_id = ? AND user_id = ?
    `).get(storyId, session.user.id);
    if (!membership || !roles.includes(membership.role)) {
      const error = new Error("This scroll is private.");
      error.status = 404;
      error.code = "story_not_found";
      throw error;
    }
    return { ...session, membershipRole: membership.role };
  }

  async function googleJwk(kid) {
    if (jwksCache.expiresAt <= now() || !jwksCache.keys.some((key) => key.kid === kid)) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), GOOGLE_FETCH_TIMEOUT_MS);
      timeout.unref?.();
      let response;
      try {
        response = await fetchImpl(GOOGLE_JWKS_URL, {
          headers: { Accept: "application/json" },
          redirect: "error",
          signal: controller.signal,
        });
      } catch (error) {
        if (error?.name === "AbortError") throw new Error("google_jwks_unavailable");
        throw error;
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) throw new Error("google_jwks_unavailable");
      const body = await readBoundedJson(response, GOOGLE_JWKS_MAX_BYTES, "google_jwks_invalid");
      if (!Array.isArray(body.keys)) throw new Error("google_jwks_invalid");
      const cacheControl = response.headers?.get?.("cache-control") || "";
      const maxAge = Number(cacheControl.match(/max-age=(\d+)/i)?.[1] || 3600);
      jwksCache = { keys: body.keys, expiresAt: now() + Math.min(Math.max(maxAge, 60), 86_400) * 1_000 };
    }
    const key = jwksCache.keys.find((candidate) => candidate.kid === kid && candidate.kty === "RSA");
    if (!key) throw new Error("google_jwk_not_found");
    return key;
  }

  async function validateGoogleIdToken(idToken, nonce) {
    const headerPart = String(idToken || "").split(".")[0];
    const header = decodeJwtPart(headerPart);
    if (!header?.kid) throw new Error("invalid_id_token");
    const jwk = await googleJwk(header.kid);
    return verifyRs256Jwt(idToken, jwk, {
      clientId: config.clientId,
      nonce,
      now: now(),
    });
  }

  function createSessionForUser(userId, req) {
    const rawToken = randomToken(32);
    const csrfToken = csrfTokenForSession(rawToken);
    const timestamp = new Date(now()).toISOString();
    const expiresAt = new Date(now() + SESSION_TTL_MS);
    const deviceLabel = String(req.headers["user-agent"] || "").slice(0, 180);
    db.prepare(`
      INSERT INTO auth_sessions
        (token_hash, user_id, issued_at, expires_at, last_seen_at, csrf_secret_hash, device_label)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(sha256(rawToken), userId, timestamp, expiresAt.toISOString(), timestamp, sha256(csrfToken), deviceLabel);
    return { rawToken, expiresAt };
  }

  function upsertGoogleUser(claims) {
    const timestamp = new Date(now()).toISOString();
    const normalizedEmail = normalizeEmail(claims.email);
    const role = config.adminEmails.has(normalizedEmail) ? "admin" : "creator";
    const existing = db.prepare("SELECT * FROM users WHERE google_subject = ?").get(claims.sub);
    if (existing?.disabled_at) throw new Error("account_disabled");
    const id = existing?.id || crypto.randomUUID();
    db.prepare(`
      INSERT INTO users
        (id, google_subject, email_fingerprint, display_name, role, created_at, last_login_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(google_subject) DO UPDATE SET
        email_fingerprint = excluded.email_fingerprint,
        display_name = excluded.display_name,
        role = CASE WHEN users.role IN ('reviewer', 'admin') THEN users.role ELSE excluded.role END,
        last_login_at = excluded.last_login_at
    `).run(
      id,
      claims.sub,
      emailFingerprint(runtimeSecret, normalizedEmail),
      normalizeDisplayName(claims.name),
      role,
      timestamp,
      timestamp,
    );
    return db.prepare("SELECT * FROM users WHERE google_subject = ?").get(claims.sub);
  }

  async function startGoogleLogin(req, res, url) {
    if (!googleConfigured()) {
      sendJson(res, 503, { error: { code: "google_not_configured", message: "Google sign-in is not configured yet." } });
      return;
    }
    if (!admitOauthStart(req)) {
      sendJson(res, 429, {
        error: {
          code: "oauth_rate_limited",
          message: "Too many sign-in attempts. Please wait a few minutes and try again.",
        },
      }, { "Retry-After": "600" });
      return;
    }
    cleanExpired();
    const rawTransaction = randomToken(32);
    const state = randomToken(32);
    const nonce = randomToken(32);
    const codeVerifier = randomToken(48);
    const codeChallenge = base64url(crypto.createHash("sha256").update(codeVerifier).digest());
    const timestamp = new Date(now()).toISOString();
    db.prepare(`
      INSERT INTO oauth_transactions
        (token_hash, state_hash, nonce, code_verifier, next_path, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      sha256(rawTransaction),
      sha256(state),
      nonce,
      codeVerifier,
      safeNextPath(url.searchParams.get("next")),
      new Date(now() + OAUTH_TTL_MS).toISOString(),
      timestamp,
    );

    const destination = new URL(GOOGLE_AUTHORIZATION_URL);
    destination.searchParams.set("client_id", config.clientId);
    destination.searchParams.set("redirect_uri", config.redirectUri);
    destination.searchParams.set("response_type", "code");
    destination.searchParams.set("scope", "openid email profile");
    destination.searchParams.set("state", state);
    destination.searchParams.set("nonce", nonce);
    destination.searchParams.set("code_challenge", codeChallenge);
    destination.searchParams.set("code_challenge_method", "S256");
    destination.searchParams.set("prompt", "select_account");
    res.writeHead(302, {
      Location: destination.toString(),
      "Set-Cookie": cookie(OAUTH_COOKIE, rawTransaction, {
        path: "/api/v2/auth/google/callback",
        maxAge: OAUTH_TTL_MS / 1_000,
      }),
      "Cache-Control": "no-store",
    });
    res.end();
  }

  async function finishGoogleLogin(req, res, url) {
    const rawTransaction = parseCookies(req.headers.cookie).get(OAUTH_COOKIE);
    const fallbackHeaders = { "Set-Cookie": clearCookie(OAUTH_COOKIE, "/api/v2/auth/google/callback") };
    const transaction = rawTransaction
      ? db.prepare("SELECT * FROM oauth_transactions WHERE token_hash = ? AND expires_at > ?")
        .get(sha256(rawTransaction), new Date(now()).toISOString())
      : null;
    if (rawTransaction) {
      db.prepare("DELETE FROM oauth_transactions WHERE token_hash = ?").run(sha256(rawTransaction));
    }
    const state = url.searchParams.get("state") || "";
    const code = url.searchParams.get("code") || "";
    if (!transaction || !state || sha256(state) !== transaction.state_hash || !code) {
      res.writeHead(302, { ...fallbackHeaders, Location: "/create/?auth_error=invalid_oauth_state" });
      res.end();
      return;
    }

    try {
      const tokens = await fetchGoogleJson(fetchImpl, GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          code,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: config.redirectUri,
          grant_type: "authorization_code",
          code_verifier: transaction.code_verifier,
        }),
      }, GOOGLE_TOKEN_MAX_BYTES, "google_token_exchange_failed");
      const claims = await validateGoogleIdToken(tokens.id_token, transaction.nonce);
      const user = upsertGoogleUser(claims);
      const session = createSessionForUser(user.id, req);
      const location = appendQuery(transaction.next_path, "signed_in", "1");
      res.writeHead(302, {
        Location: location,
        "Cache-Control": "no-store",
        "Set-Cookie": [
          clearCookie(OAUTH_COOKIE, "/api/v2/auth/google/callback"),
          cookie(SESSION_COOKIE, session.rawToken, {
            maxAge: SESSION_TTL_MS / 1_000,
            expires: session.expiresAt,
          }),
        ],
      });
      res.end();
    } catch (error) {
      const codeName = [
        "account_disabled",
        "unverified_google_identity",
      ].includes(error?.message) ? error.message : "google_oauth_failed";
      res.writeHead(302, {
        ...fallbackHeaders,
        Location: `/create/?auth_error=${encodeURIComponent(codeName)}`,
      });
      res.end();
    }
  }

  async function handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/v2/auth/google") {
      await startGoogleLogin(req, res, url);
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/v2/auth/google/callback") {
      await finishGoogleLogin(req, res, url);
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/v2/auth/me") {
      const session = findSession(req);
      if (!session) {
        sendJson(res, 401, {
          error: { code: "authentication_required", message: "Sign in with Google to create a scroll." },
          googleConfigured: googleConfigured(),
          loginUrl: "/api/v2/auth/google?next=%2Fcreate%2F",
        });
        return true;
      }
      sendJson(res, 200, {
        user: session.user,
        entitlement: entitlementForUser(session.user.id),
        publicListingQuota: quotaForUser(session.user.id),
        csrfToken: session.csrfToken,
      });
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/v2/auth/logout") {
      const session = requireSession(req, { mutation: true });
      db.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ?")
        .run(new Date(now()).toISOString(), session.row.token_hash);
      sendJson(res, 200, { ok: true }, { "Set-Cookie": clearCookie(SESSION_COOKIE) });
      return true;
    }
    return false;
  }

  return {
    handle,
    requireSession,
    findSession,
    entitlementForUser,
    quotaForUser,
    recordPublicListingRequest,
    claimStoryOwnership,
    requireStoryMembership,
    googleConfigured,
    configuration: {
      publicOrigin: config.publicOrigin,
      redirectUri: config.redirectUri,
      clientId: config.clientId,
    },
  };
}

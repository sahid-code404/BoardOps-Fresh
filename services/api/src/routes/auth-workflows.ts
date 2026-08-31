import { Hono, type Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { hashPassword, randomToken, tokenDigest, verifyPassword } from "../auth/crypto";
import type { AppEnv } from "../types";

const OTP_TTL_MS = 10 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 5 * 60 * 1000;
const REGISTRATION_ACCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ISSUE_WINDOW_MS = 60 * 60 * 1000;
const ISSUE_LIMIT_PER_IP = 8;
const LOCAL_OTP = "424242";
const REGISTRATION_COOKIE = "boardops_registration";

type ChallengePurpose =
  | "EMAIL_VERIFY"
  | "PASSWORD_RESET_OTP"
  | "PASSWORD_RESET_TOKEN"
  | "REGISTRATION_ACCESS";

type InstitutionRow = {
  id: string;
  name: string;
};

type RegistrationUserRow = {
  id: string;
  institution_id: string;
  name: string;
  email: string;
  phone: string | null;
  status: "ACTIVE" | "PENDING" | "SUSPENDED" | "ARCHIVED" | "INACTIVE";
  institution_user_id: string | null;
  email_verified: number;
  room: string | null;
  gender: string | null;
  created_at: string;
};

type ChallengeRow = {
  id: string;
  user_id: string;
  institution_id: string;
  email: string;
  purpose: ChallengePurpose;
  secret_hash: string;
  attempts: number;
  max_attempts: number;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
};

type RegistrationRequestRow = {
  id: string;
  cycle: number;
  status: "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "CHANGES_REQUESTED" | "RESUBMITTED";
  reason: string | null;
  fields_needing_correction_json: string | null;
  reviewed_at: string | null;
  created_at: string;
};

function firstForwardedIp(c: Context<AppEnv>): string {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "";
}

function clientIp(c: Context<AppEnv>): string {
  const forwarded = firstForwardedIp(c);
  // Local Wrangler supplies its own loopback cf-connecting-ip value, which
  // otherwise collapses every deterministic browser fixture into one throttle
  // bucket. Tests/dev may provide X-Forwarded-For to model independent clients;
  // production continues to trust Cloudflare's edge-owned header first.
  if (c.env.ENVIRONMENT === "local" && forwarded) return forwarded;

  const cf = c.req.header("cf-connecting-ip");
  if (cf) return cf;
  return forwarded || "127.0.0.1";
}

function userAgent(c: Context<AppEnv>): string | null {
  return c.req.header("user-agent")?.slice(0, 512) || null;
}

function normalizedEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isEmail(value: string): boolean {
  return value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
}

function passwordError(password: string): string | null {
  if (password.length < 8 || password.length > 512) return "Password must be 8 to 512 characters";
  if (!/[A-Z]/u.test(password)) return "Password must contain at least one uppercase letter";
  if (!/[a-z]/u.test(password)) return "Password must contain at least one lowercase letter";
  if (!/[0-9]/u.test(password)) return "Password must contain at least one number";
  if (!/[^A-Za-z0-9]/u.test(password)) return "Password must contain at least one special character";
  return null;
}

async function readObjectBody(c: Context<AppEnv>): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.req.json();
    return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  } catch {
    return null;
  }
}

function randomOtp(c: Context<AppEnv>): string {
  if (c.env.ENVIRONMENT === "local") return LOCAL_OTP;
  const value = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  return String(value % 1_000_000).padStart(6, "0");
}

async function secretHash(secret: string, purpose: ChallengePurpose): Promise<string> {
  if (purpose === "REGISTRATION_ACCESS" || purpose === "PASSWORD_RESET_TOKEN") {
    return `sha256:${await tokenDigest(secret)}`;
  }
  return `pbkdf2:${await hashPassword(secret, 100_000)}`;
}

async function secretMatches(secret: string, encoded: string): Promise<boolean> {
  if (encoded.startsWith("sha256:")) {
    return encoded.slice(7) === (await tokenDigest(secret));
  }
  if (encoded.startsWith("pbkdf2:")) {
    return verifyPassword(secret, encoded.slice(7));
  }
  return false;
}

function setRegistrationCookie(c: Context<AppEnv>, token: string) {
  setCookie(c, REGISTRATION_COOKIE, token, {
    httpOnly: true,
    secure: c.env.ENVIRONMENT !== "local",
    sameSite: "Lax",
    path: "/api/auth",
    maxAge: Math.floor(REGISTRATION_ACCESS_TTL_MS / 1000),
  });
}

function registrationToken(c: Context<AppEnv>, explicit?: unknown): string {
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
  return getCookie(c, REGISTRATION_COOKIE)?.trim() ?? "";
}

function logLocalDelivery(c: Context<AppEnv>, purpose: ChallengePurpose, email: string, code: string): boolean {
  if (c.env.ENVIRONMENT !== "local") return false;
  // Local development transport only. Production must configure a real mail
  // adapter before these public flows are enabled; secrets are never returned
  // in the HTTP response or stored in plaintext in D1.
  console.info(`[BoardOps local auth] ${purpose} for ${email}: ${code}`);
  return true;
}

function authEmailDeliveryAvailable(c: Context<AppEnv>): boolean {
  // Phase 04 has a deterministic local transport only. Non-local environments
  // must fail closed before any registration/email mutation until a production
  // mail adapter is explicitly configured in a later deployment checkpoint.
  return c.env.ENVIRONMENT === "local";
}

async function checkIssueRateLimit(c: Context<AppEnv>, purpose: ChallengePurpose): Promise<boolean> {
  const cutoff = new Date(Date.now() - ISSUE_WINDOW_MS).toISOString();
  const row = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM auth_challenges
     WHERE request_ip = ? AND purpose = ? AND created_at >= ?`,
  )
    .bind(clientIp(c), purpose, cutoff)
    .first<{ count: number }>();
  return Number(row?.count ?? 0) < ISSUE_LIMIT_PER_IP;
}

async function latestChallenge(
  c: Context<AppEnv>,
  userId: string,
  purpose: ChallengePurpose,
): Promise<ChallengeRow | null> {
  return c.env.DB.prepare(
    `SELECT id, user_id, institution_id, email, purpose, secret_hash, attempts,
            max_attempts, expires_at, consumed_at, created_at
     FROM auth_challenges
     WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
  )
    .bind(userId, purpose)
    .first<ChallengeRow>();
}

async function invalidateChallenges(
  c: Context<AppEnv>,
  userId: string,
  purpose: ChallengePurpose,
  now: string,
) {
  await c.env.DB.prepare(
    `UPDATE auth_challenges
     SET consumed_at = ?, updated_at = ?
     WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL`,
  )
    .bind(now, now, userId, purpose)
    .run();
}

async function insertChallenge(
  c: Context<AppEnv>,
  user: Pick<RegistrationUserRow, "id" | "institution_id" | "email">,
  purpose: ChallengePurpose,
  secret: string,
  ttlMs: number,
  maxAttempts = 5,
): Promise<string> {
  const now = new Date();
  const nowIso = now.toISOString();
  await invalidateChallenges(c, user.id, purpose, nowIso);
  const id = crypto.randomUUID();
  const encoded = await secretHash(secret, purpose);
  await c.env.DB.prepare(
    `INSERT INTO auth_challenges
      (id, institution_id, user_id, email, purpose, secret_hash, attempts,
       max_attempts, request_ip, expires_at, consumed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NULL, ?, ?)`,
  )
    .bind(
      id,
      user.institution_id,
      user.id,
      user.email,
      purpose,
      encoded,
      maxAttempts,
      clientIp(c),
      new Date(now.getTime() + ttlMs).toISOString(),
      nowIso,
      nowIso,
    )
    .run();
  return id;
}

async function verifyOneTimeChallenge(
  c: Context<AppEnv>,
  challenge: ChallengeRow | null,
  secret: string,
): Promise<boolean> {
  if (!challenge) return false;
  const now = new Date();
  const nowIso = now.toISOString();
  if (challenge.consumed_at || challenge.expires_at <= nowIso || challenge.attempts >= challenge.max_attempts) {
    return false;
  }

  const matches = await secretMatches(secret, challenge.secret_hash);
  if (matches) return true;

  const nextAttempts = challenge.attempts + 1;
  await c.env.DB.prepare(
    `UPDATE auth_challenges
     SET attempts = ?, consumed_at = CASE WHEN ? >= max_attempts THEN ? ELSE consumed_at END,
         updated_at = ?
     WHERE id = ?`,
  )
    .bind(nextAttempts, nextAttempts, nowIso, nowIso, challenge.id)
    .run();
  return false;
}

function challengeExpired(challenge: ChallengeRow): boolean {
  return challenge.expires_at <= new Date().toISOString();
}

async function registrationSession(
  c: Context<AppEnv>,
  explicit?: unknown,
): Promise<{ user: RegistrationUserRow; challenge: ChallengeRow } | null> {
  const token = registrationToken(c, explicit);
  if (!token) return null;
  const digest = await tokenDigest(token);
  const challenge = await c.env.DB.prepare(
    `SELECT id, user_id, institution_id, email, purpose, secret_hash, attempts,
            max_attempts, expires_at, consumed_at, created_at
     FROM auth_challenges
     WHERE purpose = 'REGISTRATION_ACCESS' AND secret_hash = ? AND consumed_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
  )
    .bind(`sha256:${digest}`)
    .first<ChallengeRow>();
  if (!challenge || challengeExpired(challenge)) return null;
  const user = await c.env.DB.prepare(
    `SELECT id, institution_id, name, email, phone, status, institution_user_id,
            email_verified, room, gender, created_at
     FROM users
     WHERE id = ? LIMIT 1`,
  )
    .bind(challenge.user_id)
    .first<RegistrationUserRow>();
  if (!user) return null;
  return { user, challenge };
}

async function institutionByName(c: Context<AppEnv>, name: string): Promise<InstitutionRow | null> {
  return c.env.DB.prepare(`SELECT id, name FROM institutions WHERE lower(name) = lower(?) LIMIT 1`)
    .bind(name.trim())
    .first<InstitutionRow>();
}

async function registrationView(c: Context<AppEnv>, user: RegistrationUserRow) {
  const request = await c.env.DB.prepare(
    `SELECT id, cycle, status, reason, fields_needing_correction_json, reviewed_at, created_at
     FROM registration_requests
     WHERE user_id = ?
     ORDER BY cycle DESC
     LIMIT 1`,
  )
    .bind(user.id)
    .first<RegistrationRequestRow>();

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      status: user.status,
      institutionUserId: user.institution_user_id,
      emailVerified: Boolean(user.email_verified),
      room: user.room,
      gender: user.gender,
      createdAt: user.created_at,
    },
    request: request
      ? {
          id: request.id,
          cycle: request.cycle,
          status: request.status,
          reason: request.reason,
          fieldsNeedingCorrection: JSON.parse(request.fields_needing_correction_json ?? "[]") as string[],
          reviewedAt: request.reviewed_at,
          createdAt: request.created_at,
        }
      : null,
  };
}

export function createAuthWorkflowRoutes() {
  const app = new Hono<AppEnv>();

  app.post("/auth/register", async (c) => {
    if (!authEmailDeliveryAvailable(c)) {
      return c.json({ success: false, error: "Email verification delivery is unavailable" }, 503);
    }
    const body = await readObjectBody(c);
    if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const institutionName = typeof body.institutionName === "string" ? body.institutionName.trim() : "";
    const institutionUserId = typeof body.institutionUserId === "string" ? body.institutionUserId.trim() : "";
    const email = normalizedEmail(body.email);
    const phone = typeof body.phone === "string" && body.phone.trim() ? body.phone.trim() : null;
    const password = typeof body.password === "string" ? body.password : "";
    const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";
    const room = typeof body.room === "string" && body.room.trim() ? body.room.trim() : null;
    const gender = typeof body.gender === "string" && body.gender.trim() ? body.gender.trim() : null;
    const consents =
      typeof body.consents === "object" && body.consents !== null
        ? (body.consents as Record<string, unknown>)
        : {};

    if (!name || name.length > 120) return c.json({ success: false, error: "Name is required" }, 400);
    if (!institutionName || institutionName.length > 160) {
      return c.json({ success: false, error: "Institution name is required" }, 400);
    }
    if (!institutionUserId || institutionUserId.length > 120) {
      return c.json({ success: false, error: "Institution user ID is required" }, 400);
    }
    if (!isEmail(email)) return c.json({ success: false, error: "Valid email is required" }, 400);
    if (phone && (phone.length < 8 || phone.length > 32)) {
      return c.json({ success: false, error: "Phone must be 8 to 32 characters" }, 400);
    }
    if (password !== confirmPassword) return c.json({ success: false, error: "Passwords do not match" }, 400);
    const pwdError = passwordError(password);
    if (pwdError) return c.json({ success: false, error: pwdError }, 400);
    if (consents.rules !== true || consents.privacy !== true || consents.terms !== true) {
      return c.json({ success: false, error: "All required consents must be accepted" }, 400);
    }
    if (!(await checkIssueRateLimit(c, "EMAIL_VERIFY"))) {
      return c.json({ success: false, error: "Too many verification requests. Try again later." }, 429);
    }

    const institution = await institutionByName(c, institutionName);
    if (!institution) return c.json({ success: false, error: "Institution not found" }, 404);

    const now = new Date().toISOString();
    const existing = await c.env.DB.prepare(
      `SELECT id, institution_id, name, email, phone, status, institution_user_id,
              email_verified, room, gender, created_at
       FROM users
       WHERE institution_id = ? AND email = ?
       LIMIT 1`,
    )
      .bind(institution.id, email)
      .first<RegistrationUserRow>();

    if (existing?.status === "ACTIVE") {
      return c.json({ success: false, error: "An active account already exists for this email" }, 409);
    }
    if (existing?.institution_user_id && existing.institution_user_id !== institutionUserId) {
      return c.json({ success: false, error: "This email is already tied to another institution user ID" }, 409);
    }

    const duplicateInstitutionId = await c.env.DB.prepare(
      `SELECT id FROM users WHERE institution_id = ? AND institution_user_id = ? AND email <> ? LIMIT 1`,
    )
      .bind(institution.id, institutionUserId, email)
      .first<{ id: string }>();
    if (duplicateInstitutionId) {
      return c.json({ success: false, error: "Institution user ID is already in use" }, 409);
    }

    if (phone) {
      const duplicatePhone = await c.env.DB.prepare(
        `SELECT id FROM users WHERE institution_id = ? AND phone = ? AND email <> ? LIMIT 1`,
      )
        .bind(institution.id, phone, email)
        .first<{ id: string }>();
      if (duplicatePhone) return c.json({ success: false, error: "Phone number is already in use" }, 409);
    }

    const passwordHash = await hashPassword(password);
    const userId = existing?.id ?? crypto.randomUUID();
    const role = "USER";
    try {
      if (existing) {
        await c.env.DB.prepare(
          `UPDATE users
           SET name = ?, phone = ?, password_hash = ?, institution_user_id = ?, role = ?, status = 'PENDING',
               email_verified = 0, room = ?, gender = ?, updated_at = ?
           WHERE id = ?`,
        )
          .bind(name, phone, passwordHash, institutionUserId, role, room, gender, now, existing.id)
          .run();
      } else {
        await c.env.DB.prepare(
          `INSERT INTO users
            (id, institution_id, name, email, phone, password_hash, institution_user_id, role, status,
             email_verified, room, gender, theme, language, timezone, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, ?, 'system', 'en', 'Asia/Kolkata', ?, ?)`,
        )
          .bind(
            userId,
            institution.id,
            name,
            email,
            phone,
            passwordHash,
            institutionUserId,
            role,
            room,
            gender,
            now,
            now,
          )
          .run();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("users_institution_phone_unique") || message.includes("UNIQUE constraint failed: users.institution_id, users.phone")) {
        return c.json({ success: false, error: "Phone number is already in use" }, 409);
      }
      throw error;
    }

    const user: RegistrationUserRow = {
      id: userId,
      institution_id: institution.id,
      name,
      email,
      phone,
      status: "PENDING",
      institution_user_id: institutionUserId,
      email_verified: 0,
      room,
      gender,
      created_at: existing?.created_at ?? now,
    };

    const otp = randomOtp(c);
    await insertChallenge(c, user, "EMAIL_VERIFY", otp, OTP_TTL_MS);
    if (!logLocalDelivery(c, "EMAIL_VERIFY", email, otp)) {
      return c.json({ success: false, error: "Email verification delivery is unavailable" }, 503);
    }
    const accessToken = randomToken(32);
    await insertChallenge(c, user, "REGISTRATION_ACCESS", accessToken, REGISTRATION_ACCESS_TTL_MS, 1);
    setRegistrationCookie(c, accessToken);

    return c.json(
      {
        success: true,
        data: {
          userId,
          email,
          emailVerified: false,
          status: "EMAIL_VERIFICATION_REQUIRED",
          delivery: c.env.ENVIRONMENT === "local" ? "local-development" : "email",
        },
      },
      existing ? 200 : 201,
    );
  });

  app.post("/auth/resend-verification", async (c) => {
    if (!authEmailDeliveryAvailable(c)) {
      return c.json({ success: false, error: "Email verification delivery is unavailable" }, 503);
    }
    const body = await readObjectBody(c);
    if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
    const email = normalizedEmail(body.email);
    if (!isEmail(email)) return c.json({ success: false, error: "Valid email is required" }, 400);
    if (!(await checkIssueRateLimit(c, "EMAIL_VERIFY"))) {
      return c.json({ success: false, error: "Too many verification requests. Try again later." }, 429);
    }

    const user = await c.env.DB.prepare(
      `SELECT id, institution_id, name, email, phone, status, institution_user_id,
              email_verified, room, gender, created_at
       FROM users
       WHERE email = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
      .bind(email)
      .first<RegistrationUserRow>();
    if (!user) return c.json({ success: true, data: { accepted: true } });
    if (user.email_verified) return c.json({ success: true, data: { accepted: true } });

    const otp = randomOtp(c);
    await insertChallenge(c, user, "EMAIL_VERIFY", otp, OTP_TTL_MS);
    if (!logLocalDelivery(c, "EMAIL_VERIFY", email, otp)) {
      return c.json({ success: false, error: "Email verification delivery is unavailable" }, 503);
    }
    return c.json({
      success: true,
      data: { accepted: true, delivery: c.env.ENVIRONMENT === "local" ? "local-development" : "email" },
    });
  });

  app.get("/auth/registration", async (c) => {
    const session = await registrationSession(c, c.req.query("accessToken"));
    if (!session) return c.json({ success: false, error: "Registration access denied" }, 401);
    return c.json({ success: true, data: await registrationView(c, session.user) });
  });

  app.post("/auth/verify-email", async (c) => {
    if (!authEmailDeliveryAvailable(c)) {
      return c.json({ success: false, error: "Email verification delivery is unavailable" }, 503);
    }
    const body = await readObjectBody(c);
    if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
    const session = await registrationSession(c, body.accessToken);
    const email = normalizedEmail(body.email);
    const otp = typeof body.otp === "string" ? body.otp.trim() : "";
    if (!session || session.user.email !== email) return c.json({ success: false, error: "Registration access denied" }, 401);
    if (!/^\d{6}$/u.test(otp)) return c.json({ success: false, error: "Invalid or expired verification code" }, 400);

    const challenge = await latestChallenge(c, session.user.id, "EMAIL_VERIFY");
    const valid = await verifyOneTimeChallenge(c, challenge, otp);
    if (!valid) return c.json({ success: false, error: "Invalid or expired verification code" }, 400);

    const now = new Date().toISOString();
    await c.env.DB.prepare(`UPDATE auth_challenges SET consumed_at = ?, updated_at = ? WHERE id = ?`)
      .bind(now, now, challenge!.id)
      .run();
    await c.env.DB.prepare(`UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?`)
      .bind(now, session.user.id)
      .run();

    const existingRequest = await c.env.DB.prepare(
      `SELECT id, cycle, status, reason, fields_needing_correction_json, reviewed_at, created_at
       FROM registration_requests
       WHERE user_id = ? ORDER BY cycle DESC LIMIT 1`,
    )
      .bind(session.user.id)
      .first<RegistrationRequestRow>();
    if (!existingRequest) {
      await c.env.DB.prepare(
        `INSERT INTO registration_requests
          (id, institution_id, user_id, cycle, status, created_at, updated_at)
         VALUES (?, ?, ?, 1, 'PENDING_REVIEW', ?, ?)`,
      )
        .bind(crypto.randomUUID(), session.user.institution_id, session.user.id, now, now)
        .run();
    }

    const refreshed = { ...session.user, email_verified: 1 };
    return c.json({ success: true, data: await registrationView(c, refreshed) });
  });

  app.patch("/auth/registration", async (c) => {
    if (!authEmailDeliveryAvailable(c)) {
      return c.json({ success: false, error: "Email verification delivery is unavailable" }, 503);
    }
    const body = await readObjectBody(c);
    if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
    const session = await registrationSession(c, body.accessToken);
    if (!session) return c.json({ success: false, error: "Registration access denied" }, 401);

    const email = Object.hasOwn(body, "email") ? normalizedEmail(body.email) : session.user.email;
    const phone = Object.hasOwn(body, "phone")
      ? typeof body.phone === "string" && body.phone.trim()
        ? body.phone.trim()
        : null
      : session.user.phone;
    const name = Object.hasOwn(body, "name") && typeof body.name === "string" ? body.name.trim() : session.user.name;
    const room = Object.hasOwn(body, "room")
      ? typeof body.room === "string" && body.room.trim()
        ? body.room.trim()
        : null
      : session.user.room;
    const gender = Object.hasOwn(body, "gender")
      ? typeof body.gender === "string" && body.gender.trim()
        ? body.gender.trim()
        : null
      : session.user.gender;
    const institutionUserId =
      Object.hasOwn(body, "institutionUserId") && typeof body.institutionUserId === "string"
        ? body.institutionUserId.trim()
        : session.user.institution_user_id ?? "";

    if (!name || name.length > 120) return c.json({ success: false, error: "Name is required" }, 400);
    if (!isEmail(email)) return c.json({ success: false, error: "Valid email is required" }, 400);
    if (phone && (phone.length < 8 || phone.length > 32)) {
      return c.json({ success: false, error: "Phone must be 8 to 32 characters" }, 400);
    }
    if (!institutionUserId || institutionUserId.length > 120) {
      return c.json({ success: false, error: "Institution user ID is required" }, 400);
    }

    const duplicateEmail = await c.env.DB.prepare(
      `SELECT id FROM users WHERE institution_id = ? AND email = ? AND id <> ? LIMIT 1`,
    )
      .bind(session.user.institution_id, email, session.user.id)
      .first<{ id: string }>();
    if (duplicateEmail) return c.json({ success: false, error: "Email is already in use" }, 409);

    const duplicateInstitutionId = await c.env.DB.prepare(
      `SELECT id FROM users WHERE institution_id = ? AND institution_user_id = ? AND id <> ? LIMIT 1`,
    )
      .bind(session.user.institution_id, institutionUserId, session.user.id)
      .first<{ id: string }>();
    if (duplicateInstitutionId) return c.json({ success: false, error: "Institution user ID is already in use" }, 409);

    if (phone) {
      const duplicatePhone = await c.env.DB.prepare(
        `SELECT id FROM users WHERE institution_id = ? AND phone = ? AND id <> ? LIMIT 1`,
      )
        .bind(session.user.institution_id, phone, session.user.id)
        .first<{ id: string }>();
      if (duplicatePhone) return c.json({ success: false, error: "Phone number is already in use" }, 409);
    }

    const emailChanged = email !== session.user.email;
    const now = new Date().toISOString();
    try {
      await c.env.DB.prepare(
        `UPDATE users
         SET name = ?, email = ?, phone = ?, institution_user_id = ?, room = ?, gender = ?,
             email_verified = CASE WHEN ? THEN 0 ELSE email_verified END,
             status = 'PENDING', updated_at = ?
         WHERE id = ?`,
      )
        .bind(name, email, phone, institutionUserId, room, gender, emailChanged ? 1 : 0, now, session.user.id)
        .run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("users_institution_phone_unique") || message.includes("UNIQUE constraint failed: users.institution_id, users.phone")) {
        return c.json({ success: false, error: "Phone number is already in use" }, 409);
      }
      throw error;
    }

    const latest = await c.env.DB.prepare(
      `SELECT id, cycle, status, reason, fields_needing_correction_json, reviewed_at, created_at
       FROM registration_requests
       WHERE user_id = ? ORDER BY cycle DESC LIMIT 1`,
    )
      .bind(session.user.id)
      .first<RegistrationRequestRow>();
    if (latest && ["REJECTED", "CHANGES_REQUESTED"].includes(latest.status)) {
      await c.env.DB.prepare(
        `INSERT INTO registration_requests
          (id, institution_id, user_id, cycle, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'RESUBMITTED', ?, ?)`,
      )
        .bind(crypto.randomUUID(), session.user.institution_id, session.user.id, latest.cycle + 1, now, now)
        .run();
    }

    const updatedUser: RegistrationUserRow = {
      ...session.user,
      name,
      email,
      phone,
      institution_user_id: institutionUserId,
      room,
      gender,
      status: "PENDING",
      email_verified: emailChanged ? 0 : session.user.email_verified,
    };

    if (emailChanged) {
      if (!(await checkIssueRateLimit(c, "EMAIL_VERIFY"))) {
        return c.json({ success: false, error: "Too many verification requests. Try again later." }, 429);
      }
      const otp = randomOtp(c);
      await insertChallenge(c, updatedUser, "EMAIL_VERIFY", otp, OTP_TTL_MS);
      if (!logLocalDelivery(c, "EMAIL_VERIFY", email, otp)) {
        return c.json({ success: false, error: "Email verification delivery is unavailable" }, 503);
      }
    }

    return c.json({ success: true, data: await registrationView(c, updatedUser) });
  });

  app.post("/auth/registration/resubmit", async (c) => {
    const body = await readObjectBody(c);
    if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
    const session = await registrationSession(c, body.accessToken);
    if (!session) return c.json({ success: false, error: "Registration access denied" }, 401);
    if (!session.user.email_verified) {
      return c.json({ success: false, error: "Verify your email before resubmitting" }, 409);
    }

    const latest = await c.env.DB.prepare(
      `SELECT id, cycle, status, reason, fields_needing_correction_json, reviewed_at, created_at
       FROM registration_requests
       WHERE user_id = ? ORDER BY cycle DESC LIMIT 1`,
    )
      .bind(session.user.id)
      .first<RegistrationRequestRow>();
    if (!latest) return c.json({ success: false, error: "Registration request not found" }, 404);
    if (!["REJECTED", "CHANGES_REQUESTED"].includes(latest.status)) {
      return c.json({ success: false, error: "Registration is not awaiting resubmission" }, 409);
    }

    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `INSERT INTO registration_requests
        (id, institution_id, user_id, cycle, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'RESUBMITTED', ?, ?)`,
    )
      .bind(crypto.randomUUID(), session.user.institution_id, session.user.id, latest.cycle + 1, now, now)
      .run();
    return c.json({ success: true, data: await registrationView(c, session.user) });
  });

  app.post("/auth/forgot-password", async (c) => {
    if (!authEmailDeliveryAvailable(c)) {
      return c.json({ success: false, error: "Password recovery delivery is unavailable" }, 503);
    }
    const body = await readObjectBody(c);
    if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
    const email = normalizedEmail(body.email);
    if (!isEmail(email)) return c.json({ success: true, data: { accepted: true } });
    if (!(await checkIssueRateLimit(c, "PASSWORD_RESET_OTP"))) {
      return c.json({ success: true, data: { accepted: true } });
    }

    const user = await c.env.DB.prepare(
      `SELECT id, institution_id, name, email, phone, status, institution_user_id,
              email_verified, room, gender, created_at
       FROM users
       WHERE email = ? AND status = 'ACTIVE'
       ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(email)
      .first<RegistrationUserRow>();
    if (!user) return c.json({ success: true, data: { accepted: true } });

    const otp = randomOtp(c);
    await insertChallenge(c, user, "PASSWORD_RESET_OTP", otp, OTP_TTL_MS);
    if (!logLocalDelivery(c, "PASSWORD_RESET_OTP", email, otp)) {
      return c.json({ success: false, error: "Password recovery delivery is unavailable" }, 503);
    }
    return c.json({
      success: true,
      data: { accepted: true, delivery: c.env.ENVIRONMENT === "local" ? "local-development" : "email" },
    });
  });

  app.post("/auth/reset-password/verify", async (c) => {
    if (!authEmailDeliveryAvailable(c)) {
      return c.json({ success: false, error: "Password recovery delivery is unavailable" }, 503);
    }
    const body = await readObjectBody(c);
    if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
    const email = normalizedEmail(body.email);
    const otp = typeof body.otp === "string" ? body.otp.trim() : "";
    if (!isEmail(email) || !/^\d{6}$/u.test(otp)) {
      return c.json({ success: false, error: "Invalid or expired verification code" }, 400);
    }

    const user = await c.env.DB.prepare(
      `SELECT id, institution_id, name, email, phone, status, institution_user_id,
              email_verified, room, gender, created_at
       FROM users
       WHERE email = ? AND status = 'ACTIVE'
       ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(email)
      .first<RegistrationUserRow>();
    if (!user) return c.json({ success: false, error: "Invalid or expired verification code" }, 400);

    const challenge = await latestChallenge(c, user.id, "PASSWORD_RESET_OTP");
    if (!(await verifyOneTimeChallenge(c, challenge, otp))) {
      return c.json({ success: false, error: "Invalid or expired verification code" }, 400);
    }

    const now = new Date().toISOString();
    await c.env.DB.prepare(`UPDATE auth_challenges SET consumed_at = ?, updated_at = ? WHERE id = ?`)
      .bind(now, now, challenge!.id)
      .run();
    const resetToken = randomToken(32);
    await insertChallenge(c, user, "PASSWORD_RESET_TOKEN", resetToken, RESET_TOKEN_TTL_MS, 1);
    return c.json({ success: true, data: { resetToken } });
  });

  app.post("/auth/reset-password", async (c) => {
    if (!authEmailDeliveryAvailable(c)) {
      return c.json({ success: false, error: "Password recovery delivery is unavailable" }, 503);
    }
    const body = await readObjectBody(c);
    if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
    const email = normalizedEmail(body.email);
    const resetToken = typeof body.resetToken === "string" ? body.resetToken.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";
    if (!isEmail(email) || !resetToken) return c.json({ success: false, error: "Invalid or expired reset token" }, 400);
    if (password !== confirmPassword) return c.json({ success: false, error: "Passwords do not match" }, 400);
    const pwdError = passwordError(password);
    if (pwdError) return c.json({ success: false, error: pwdError }, 400);

    const user = await c.env.DB.prepare(
      `SELECT id, institution_id, name, email, phone, status, institution_user_id,
              email_verified, room, gender, created_at
       FROM users
       WHERE email = ? AND status = 'ACTIVE'
       ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(email)
      .first<RegistrationUserRow>();
    if (!user) return c.json({ success: false, error: "Invalid or expired reset token" }, 400);

    const challenge = await latestChallenge(c, user.id, "PASSWORD_RESET_TOKEN");
    if (!challenge || challenge.secret_hash !== `sha256:${await tokenDigest(resetToken)}` || challengeExpired(challenge)) {
      return c.json({ success: false, error: "Invalid or expired reset token" }, 400);
    }

    const now = new Date().toISOString();
    const passwordHash = await hashPassword(password);
    await c.env.DB.prepare(
      `UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(passwordHash, now, user.id)
      .run();
    await c.env.DB.prepare(
      `UPDATE auth_challenges SET consumed_at = ?, updated_at = ? WHERE id = ? AND consumed_at IS NULL`,
    )
      .bind(now, now, challenge.id)
      .run();
    await c.env.DB.prepare(`DELETE FROM user_sessions WHERE user_id = ?`).bind(user.id).run();
    return c.json({ success: true, data: { passwordReset: true } });
  });

  return app;
}

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

function clientIp(c: Context<AppEnv>): string {
  const cf = c.req.header("cf-connecting-ip");
  if (cf) return cf;
  const forwarded = c.req.header("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "127.0.0.1";
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

async function consumeChallenge(c: Context<AppEnv>, id: string, now: string) {
  await c.env.DB.prepare(
    `UPDATE auth_challenges SET consumed_at = ?, updated_at = ? WHERE id = ? AND consumed_at IS NULL`,
  )
    .bind(now, now, id)
    .run();
}

async function audit(
  c: Context<AppEnv>,
  user: Pick<RegistrationUserRow, "id" | "institution_id">,
  action: string,
  metadata: Record<string, unknown> = {},
  reason: string | null = null,
) {
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO audit_events
      (id, institution_id, actor_user_id, action, entity_type, entity_id,
       request_id, reason, metadata_json, created_at)
     VALUES (?, ?, ?, ?, 'User', ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      user.institution_id,
      user.id,
      action,
      user.id,
      c.get("requestId"),
      reason,
      JSON.stringify({ ...metadata, ipAddress: clientIp(c), userAgent: userAgent(c) }),
      now,
    )
    .run();
}

async function findUserByEmail(c: Context<AppEnv>, email: string): Promise<RegistrationUserRow | null> {
  return c.env.DB.prepare(
    `SELECT id, institution_id, name, email, phone, status, institution_user_id,
            email_verified, room, gender, created_at
     FROM users
     WHERE lower(email) = ?
     LIMIT 1`,
  )
    .bind(email)
    .first<RegistrationUserRow>();
}

function parseCorrectionFields(value: string | null): string[] | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string") ? parsed : null;
  } catch {
    return null;
  }
}

export const authWorkflowRoutes = new Hono<AppEnv>();

authWorkflowRoutes.post("/register", async (c) => {
  const body = await readObjectBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const institutionName = typeof body.institutionName === "string" ? body.institutionName.trim() : "";
  const institutionUserId = typeof body.institutionUserId === "string" ? body.institutionUserId.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const email = normalizedEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";
  const room = typeof body.room === "string" ? body.room.trim() : "";
  const gender = body.gender == null || body.gender === "" ? null : String(body.gender).toUpperCase();
  const consents = typeof body.consents === "object" && body.consents !== null
    ? (body.consents as Record<string, unknown>)
    : {};

  if (name.length < 2 || name.length > 100) return c.json({ success: false, error: "Name must be 2 to 100 characters" }, 400);
  if (!institutionName) return c.json({ success: false, error: "Institution name is required" }, 400);
  if (!institutionUserId || institutionUserId.length > 100) return c.json({ success: false, error: "Institution User ID is required" }, 400);
  if (phone.length < 8 || phone.length > 32) return c.json({ success: false, error: "Enter a valid phone number" }, 400);
  if (!isEmail(email)) return c.json({ success: false, error: "Enter a valid email" }, 400);
  if (!room || room.length > 64) return c.json({ success: false, error: "Room number is required" }, 400);
  if (gender && !["MALE", "FEMALE", "OTHER"].includes(gender)) return c.json({ success: false, error: "Invalid gender" }, 400);
  if (consents.rules !== true || consents.privacy !== true || consents.terms !== true) {
    return c.json({ success: false, error: "Institution Rules, Privacy Policy, and Terms & Conditions must be accepted" }, 400);
  }
  if (password !== confirmPassword) return c.json({ success: false, error: "Passwords do not match" }, 400);
  const pwdError = passwordError(password);
  if (pwdError) return c.json({ success: false, error: pwdError }, 422);
  if (!(await checkIssueRateLimit(c, "EMAIL_VERIFY"))) {
    return c.json({ success: false, error: "Too many registration attempts. Please try again later." }, 429);
  }

  const institution = await c.env.DB.prepare(
    `SELECT id, name FROM institutions WHERE status = 'ACTIVE' AND lower(name) = lower(?) LIMIT 1`,
  )
    .bind(institutionName)
    .first<InstitutionRow>();
  if (!institution) return c.json({ success: false, error: "Institution is not available for registration" }, 400);

  const [emailTaken, phoneTaken, institutionIdTaken] = await Promise.all([
    c.env.DB.prepare(`SELECT id FROM users WHERE lower(email) = ? LIMIT 1`).bind(email).first<{ id: string }>(),
    c.env.DB.prepare(`SELECT id FROM users WHERE institution_id = ? AND phone = ? LIMIT 1`).bind(institution.id, phone).first<{ id: string }>(),
    c.env.DB.prepare(`SELECT id FROM users WHERE institution_id = ? AND institution_user_id = ? LIMIT 1`).bind(institution.id, institutionUserId).first<{ id: string }>(),
  ]);
  if (emailTaken) return c.json({ success: false, error: "This email is already registered" }, 409);
  if (phoneTaken) return c.json({ success: false, error: "This phone number is already registered" }, 409);
  if (institutionIdTaken) return c.json({ success: false, error: "This Institution User ID is already taken" }, 409);

  const now = new Date();
  const nowIso = now.toISOString();
  const userId = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  const emailChallengeId = crypto.randomUUID();
  const accessChallengeId = crypto.randomUUID();
  const otp = randomOtp(c);
  const accessToken = randomToken();
  const [passwordHash, otpHash, accessHash] = await Promise.all([
    hashPassword(password),
    secretHash(otp, "EMAIL_VERIFY"),
    secretHash(accessToken, "REGISTRATION_ACCESS"),
  ]);
  const fieldsJson = JSON.stringify({
    name,
    email,
    phone,
    room,
    gender,
    institutionName: institution.name,
    institutionUserId,
  });

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO users
        (id, institution_id, name, email, phone, password_hash, role, status,
         institution_user_id, email_verified, room, gender, emergency_contact,
         theme, language, timezone, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'USER', 'PENDING', ?, 0, ?, ?, NULL,
               'system', 'en', 'Asia/Kolkata', ?, ?)`,
    ).bind(userId, institution.id, name, email, phone, passwordHash, institutionUserId, room, gender, nowIso, nowIso),
    c.env.DB.prepare(
      `INSERT INTO registration_requests
        (id, institution_id, user_id, cycle, status, fields_json, request_ip, created_at, updated_at)
       VALUES (?, ?, ?, 1, 'PENDING_REVIEW', ?, ?, ?, ?)`,
    ).bind(requestId, institution.id, userId, fieldsJson, clientIp(c), nowIso, nowIso),
    c.env.DB.prepare(
      `INSERT INTO auth_challenges
        (id, institution_id, user_id, email, purpose, secret_hash, attempts, max_attempts,
         request_ip, expires_at, consumed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'EMAIL_VERIFY', ?, 0, 5, ?, ?, NULL, ?, ?)`,
    ).bind(
      emailChallengeId,
      institution.id,
      userId,
      email,
      otpHash,
      clientIp(c),
      new Date(now.getTime() + OTP_TTL_MS).toISOString(),
      nowIso,
      nowIso,
    ),
    c.env.DB.prepare(
      `INSERT INTO auth_challenges
        (id, institution_id, user_id, email, purpose, secret_hash, attempts, max_attempts,
         request_ip, expires_at, consumed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'REGISTRATION_ACCESS', ?, 0, 20, ?, ?, NULL, ?, ?)`,
    ).bind(
      accessChallengeId,
      institution.id,
      userId,
      email,
      accessHash,
      clientIp(c),
      new Date(now.getTime() + REGISTRATION_ACCESS_TTL_MS).toISOString(),
      nowIso,
      nowIso,
    ),
    c.env.DB.prepare(
      `INSERT INTO audit_events
        (id, institution_id, actor_user_id, action, entity_type, entity_id,
         request_id, reason, metadata_json, created_at)
       VALUES (?, ?, ?, 'USER_REGISTERED', 'User', ?, ?, NULL, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      institution.id,
      userId,
      userId,
      c.get("requestId"),
      JSON.stringify({ institutionUserId, cycle: 1, ipAddress: clientIp(c) }),
      nowIso,
    ),
  ]);

  if (!logLocalDelivery(c, "EMAIL_VERIFY", email, otp)) {
    return c.json({ success: false, error: "Email verification delivery is not configured" }, 503);
  }

  setRegistrationCookie(c, accessToken);
  return c.json({ success: true, data: { userId, email } });
});

authWorkflowRoutes.post("/send-verification", async (c) => {
  const body = await readObjectBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
  const email = normalizedEmail(body.email);
  if (!isEmail(email)) return c.json({ success: false, error: "Enter a valid email" }, 400);

  const user = await findUserByEmail(c, email);
  if (!user || user.email_verified === 1) return c.json({ success: true, data: { sent: true } });
  if (!(await checkIssueRateLimit(c, "EMAIL_VERIFY"))) {
    return c.json({ success: false, error: "Too many verification requests. Please try again later." }, 429);
  }

  const otp = randomOtp(c);
  await insertChallenge(c, user, "EMAIL_VERIFY", otp, OTP_TTL_MS);
  await audit(c, user, "VERIFICATION_RESENT");

  if (!logLocalDelivery(c, "EMAIL_VERIFY", email, otp)) {
    return c.json({ success: false, error: "Email verification delivery is not configured" }, 503);
  }
  return c.json({ success: true, data: { sent: true } });
});

authWorkflowRoutes.post("/verify-email", async (c) => {
  const body = await readObjectBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
  const email = normalizedEmail(body.email);
  const otp = typeof body.otp === "string" ? body.otp.trim() : "";
  if (!isEmail(email) || !/^\d{6}$/u.test(otp)) {
    return c.json({ success: false, error: "Invalid or expired code" }, 400);
  }

  const user = await findUserByEmail(c, email);
  if (!user) return c.json({ success: false, error: "Invalid or expired code" }, 400);
  if (user.email_verified === 1) {
    return c.json({ success: true, data: { userId: user.id, email: user.email, emailVerified: true } });
  }

  const challenge = await latestChallenge(c, user.id, "EMAIL_VERIFY");
  if (!(await verifyOneTimeChallenge(c, challenge, otp))) {
    return c.json({ success: false, error: "Invalid or expired code" }, 400);
  }

  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?`).bind(now, user.id),
    c.env.DB.prepare(`UPDATE auth_challenges SET consumed_at = ?, updated_at = ? WHERE id = ?`).bind(now, now, challenge!.id),
    c.env.DB.prepare(
      `INSERT INTO audit_events
        (id, institution_id, actor_user_id, action, entity_type, entity_id,
         request_id, reason, metadata_json, created_at)
       VALUES (?, ?, ?, 'EMAIL_VERIFIED', 'User', ?, ?, NULL, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      user.institution_id,
      user.id,
      user.id,
      c.get("requestId"),
      JSON.stringify({ ipAddress: clientIp(c), userAgent: userAgent(c) }),
      now,
    ),
  ]);

  return c.json({ success: true, data: { userId: user.id, email: user.email, emailVerified: true } });
});

authWorkflowRoutes.get("/registration-status", async (c) => {
  const email = normalizedEmail(c.req.query("email"));
  const accessToken = registrationToken(c, c.req.query("token"));
  if (!isEmail(email) || !accessToken) return c.json({ success: true, data: { exists: false } });

  const user = await findUserByEmail(c, email);
  if (!user) return c.json({ success: true, data: { exists: false } });

  const access = await latestChallenge(c, user.id, "REGISTRATION_ACCESS");
  const now = new Date().toISOString();
  if (!access || access.expires_at <= now || !(await secretMatches(accessToken, access.secret_hash))) {
    return c.json({ success: true, data: { exists: false } });
  }

  const institution = await c.env.DB.prepare(`SELECT name FROM institutions WHERE id = ? LIMIT 1`)
    .bind(user.institution_id)
    .first<{ name: string }>();
  const latest = await c.env.DB.prepare(
    `SELECT id, cycle, status, reason, fields_needing_correction_json, reviewed_at, created_at
     FROM registration_requests
     WHERE user_id = ?
     ORDER BY cycle DESC
     LIMIT 1`,
  )
    .bind(user.id)
    .first<RegistrationRequestRow>();

  return c.json({
    success: true,
    data: {
      exists: true,
      status: user.status,
      emailVerified: user.email_verified === 1,
      name: user.name,
      email: user.email,
      institutionName: institution?.name ?? null,
      institutionUserId: user.institution_user_id,
      phone: user.phone,
      room: user.room,
      gender: user.gender,
      changesRequested: latest?.status === "CHANGES_REQUESTED"
        ? parseCorrectionFields(latest.fields_needing_correction_json)
        : null,
      changesRequestReason: latest?.status === "CHANGES_REQUESTED" ? latest.reason : null,
      changesRequestedAt: latest?.status === "CHANGES_REQUESTED" ? latest.reviewed_at : null,
      rejectionReason: latest?.status === "REJECTED" ? latest.reason : null,
      cycle: latest?.cycle ?? null,
      reviewStatus: latest?.status ?? null,
      reviewedAt: latest?.reviewed_at ?? null,
      submittedAt: latest?.created_at ?? null,
    },
  });
});

authWorkflowRoutes.post("/resubmit", async (c) => {
  const body = await readObjectBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
  const email = normalizedEmail(body.email);
  const accessToken = registrationToken(c, body.registrationToken);
  if (!isEmail(email) || !accessToken) return c.json({ success: false, error: "Registration access expired" }, 401);

  const user = await findUserByEmail(c, email);
  if (!user) return c.json({ success: false, error: "Registration not found" }, 404);
  const access = await latestChallenge(c, user.id, "REGISTRATION_ACCESS");
  const nowIso = new Date().toISOString();
  if (!access || access.expires_at <= nowIso || !(await secretMatches(accessToken, access.secret_hash))) {
    return c.json({ success: false, error: "Registration access expired" }, 401);
  }

  const latest = await c.env.DB.prepare(
    `SELECT id, cycle, status, reason, fields_needing_correction_json, reviewed_at, created_at
     FROM registration_requests WHERE user_id = ? ORDER BY cycle DESC LIMIT 1`,
  )
    .bind(user.id)
    .first<RegistrationRequestRow>();
  if (!latest || latest.status !== "CHANGES_REQUESTED") {
    return c.json({ success: false, error: "No changes were requested for this account" }, 422);
  }

  const requestedFields = parseCorrectionFields(latest.fields_needing_correction_json) ?? [];
  const nextName = typeof body.name === "string" ? body.name.trim() : user.name;
  const nextInstitutionUserId = typeof body.institutionUserId === "string" ? body.institutionUserId.trim() : user.institution_user_id ?? "";
  const nextPhone = typeof body.phone === "string" ? body.phone.trim() : user.phone ?? "";
  const nextRoom = typeof body.room === "string" ? body.room.trim() : user.room ?? "";
  const nextGender = body.gender == null || body.gender === "" ? user.gender : String(body.gender).toUpperCase();
  const requestedNewEmail = normalizedEmail(body.newEmail);
  const nextEmail = requestedFields.includes("email") && requestedNewEmail ? requestedNewEmail : user.email;

  if (nextName.length < 2 || nextName.length > 100) return c.json({ success: false, error: "Name must be 2 to 100 characters" }, 400);
  if (!nextInstitutionUserId || nextInstitutionUserId.length > 100) return c.json({ success: false, error: "Institution User ID is required" }, 400);
  if (nextPhone.length < 8 || nextPhone.length > 32) return c.json({ success: false, error: "Enter a valid phone number" }, 400);
  if (!nextRoom || nextRoom.length > 64) return c.json({ success: false, error: "Room number is required" }, 400);
  if (nextGender && !["MALE", "FEMALE", "OTHER"].includes(nextGender)) return c.json({ success: false, error: "Invalid gender" }, 400);
  if (!isEmail(nextEmail)) return c.json({ success: false, error: "Enter a valid email" }, 400);

  const [emailTaken, phoneTaken, institutionIdTaken] = await Promise.all([
    nextEmail !== user.email
      ? c.env.DB.prepare(`SELECT id FROM users WHERE lower(email) = ? AND id <> ? LIMIT 1`).bind(nextEmail, user.id).first<{ id: string }>()
      : Promise.resolve(null),
    nextPhone !== user.phone
      ? c.env.DB.prepare(`SELECT id FROM users WHERE institution_id = ? AND phone = ? AND id <> ? LIMIT 1`).bind(user.institution_id, nextPhone, user.id).first<{ id: string }>()
      : Promise.resolve(null),
    nextInstitutionUserId !== user.institution_user_id
      ? c.env.DB.prepare(`SELECT id FROM users WHERE institution_id = ? AND institution_user_id = ? AND id <> ? LIMIT 1`).bind(user.institution_id, nextInstitutionUserId, user.id).first<{ id: string }>()
      : Promise.resolve(null),
  ]);
  if (emailTaken) return c.json({ success: false, error: "This email is already registered" }, 409);
  if (phoneTaken) return c.json({ success: false, error: "This phone number is already registered" }, 409);
  if (institutionIdTaken) return c.json({ success: false, error: "This Institution User ID is already taken" }, 409);

  const emailChanged = nextEmail !== user.email;
  const nextCycle = latest.cycle + 1;
  const institution = await c.env.DB.prepare(`SELECT name FROM institutions WHERE id = ? LIMIT 1`)
    .bind(user.institution_id)
    .first<{ name: string }>();
  const fieldsJson = JSON.stringify({
    name: nextName,
    email: nextEmail,
    phone: nextPhone,
    room: nextRoom,
    gender: nextGender,
    institutionName: institution?.name ?? null,
    institutionUserId: nextInstitutionUserId,
  });

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE users
       SET name = ?, email = ?, phone = ?, institution_user_id = ?, room = ?, gender = ?,
           email_verified = CASE WHEN ? THEN 0 ELSE email_verified END,
           status = 'PENDING', updated_at = ?
       WHERE id = ?`,
    ).bind(nextName, nextEmail, nextPhone, nextInstitutionUserId, nextRoom, nextGender, emailChanged ? 1 : 0, nowIso, user.id),
    c.env.DB.prepare(
      `UPDATE registration_requests SET status = 'RESUBMITTED', updated_at = ? WHERE id = ?`,
    ).bind(nowIso, latest.id),
    c.env.DB.prepare(
      `INSERT INTO registration_requests
        (id, institution_id, user_id, cycle, status, fields_json, request_ip, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'PENDING_REVIEW', ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), user.institution_id, user.id, nextCycle, fieldsJson, clientIp(c), nowIso, nowIso),
    c.env.DB.prepare(
      `INSERT INTO audit_events
        (id, institution_id, actor_user_id, action, entity_type, entity_id,
         request_id, reason, metadata_json, created_at)
       VALUES (?, ?, ?, 'USER_RESUBMITTED', 'User', ?, ?, NULL, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      user.institution_id,
      user.id,
      user.id,
      c.get("requestId"),
      JSON.stringify({ cycle: nextCycle, requestedFields, emailChanged, ipAddress: clientIp(c) }),
      nowIso,
    ),
  ]);

  if (emailChanged) {
    const updatedUser = { ...user, email: nextEmail };
    const otp = randomOtp(c);
    await insertChallenge(c, updatedUser, "EMAIL_VERIFY", otp, OTP_TTL_MS);
    if (!logLocalDelivery(c, "EMAIL_VERIFY", nextEmail, otp)) {
      return c.json({ success: false, error: "Email verification delivery is not configured" }, 503);
    }
  }

  return c.json({
    success: true,
    data: { userId: user.id, status: "PENDING", cycle: nextCycle, email: nextEmail, verificationRequired: emailChanged },
  });
});

authWorkflowRoutes.post("/forgot-password", async (c) => {
  const body = await readObjectBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
  const email = normalizedEmail(body.email);
  if (!isEmail(email)) return c.json({ success: false, error: "Enter a valid email" }, 400);
  if (!(await checkIssueRateLimit(c, "PASSWORD_RESET_OTP"))) {
    return c.json({ success: false, error: "Too many requests. Please try again later." }, 429);
  }

  const user = await findUserByEmail(c, email);
  if (!user) return c.json({ success: true, data: { sent: true } });

  const otp = randomOtp(c);
  await insertChallenge(c, user, "PASSWORD_RESET_OTP", otp, OTP_TTL_MS);
  await audit(c, user, "PASSWORD_RESET_REQUESTED");
  if (!logLocalDelivery(c, "PASSWORD_RESET_OTP", email, otp)) {
    return c.json({ success: false, error: "Password reset delivery is not configured" }, 503);
  }
  return c.json({ success: true, data: { sent: true } });
});

authWorkflowRoutes.post("/verify-reset-otp", async (c) => {
  const body = await readObjectBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
  const email = normalizedEmail(body.email);
  const otp = typeof body.otp === "string" ? body.otp.trim() : "";
  if (!isEmail(email) || !/^\d{6}$/u.test(otp)) return c.json({ success: false, error: "Invalid or expired code" }, 400);

  const user = await findUserByEmail(c, email);
  if (!user) return c.json({ success: false, error: "Invalid or expired code" }, 400);
  const challenge = await latestChallenge(c, user.id, "PASSWORD_RESET_OTP");
  if (!(await verifyOneTimeChallenge(c, challenge, otp))) {
    return c.json({ success: false, error: "Invalid or expired code" }, 400);
  }

  const now = new Date().toISOString();
  await consumeChallenge(c, challenge!.id, now);
  const resetToken = randomToken();
  await insertChallenge(c, user, "PASSWORD_RESET_TOKEN", resetToken, RESET_TOKEN_TTL_MS, 5);
  await audit(c, user, "PASSWORD_RESET_OTP_VERIFIED");
  return c.json({ success: true, data: { verified: true, resetToken } });
});

authWorkflowRoutes.post("/reset-password", async (c) => {
  const body = await readObjectBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
  const email = normalizedEmail(body.email);
  const resetToken = typeof body.resetToken === "string" ? body.resetToken.trim() : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  if (!isEmail(email) || !resetToken) return c.json({ success: false, error: "Invalid or expired reset token" }, 400);
  const pwdError = passwordError(newPassword);
  if (pwdError) return c.json({ success: false, error: pwdError }, 422);

  const user = await findUserByEmail(c, email);
  if (!user) return c.json({ success: false, error: "Invalid or expired reset token" }, 400);
  const challenge = await latestChallenge(c, user.id, "PASSWORD_RESET_TOKEN");
  const now = new Date().toISOString();
  if (!challenge || challenge.expires_at <= now || !(await secretMatches(resetToken, challenge.secret_hash))) {
    return c.json({ success: false, error: "Invalid or expired reset token" }, 400);
  }

  const passwordHash = await hashPassword(newPassword);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`).bind(passwordHash, now, user.id),
    c.env.DB.prepare(`UPDATE auth_challenges SET consumed_at = ?, updated_at = ? WHERE id = ?`).bind(now, now, challenge.id),
    c.env.DB.prepare(`UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).bind(now, user.id),
    c.env.DB.prepare(
      `INSERT INTO audit_events
        (id, institution_id, actor_user_id, action, entity_type, entity_id,
         request_id, reason, metadata_json, created_at)
       VALUES (?, ?, ?, 'PASSWORD_RESET_COMPLETED', 'User', ?, ?, NULL, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      user.institution_id,
      user.id,
      user.id,
      c.get("requestId"),
      JSON.stringify({ allSessionsRevoked: true, ipAddress: clientIp(c), userAgent: userAgent(c) }),
      now,
    ),
  ]);

  return c.json({ success: true, data: { reset: true } });
});

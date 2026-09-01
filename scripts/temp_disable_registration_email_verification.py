from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}\n--- needle ---\n{old[:700]}")
    p.write_text(text.replace(old, new, 1))


path = "services/api/src/routes/auth-workflows.ts"
replace_once(
    path,
    '''const LOCAL_OTP = "424242";
const REGISTRATION_COOKIE = "boardops_registration";''',
    '''const LOCAL_OTP = "424242";
const REGISTRATION_COOKIE = "boardops_registration";
// Temporary product switch: new registrations skip email OTP while false.
// Set this to true when production email verification is ready to return.
const EMAIL_VERIFICATION_ENABLED = false;''',
)

replace_once(
    path,
    '''  if (!authEmailDeliveryAvailable(c)) {
    return c.json({ success: false, error: "Email verification delivery is not configured" }, 503);
  }
  if (!(await checkIssueRateLimit(c, "EMAIL_VERIFY"))) {
    return c.json({ success: false, error: "Too many registration attempts. Please try again later." }, 429);
  }''',
    '''  if (EMAIL_VERIFICATION_ENABLED && !authEmailDeliveryAvailable(c)) {
    return c.json({ success: false, error: "Email verification delivery is not configured" }, 503);
  }
  if (EMAIL_VERIFICATION_ENABLED && !(await checkIssueRateLimit(c, "EMAIL_VERIFY"))) {
    return c.json({ success: false, error: "Too many registration attempts. Please try again later." }, 429);
  }''',
)

replace_once(
    path,
    '''       VALUES (?, ?, ?, ?, ?, ?, 'USER', 'PENDING', ?, 0, ?, ?, NULL,
               'system', 'en', 'Asia/Kolkata', ?, ?)`,
    ).bind(userId, institution.id, name, email, phone, passwordHash, institutionUserId, room, gender, nowIso, nowIso),''',
    '''       VALUES (?, ?, ?, ?, ?, ?, 'USER', 'PENDING', ?, ?, ?, ?, NULL,
               'system', 'en', 'Asia/Kolkata', ?, ?)`,
    ).bind(
      userId, institution.id, name, email, phone, passwordHash, institutionUserId,
      EMAIL_VERIFICATION_ENABLED ? 0 : 1, room, gender, nowIso, nowIso,
    ),''',
)

replace_once(
    path,
    '''       VALUES (?, ?, ?, ?, 'EMAIL_VERIFY', ?, 0, 5, ?, ?, NULL, ?, ?)`,''',
    '''       VALUES (?, ?, ?, ?, 'EMAIL_VERIFY', ?, 0, 5, ?, ?, ?, ?, ?)`,''',
)

replace_once(
    path,
    '''      new Date(now.getTime() + OTP_TTL_MS).toISOString(),
      nowIso,
      nowIso,
    ),''',
    '''      new Date(now.getTime() + OTP_TTL_MS).toISOString(),
      EMAIL_VERIFICATION_ENABLED ? null : nowIso,
      nowIso,
      nowIso,
    ),''',
)

replace_once(
    path,
    '''  if (!logLocalDelivery(c, "EMAIL_VERIFY", email, otp)) {
    return c.json({ success: false, error: "Email verification delivery is not configured" }, 503);
  }

  setRegistrationCookie(c, accessToken);
  return c.json({ success: true, data: { userId, email } });''',
    '''  if (EMAIL_VERIFICATION_ENABLED && !logLocalDelivery(c, "EMAIL_VERIFY", email, otp)) {
    return c.json({ success: false, error: "Email verification delivery is not configured" }, 503);
  }

  setRegistrationCookie(c, accessToken);
  return c.json({
    success: true,
    data: { userId, email, verificationRequired: EMAIL_VERIFICATION_ENABLED },
  });''',
)

replace_once(
    path,
    '''  const emailChanged = nextEmail !== user.email;
  if (emailChanged && !authEmailDeliveryAvailable(c)) {
    return c.json({ success: false, error: "Email verification delivery is not configured" }, 503);
  }''',
    '''  const emailChanged = nextEmail !== user.email;
  if (emailChanged && EMAIL_VERIFICATION_ENABLED && !authEmailDeliveryAvailable(c)) {
    return c.json({ success: false, error: "Email verification delivery is not configured" }, 503);
  }''',
)

replace_once(
    path,
    '''       SET name = ?, email = ?, phone = ?, institution_user_id = ?, room = ?, gender = ?,
           email_verified = CASE WHEN ? THEN 0 ELSE email_verified END,
           status = 'PENDING', updated_at = ?
       WHERE id = ?`,
    ).bind(nextName, nextEmail, nextPhone, nextInstitutionUserId, nextRoom, nextGender, emailChanged ? 1 : 0, nowIso, user.id),''',
    '''       SET name = ?, email = ?, phone = ?, institution_user_id = ?, room = ?, gender = ?,
           email_verified = CASE WHEN ? THEN ? ELSE email_verified END,
           status = 'PENDING', updated_at = ?
       WHERE id = ?`,
    ).bind(
      nextName, nextEmail, nextPhone, nextInstitutionUserId, nextRoom, nextGender,
      emailChanged ? 1 : 0, EMAIL_VERIFICATION_ENABLED ? 0 : 1, nowIso, user.id,
    ),''',
)

replace_once(
    path,
    '''  if (emailChanged) {
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
  });''',
    '''  if (emailChanged && EMAIL_VERIFICATION_ENABLED) {
    const updatedUser = { ...user, email: nextEmail };
    const otp = randomOtp(c);
    await insertChallenge(c, updatedUser, "EMAIL_VERIFY", otp, OTP_TTL_MS);
    if (!logLocalDelivery(c, "EMAIL_VERIFY", nextEmail, otp)) {
      return c.json({ success: false, error: "Email verification delivery is not configured" }, 503);
    }
  }

  return c.json({
    success: true,
    data: {
      userId: user.id,
      status: "PENDING",
      cycle: nextCycle,
      email: nextEmail,
      verificationRequired: emailChanged && EMAIL_VERIFICATION_ENABLED,
    },
  });''',
)

path = "apps/web/src/components/features/auth/auth-screen.tsx"
replace_once(
    path,
    '''      const res = await api.post<{ success: boolean; data: { userId: string; email: string } }>(
        "/auth/register",''',
    '''      const res = await api.post<{ success: boolean; data: { userId: string; email: string; verificationRequired: boolean } }>(
        "/auth/register",''',
)

replace_once(
    path,
    '''      setVerifyEmail(res.data.email);
      setPendingEmail(res.data.email);
      setOtp("");
      setMode("verify");
      toast.success("Account created — verify your email next.");''',
    '''      setPendingEmail(res.data.email);
      setOtp("");
      if (res.data.verificationRequired) {
        setVerifyEmail(res.data.email);
        setMode("verify");
        toast.success("Account created — verify your email next.");
      } else {
        setVerifyEmail("");
        setMode("pending");
        toast.success("Account created — pending admin approval.");
      }''',
)

path = ".github/workflows/ci.yml"
replace_once(
    path,
    '''          # Phase 04 registration -> verification -> review -> resubmit -> approve.''',
    '''          # Phase 04 registration -> review -> resubmit -> approve.
          # Registration email OTP is temporarily disabled; the API must auto-verify
          # the new pending account and report verificationRequired=false.''',
)

replace_once(
    path,
    '''          registration_user_id=$(node -e "const fs=require('fs'); const x=JSON.parse(fs.readFileSync('/tmp/register.json','utf8')); if(!x.success||!x.data?.userId||x.data?.email!=='phase04.user@example.test'||x.data?.registrationToken||x.data?.otp) process.exit(1); process.stdout.write(x.data.userId)")''',
    '''          registration_user_id=$(node -e "const fs=require('fs'); const x=JSON.parse(fs.readFileSync('/tmp/register.json','utf8')); if(!x.success||!x.data?.userId||x.data?.email!=='phase04.user@example.test'||x.data?.verificationRequired!==false||x.data?.registrationToken||x.data?.otp) process.exit(1); process.stdout.write(x.data.userId)")''',
)

replace_once(
    path,
    '''          wrong_otp_status=$(curl --silent --output /tmp/wrong-verify.json --write-out '%{http_code}' \\
            -H 'content-type: application/json' \\
            -d '{"email":"phase04.user@example.test","otp":"111111"}' \\
            http://127.0.0.1:8787/api/auth/verify-email)
          test "$wrong_otp_status" = "400"

          curl --fail --show-error \\
            -H 'content-type: application/json' \\
            -d '{"email":"phase04.user@example.test","otp":"424242"}' \\
            http://127.0.0.1:8787/api/auth/verify-email > /tmp/verify-email.json
          node -e "const fs=require('fs'); const x=JSON.parse(fs.readFileSync('/tmp/verify-email.json','utf8')); if(!x.success||x.data?.emailVerified!==true) process.exit(1)"

''',
    '''''',
)

# Both staging files are temporary and must not survive in the PR.
for temp_path in (
    ".github/workflows/temp-disable-registration-email-verification.yml",
    "scripts/temp_disable_registration_email_verification.py",
):
    p = Path(temp_path)
    if p.exists():
        p.unlink()

print("Temporary registration email verification bypass applied")

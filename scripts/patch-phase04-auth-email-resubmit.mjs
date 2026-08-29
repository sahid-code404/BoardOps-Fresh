import { readFileSync, writeFileSync } from "node:fs";

const path = "apps/web/src/components/features/auth/auth-screen.tsx";
let source = readFileSync(path, "utf8");

function replaceOnce(label, before, after) {
  const count = source.split(before).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected exactly one match, found ${count}`);
  }
  source = source.replace(before, after);
}

replaceOnce(
  "pending-screen-callback",
  `        onBackToLogin={resetToLogin}\n      />`,
  `        onBackToLogin={resetToLogin}\n        onVerificationRequired={(email) => {\n          setVerifyEmail(email);\n          setPendingEmail(email);\n          setOtp(\"\");\n          setMode(\"verify\");\n        }}\n      />`,
);

replaceOnce(
  "pending-screen-props",
  `  hasChangesRequested,\n  onBackToLogin,\n}: {\n  email: string;\n  status?: RegistrationStatus;\n  isLoading: boolean;\n  isApproved: boolean;\n  isRejected: boolean;\n  hasChangesRequested: boolean;\n  onBackToLogin: () => void;\n}) {`,
  `  hasChangesRequested,\n  onBackToLogin,\n  onVerificationRequired,\n}: {\n  email: string;\n  status?: RegistrationStatus;\n  isLoading: boolean;\n  isApproved: boolean;\n  isRejected: boolean;\n  hasChangesRequested: boolean;\n  onBackToLogin: () => void;\n  onVerificationRequired: (email: string) => void;\n}) {`,
);

replaceOnce(
  "resubmit-on-done",
  `            onDone={() => {\n              setShowResubmit(false);\n              qc.invalidateQueries({ queryKey: [\"registration-status\", email] });\n            }}`,
  `            onDone={(result) => {\n              setShowResubmit(false);\n              if (result.verificationRequired) {\n                onVerificationRequired(result.email);\n                return;\n              }\n              qc.invalidateQueries({ queryKey: [\"registration-status\", email] });\n            }}`,
);

replaceOnce(
  "resubmit-prop-type",
  `  onDone: () => void;\n}) {`,
  `  onDone: (result: { email: string; verificationRequired: boolean }) => void;\n}) {`,
);

replaceOnce(
  "resubmit-state-email",
  `    institutionUserId: status.institutionUserId ?? \"\",\n    phone: status.phone ?? \"\",\n    room: status.room ?? \"\",`,
  `    institutionUserId: status.institutionUserId ?? \"\",\n    phone: status.phone ?? \"\",\n    newEmail: status.email ?? \"\",\n    room: status.room ?? \"\",`,
);

replaceOnce(
  "resubmit-email-validation",
  `    if (!form.phone || form.phone.length < 8) {\n      setErrors({ phone: \"Enter a valid phone\" });\n      return;\n    }\n    if (!form.room) {`,
  `    if (!form.phone || form.phone.length < 8) {\n      setErrors({ phone: \"Enter a valid phone\" });\n      return;\n    }\n    if (fields.includes(\"email\") && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/u.test(form.newEmail.trim())) {\n      setErrors({ email: \"Enter a valid email\" });\n      return;\n    }\n    if (!form.room) {`,
);

replaceOnce(
  "resubmit-api",
  `      await api.post(\"/auth/resubmit\", {\n        email: status.email,\n        name: form.name,\n        institutionUserId: form.institutionUserId,\n        phone: form.phone,\n        room: form.room,\n        gender: form.gender || undefined,\n      });\n      toast.success(\"Resubmitted for review!\");\n      onDone();`,
  `      const response = await api.post<{\n        success: boolean;\n        data: { email: string; verificationRequired: boolean };\n      }>(\"/auth/resubmit\", {\n        email: status.email,\n        name: form.name,\n        institutionUserId: form.institutionUserId,\n        phone: form.phone,\n        newEmail: fields.includes(\"email\") ? form.newEmail.trim() : undefined,\n        room: form.room,\n        gender: form.gender || undefined,\n      });\n      if (response.data.verificationRequired) {\n        toast.success(\"Registration updated — verify your new email next.\");\n      } else {\n        toast.success(\"Resubmitted for review!\");\n      }\n      onDone(response.data);`,
);

replaceOnce(
  "resubmit-email-input",
  `      <GlassInput\n        label=\"Mobile Number\"\n        value={form.phone}\n        onChange={(e) => setForm({ ...form, phone: e.target.value })}\n        error={errors.phone}\n        icon={<Phone className=\"h-4 w-4\" />}\n      />\n      <GlassInput\n        label=\"Room Number\"`,
  `      <GlassInput\n        label=\"Mobile Number\"\n        value={form.phone}\n        onChange={(e) => setForm({ ...form, phone: e.target.value })}\n        error={errors.phone}\n        icon={<Phone className=\"h-4 w-4\" />}\n      />\n      {fields.includes(\"email\") && (\n        <GlassInput\n          label=\"Personal Email\"\n          type=\"email\"\n          value={form.newEmail}\n          onChange={(e) => setForm({ ...form, newEmail: e.target.value })}\n          error={errors.email}\n          icon={<Mail className=\"h-4 w-4\" />}\n          hint=\"Changing your email requires a new verification code.\"\n        />\n      )}\n      <GlassInput\n        label=\"Room Number\"`,
);

writeFileSync(path, source);
console.log("[BoardOps] Phase 04 auth email-resubmit UI patch applied.");

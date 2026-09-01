from pathlib import Path

path = Path("apps/web/src/components/features/auth/auth-screen.tsx")
text = path.read_text()

def replace_once(old: str, new: str) -> None:
    global text
    if text.count(old) != 1:
        raise SystemExit(f"expected one auth-screen match, found {text.count(old)}")
    text = text.replace(old, new, 1)

replace_once(
'''        onVerificationRequired={(email) => {
          setVerifyEmail(email);
          setPendingEmail(email);
          setOtp("");
          setMode("verify");
        }}
      />''',
'''        onVerificationRequired={(email) => {
          setVerifyEmail(email);
          setPendingEmail(email);
          setOtp("");
          setMode("verify");
        }}
        onPendingEmailChanged={(email) => {
          setPendingEmail(email);
          setVerifyEmail("");
          setOtp("");
        }}
      />''')

replace_once(
'''  onBackToLogin,
  onVerificationRequired,
}: {
  email: string;
  status?: RegistrationStatus;
  isLoading: boolean;
  isApproved: boolean;
  isRejected: boolean;
  hasChangesRequested: boolean;
  onBackToLogin: () => void;
  onVerificationRequired: (email: string) => void;
}) {''',
'''  onBackToLogin,
  onVerificationRequired,
  onPendingEmailChanged,
}: {
  email: string;
  status?: RegistrationStatus;
  isLoading: boolean;
  isApproved: boolean;
  isRejected: boolean;
  hasChangesRequested: boolean;
  onBackToLogin: () => void;
  onVerificationRequired: (email: string) => void;
  onPendingEmailChanged: (email: string) => void;
}) {''')

replace_once(
'''              qc.invalidateQueries({ queryKey: ["registration-status", email] });''',
'''              qc.removeQueries({ queryKey: ["registration-status", email] });
              onPendingEmailChanged(result.email);''')

path.write_text(text)

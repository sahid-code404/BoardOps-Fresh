export type PasswordPolicyResult = {
  valid: boolean;
  error: string | null;
};

export function validatePasswordPolicy(password: string): PasswordPolicyResult {
  if (password.length < 8 || password.length > 512) {
    return { valid: false, error: "Password must be 8 to 512 characters" };
  }
  if (!/[A-Z]/u.test(password)) {
    return { valid: false, error: "Password must contain at least one uppercase letter" };
  }
  if (!/[a-z]/u.test(password)) {
    return { valid: false, error: "Password must contain at least one lowercase letter" };
  }
  if (!/[0-9]/u.test(password)) {
    return { valid: false, error: "Password must contain at least one number" };
  }
  if (!/[^A-Za-z0-9]/u.test(password)) {
    return { valid: false, error: "Password must contain at least one special character" };
  }
  return { valid: true, error: null };
}

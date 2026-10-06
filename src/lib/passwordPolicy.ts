// Password rules shared by the sign-in screens and the /api auth endpoints (the server re-checks).
// Supabase Auth does the actual hashing and storage; this only decides what NotifyEm accepts.

export const PASSWORD_MIN_LENGTH = 12;
/** Supabase Auth (bcrypt) ignores anything past 72 bytes, so longer passwords are refused rather than truncated. */
export const PASSWORD_MAX_BYTES = 72;

export const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/;

/** Returns a list of problems; empty means the password is acceptable. */
export function passwordProblems(password: string, context: { username?: string; previous?: string } = {}): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) problems.push(`Use at least ${PASSWORD_MIN_LENGTH} characters.`);
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) problems.push(`Use at most ${PASSWORD_MAX_BYTES} bytes.`);
  if (/^(.)\1*$/.test(password)) problems.push('Do not repeat a single character.');
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(re => re.test(password)).length;
  if (password.length < 20 && classes < 3) problems.push('Mix at least three of: lowercase, uppercase, numbers, symbols (or use 20+ characters).');
  if (context.username && context.username.length >= 3 && password.toLowerCase().includes(context.username.toLowerCase())) {
    problems.push('Do not include your username.');
  }
  if (context.previous && password === context.previous) problems.push('Choose a password different from the current one.');
  return problems;
}

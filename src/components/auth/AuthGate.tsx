import React, { useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, Loader2, LogIn, Mail } from 'lucide-react';
import logo from '../../assets/images/notifyem-logo.png';
import type { SessionUser } from '../../types';
import { AUTH_EVENTS } from '../../services/apiClient';
import { changePassword, completeEmailLink, fetchSession, requestPasswordReset, signIn, signOut } from '../../services/authService';
import { passwordProblems } from '../../lib/passwordPolicy';

// Decides what to show before the app: sign-in, forgot password, set-a-password from an emailed link,
// or the forced change of a temporary password. The app itself only renders for a signed-in user.
// Hiding the app is convenience only; every /api route enforces sign-in and roles on the server.

type Screen =
  | { kind: 'loading' }
  | { kind: 'signin'; notice?: string }
  | { kind: 'forgot' }
  | { kind: 'link'; tokenHash: string; type: 'invite' | 'recovery' }
  | { kind: 'change'; user: SessionUser }
  | { kind: 'app'; user: SessionUser };

interface AuthGateProps {
  children: (user: SessionUser, onSignOut: () => void) => React.ReactNode;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong. Please try again.');

/** Reads an invite / reset link (/accept-invite?token_hash=…&type=invite) and removes it from the address bar. */
function readEmailLink(): Screen | null {
  const path = window.location.pathname.replace(/\/+$/, '');
  if (path !== '/accept-invite' && path !== '/reset-password') return null;
  const params = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  window.history.replaceState(null, '', '/');
  const tokenHash = params.get('token_hash');
  const type = params.get('type') === 'invite' || path === '/accept-invite' ? 'invite' : 'recovery';
  if (tokenHash) return { kind: 'link', tokenHash, type };
  return {
    kind: 'signin',
    notice: hash.get('error_description')?.replace(/\+/g, ' ') || 'That link is invalid or has expired. Ask for a new one.'
  };
}

export const AuthGate: React.FC<AuthGateProps> = ({ children }) => {
  const [screen, setScreen] = useState<Screen>(() => readEmailLink() ?? { kind: 'loading' });
  const [loadError, setLoadError] = useState<string | null>(null);

  const enter = useCallback((user: SessionUser) => setScreen(user.mustChangePassword ? { kind: 'change', user } : { kind: 'app', user }), []);

  const loadSession = useCallback(async () => {
    setLoadError(null);
    try {
      const user = await fetchSession();
      if (user) enter(user);
      else setScreen({ kind: 'signin' });
    } catch (error) {
      setLoadError(errorText(error));
    }
  }, [enter]);

  useEffect(() => {
    if (screen.kind === 'loading') void loadSession();
    // Only on first mount; later transitions are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onSignedOut = () => setScreen(s => (s.kind === 'app' || s.kind === 'change' ? { kind: 'signin', notice: 'Your session ended. Please sign in again.' } : s));
    const onChangeRequired = () => setScreen(s => (s.kind === 'app' ? { kind: 'change', user: { ...s.user, mustChangePassword: true } } : s));
    window.addEventListener(AUTH_EVENTS.signedOut, onSignedOut);
    window.addEventListener(AUTH_EVENTS.passwordChangeRequired, onChangeRequired);
    return () => {
      window.removeEventListener(AUTH_EVENTS.signedOut, onSignedOut);
      window.removeEventListener(AUTH_EVENTS.passwordChangeRequired, onChangeRequired);
    };
  }, []);

  const handleSignOut = useCallback(async () => {
    try {
      await signOut();
    } finally {
      setScreen({ kind: 'signin', notice: 'You have been signed out.' });
    }
  }, []);

  if (screen.kind === 'app') return <>{children(screen.user, () => void handleSignOut())}</>;

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-100 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <img src={logo} alt="NotifyEm" className="h-14 w-auto" />
          <p className="mt-3 text-xs text-neutral-400">Real estate lead finder &amp; marketing</p>
        </div>
        <div className="bg-neutral-900 border border-neutral-800 rounded-lg shadow-2xl p-6">
          {screen.kind === 'loading' &&
            (loadError ? (
              <div className="space-y-3 text-sm">
                <p className="text-rose-300">{loadError}</p>
                <button type="button" onClick={() => void loadSession()} className={primaryButton}>
                  Try again
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 text-sm text-neutral-400 py-6">
                <Loader2 className="w-4 h-4 animate-spin" /> Checking your session…
              </div>
            ))}
          {screen.kind === 'signin' && <SignInForm notice={screen.notice} onSignedIn={enter} onForgot={() => setScreen({ kind: 'forgot' })} />}
          {screen.kind === 'forgot' && <ForgotForm onBack={() => setScreen({ kind: 'signin' })} />}
          {screen.kind === 'link' && <EmailLinkForm tokenHash={screen.tokenHash} type={screen.type} onDone={enter} onBack={() => setScreen({ kind: 'signin' })} />}
          {screen.kind === 'change' && <ChangePasswordForm user={screen.user} onDone={enter} onSignOut={() => void handleSignOut()} />}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------

const inputClass =
  'mt-1 w-full px-3 py-2 bg-neutral-950 border border-neutral-700 rounded-md text-sm text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:border-cyan-400';
const primaryButton =
  'w-full py-2 rounded-md bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed';
const linkButton = 'text-xs text-cyan-400 hover:underline cursor-pointer';

const Heading: React.FC<{ title: string; subtitle?: string }> = ({ title, subtitle }) => (
  <div className="mb-4">
    <h1 className="text-base font-bold text-white">{title}</h1>
    {subtitle && <p className="mt-1 text-xs text-neutral-400 leading-relaxed">{subtitle}</p>}
  </div>
);

const Alert: React.FC<{ tone: 'error' | 'info'; children: React.ReactNode }> = ({ tone, children }) => (
  <div
    role={tone === 'error' ? 'alert' : 'status'}
    className={`mb-3 rounded-md px-3 py-2 text-xs ${tone === 'error' ? 'bg-rose-950/60 border border-rose-500/40 text-rose-200' : 'bg-cyan-950/50 border border-cyan-500/30 text-cyan-100'}`}
  >
    {children}
  </div>
);

const PasswordInput: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  autoFocus?: boolean;
}> = ({ label, value, onChange, autoComplete, autoFocus }) => {
  const [visible, setVisible] = useState(false);
  return (
    <label className="block text-xs text-neutral-300">
      {label}
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={event => onChange(event.target.value)}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          required
          className={`${inputClass} pr-9`}
        />
        <button
          type="button"
          onClick={() => setVisible(v => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 mt-0.5 p-1 text-neutral-500 hover:text-neutral-200 cursor-pointer"
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </label>
  );
};

const SignInForm: React.FC<{ notice?: string; onSignedIn: (user: SessionUser) => void; onForgot: () => void }> = ({ notice, onSignedIn, onForgot }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await signIn(username.trim(), password);
      setPassword('');
      onSignedIn(user);
    } catch (err) {
      setError(errorText(err));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <Heading title="Sign in to NotifyEm" />
      {notice && !error && <Alert tone="info">{notice}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      <label className="block text-xs text-neutral-300">
        Username
        <input value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" autoFocus required className={inputClass} />
      </label>
      <PasswordInput label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
      <button type="submit" disabled={busy} className={primaryButton}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      <div className="flex items-center justify-between pt-1">
        <button type="button" onClick={onForgot} className={linkButton}>
          Forgot password?
        </button>
        <span className="text-[11px] text-neutral-500">Accounts are by invitation only.</span>
      </div>
    </form>
  );
};

const ForgotForm: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [identifier, setIdentifier] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setMessage(await requestPasswordReset(identifier.trim()));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <Heading title="Reset your password" subtitle="Enter your username or email. If the account exists, we'll email it a reset link." />
      {error && <Alert tone="error">{error}</Alert>}
      {message ? (
        <Alert tone="info">{message}</Alert>
      ) : (
        <>
          <label className="block text-xs text-neutral-300">
            Username or email
            <input value={identifier} onChange={event => setIdentifier(event.target.value)} autoComplete="username" autoFocus required className={inputClass} />
          </label>
          <button type="submit" disabled={busy} className={primaryButton}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
            Send reset link
          </button>
        </>
      )}
      <button type="button" onClick={onBack} className={linkButton}>
        ← Back to sign in
      </button>
    </form>
  );
};

/** Live checklist for a new password, using the same rules the server enforces. */
const PasswordRules: React.FC<{ password: string; username?: string; previous?: string }> = ({ password, username, previous }) => {
  if (!password) return <p className="text-[11px] text-neutral-500">At least 12 characters, mixing upper/lowercase, numbers or symbols (or 20+ characters).</p>;
  const problems = passwordProblems(password, { username, previous });
  return problems.length ? (
    <ul className="text-[11px] text-amber-300 space-y-0.5">
      {problems.map(p => (
        <li key={p}>• {p}</li>
      ))}
    </ul>
  ) : (
    <p className="text-[11px] text-emerald-400">Password meets the requirements.</p>
  );
};

function useNewPassword(context: { username?: string; previous?: string }) {
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const mismatch = confirm.length > 0 && next !== confirm;
  const valid = next.length > 0 && next === confirm && passwordProblems(next, context).length === 0;
  return { next, setNext, confirm, setConfirm, mismatch, valid };
}

const EmailLinkForm: React.FC<{ tokenHash: string; type: 'invite' | 'recovery'; onDone: (user: SessionUser) => void; onBack: () => void }> = ({
  tokenHash,
  type,
  onDone,
  onBack
}) => {
  const pw = useNewPassword({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pw.valid) return;
    setBusy(true);
    setError(null);
    try {
      onDone(await completeEmailLink(tokenHash, type, pw.next));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <Heading
        title={type === 'invite' ? 'Welcome to NotifyEm' : 'Choose a new password'}
        subtitle={type === 'invite' ? 'Choose a password to finish setting up your account.' : 'Your reset link is valid. Pick a new password to sign in.'}
      />
      {error && <Alert tone="error">{error}</Alert>}
      <PasswordInput label="New password" value={pw.next} onChange={pw.setNext} autoComplete="new-password" autoFocus />
      <PasswordRules password={pw.next} />
      <PasswordInput label="Confirm new password" value={pw.confirm} onChange={pw.setConfirm} autoComplete="new-password" />
      {pw.mismatch && <p className="text-[11px] text-amber-300">The passwords don't match.</p>}
      <button type="submit" disabled={busy || !pw.valid} className={primaryButton}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
        {type === 'invite' ? 'Create account' : 'Save new password'}
      </button>
      <button type="button" onClick={onBack} className={linkButton}>
        ← Back to sign in
      </button>
    </form>
  );
};

const ChangePasswordForm: React.FC<{ user: SessionUser; onDone: (user: SessionUser) => void; onSignOut: () => void }> = ({ user, onDone, onSignOut }) => {
  const [current, setCurrent] = useState('');
  const pw = useNewPassword({ username: user.username, previous: current });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pw.valid) return;
    setBusy(true);
    setError(null);
    try {
      onDone(await changePassword(current, pw.next));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <Heading
        title="Set your own password"
        subtitle={`Signed in as ${user.username}. You're using a temporary password; choose a new one to continue.`}
      />
      {error && <Alert tone="error">{error}</Alert>}
      <PasswordInput label="Temporary (current) password" value={current} onChange={setCurrent} autoComplete="current-password" autoFocus />
      <PasswordInput label="New password" value={pw.next} onChange={pw.setNext} autoComplete="new-password" />
      <PasswordRules password={pw.next} username={user.username} previous={current} />
      <PasswordInput label="Confirm new password" value={pw.confirm} onChange={pw.setConfirm} autoComplete="new-password" />
      {pw.mismatch && <p className="text-[11px] text-amber-300">The passwords don't match.</p>}
      <button type="submit" disabled={busy || !pw.valid || !current} className={primaryButton}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
        Save and continue
      </button>
      <button type="button" onClick={onSignOut} className={linkButton}>
        Sign out
      </button>
    </form>
  );
};

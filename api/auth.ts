import { json } from './_lib/http.js';
import { POST as changePassword } from './_lib/routes/auth/change-password.js';
import { POST as complete } from './_lib/routes/auth/complete.js';
import { POST as forgotPassword } from './_lib/routes/auth/forgot-password.js';
import { POST as login } from './_lib/routes/auth/login.js';
import { POST as logout } from './_lib/routes/auth/logout.js';
import { GET as me } from './_lib/routes/auth/me.js';

// Sign-in endpoints, served by ONE function (Vercel Hobby allows 12 functions per deployment):
//   GET  /api/auth                          → the signed-in user (401 when signed out)
//   POST /api/auth?action=login             { username, password }
//   POST /api/auth?action=logout
//   POST /api/auth?action=change-password   { currentPassword, newPassword }
//   POST /api/auth?action=forgot-password   { identifier }
//   POST /api/auth?action=complete          { tokenHash, type, newPassword }   (invite / reset link)

const ACTIONS: Record<string, (request: Request) => Promise<Response>> = {
  login,
  logout,
  'change-password': changePassword,
  'forgot-password': forgotPassword,
  complete
};

export const GET = me;

export async function POST(request: Request): Promise<Response> {
  const action = new URL(request.url).searchParams.get('action') ?? '';
  const route = ACTIONS[action];
  return route ? route(request) : json({ error: 'Unknown auth action.' }, 404);
}

import { toSessionUser } from '../../accounts.js';
import { withAuth } from '../../auth.js';
import { json } from '../../http.js';

// GET /api/auth/me — the signed-in user (401 when signed out). Reachable while a temporary password
// still has to be changed, so the app can show the change-password screen.

export const GET = withAuth(async (_request, ctx) => json({ user: toSessionUser(ctx.user) }), { allowPasswordChangeRequired: true });

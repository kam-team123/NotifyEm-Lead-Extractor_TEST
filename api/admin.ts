import { json } from './_lib/http.js';
import { POST as invite } from './_lib/routes/admin/invite.js';

// Admin endpoints, served by ONE function (Vercel Hobby allows 12 functions per deployment).
// Each action enforces the admin role itself (withAuth({ role: 'admin' })).
//   POST /api/admin?action=invite   { username, email, role?, fullName? }

const ACTIONS: Record<string, (request: Request) => Promise<Response>> = { invite };

export async function POST(request: Request): Promise<Response> {
  const action = new URL(request.url).searchParams.get('action') ?? '';
  const route = ACTIONS[action];
  return route ? route(request) : json({ error: 'Unknown admin action.' }, 404);
}

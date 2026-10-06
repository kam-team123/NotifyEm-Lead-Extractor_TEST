import { clientIp, recordAudit } from '../../audit.js';
import { assertSameOrigin, clearedSessionCookies, cookieNames, isSecureRequest, loadAppUser, parseCookies, resolveSession, withCookies } from '../../auth.js';
import { handler, json } from '../../http.js';
import { getSupabase } from '../../supabase.js';

// POST /api/auth/logout — revokes the session with Supabase Auth and clears the cookies.
// Always succeeds from the browser's point of view, so a half-expired session can still sign out.

export const POST = handler(async request => {
  assertSameOrigin(request);
  const secure = isSecureRequest(request);
  const cookies = parseCookies(request.headers.get('cookie'));
  const hadSession = Boolean(cookies[cookieNames(secure).access] || cookies[cookieNames(secure).refresh]);

  if (hadSession) {
    try {
      const session = await resolveSession(request);
      if (session?.authUserId) {
        await getSupabase()?.auth.admin.signOut(session.accessToken, 'local');
        const user = await loadAppUser(session.authUserId);
        await recordAudit({ action: 'auth.logout', outcome: 'success', actorId: session.authUserId, actorLabel: user?.username ?? '', targetUserId: session.authUserId, ip: clientIp(request) });
      }
    } catch (error) {
      console.error(`Sign-out revoke failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  return withCookies(json({ ok: true }), clearedSessionCookies(secure));
});

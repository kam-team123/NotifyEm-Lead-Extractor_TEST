import { getSupabase } from './supabase.js';

// Append-only security log (public.audit_events). Written with the service role; readable by admins only.
// Secrets must never reach it: sanitizeMetadata() drops any key that looks like a credential.

export type AuditOutcome = 'success' | 'failure' | 'denied';

export interface AuditEvent {
  action: string;
  outcome: AuditOutcome;
  actorId?: string | null;
  actorLabel?: string;
  targetUserId?: string | null;
  ip?: string | null;
  metadata?: Record<string, unknown>;
}

const SECRET_KEY_PATTERN = /pass(word)?|secret|token|api[_-]?key|authorization|cookie|session|credential|private|signature/i;
const MAX_STRING = 300;

/** Removes credential-like keys (at any depth) and truncates long strings. */
export function sanitizeMetadata(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]';
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 20).map(v => sanitizeMetadata(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (SECRET_KEY_PATTERN.test(key)) continue;
      out[key] = sanitizeMetadata(v, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Records an audit event. Never throws: a logging failure must not break sign-in, but it is reported
 * in the function logs (without the event's metadata) so it can be noticed.
 */
export async function recordAudit(event: AuditEvent): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from('audit_events').insert({
    action: event.action,
    outcome: event.outcome,
    actor_id: event.actorId ?? null,
    actor_label: (event.actorLabel ?? '').slice(0, 100),
    target_user_id: event.targetUserId ?? null,
    ip: event.ip ?? null,
    metadata: sanitizeMetadata(event.metadata ?? {})
  });
  if (error) console.error(`audit_events insert failed for action "${event.action}": ${error.message}`);
}

/** Best-effort client IP from Vercel's forwarding headers. */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0].trim() || request.headers.get('x-real-ip') || null;
}

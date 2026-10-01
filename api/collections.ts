import type { DatabaseCollection } from '../src/types/index.js';
import { handler, HttpError, json, readJson } from './_lib/http.js';
import { requireSupabase } from './_lib/supabase.js';
import { stateCode } from './_lib/geo.js';

// GET  /api/collections
// POST /api/collections  { id?, name, description, state }
// PATCH /api/collections?id=…  { name?, description?, state? }
// DELETE /api/collections?id=…

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toCollection(row: Record<string, any>): DatabaseCollection {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    leadCount: 0,
    targetStates: row.target_states ?? [],
    colorTag: row.color_tag ?? 'cyan',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export const GET = handler(async () => {
  const sb = requireSupabase();
  const { data, error } = await sb.from('collections').select('*').order('created_at', { ascending: true });
  if (error) throw new HttpError(500, error.message);
  return json({ collections: (data ?? []).map(toCollection) });
});

export const POST = handler(async request => {
  const body = await readJson<{ id?: string; name?: string; description?: string; state?: string }>(request);
  const name = body.name?.trim();
  if (!name) throw new HttpError(400, 'Collection name is required.');
  if (body.id && !UUID.test(body.id)) throw new HttpError(400, 'Collection id must be a UUID.');
  const state = stateCode(body.state);
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('collections')
    .insert({
      ...(body.id ? { id: body.id } : {}),
      name: name.slice(0, 120),
      description: (body.description ?? '').slice(0, 2000),
      target_states: state ? [state] : []
    })
    .select('*')
    .single();
  if (error) throw new HttpError(500, error.message);
  return json({ collection: toCollection(data) }, 201);
});

const idParam = (request: Request) => {
  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!UUID.test(id)) throw new HttpError(400, 'Missing or invalid ?id=');
  return id;
};

export const PATCH = handler(async request => {
  const id = idParam(request);
  const body = await readJson<{ name?: string; description?: string; state?: string }>(request);
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) throw new HttpError(400, 'Collection name cannot be empty.');
    patch.name = name.slice(0, 120);
  }
  if (body.description !== undefined) patch.description = body.description.slice(0, 2000);
  if (body.state !== undefined) {
    const state = stateCode(body.state);
    patch.target_states = state ? [state] : [];
  }
  if (!Object.keys(patch).length) throw new HttpError(400, 'Nothing to update.');
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('collections')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new HttpError(error.code === 'PGRST116' ? 404 : 500, error.message);
  return json({ collection: toCollection(data) });
});

// Leads in the collection are kept; their collection_id is cleared by the foreign key (on delete set null).
export const DELETE = handler(async request => {
  const id = idParam(request);
  const sb = requireSupabase();
  const { error } = await sb.from('collections').delete().eq('id', id);
  if (error) throw new HttpError(500, error.message);
  return json({ deleted: id });
});

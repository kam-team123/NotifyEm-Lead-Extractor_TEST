// In-memory stand-in for the parts of supabase-js the auth code uses. It lets the endpoint tests check
// NotifyEm's own decisions (who may sign in, what is audited, what is never returned). It does NOT
// emulate Postgres row-level security; tenant isolation must be verified against a real database.

type Row = Record<string, any>;
type Result = { data: any; error: { message: string } | null; count?: number };

export interface FakeSupabase {
  tables: Record<string, Row[]>;
  authUsers: { id: string; email: string; password: string | null }[];
  calls: {
    createUser: number;
    updateUserById: { id: string; keys: string[] }[];
    signOut: { jwt: string; scope?: string }[];
    deleteUser: string[];
    resetPasswordForEmail: { email: string; redirectTo?: string }[];
    inviteUserByEmail: { email: string; redirectTo?: string }[];
  };
  failInsertOn: Set<string>;
  service: any;
  anon: any;
  addAuthUser(email: string, password: string | null): string;
  addAppUser(row: Row): Row;
  issueEmailToken(userId: string, type: 'invite' | 'recovery'): string;
  reset(): void;
}

export function createFakeSupabase(): FakeSupabase {
  let counter = 0;
  let uidSeq = 2;
  const sessions = new Map<string, string>();
  const refreshTokens = new Map<string, string>();
  const emailTokens = new Map<string, { userId: string; type: string }>();

  const fake = {
    tables: {} as Record<string, Row[]>,
    authUsers: [] as FakeSupabase['authUsers'],
    calls: {} as FakeSupabase['calls'],
    failInsertOn: new Set<string>()
  } as FakeSupabase;

  const newSession = (userId: string) => {
    counter++;
    const session = { access_token: `at-${counter}`, refresh_token: `rt-${counter}`, expires_in: 3600 };
    sessions.set(session.access_token, userId);
    refreshTokens.set(session.refresh_token, userId);
    return session;
  };

  const ci = (v: unknown) => (typeof v === 'string' ? v.toLowerCase() : v);

  class Query implements PromiseLike<Result> {
    private filters: ((r: Row) => boolean)[] = [];
    private mode: 'select' | 'insert' | 'update' | 'delete' = 'select';
    private rows: Row[] = [];
    private patch: Row = {};
    private head = false;
    constructor(private table: string) {}
    select(_cols?: string, opts?: { head?: boolean }) {
      if (opts?.head) this.head = true;
      return this;
    }
    eq(col: string, val: unknown) {
      this.filters.push(r => ci(r[col]) === ci(val));
      return this;
    }
    gte(col: string, val: unknown) {
      this.filters.push(r => r[col] >= (val as any));
      return this;
    }
    lt(col: string, val: unknown) {
      this.filters.push(r => r[col] < (val as any));
      return this;
    }
    insert(rows: Row | Row[]) {
      this.mode = 'insert';
      this.rows = Array.isArray(rows) ? rows : [rows];
      return this;
    }
    update(patch: Row) {
      this.mode = 'update';
      this.patch = patch;
      return this;
    }
    delete() {
      this.mode = 'delete';
      return this;
    }
    async maybeSingle(): Promise<Result> {
      const r = await this.exec();
      return { data: r.error ? null : (r.data?.[0] ?? null), error: r.error };
    }
    async single(): Promise<Result> {
      return this.maybeSingle();
    }
    then<A, B>(onOk?: (r: Result) => A | PromiseLike<A>, onErr?: (e: unknown) => B | PromiseLike<B>) {
      return this.exec().then(onOk, onErr);
    }
    private async exec(): Promise<Result> {
      const table = (fake.tables[this.table] ??= []);
      if (this.mode === 'insert') {
        if (fake.failInsertOn.has(this.table)) return { data: null, error: { message: `insert into ${this.table} failed` } };
        const inserted: Row[] = [];
        for (const raw of this.rows) {
          const row: Row = { ...raw };
          if (this.table === 'app_users') {
            row.public_uid ??= String(uidSeq++).padStart(3, '0');
            row.role ??= 'user';
            row.status ??= 'active';
            row.must_change_password ??= false;
            row.full_name ??= '';
            if (table.some(r => ci(r.username) === ci(row.username) || r.public_uid === row.public_uid || r.id === row.id)) {
              return { data: null, error: { message: 'duplicate key value violates unique constraint' } };
            }
          }
          if (this.table === 'auth_attempts') row.attempted_at ??= new Date().toISOString();
          table.push(row);
          inserted.push(row);
        }
        return { data: inserted.map(r => ({ ...r })), error: null };
      }
      const match = table.filter(r => this.filters.every(f => f(r)));
      if (this.mode === 'update') {
        for (const r of match) Object.assign(r, this.patch);
        return { data: match, error: null };
      }
      if (this.mode === 'delete') {
        fake.tables[this.table] = table.filter(r => !match.includes(r));
        return { data: match, error: null };
      }
      if (this.head) return { data: null, error: null, count: match.length };
      return { data: match.map(r => ({ ...r })), error: null };
    }
  }

  const authApi = {
    async signInWithPassword({ email, password }: { email: string; password: string }) {
      const user = fake.authUsers.find(u => u.email === email.toLowerCase() && u.password !== null && u.password === password);
      if (!user) return { data: { session: null, user: null }, error: { message: 'Invalid login credentials' } };
      return { data: { session: newSession(user.id), user: { id: user.id } }, error: null };
    },
    async getUser(token: string) {
      const id = sessions.get(token);
      return id ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } };
    },
    async refreshSession({ refresh_token }: { refresh_token: string }) {
      const id = refreshTokens.get(refresh_token);
      if (!id) return { data: { session: null, user: null }, error: { message: 'invalid refresh token' } };
      refreshTokens.delete(refresh_token);
      return { data: { session: newSession(id), user: { id } }, error: null };
    },
    async verifyOtp({ token_hash, type }: { token_hash: string; type: string }) {
      const entry = emailTokens.get(token_hash);
      if (!entry || entry.type !== type) return { data: { user: null, session: null }, error: { message: 'Token has expired or is invalid' } };
      emailTokens.delete(token_hash);
      return { data: { user: { id: entry.userId }, session: newSession(entry.userId) }, error: null };
    },
    async resetPasswordForEmail(email: string, opts?: { redirectTo?: string }) {
      fake.calls.resetPasswordForEmail.push({ email, redirectTo: opts?.redirectTo });
      return { data: {}, error: null };
    }
  };

  const admin = {
    async listUsers({ page = 1, perPage = 50 }: { page?: number; perPage?: number }) {
      return { data: { users: fake.authUsers.slice((page - 1) * perPage, page * perPage).map(u => ({ id: u.id, email: u.email })) }, error: null };
    },
    async createUser({ email, password }: { email: string; password: string }) {
      fake.calls.createUser++;
      if (fake.authUsers.some(u => u.email === email.toLowerCase())) return { data: { user: null }, error: { message: 'User already registered' } };
      const id = fake.addAuthUser(email, password);
      return { data: { user: { id, email } }, error: null };
    },
    async deleteUser(id: string) {
      fake.calls.deleteUser.push(id);
      fake.authUsers = fake.authUsers.filter(u => u.id !== id);
      return { data: {}, error: null };
    },
    async updateUserById(id: string, attrs: { password?: string }) {
      fake.calls.updateUserById.push({ id, keys: Object.keys(attrs) });
      const user = fake.authUsers.find(u => u.id === id);
      if (!user) return { data: { user: null }, error: { message: 'User not found' } };
      if (attrs.password !== undefined) user.password = attrs.password;
      return { data: { user: { id } }, error: null };
    },
    async signOut(jwt: string, scope?: string) {
      fake.calls.signOut.push({ jwt, scope });
      return { error: null };
    },
    async inviteUserByEmail(email: string, opts?: { redirectTo?: string }) {
      fake.calls.inviteUserByEmail.push({ email, redirectTo: opts?.redirectTo });
      const id = fake.addAuthUser(email, null);
      return { data: { user: { id, email } }, error: null };
    }
  };

  fake.service = { from: (table: string) => new Query(table), auth: { ...authApi, admin } };
  fake.anon = { auth: authApi };

  fake.addAuthUser = (email, password) => {
    const id = `auth-${++counter}`;
    fake.authUsers.push({ id, email: email.toLowerCase(), password });
    return id;
  };
  fake.addAppUser = row => {
    const full = { role: 'user', status: 'active', must_change_password: false, full_name: '', public_uid: String(uidSeq++).padStart(3, '0'), ...row };
    (fake.tables.app_users ??= []).push(full);
    return full;
  };
  fake.issueEmailToken = (userId, type) => {
    const hash = `th-${++counter}`;
    emailTokens.set(hash, { userId, type });
    return hash;
  };
  fake.reset = () => {
    fake.tables = { app_users: [], audit_events: [], auth_attempts: [] };
    fake.authUsers = [];
    fake.calls = { createUser: 0, updateUserById: [], signOut: [], deleteUser: [], resetPasswordForEmail: [], inviteUserByEmail: [] };
    fake.failInsertOn.clear();
    sessions.clear();
    refreshTokens.clear();
    emailTokens.clear();
    uidSeq = 2;
  };
  fake.reset();
  return fake;
}

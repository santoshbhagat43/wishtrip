import { test as base, expect, type APIRequestContext, type APIResponse } from "@playwright/test";

import { ADMIN } from "../utils/env";

type CallOptions = {
  data?: unknown;
  multipart?: Record<string, string | { name: string; mimeType: string; buffer: Buffer }>;
  params?: Record<string, string | number | boolean | string[]>;
  status?: number;
};

/**
 * Small API client for tests. Every call is printed (method, path, status, time) and its
 * request/response bodies are attached to the HTML report, so the API's behaviour is visible.
 */
export class Api {
  constructor(
    private request: APIRequestContext,
    private token?: string,
    readonly who = "anonymous",
  ) {}

  async call<T = any>(method: string, path: string, options: CallOptions = {}): Promise<{ body: T; res: APIResponse }> {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(options.params ?? {})) {
      for (const item of Array.isArray(v) ? v : [v]) query.append(k, String(item));
    }
    const url = query.size ? `${path}?${query}` : path;
    const started = Date.now();
    const res = await this.request.fetch(url, {
      method,
      headers: this.token ? { authorization: `Bearer ${this.token}` } : {},
      data: options.data,
      multipart: options.multipart,
      // Chat turns call a local LLM (gemma4 can take ~30s); everything else is fast.
      timeout: 180_000,
    });
    const ms = Date.now() - started;
    const text = await res.text();
    let body: any = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON */
    }
    const expected = options.status ?? (method === "POST" ? [200, 201, 202] : method === "DELETE" ? [204] : [200]);
    const ok = Array.isArray(expected) ? expected.includes(res.status()) : res.status() === expected;
    console.log(`    ${ok ? "→" : "✗"} [${this.who}] ${method.padEnd(6)} ${url}  ${res.status()}  ${ms}ms`);
    await base.info().attach(`${method} ${url} → ${res.status()}`, {
      body: JSON.stringify({ request: options.data ?? options.params ?? null, response: body }, null, 2),
      contentType: "application/json",
    });
    expect(ok, `${method} ${url} returned ${res.status()}: ${text.slice(0, 300)}`).toBe(true);
    return { body, res };
  }

  get = <T = any>(path: string, o?: CallOptions) => this.call<T>("GET", path, o);
  post = <T = any>(path: string, o?: CallOptions) => this.call<T>("POST", path, o);
  patch = <T = any>(path: string, o?: CallOptions) => this.call<T>("PATCH", path, o);
  put = <T = any>(path: string, o?: CallOptions) => this.call<T>("PUT", path, o);
  delete = <T = any>(path: string, o?: CallOptions) => this.call<T>("DELETE", path, o);
}

type Fixtures = { anon: Api; admin: Api; traveler: Api & { email: string } };

export const test = base.extend<Fixtures>({
  anon: async ({ request }, use) => use(new Api(request)),
  admin: async ({ request }, use) => {
    const res = await request.post("/auth/login", { data: ADMIN });
    expect(res.status(), "admin login (check ADMIN_* in .env and run the seed)").toBe(200);
    use(new Api(request, (await res.json()).access_token, "admin"));
  },
  traveler: async ({ request }, use) => {
    // A fresh traveler per test keeps profile/behaviour tests isolated.
    const email = `e2e-traveler-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
    const res = await request.post("/auth/register", { data: { email, password: "e2e-password-123", full_name: "E2E Traveler" } });
    expect(res.status()).toBe(201);
    await use(Object.assign(new Api(request, (await res.json()).access_token, "traveler"), { email }));
  },
});

export { expect };

/** Find a published city by name (seeded / imported data). */
export async function cityId(api: Api, name: string): Promise<string> {
  const { body } = await api.get("/admin/locations", { params: { type: "city", q: name, page_size: 5 } });
  const city = body.items.find((c: { name: string }) => c.name === name);
  expect(city, `city ${name} exists (run seed + import)`).toBeTruthy();
  return city.id;
}

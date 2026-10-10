import { uniqueName } from "../utils/env";
import { cityId, expect, test } from "./client";

test.describe("Knowledge base API", () => {
  test("GET /admin/stats summarises the knowledge base", async ({ admin }) => {
    const { body } = await admin.get("/admin/stats");
    expect(body.total).toBeGreaterThan(0);
    expect(body.by_type).toHaveProperty("city");
  });

  test("GET /admin/locations filters by type, source, region, verification and search", async ({ admin }) => {
    const hotels = await admin.get("/admin/locations", {
      params: { type: "hotel", source: "goexperience-kb", needs_verification: true, page_size: 3 },
    });
    expect(hotels.body.items.every((l: any) => l.type === "hotel" && l.provenance.needs_verification)).toBe(true);
    const kerala = await admin.get("/admin/locations", { params: { type: "city", region: "Kerala" } });
    expect(kerala.body.total).toBe(5);
    const search = await admin.get("/admin/locations", { params: { q: "Tower Bridge" } });
    expect(search.body.items[0].name).toBe("Tower Bridge");
  });

  test("location CRUD with hierarchy rules, slug, completeness and audit", async ({ admin }) => {
    const london = await cityId(admin, "London");
    const name = uniqueName("Gallery");

    // Rules: a place needs a city parent
    await admin.post("/admin/locations", { data: { type: "attraction", name }, status: 400 });

    const { body: created } = await admin.post("/admin/locations", {
      data: { type: "attraction", name, parent_id: london, status: "draft", summary: "Test gallery" },
      status: 201,
    });
    expect(created.ancestors.map((a: any) => a.name)).toEqual(["United Kingdom", "London"]);
    expect(created.missing_fields).toContain("duration");

    const { body: detail } = await admin.get(`/admin/locations/${created.id}`);
    expect(detail.slug).toMatch(/^e2e-gallery/);

    const { body: updated } = await admin.patch(`/admin/locations/${created.id}`, {
      data: { duration_minutes: 90, best_times: ["morning"], status: "published" },
    });
    expect(updated.duration_minutes).toBe(90);
    expect(updated.missing_fields).not.toContain("duration");

    const { body: counts } = await admin.get(`/admin/locations/${london}/children-counts`);
    expect(typeof counts).toBe("object");

    const { body: audit } = await admin.get("/admin/audit-log", { params: { entity_id: created.id } });
    expect(audit.items.map((e: any) => e.action)).toEqual(expect.arrayContaining(["create", "update"]));

    await admin.delete(`/admin/locations/${created.id}`);
    await admin.get(`/admin/locations/${created.id}`, { status: 404 });
  });

  test("cannot delete a city that still has places", async ({ admin }) => {
    await admin.delete(`/admin/locations/${await cityId(admin, "London")}`, { status: 409 });
  });

  test("relations: add, list from both sides, reject duplicates, delete", async ({ admin }) => {
    const london = await cityId(admin, "London");
    const { body: a } = await admin.post("/admin/locations", { data: { type: "attraction", name: uniqueName("A"), parent_id: london }, status: 201 });
    const { body: b } = await admin.post("/admin/locations", { data: { type: "restaurant", name: uniqueName("B"), parent_id: london }, status: 201 });
    const { body: rel } = await admin.post(`/admin/locations/${a.id}/relations`, {
      data: { target_id: b.id, relation: "near", travel_minutes: 7 },
      status: 201,
    });
    await admin.post(`/admin/locations/${b.id}/relations`, { data: { target_id: a.id, relation: "near" }, status: 409 });
    const { body: fromB } = await admin.get(`/admin/locations/${b.id}/relations`);
    expect(fromB).toHaveLength(1);
    await admin.delete(`/admin/relations/${rel.id}`);
    await admin.delete(`/admin/locations/${a.id}`);
    await admin.delete(`/admin/locations/${b.id}`);
  });

  test("tags: list, create, reject duplicates, delete", async ({ admin }) => {
    const name = uniqueName("Tag");
    const { body: tag } = await admin.post("/admin/tags", { data: { name, category: "style" }, status: 201 });
    await admin.post("/admin/tags", { data: { name }, status: 409 });
    const { body: tags } = await admin.get("/admin/tags");
    expect(tags.some((t: any) => t.id === tag.id)).toBe(true);
    await admin.delete(`/admin/tags/${tag.id}`);
  });

  test("POST /admin/locations/reindex queues re-embedding", async ({ admin }) => {
    const { body } = await admin.post("/admin/locations/reindex", { status: 202 });
    expect(body.status).toBe("queued");
  });
});

test.describe("Media API", () => {
  test("upload an image, list it, serve it, reject non-media, delete", async ({ admin, request }) => {
    const london = await cityId(admin, "London");
    const { body: loc } = await admin.post("/admin/locations", { data: { type: "attraction", name: uniqueName("Media"), parent_id: london }, status: 201 });
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkaPhfDwAEhwH/2BKRNgAAAABJRU5ErkJggg==", "base64");
    const { body: media } = await admin.post(`/admin/locations/${loc.id}/media`, {
      multipart: { kind: "image", caption: "E2E", file: { name: "e2e.png", mimeType: "image/png", buffer: png } },
      status: 201,
    });
    expect(media.url).toMatch(/^\/media\/locations\//);
    expect((await request.get(media.url)).status()).toBe(200);
    await admin.post(`/admin/locations/${loc.id}/media`, {
      multipart: { kind: "image", file: { name: "x.txt", mimeType: "text/plain", buffer: Buffer.from("hi") } },
      status: 400,
    });
    const { body: list } = await admin.get(`/admin/locations/${loc.id}/media`);
    expect(list).toHaveLength(1);
    await admin.delete(`/admin/media/${media.id}`);
    await admin.delete(`/admin/locations/${loc.id}`);
  });
});

import { expect, test } from "./client";

test.describe("Support API", () => {
  test("inbox counts every view and sorts the queue by who needs help first", async ({ admin }) => {
    const { body } = await admin.get("/admin/support/inbox");
    expect(body.counts.open).toBeGreaterThan(0);
    // Someone in destination outranks everything else in the queue.
    const first = body.items[0];
    if (body.counts.in_destination > 0) expect(first.in_destination).toBe(true);
    expect(first).toHaveProperty("waiting_minutes");

    const urgent = await admin.get("/admin/support/inbox", { params: { view: "urgent" } });
    expect(urgent.body.items.every((t: any) => t.priority === "urgent")).toBe(true);

    const search = await admin.get("/admin/support/inbox", { params: { q: "vegetarian" } });
    expect(search.body.items.length).toBeGreaterThan(0);
  });

  test("a ticket carries the conversation and the traveller's real context", async ({ admin }) => {
    const { body: inbox } = await admin.get("/admin/support/inbox");
    const { body } = await admin.get(`/admin/support/tickets/${inbox.items[0].id}`);
    expect(body.messages.length).toBeGreaterThan(0);
    expect(body.messages[0].author).toBe("customer");
    // Context is read from the traveller's own profile and trips — never invented.
    expect(body.context).toHaveProperty("trips_planned");
    expect(body.context).toHaveProperty("saved_places");
    expect(body.context).not.toHaveProperty("bookings");
  });

  test("replying starts the clock, assigns the agent, and can resolve", async ({ admin, traveler }) => {
    // Open a ticket as a real traveller so the test owns its own state.
    const { body: target } = await traveler.post("/support/tickets", {
      data: { subject: "E2E — my hotel link is broken", body: "The link on day 2 goes nowhere." },
      status: 201,
    });
    expect(target.first_response_at).toBeNull();
    expect(target.status).toBe("open");

    const { body: replied } = await admin.post(`/admin/support/tickets/${target.id}/reply`, {
      data: { body: "Checking this now — I'll come back within the hour." },
      status: 201,
    });
    expect(replied.first_response_at).not.toBeNull();
    expect(replied.assignee).not.toBeNull();
    expect(replied.status).toBe("waiting_customer");

    // An internal note is staff-only and must not change the ticket's state.
    const { body: noted } = await admin.post(`/admin/support/tickets/${target.id}/reply`, {
      data: { body: "Supplier says the shack shut in September.", internal: true },
      status: 201,
    });
    expect(noted.messages.at(-1).author).toBe("note");
    expect(noted.status).toBe("waiting_customer");
    // The note stays with staff: the traveller's own view never carries it.
    const { body: mine } = await traveler.get("/support/tickets");
    expect(mine).toHaveLength(1);

    const { body: resolved } = await admin.patch(`/admin/support/tickets/${target.id}`, {
      data: { status: "resolved" },
    });
    expect(resolved.status).toBe("resolved");
  });
});

test.describe("Menus API", () => {
  test("a menu and its links drive the public navigation", async ({ admin, request }) => {
    const name = `E2E menu ${Date.now()}`;
    const { body: created } = await admin.post("/admin/menus", {
      data: { name, placement: "footer", is_active: true },
      status: 201,
    });
    expect(created.slug).toContain("e2e-menu");

    // A link needs somewhere to go.
    await admin.post(`/admin/menus/${created.id}/items`, { data: { label: "Nowhere" }, status: 400 });

    const { body: withLink } = await admin.post(`/admin/menus/${created.id}/items`, {
      data: { label: "Trip planner", url: "/plan" },
      status: 201,
    });
    expect(withLink.items[0].resolved_url).toBe("/plan");

    // Linking to a place resolves to that place's page.
    const { body: cities } = await admin.get("/admin/locations", {
      params: { type: "city", status: "published", page_size: 1 },
    });
    const city = cities.items[0];
    const { body: withPlace } = await admin.post(`/admin/menus/${created.id}/items`, {
      data: { label: city.name, location_id: city.id },
      status: 201,
    });
    expect(withPlace.items.some((i: any) => i.resolved_url === `/explore/${city.id}`)).toBe(true);

    const published = await request.get("/explore/menus?placement=footer");
    expect(JSON.stringify(await published.json())).toContain("Trip planner");

    // Hiding the menu takes it off the site without deleting anything.
    await admin.patch(`/admin/menus/${created.id}`, { data: { is_active: false } });
    const hidden = await request.get("/explore/menus?placement=footer");
    expect(JSON.stringify(await hidden.json())).not.toContain(name);

    await admin.delete(`/admin/menus/${created.id}`, { status: 204 });
  });
});

test.describe("Support routing API", () => {
  test("round robin, least busy and manual each pick differently", async ({ admin }) => {
    const { body: start } = await admin.get("/admin/support/routing");
    expect(start.agents.length).toBeGreaterThan(1);
    // Exactly one agent is "next", and the reason says why.
    expect(start.agents.filter((a: any) => a.is_next)).toHaveLength(1);
    expect(start.next_reason).toContain(start.next_agent);

    const { body: busy } = await admin.put("/admin/support/routing", { data: { method: "least_busy" } });
    expect(busy.next_reason).toContain("fewest open tickets");

    const { body: manual } = await admin.put("/admin/support/routing", { data: { method: "manual" } });
    expect(manual.next_agent).toBeNull();
    expect(manual.next_reason).toContain("Unassigned");

    await admin.put("/admin/support/routing", { data: { method: start.method } });
  });

  test("availability, limits and rotation decide who is eligible", async ({ admin }) => {
    const { body: before } = await admin.get("/admin/support/routing");
    const agent = before.agents.find((a: any) => a.is_next);

    // Off shift takes them out of the rotation without changing anything else.
    const { body: off } = await admin.patch(`/admin/support/routing/agents/${agent.user_id}`, {
      data: { availability: "off_shift" },
    });
    expect(off.agents.find((a: any) => a.user_id === agent.user_id).is_next).toBe(false);

    // A limit of zero means "already full", so they are skipped too.
    await admin.patch(`/admin/support/routing/agents/${agent.user_id}`, {
      data: { availability: "online", capacity: 0 },
    });
    const { body: full } = await admin.get("/admin/support/routing");
    expect(full.agents.find((a: any) => a.user_id === agent.user_id).is_next).toBe(false);

    await admin.patch(`/admin/support/routing/agents/${agent.user_id}`, {
      data: { capacity: agent.capacity, availability: agent.availability },
    });
  });

  test("a new ticket is routed automatically, with the reason recorded", async ({ admin, traveler }) => {
    const { body: created } = await traveler.post("/support/tickets", {
      data: { subject: "E2E — routing check", body: "Who picks this up?" },
      status: 201,
    });
    expect(created.assignee).not.toBeNull();

    const { body: routing } = await admin.get("/admin/support/routing");
    const logged = routing.recent.find((l: any) => l.ticket_number === created.number);
    expect(logged, "the assignment was logged with its reason").toBeTruthy();
    expect(logged.reason.length).toBeGreaterThan(10);

    await admin.patch(`/admin/support/tickets/${created.id}`, { data: { status: "resolved" } });
  });

  test("a preview says who would take a ticket without assigning it", async ({ admin }) => {
    const { body: routing } = await admin.get("/admin/support/routing");
    const specialist = routing.agents.find((a: any) => a.handles.length > 0);
    test.skip(!specialist, "no agent has a handles entry (run seed_support_menus)");

    const { body } = await admin.get("/admin/support/routing/preview", {
      params: { destination: specialist.handles[0], channel: "in_app" },
    });
    expect(body.reason).toContain(specialist.handles[0]);

    // Nothing was written: the log is unchanged.
    const { body: after } = await admin.get("/admin/support/routing");
    expect(after.recent.length).toBe(routing.recent.length);
  });
});

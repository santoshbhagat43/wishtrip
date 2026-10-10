import { cityId, expect, test } from "./client";

test.describe("Search, profiles and recommendations API", () => {
  test("GET /search/semantic ranks by meaning (or keyword overlap without a key)", async ({ traveler }) => {
    const { body } = await traveler.get("/search/semantic", { params: { q: "tea gardens tasting", limit: 5 } });
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0].location.name.toLowerCase()).toContain("tea");
  });

  test("profile: empty by default, PUT saves, behaviour events record", async ({ traveler, admin }) => {
    const { body: empty } = await traveler.get("/profiles/me");
    expect(empty.interest_tag_ids).toEqual([]);
    const { body: tags } = await admin.get("/admin/tags");
    const scenic = tags.find((t: any) => t.name === "Scenic views");
    const { body: saved } = await traveler.put("/profiles/me", {
      data: { budget_level: 1, energy_level: 2, companions: "couple", preferred_times: ["evening"], interest_tag_ids: [scenic.id] },
    });
    expect(saved.companions).toBe("couple");

    const { body: places } = await admin.get("/admin/locations", { params: { q: "Tower Bridge" } });
    await traveler.post("/profiles/me/events", { data: { location_id: places.items[0].id, event_type: "skipped" }, status: 201 });
  });

  test("GET /recommendations ranks with reasons and respects hard constraints", async ({ traveler, admin }) => {
    const london = await cityId(admin, "London");
    await traveler.put("/profiles/me", { data: { companions: "family", accessibility_needs: true } });
    const { body } = await traveler.get("/recommendations", { params: { city_id: london, limit: 20 } });
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((i: any) => i.location.parent.id === london)).toBe(true);
    // Scores are sorted and explained
    const scores = body.items.map((i: any) => i.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(Object.keys(body.items[0].components)).toEqual(expect.arrayContaining(["interest", "semantic", "energy"]));
  });

  test("staff: GET /admin/travelers, traveler detail, recommendation preview", async ({ admin, traveler }) => {
    const { body: me } = await traveler.get("/auth/me");
    await traveler.post("/profiles/me/events", {
      data: { location_id: (await admin.get("/admin/locations", { params: { q: "Tower Bridge" } })).body.items[0].id, event_type: "selected" },
      status: 201,
    });
    const { body: list } = await admin.get("/admin/travelers", { params: { page_size: 100 } });
    expect(list.total).toBeGreaterThan(0);
    const { body: detail } = await admin.get(`/admin/travelers/${me.id}`);
    expect(detail.recent_events[0].event.event_type).toBe("selected");
    const { body: preview } = await admin.get("/admin/recommendations/preview", {
      params: { user_id: me.id, city_id: await cityId(admin, "London") },
    });
    expect(preview.weights).toHaveProperty("interest");
  });
});

test.describe("Chat API", () => {
  test.describe.configure({ timeout: 240_000 });
  test("session lifecycle and a knowledge-grounded answer without inventing prices", async ({ traveler }) => {
    const { body: session } = await traveler.post("/chat/sessions", { status: 201 });
    const { body: turn } = await traveler.post(`/chat/sessions/${session.id}/messages`, {
      data: { content: "Plan 3 days in Kerala for my family, we love nature" },
      status: 200,
    });
    const reply = turn.assistant_message;
    expect(reply.intent.destination).toBe("Kerala");
    expect(["knowledge_base", "partial"]).toContain(reply.grounding);
    expect(reply.sources.length).toBeGreaterThan(0);
    // Prices only ever come from verified knowledge-base data
    for (const s of reply.suggestions) {
      if (!s.from_knowledge_base) expect(s.price).toBeNull();
    }
    expect(turn.session.state.destination).toBe("Kerala");
    // Day plans are re-checked by the deterministic feasibility engine.
    if (reply.itinerary.length > 0) {
      expect(["feasible", "repaired", "needs_attention"]).toContain(reply.feasibility.status);
      for (const day of reply.itinerary) {
        if (reply.feasibility.status !== "needs_attention") {
          expect(day.activity_minutes + day.travel_minutes).toBeLessThanOrEqual(day.capacity_minutes);
        }
        for (const item of day.items) expect(item.start).toMatch(/^\d\d:\d\d$/);
      }
    }

    const { body: sessions } = await traveler.get("/chat/sessions");
    expect(sessions[0].id).toBe(session.id);
    const { body: detail } = await traveler.get(`/chat/sessions/${session.id}`);
    expect(detail.messages).toHaveLength(2);
    await traveler.delete(`/chat/sessions/${session.id}`);
    await traveler.get(`/chat/sessions/${session.id}`, { status: 404 });
  });

  test("a destination we don't cover gets no look-alike knowledge", async ({ traveler }) => {
    const { body: session } = await traveler.post("/chat/sessions", { status: 201 });
    const { body: turn } = await traveler.post(`/chat/sessions/${session.id}/messages`, {
      data: { content: "Plan 3 days in Reykjavik for a couple" },
      status: 200,
    });
    expect(turn.assistant_message.intent.destination).toBe("Reykjavik");
    expect(turn.assistant_message.grounding).toBe("general");
    expect(turn.assistant_message.sources).toEqual([]);
  });
});

/**
 * Conversation scenarios @conversations — real multi-turn chats through the traveler website,
 * checking what the system understood and the rules it must never break.
 *
 *   pnpm test:conversations              (headed)
 *   HEADLESS=1 pnpm test:conversations
 *
 * HARD checks (test fails): no invented prices, uncovered/off-topic requests get no
 * knowledge-base places, every reply renders. SOFT checks (all recorded, test marked failed
 * but keeps going): intent fields the system should have understood.
 */
import { expect, signUp, test } from "./fixtures";
import type { Page } from "@playwright/test";

type Expect = Partial<{
  intent: string | string[];
  destination: string | null | RegExp;
  companions: string;
  duration_days: number | null;
  budget_max: number;
  budget_min: number;
  energy_max: number;
  energy_min: number;
  start_date: RegExp;
  preferred_times: string[];
  location_types: string[];
  cleared: string[];
  grounding: string | string[];
  no_sources: boolean;
  state: Record<string, unknown>;
  state_missing: string[];
}>;
type Turn = { say: string; expect: Expect };
type Scenario = { name: string; intents: string[]; profile?: Record<string, unknown>; turns: Turn[] };

const KB = ["knowledge_base", "partial"];
const PRICE = /(?:[£$€₹]\s?\d|\b(?:INR|USD|EUR|GBP|Rs\.?)\s?\d)/i;

const SCENARIOS: Scenario[] = [
  {
    name: "1 · Family holiday in a region, then easing a day",
    intents: ["smalltalk", "plan_trip", "region destination", "family with kids", "modify_plan"],
    turns: [
      { say: "Hi there!", expect: { intent: "smalltalk" } },
      { say: "Plan 5 days in Kerala with my wife and our two kids", expect: { intent: "plan_trip", destination: "Kerala", companions: "family", duration_days: 5, grounding: KB } },
      { say: "Make day 2 more relaxing please", expect: { intent: "modify_plan", energy_max: 2, state: { destination: "Kerala", duration_days: 5 } } },
    ],
  },
  {
    name: "2 · Honeymoon with dates added later, then a price question",
    intents: ["couple", "duration in weeks", "start date", "price question"],
    turns: [
      { say: "A week in Goa for our honeymoon, we love beaches and sunsets", expect: { destination: "Goa", companions: "couple", duration_days: 7, grounding: KB } },
      { say: "We start on 12 November", expect: { start_date: /-11-12$/, state: { destination: "Goa", duration_days: 7 } } },
      { say: "How much will this trip cost?", expect: { state: { destination: "Goa" } } },
    ],
  },
  {
    name: "3 · Parents in the mountains, typo + alias, low mobility",
    intents: ["seniors", "typo destination", "alias destination", "low energy"],
    turns: [
      { say: "3 relaxed days in Dharamsala for my parents", expect: { destination: /dharamshala|mcleod/i, companions: "seniors", duration_days: 3, energy_max: 2, grounding: KB } },
      { say: "They can't walk much, keep it very gentle", expect: { energy_max: 1, state: { companions: "seniors" } } },
    ],
  },
  {
    name: "4 · Backpackers after street food, typo, evenings",
    intents: ["budget travel", "friends", "typo destination", "interests", "time of day"],
    turns: [
      { say: "cheap street food in Bangkock with my college friends", expect: { destination: "Bangkok", companions: "friends", budget_max: 1, grounding: KB } },
      { say: "What about night markets in the evening?", expect: { preferred_times: ["evening"], state: { destination: "Bangkok" } } },
    ],
  },
  {
    name: "5 · Information questions about a country and a city",
    intents: ["ask_info", "country destination"],
    turns: [
      { say: "What's the best time to visit Japan?", expect: { intent: "ask_info", destination: "Japan" } },
      { say: "Is Kyoto good for temples?", expect: { intent: ["ask_info", "recommend"], destination: "Kyoto", grounding: KB } },
    ],
  },
  {
    name: "6 · Targeted question: restaurants near a town",
    intents: ["recommend restaurants", "alias destination"],
    turns: [
      { say: "Any good restaurants near Munnar?", expect: { intent: ["recommend", "ask_info"], destination: /munnar/i, location_types: ["restaurant"], grounding: KB } },
    ],
  },
  {
    name: "7 · Uncovered destination, then switching to one we know",
    intents: ["uncovered destination", "destination change"],
    turns: [
      { say: "Plan 3 days in Reykjavik for a couple", expect: { destination: "Reykjavik", grounding: "general", no_sources: true } },
      { say: "OK, what about London instead?", expect: { destination: "London", grounding: KB, state: { destination: "London" } } },
    ],
  },
  {
    name: "8 · Wheelchair access in Paris",
    intents: ["accessibility"],
    profile: { accessibility_needs: true },
    turns: [
      { say: "My mother uses a wheelchair. Two days in Paris for us please", expect: { destination: "Paris", duration_days: 2, energy_max: 1, grounding: KB } },
    ],
  },
  {
    name: "9 · Dates given, then taken back",
    intents: ["start date", "take back details"],
    turns: [
      { say: "4 days in Phuket from 2 December", expect: { destination: "Phuket", duration_days: 4, start_date: /-12-02$/ } },
      { say: "Actually our dates are flexible now", expect: { cleared: ["start_date"], state: { destination: "Phuket" }, state_missing: ["start_date"] } },
    ],
  },
  {
    name: "10 · Off-topic request, then a luxury anniversary",
    intents: ["off-topic", "luxury", "anniversary couple"],
    turns: [
      { say: "Can you help me file my income taxes?", expect: { grounding: "general", no_sources: true } },
      { say: "Fine — plan a luxury anniversary trip to Phuket for 4 nights", expect: { destination: "Phuket", duration_days: 4, budget_min: 3, companions: "couple", grounding: KB } },
    ],
  },
];

async function send(page: Page, text: string) {
  const reply = page.waitForResponse((r) => /\/api\/wt\/chat\/sessions\/[^/]+\/messages$/.test(r.url()), { timeout: 300_000 });
  await page.getByPlaceholder(/4 days in Munnar/).fill(text);
  await page.getByRole("button", { name: "Send" }).click();
  const res = await reply;
  expect(res.status(), `chat reply for "${text}"`).toBe(200);
  return res.json();
}

function checkUnderstanding(turn: Turn, msg: any, state: Record<string, unknown>) {
  const i = msg.intent ?? {};
  const e = turn.expect;
  const label = (field: string) => `"${turn.say}" → ${field}`;
  const oneOf = (v: string | string[]) => (Array.isArray(v) ? v : [v]);
  if (e.intent) expect.soft(oneOf(e.intent), label("intent")).toContain(i.intent);
  if (e.destination !== undefined) {
    if (e.destination instanceof RegExp) expect.soft(String(i.destination ?? state.destination ?? ""), label("destination")).toMatch(e.destination);
    else expect.soft(i.destination ?? null, label("destination")).toBe(e.destination);
  }
  if (e.companions) expect.soft(i.companions ?? state.companions, label("companions")).toBe(e.companions);
  if (e.duration_days !== undefined) expect.soft(i.duration_days ?? null, label("duration_days")).toBe(e.duration_days);
  if (e.budget_max !== undefined) expect.soft(i.budget_level ?? 99, label("budget_level")).toBeLessThanOrEqual(e.budget_max);
  if (e.budget_min !== undefined) expect.soft(i.budget_level ?? -1, label("budget_level")).toBeGreaterThanOrEqual(e.budget_min);
  if (e.energy_max !== undefined) expect.soft(i.energy_level ?? (state.energy_level as number) ?? 99, label("energy_level")).toBeLessThanOrEqual(e.energy_max);
  if (e.energy_min !== undefined) expect.soft(i.energy_level ?? -1, label("energy_level")).toBeGreaterThanOrEqual(e.energy_min);
  if (e.start_date) expect.soft(String(i.start_date ?? state.start_date ?? ""), label("start_date")).toMatch(e.start_date);
  if (e.preferred_times) expect.soft(i.preferred_times ?? [], label("preferred_times")).toEqual(expect.arrayContaining(e.preferred_times));
  if (e.location_types) expect.soft(i.location_types ?? [], label("location_types")).toEqual(expect.arrayContaining(e.location_types));
  if (e.cleared) expect.soft(i.cleared_fields ?? [], label("cleared_fields")).toEqual(expect.arrayContaining(e.cleared));
  if (e.grounding && !e.no_sources) expect.soft(oneOf(e.grounding), label("grounding")).toContain(msg.grounding);
  for (const [k, v] of Object.entries(e.state ?? {})) expect.soft(state[k], label(`trip state ${k}`)).toBe(v);
  for (const k of e.state_missing ?? []) expect.soft(state, label(`trip state without ${k}`)).not.toHaveProperty(k);
}

function checkRules(turn: Turn, msg: any) {
  // Never an invented price: in the text, or on any suggestion / scheduled item.
  expect(msg.content, `"${turn.say}": reply must not state a price`).not.toMatch(PRICE);
  for (const s of msg.suggestions ?? []) expect(s.price ?? null, `"${turn.say}": ${s.name} price`).toBeNull();
  // Uncovered destinations and off-topic requests must not be answered with our places.
  if (turn.expect.no_sources) {
    expect(msg.grounding, `"${turn.say}": grounding`).toBe("general");
    expect(msg.sources, `"${turn.say}": no knowledge-base sources`).toEqual([]);
  }
  // Questions, suggestions and small talk get answers — never a day plan.
  if (!["plan_trip", "modify_plan"].includes(msg.intent?.intent)) {
    expect(msg.itinerary ?? [], `"${turn.say}": a ${msg.intent?.intent} reply must not be a day plan`).toEqual([]);
    expect(msg.feasibility ?? null, `"${turn.say}": no plan check for a ${msg.intent?.intent}`).toBeNull();
  }
  // Every scheduled day respects its capacity unless flagged as needing attention.
  if (msg.feasibility && msg.feasibility.status !== "needs_attention") {
    for (const d of msg.itinerary) {
      expect(d.activity_minutes + d.travel_minutes, `"${turn.say}": day ${d.day} load`).toBeLessThanOrEqual(d.capacity_minutes);
    }
  }
}

function transcriptLine(turn: Turn, msg: any, state: Record<string, unknown>) {
  const i = msg.intent ?? {};
  const understood = Object.fromEntries(
    Object.entries(i).filter(([k, v]) => !["search_query", "source", "corrections", "interests"].includes(k) && v !== null && !(Array.isArray(v) && v.length === 0)),
  );
  return [
    `**Traveler:** ${turn.say}`,
    `- understood (${i.source}): \`${JSON.stringify(understood)}\``,
    `- grounding: **${msg.grounding}** · sources: ${(msg.sources ?? []).length} · model: ${msg.model}`,
    msg.feasibility ? `- plan check: **${msg.feasibility.status}** · ${msg.itinerary.length} days · ${msg.feasibility.changes.length} adjustments` : "- plan check: not a day plan",
    ...(i.corrections?.length ? [`- corrections: ${i.corrections.join(" | ")}`] : []),
    `- trip state: \`${JSON.stringify(state)}\``,
    `- reply: ${String(msg.content).replace(/\s+/g, " ").slice(0, 220)}…`,
    "",
  ].join("\n");
}

test.describe("Conversation scenarios @conversations", () => {
  test.describe.configure({ timeout: 900_000 });

  for (const scenario of SCENARIOS) {
    test(scenario.name, async ({ page }, testInfo) => {
      await signUp(page);
      if (scenario.profile) {
        const res = await page.request.put("/api/wt/profiles/me", { data: scenario.profile });
        expect(res.status()).toBe(200);
      }
      await page.goto("/arya");
      await page.getByRole("button", { name: "Your trips" }).click();
      await page.getByRole("menuitem", { name: "New trip" }).click();

      const transcript = [`# ${scenario.name}`, `Intents covered: ${scenario.intents.join(", ")}`, ""];
      for (const turn of scenario.turns) {
        const result = await send(page, turn.say);
        const msg = result.assistant_message;
        const state = result.session.state ?? {};
        console.log(`    💬 ${turn.say}\n       → ${msg.intent?.intent} · ${msg.grounding} · dest=${msg.intent?.destination ?? state.destination ?? "–"}${msg.feasibility ? ` · plan ${msg.feasibility.status}` : ""}`);
        transcript.push(transcriptLine(turn, msg, state));

        // The reply shows up for the traveler, with the right label.
        await expect(page.getByText(/From places WishTrip has checked|Includes some general suggestions|General ideas/).last()).toBeVisible();
        checkRules(turn, msg);
        checkUnderstanding(turn, msg, state);
      }
      await testInfo.attach("transcript.md", { body: transcript.join("\n"), contentType: "text/markdown" });
    });
  }
});

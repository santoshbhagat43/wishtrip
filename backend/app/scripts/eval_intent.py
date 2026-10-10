"""Intent-extraction benchmark: does the model understand what the traveler wants?

    uv run python -m app.scripts.eval_intent                       # current LLM_PROVIDER
    uv run python -m app.scripts.eval_intent --provider ollama openrouter none

"none" scores the keyword fallback used when no LLM is configured. Each case lists only the
fields the message clearly states; a case passes when every listed field matches.
"""

import argparse
import asyncio
import time

from sqlalchemy import func, select

from app.ai.llm import LLMClient, provider_config
from app.ai.orchestrator import AIOrchestrator
from app.db.session import SessionLocal
from app.modules.chat.intent import understand
from app.modules.knowledge.models import Location, LocationStatus, LocationType, Tag

CASES: list[tuple[str, dict]] = [
    (
        "5 relaxed days in Kerala with my wife and our two kids",
        {
            "destination": "Kerala",
            "duration_days": 5,
            "companions": "family",
            "energy_level": ("<=", 2),
        },
    ),
    (
        "Planning a honeymoon in Goa for a week, we love beaches and sunsets",
        {"destination": "Goa", "duration_days": 7, "companions": "couple"},
    ),
    (
        "cheap street food in Bangkok with my college friends",
        {"destination": "Bangkok", "companions": "friends", "budget_level": ("<=", 1)},
    ),
    (
        "I'm travelling alone to Kyoto for 3 days and want to see temples early in the morning",
        {
            "destination": "Kyoto",
            "duration_days": 3,
            "companions": "solo",
            "preferred_times": ["morning"],
        },
    ),
    (
        "Any good restaurants near Munnar?",
        {
            "destination": "Munnar tea hills|Munnar",
            "location_types": ["restaurant"],
            "intent": "recommend|ask_info",
        },
    ),
    (
        "We want an adventurous trip to Dharamshala — trekking, paragliding, the works",
        {"destination": "Dharamshala|McLeod Ganj", "energy_level": (">=", 4)},
    ),
    (
        "Luxury stay in Phuket for our anniversary, 4 nights",
        {
            "destination": "Phuket",
            "duration_days": 4,
            "budget_level": (">=", 3),
            "companions": "couple",
        },
    ),
    ("what's the best time to visit Japan?", {"destination": "Japan", "intent": "ask_info"}),
    (
        "Replace day 2 with something more relaxing",
        {"intent": "modify_plan", "energy_level": ("<=", 2)},
    ),
    ("hello!", {"intent": "smalltalk"}),
    (
        "Plan a weekend in Chiang Mai with my parents, they can't walk much",
        {"destination": "Chiang Mai", "duration_days": 2, "energy_level": ("<=", 2)},
    ),
    (
        "Show me evening activities in Tokyo",
        {"destination": "Tokyo", "preferred_times": ["evening"]},
    ),
]


def matches(expected, actual) -> bool:
    if isinstance(expected, tuple):
        op, bound = expected
        return actual is not None and (actual <= bound if op == "<=" else actual >= bound)
    if isinstance(expected, list):
        return set(expected) <= set(actual or [])
    if isinstance(expected, str) and "|" in expected:
        return str(actual).lower() in {e.lower() for e in expected.split("|")}
    if isinstance(expected, str):
        return str(actual or "").lower() == expected.lower()
    return actual == expected


async def run(provider: str, destinations: list[str], tags: list[str]) -> None:
    cfg = provider_config(provider)
    if provider != "none" and cfg is None:
        print(f"== {provider}: not configured (missing key?) — skipped\n")
        return
    ai = AIOrchestrator(client=LLMClient(cfg))
    label = f"{provider} ({cfg.models['intent']})" if cfg else "none (keyword fallback)"
    passed, fields_ok, fields_total, times = 0, 0, 0, []
    lines = []
    for message, expected in CASES:
        started = time.perf_counter()
        intent = (await understand(ai, message, [], destinations, tags)).to_dict()
        times.append(time.perf_counter() - started)
        misses = [
            f"{k}={intent.get(k)!r}" for k, v in expected.items() if not matches(v, intent.get(k))
        ]
        fields_ok += len(expected) - len(misses)
        fields_total += len(expected)
        passed += not misses
        lines.append(f"   {'✓' if not misses else '✗'} {message[:58]:<58} {'; '.join(misses)}")
    print(
        f"== {label}: {passed}/{len(CASES)} messages fully understood · "
        f"{fields_ok}/{fields_total} fields · avg {sum(times) / len(times):.2f}s"
    )
    print("\n".join(lines) + "\n")


async def main(providers: list[str]) -> None:
    async with SessionLocal() as session:
        destinations = list(
            await session.scalars(
                select(Location.name).where(
                    Location.type.in_([LocationType.CITY, LocationType.COUNTRY]),
                    Location.status == LocationStatus.PUBLISHED,
                )
            )
        )
        regions = await session.scalars(
            select(Location.region).where(Location.region != "").distinct()
        )
        aliases = await session.scalars(select(func.unnest(Location.aliases)))
        destinations += [d for d in {*regions, *aliases} if d not in destinations]
        tags = list(await session.scalars(select(Tag.name)))
    for provider in providers:
        await run(provider, destinations, tags)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider", nargs="+", default=["ollama", "none"])
    asyncio.run(main(parser.parse_args().provider))

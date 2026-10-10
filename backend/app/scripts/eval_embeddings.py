"""Retrieval-quality benchmark for the embedding provider.

    uv run python -m app.scripts.eval_embeddings                      # current EMBEDDING_PROVIDER
    uv run python -m app.scripts.eval_embeddings --provider hashing ollama

Embeds every published place in memory (the database is not modified) and runs paraphrased
traveler queries that avoid the places' own wording, so word overlap alone can't score well.
A query counts as answered when a relevant place appears in the top 5. Also reports MRR@10.
"""

import argparse
import asyncio
import math
import re
import time

from sqlalchemy import select

from app.ai import embeddings
from app.ai.indexing import location_document
from app.ai.openrouter import AIUnavailableError
from app.core.config import settings
from app.db.session import SessionLocal
from app.modules.knowledge.models import CONTAINER_TYPES, Location, LocationStatus

# (paraphrased query, regex that a relevant place's name matches)
CASES = [
    ("watch the sun go down by the water", r"sunset"),
    ("visit a plantation and taste the leaves they grow", r"\btea\b"),
    ("see monks and a Buddhist place of worship", r"monaster|dalai lama|wat |temple"),
    ("swim with fish over a coral reef", r"snorkel"),
    ("float slowly through canals on a boat you can sleep on", r"backwater|houseboat"),
    ("evening stalls selling snacks and souvenirs", r"night market|night bazaar"),
    ("get pampered with a traditional body treatment", r"spa|ayurved|massage|onsen"),
    ("learn to make local dishes with a chef", r"cooking"),
    ("meet gentle giant animals responsibly", r"elephant"),
    ("noodle soup in a busy little shop", r"ramen"),
    ("fly off a mountain with a canopy", r"paraglid"),
    ("walk through the forest to a cascade", r"waterfall"),
    ("old stone stronghold overlooking the sea", r"\bfort\b"),
    ("Japanese hot spring bath", r"onsen"),
]


# Queries the knowledge base should NOT answer; their best scores calibrate the relevance cutoff.
OFF_TOPIC = [
    "quantum physics lecture",
    "buy a second-hand car",
    "tax filing deadline",
    "dentist appointment",
    "repair my laptop screen",
]


def cosine(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b, strict=True)) / (
        math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b)) or 1.0
    )


async def evaluate(provider: str, places: list[tuple[str, str]]) -> dict:
    # "ollama-noprompt" benchmarks the Ollama model without task prompts.
    settings.ollama_task_prompts = False if provider == "ollama-noprompt" else None
    settings.embedding_provider = "ollama" if provider == "ollama-noprompt" else provider
    embedder = embeddings.get_embedder()
    started = time.perf_counter()
    doc_vectors: list[list[float]] = []
    for i in range(0, len(places), 32):
        doc_vectors += await embedder.embed([doc for _, doc in places[i : i + 32]], "document")
    index_seconds = time.perf_counter() - started

    hits, rr, rows = 0, 0.0, []
    for query, pattern in CASES:
        q = (await embedder.embed([query], "query"))[0]
        ranked = sorted(
            ((cosine(q, v), name) for (name, _), v in zip(places, doc_vectors, strict=True)),
            reverse=True,
        )[:10]
        ranks = [i for i, (_, name) in enumerate(ranked, 1) if re.search(pattern, name, re.I)]
        first = ranks[0] if ranks else None
        hits += bool(first and first <= 5)
        rr += 1 / first if first else 0
        rows.append((query, first, ranked[0][1], ranked[0][0]))
    off_topic = []
    for query in OFF_TOPIC:
        q = (await embedder.embed([query], "query"))[0]
        off_topic.append(max(cosine(q, v) for v in doc_vectors))
    return {
        "off_topic_max": max(off_topic),
        "relevant_min_top": min(score for *_, score in rows),
        "min_similarity": embedder.min_similarity,
        "provider": embedder.name,
        "hit@5": hits / len(CASES),
        "mrr@10": rr / len(CASES),
        "index_seconds": index_seconds,
        "rows": rows,
    }


async def main(providers: list[str]) -> None:
    async with SessionLocal() as session:
        locations = (
            await session.scalars(
                select(Location).where(
                    Location.status == LocationStatus.PUBLISHED,
                    Location.type.not_in(CONTAINER_TYPES),
                )
            )
        ).unique()
        places = [
            (loc.name, location_document(loc, loc.parent.name if loc.parent else None))
            for loc in locations
        ]
    print(f"{len(places)} published places, {len(CASES)} paraphrased queries\n")
    for provider in providers:
        try:
            result = await evaluate(provider, places)
        except AIUnavailableError as exc:
            print(f"== {provider}: skipped — {exc}\n")
            continue
        print(
            f"== {provider} ({result['provider']}): hit@5 {result['hit@5']:.0%} · MRR@10 "
            f"{result['mrr@10']:.2f} · indexed in {result['index_seconds']:.1f}s"
        )
        print(
            f"   cutoff check: off-topic best {result['off_topic_max']:.2f} · weakest relevant top "
            f"{result['relevant_min_top']:.2f} · configured cutoff {result['min_similarity']:.2f}"
        )
        for query, rank, top, score in result["rows"]:
            mark = f"#{rank}" if rank else "miss"
            print(f"   {mark:>5}  {query[:52]:<52} → {top[:40]} ({score:.2f})")
        print()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider", nargs="+", default=[settings.embedding_provider])
    asyncio.run(main(parser.parse_args().provider))

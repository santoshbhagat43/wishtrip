import json
import math
import uuid

import httpx
import pytest
from sqlalchemy import select

from app.ai import embeddings
from app.ai.embeddings import HashingEmbedder, OllamaEmbedder, fit_dimensions, get_embedder
from app.ai.indexing import embed_locations, stale_embedding_clause
from app.ai.openrouter import AIUnavailableError
from app.ai.orchestrator import AIOrchestrator
from app.core.config import settings
from app.db.session import SessionLocal
from app.modules.knowledge.models import Location
from tests.conftest import auth


def norm(v: list[float]) -> float:
    return math.sqrt(sum(x * x for x in v))


# Vector math ------------------------------------------------------------------------------


def test_fit_dimensions_truncates_and_renormalizes():
    vector = [3.0, 4.0, 12.0]  # norm 13
    fitted = fit_dimensions(vector, 2)
    assert len(fitted) == 2
    assert fitted == pytest.approx([0.6, 0.8])
    assert norm(fitted) == pytest.approx(1.0)


def test_fit_dimensions_rejects_short_vectors():
    with pytest.raises(ValueError):
        fit_dimensions([1.0, 2.0], 768)


async def test_hashing_embedder_is_deterministic_unit_length_and_sized():
    embedder = HashingEmbedder()
    a, b, c = await embedder.embed(["tea gardens", "tea gardens", "night market"])
    assert len(a) == settings.embedding_dimensions == 768
    assert a == b
    assert norm(a) == pytest.approx(1.0)
    assert sum(x * y for x, y in zip(a, c, strict=True)) < 0.5


# Ollama provider (mocked HTTP) ------------------------------------------------------------


def ollama_transport(seen: list[dict], dims: int = 1024, status: int = 200):
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        seen.append({"path": request.url.path, **body})
        if status != 200:
            return httpx.Response(status, text="model not found")
        return httpx.Response(200, json={"embeddings": [[1.0] * dims for _ in body["input"]]})

    return httpx.MockTransport(handler)


async def test_ollama_embedder_uses_embeddinggemma_task_prompts_and_fits_dims():
    seen: list[dict] = []
    embedder = OllamaEmbedder(
        model="embeddinggemma", base_url="http://ollama", transport=ollama_transport(seen)
    )
    docs = await embedder.embed(["Tower Bridge"], "document")
    query = await embedder.embed(["sunset views"], "query")
    assert seen[0]["path"] == "/api/embed"
    assert seen[0]["model"] == "embeddinggemma"
    assert seen[0]["input"] == ["title: none | text: Tower Bridge"]
    assert seen[1]["input"] == ["task: search result | query: sunset views"]
    assert len(docs[0]) == len(query[0]) == 768
    assert norm(docs[0]) == pytest.approx(1.0)
    assert embedder.name == "ollama/embeddinggemma"


async def test_embeddinggemma_2_uses_plain_text_per_benchmark():
    seen: list[dict] = []
    embedder = OllamaEmbedder(
        model="embeddinggemma-2", base_url="http://ollama", transport=ollama_transport(seen)
    )
    await embedder.embed(["sunset"], "query")
    assert seen[0]["input"] == ["sunset"]


async def test_ollama_embedder_sends_plain_text_for_other_models():
    seen: list[dict] = []
    embedder = OllamaEmbedder(
        model="nomic-embed-text", base_url="http://ollama", transport=ollama_transport(seen)
    )
    await embedder.embed(["Tower Bridge"], "query")
    assert seen[0]["input"] == ["Tower Bridge"]


async def test_ollama_errors_become_ai_unavailable():
    embedder = OllamaEmbedder(base_url="http://ollama", transport=ollama_transport([], status=404))
    with pytest.raises(AIUnavailableError, match="404"):
        await embedder.embed(["x"])

    def refuse(request):
        raise httpx.ConnectError("refused")

    down = OllamaEmbedder(base_url="http://ollama", transport=httpx.MockTransport(refuse))
    with pytest.raises(AIUnavailableError, match="unreachable"):
        await down.embed(["x"])


@pytest.mark.parametrize(
    ("provider", "key", "expected"),
    [
        ("auto", "", embeddings.HashingEmbedder),
        ("auto", "sk-test", embeddings.OpenRouterEmbedder),
        ("ollama", "", embeddings.OllamaEmbedder),
        ("hashing", "sk-test", embeddings.HashingEmbedder),
    ],
)
def test_provider_selection(monkeypatch, provider, key, expected):
    monkeypatch.setattr(settings, "embedding_provider", provider)
    monkeypatch.setattr(settings, "openrouter_api_key", key)
    assert isinstance(get_embedder(), expected)


# Index freshness --------------------------------------------------------------------------


class RenamedEmbedder(HashingEmbedder):
    name = "another-model"


async def test_index_freshness_tracks_edits_and_model_changes(client, editor, london):
    tower = uuid.UUID(london["places"]["Tower Bridge"]["id"])
    async with SessionLocal() as session:
        loc = await session.get(Location, tower)
        assert loc.embedding_model == "local-hashing"
        assert loc.embedded_at >= loc.updated_at
        stale = select(Location.id).where(stale_embedding_clause("local-hashing"))
        assert tower not in set(await session.scalars(stale))
        # Switching models makes every row stale...
        other = select(Location.id).where(stale_embedding_clause("another-model"))
        assert tower in set(await session.scalars(other))

    # ...and re-embedding with the new model stores its name.
    async with SessionLocal() as session:
        count = await embed_locations(session, AIOrchestrator(embedder=RenamedEmbedder()))
        assert count == 5  # every published row
    async with SessionLocal() as session:
        assert (await session.get(Location, tower)).embedding_model == "another-model"


async def test_drafts_are_not_embedded_and_publishing_embeds(client, editor, london):
    h = auth(editor)
    draft = (
        await client.post(
            "/admin/locations",
            json={"type": "attraction", "name": "Draft spot", "parent_id": london["city"]["id"]},
            headers=h,
        )
    ).json()
    assert draft["embedded_at"] is None
    await client.patch(f"/admin/locations/{draft['id']}", json={"status": "published"}, headers=h)
    # Embedding runs as a background task after the response; read the row back.
    published = (await client.get(f"/admin/locations/{draft['id']}", headers=h)).json()
    assert published["embedded_at"] is not None
    assert published["embedding_stale"] is False


async def test_deleting_a_tag_reembeds_the_places_that_had_it(client, editor, london):
    h = auth(editor)
    tower = london["places"]["Tower Bridge"]["id"]
    before = (await client.get(f"/admin/locations/{tower}", headers=h)).json()["embedded_at"]
    await client.delete(f"/admin/tags/{london['tags']['History']}", headers=h)
    after = (await client.get(f"/admin/locations/{tower}", headers=h)).json()
    assert after["embedded_at"] > before
    assert after["embedding_stale"] is False


async def test_renaming_a_city_reembeds_its_places(client, editor, london):
    h = auth(editor)
    tower = london["places"]["Tower Bridge"]["id"]
    before = (await client.get(f"/admin/locations/{tower}", headers=h)).json()["embedded_at"]
    await client.patch(
        f"/admin/locations/{london['city']['id']}", json={"name": "Greater London"}, headers=h
    )
    assert (await client.get(f"/admin/locations/{tower}", headers=h)).json()["embedded_at"] > before


# Retrieval -------------------------------------------------------------------------------


async def test_search_returns_published_places_in_similarity_order(
    client, editor, traveler, london
):
    await client.post(
        "/admin/locations",
        json={
            "type": "experience",
            "name": "Hidden street food night",
            "parent_id": london["city"]["id"],
            "summary": "Street food tasting",
        },
        headers=auth(editor),
    )  # draft
    results = (
        await client.get("/search/semantic?q=street food tasting", headers=auth(traveler))
    ).json()["results"]
    names = [r["location"]["name"] for r in results]
    assert "Hidden street food night" not in names
    sims = [r["similarity"] for r in results]
    assert sims == sorted(sims, reverse=True)


async def test_traveler_endpoints_hide_internal_fields(client, editor, traveler, london):
    internal = {"provenance", "source", "status", "embedding_model", "embedded_at", "completeness"}
    hit = (await client.get("/search/semantic?q=bridge", headers=auth(traveler))).json()["results"][
        0
    ]
    assert not internal & set(hit["location"])
    recs = (
        await client.get(f"/recommendations?city_id={london['city']['id']}", headers=auth(traveler))
    ).json()
    assert not internal & set(recs["items"][0]["location"])
    # Staff previews keep them.
    preview = (
        await client.get(
            f"/admin/recommendations/preview?user_id={traveler.id}&city_id={london['city']['id']}",
            headers=auth(editor),
        )
    ).json()
    assert "source" in preview["items"][0]["location"]

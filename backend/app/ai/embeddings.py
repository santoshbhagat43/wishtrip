import hashlib
import math
import re
from typing import Literal, Protocol

import httpx

from app.ai.openrouter import AIUnavailableError, OpenRouterClient
from app.core.config import settings

# Retrieval models embed a search query and a stored document differently.
EmbedKind = Literal["document", "query"]


class Embedder(Protocol):
    name: str
    min_similarity: float

    async def embed(self, texts: list[str], kind: EmbedKind = "document") -> list[list[float]]: ...


def normalize(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(v * v for v in vector)) or 1.0
    return [v / norm for v in vector]


def fit_dimensions(vector: list[float], dimensions: int) -> list[float]:
    """Truncate Matryoshka-style embeddings (Gemini, EmbeddingGemma, OpenAI v3) to the stored
    size and re-normalize. Providers may ignore a `dimensions` parameter and return more."""
    if len(vector) < dimensions:
        raise ValueError(f"Embedding has {len(vector)} dims, expected at least {dimensions}")
    return normalize(vector[:dimensions])


class OpenRouterEmbedder:
    def __init__(self, client: OpenRouterClient | None = None) -> None:
        self.client = client or OpenRouterClient()
        self.name = settings.embedding_model
        # Gemini/OpenAI embeddings have a high similarity floor; below this is usually noise.
        self.min_similarity = settings.retrieval_min_similarity or 0.5

    async def embed(self, texts: list[str], kind: EmbedKind = "document") -> list[list[float]]:
        vectors = await self.client.embed(
            settings.embedding_model, texts, settings.embedding_dimensions
        )
        return [fit_dimensions(v, settings.embedding_dimensions) for v in vectors]


class OllamaEmbedder:
    """Local embeddings through Ollama's /api/embed (development without an API key)."""

    def __init__(
        self,
        model: str | None = None,
        base_url: str | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.model = model or settings.ollama_embedding_model
        self.base_url = (base_url or settings.ollama_base_url).rstrip("/")
        self.name = f"ollama/{self.model}"
        # Calibrated for embeddinggemma-2 (eval_embeddings): off-topic queries peak at ~0.70,
        # typical travel queries score 0.75–0.84, the hardest paraphrases ~0.70. Only used when
        # no destination narrows the search. Re-calibrate when changing the model.
        self.min_similarity = settings.retrieval_min_similarity or 0.70
        self._transport = transport

    def _prompt(self, text: str, kind: EmbedKind) -> str:
        # EmbeddingGemma is trained with task prompts; without them retrieval quality drops.
        use_prompts = settings.ollama_task_prompts
        if use_prompts is None:
            # Benchmarked (app.scripts.eval_embeddings): v1 needs the prompts, v2 does better
            # without them (MRR 0.95 vs 0.89 on our paraphrase set).
            use_prompts = "embeddinggemma" in self.model and "embeddinggemma-2" not in self.model
        if use_prompts:
            if kind == "query":
                return f"task: search result | query: {text}"
            return f"title: none | text: {text}"
        return text

    async def embed(self, texts: list[str], kind: EmbedKind = "document") -> list[list[float]]:
        payload = {"model": self.model, "input": [self._prompt(t, kind) for t in texts]}
        try:
            async with httpx.AsyncClient(timeout=120, transport=self._transport) as client:
                response = await client.post(f"{self.base_url}/api/embed", json=payload)
        except httpx.HTTPError as exc:
            raise AIUnavailableError(f"Ollama unreachable at {self.base_url}: {exc}") from exc
        if response.status_code >= 400:
            raise AIUnavailableError(f"Ollama {response.status_code}: {response.text[:300]}")
        vectors = response.json()["embeddings"]
        return [fit_dimensions(v, settings.embedding_dimensions) for v in vectors]


class HashingEmbedder:
    """Deterministic bag-of-words embedding used when no embedding model is available.

    It only captures word overlap, not meaning, but it keeps semantic search and
    retrieval working end-to-end in tests and fully offline runs.
    """

    name = "local-hashing"

    def __init__(self, dimensions: int | None = None) -> None:
        self.dimensions = dimensions or settings.embedding_dimensions
        self.min_similarity = settings.retrieval_min_similarity or 0.08

    def _vector(self, text: str) -> list[float]:
        vector = [0.0] * self.dimensions
        words = re.findall(r"[a-z0-9]+", text.lower())
        features = words + [f"{a}_{b}" for a, b in zip(words, words[1:], strict=False)]
        for feature in features:
            digest = hashlib.blake2b(feature.encode(), digest_size=8).digest()
            index = int.from_bytes(digest[:4], "little") % self.dimensions
            vector[index] += 1.0 if digest[4] & 1 else -1.0
        return normalize(vector)

    async def embed(self, texts: list[str], kind: EmbedKind = "document") -> list[list[float]]:
        return [self._vector(t) for t in texts]


def get_embedder() -> Embedder:
    provider = settings.embedding_provider
    if provider == "auto":
        provider = "openrouter" if settings.ai_enabled else "hashing"
    if provider == "openrouter":
        return OpenRouterEmbedder()
    if provider == "ollama":
        return OllamaEmbedder()
    if provider == "hashing":
        return HashingEmbedder()
    raise ValueError(f"Unknown EMBEDDING_PROVIDER {provider!r}")

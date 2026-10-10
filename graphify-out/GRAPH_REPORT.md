# Graph Report - .  (2026-10-10)

## Corpus Check
- Corpus is ~1,976 words - fits in a single context window. You may not need a graph.

## Summary
- 38 nodes · 71 edges · 6 communities
- Extraction: 80% EXTRACTED · 20% INFERRED · 0% AMBIGUOUS · INFERRED: 14 edges (avg confidence: 0.81)
- Token cost: 70,643 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Backend & AI Services|Backend & AI Services]]
- [[_COMMUNITY_Integration & Booking|Integration & Booking]]
- [[_COMMUNITY_Recommendation Pipeline|Recommendation Pipeline]]
- [[_COMMUNITY_Product Surfaces & Itinerary|Product Surfaces & Itinerary]]
- [[_COMMUNITY_Location Knowledge & Storage|Location Knowledge & Storage]]
- [[_COMMUNITY_Location Model & Validation|Location Model & Validation]]

## God Nodes (most connected - your core abstractions)
1. `Wishtrip Technical Architecture Story` - 11 edges
2. `Travel Location Knowledge Base` - 8 edges
3. `AI/ML Recommendation Architecture` - 8 edges
4. `Python + FastAPI Backend` - 7 edges
5. `Integration Abstraction Layer` - 7 edges
6. `AI / LLM Layer` - 6 edges
7. `Redis Cache & Temporary State` - 6 edges
8. `Proposed Technology Stack` - 6 edges
9. `AI Should Not Be the Source of Truth` - 6 edges
10. `Next.js + TypeScript Frontend` - 5 edges

## Surprising Connections (you probably didn't know these)
- `AI Should Not Be the Source of Truth` --semantically_similar_to--> `Admin Panel (Knowledge Management System)`  [INFERRED] [semantically similar]
  story.md → dev.md
- `Facts/Relevance/Intelligence/Constraints Philosophy` --semantically_similar_to--> `AI/ML Recommendation Architecture`  [INFERRED] [semantically similar]
  story.md → dev.md
- `AI / LLM Layer` --calls--> `Itinerary Engine`  [INFERRED]
  dev.md → story.md
- `Wishtrip Technical Architecture Story` --references--> `Python + FastAPI Backend`  [EXTRACTED]
  story.md → dev.md
- `AI Should Not Be the Source of Truth` --references--> `Travel Location Knowledge Base`  [EXTRACTED]
  story.md → dev.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Recommendation Pipeline (Profile to Itinerary)** — dev_traveler_profile, dev_preference_engine, dev_candidate_search, dev_travel_location_knowledge_base, dev_ranking_engine, dev_ai_llm_layer, story_itinerary_engine [EXTRACTED 1.00]
- **AI Grounded in Source of Truth with Rule Validation** — dev_travel_location_knowledge_base, dev_traveler_profile, dev_ai_llm_layer, story_rule_validation, story_ai_not_source_of_truth [EXTRACTED 1.00]
- **Provider Independence via Gateways/Adapters** — dev_integration_abstraction_layer, dev_provider_adapters, dev_openrouter, dev_ai_orchestrator, dev_engineering_principles [INFERRED 0.85]

## Communities (6 total, 0 thin omitted)

### Community 0 - "Backend & AI Services"
Cohesion: 0.29
Nodes (8): AI Service / AI Orchestrator, Celery Background Jobs, Core Platform Layer, Deployment, Security & DevOps, Python + FastAPI Backend, Intelligence Layer, OpenRouter Model Gateway, Proposed Technology Stack

### Community 1 - "Integration & Booking"
Cohesion: 0.32
Nodes (8): Booking Engine, Booking Layer, Engineering Principles (API-first, modular, provider-independent, MVP-first), Integration Abstraction Layer, Provider Adapters (Flight/Hotel/Activity), Redis Cache & Temporary State, Overall System Architecture, Wishtrip Platform

### Community 2 - "Recommendation Pipeline"
Cohesion: 0.52
Nodes (7): Candidate Search, Preference Engine, Ranking Engine, AI/ML Recommendation Architecture, Traveler Profile & User Intelligence, AI Should Not Be the Source of Truth, Facts/Relevance/Intelligence/Constraints Philosophy

### Community 3 - "Product Surfaces & Itinerary"
Cohesion: 0.47
Nodes (6): Admin Panel (Knowledge Management System), AI / LLM Layer, Next.js + TypeScript Frontend, SEO Destination Pages, Itinerary Engine, Wishtrip Technical Architecture Story

### Community 4 - "Location Knowledge & Storage"
Cohesion: 0.40
Nodes (6): Defer Graph Database Decision, Knowledge Graph of Location Relationships, Neo4j / Graph Database, pgvector Semantic Search, PostgreSQL, Travel Location Knowledge Base

### Community 5 - "Location Model & Validation"
Cohesion: 0.67
Nodes (3): Location Entity Data Model, Object Storage (Media), Rule Validation

## Knowledge Gaps
- **5 isolated node(s):** `SEO Destination Pages`, `Core Platform Layer`, `Neo4j / Graph Database`, `Provider Adapters (Flight/Hotel/Activity)`, `Deployment, Security & DevOps`
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Wishtrip Technical Architecture Story` connect `Product Surfaces & Itinerary` to `Backend & AI Services`, `Integration & Booking`, `Recommendation Pipeline`, `Location Knowledge & Storage`?**
  _High betweenness centrality (0.414) - this node is a cross-community bridge._
- **Why does `Integration Abstraction Layer` connect `Integration & Booking` to `Backend & AI Services`, `Product Surfaces & Itinerary`?**
  _High betweenness centrality (0.170) - this node is a cross-community bridge._
- **Why does `Travel Location Knowledge Base` connect `Location Knowledge & Storage` to `Backend & AI Services`, `Recommendation Pipeline`, `Product Surfaces & Itinerary`, `Location Model & Validation`?**
  _High betweenness centrality (0.168) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `AI/ML Recommendation Architecture` (e.g. with `AI Should Not Be the Source of Truth` and `Facts/Relevance/Intelligence/Constraints Philosophy`) actually correct?**
  _`AI/ML Recommendation Architecture` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 4 inferred relationships involving `Integration Abstraction Layer` (e.g. with `Booking Layer` and `Engineering Principles (API-first, modular, provider-independent, MVP-first)`) actually correct?**
  _`Integration Abstraction Layer` has 4 INFERRED edges - model-reasoned connections that need verification._
- **What connects `SEO Destination Pages`, `Core Platform Layer`, `Neo4j / Graph Database` to the rest of the system?**
  _5 weakly-connected nodes found - possible documentation gaps or missing edges._
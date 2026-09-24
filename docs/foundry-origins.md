# From Foundry to an open stack

Beacon was first built on Palantir Foundry. When that environment went away, the backend was rebuilt on an open stack behind the same React frontend. The screens and their pure modules were kept. Everything under them was replaced.

| Foundry (original) | This repo |
| --- | --- |
| Ontology: 12 object types, 12 link types | `shared/schema.ts`: 11 object types, 2 traversed links; Postgres tables generated from it |
| Pipeline Builder cleaning a licensed data export | `server/seed/universe.ts`: deterministic synthetic universe |
| 30 Actions (function-backed + declarative) | 17 actions in `server/actions/` (every one the UI or seed calls) |
| 39 TypeScript v1 Functions | Server modules plus pure functions in `shared/` |
| Functions-backed rubric + client mirror + parity test | A redesigned public rubric (v2) in one module imported by both sides (no parity test needed) |
| AIP Logic for rejection clustering | Claude (`claude-opus-5`, structured output) behind a flag, with a grounding check and a deterministic fallback |
| OSDK + `@osdk/react` hooks | `src/data/hooks.ts`: same hook names over TanStack Query |
| OAuth + organization marking on every action | Open demo: single shared analyst, nightly reset, throttles and row ceilings |
| Foundry website hosting | Vercel (static app + Functions) with Neon Postgres |

## What carried over unchanged

- Every screen, and the pure frontend modules behind them (queue ranking, axis state, active screening, trust metrics, finding actions) with their tests.
- The shape of the rubric: nine axes scored 0, 1, or 2, A/B/C tiers, and hard rejects.
- The firm lifecycle, append-only history, conflict and abstention semantics, drift, and rule governance with versioned hard-screen configs.

## What changed

- **The rubric.** Version 2 has new labels, cutoffs, tiers, defaults, and hard rejects, designed for the public demo.
- **The data.** A synthetic 700-firm universe with invented names. Enrichment providers are deterministic mocks with neutral names that cite `.example` URLs.
- **The taxonomy.** Generic geographies, products, and sectors.
- **Rule clustering.** Claude replaces AIP Logic. A keyword heuristic runs whenever Claude is off, throttled, or unavailable, and both go through the same grounding check.

## Deliberately left out

- Target Brief generation and the admin data-repair actions (no screen used them).
- Per-user identity and permissions (a public demo has one shared analyst).
- Live third-party data connectors (replaced by deterministic mocks).

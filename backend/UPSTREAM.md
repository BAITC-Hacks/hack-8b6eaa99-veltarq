# Backend provenance

This directory is based on the `integration` branch of
https://github.com/BAITC-Hacks/hack-8b6eaa99-veltarq at commit
`d84f672f1600d39791eb0160078edfeaf73f7fb7`.

The upstream repository was copied into this site's `backend/` directory on
2026-09-23. Its Git history is not nested in this repository.

Local integration changes:

- CORS origins can be configured with `VELTARQ_CORS_ORIGINS`; local site port
  5175 is supported by default on both `localhost` and `127.0.0.1`.
- `VELTARQ_SERVE_FRONTEND=true` serves the root project's `dist/` build beside
  the API. API errors and missing assets remain HTTP errors.
- Hosting behavior is covered by `tests/test_hosting.py`.
- The root `scripts/backend.mjs` and `scripts/dev.mjs` launch Python and Vite,
  load `backend/.env`, and terminate subprocesses on shutdown.

The upstream catalog, validation, scoring, simulation, recommendation, storage,
and analyst implementations are retained.

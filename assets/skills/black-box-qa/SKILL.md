# Black-box QA

Turn `qa.md` into deterministic tests against the public interface.

- Import only the public entry (default `src/index.ts`), not private modules.
- Never patch product code under `src/`. If behavior is wrong, report failed and leave the product tree unchanged.
- Write executable tests under `tests/qa/` and `qa-report.md`.

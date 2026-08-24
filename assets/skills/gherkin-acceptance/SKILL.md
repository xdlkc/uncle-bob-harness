# Gherkin acceptance

One User Story. Convert it into Given-When-Then Gherkin and black-box QA markdown.

- Write `acceptance.feature` with a concrete Then on every scenario.
- Tag scenarios with `@story_<id>`.
- Write `qa.md`: numbered cases with setup, action, observation, teardown against the public API.
- If a product choice is missing, write `blockers.md` and leave status blocked. Do not invent policy.
- Do not implement `src/`. Do not weaken the story into a multi-story plan.

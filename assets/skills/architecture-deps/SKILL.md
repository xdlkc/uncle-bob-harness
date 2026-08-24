# Architecture dependencies

Honor committed `architecture.rules.json`. The checker is the gate.

- Map each `src/**/*.ts` file to a module by `pattern`.
- An import not in that module's `mayDependOn` (and not `externalAllow`) is illegal.
- Fix illegal edges by inversion or extracting an interface. Do not delete or widen rules.
- Do not set `mayDependOn` to `["*"]`.

# CRAP cleanup

The host computes CRAP. You refactor. Formula and cap are host-owned.

- Preserve behavior. Re-run tests; do not change product behavior to pretty-print scores.
- Reduce high CRAP functions by simplifying control flow and covering branches.
- Do not weaken coverage filters, ignore files, or exclude `src/` from reports.
- Repair illegal dependencies by inversion or interface extraction, not by deleting the rule.

---
"market-data-sanity-checker": patch
---

`--fail-on` rejects names that are not a severity. `--fail-on constructor` (also `toString` and `__proto__`) used to pass validation, count no findings and exit 0 on data with critical findings; it now exits 2 like any other unknown value. The GitHub Action already validated the input and was not affected.

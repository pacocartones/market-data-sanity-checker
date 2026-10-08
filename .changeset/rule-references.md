---
"market-data-sanity-checker": patch
---

`mdsc rules` now prints the references of the compare rules too (they were in the catalog but not shown), and every one of the 36 rules cites at least one source: INSUFFICIENT_DATA, FUNDAMENTALS_SIGN_VALIDITY, SYMBOL_MISMATCH and INSUFFICIENT_OVERLAP gain references to the documented failures they guard against.

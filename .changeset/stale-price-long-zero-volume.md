---
"market-data-sanity-checker": minor
---

`STALE_PRICE` no longer excuses every zero-volume run as a trading halt: a price frozen with volume 0 for more than `maxHaltSessions` (default 10, the longest summary suspension the SEC may order) is reported at `info`. Closes #59.

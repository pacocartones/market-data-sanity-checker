---
case: "Truncated tail passes a count-only comparison"
source: "any"
reported_by: "@arian-gogani"
---

## What happened

A subject series ends two sessions before the authority. A comparison of session counts with a tolerance (10% in the original probe) passed with 2 of 21 sessions silently deleted. With equal counts but an entirely different window, a count comparison also passes.

## Evidence

[#35](https://github.com/pacocartones/market-data-sanity-checker/issues/35), [`wrong_window.py`](https://github.com/arian-gogani/nobulex-registry/blob/main/examples/wrong_window.py)

## A checker should report

`SERIES_TAIL_TRUNCATED` naming the authority dates absent from the subject; with no shared session, `INSUFFICIENT_OVERLAP` (critical), never a truncation

## The check does NOT establish

That the shared sessions are correct: prices, adjustments and volumes need their own rules

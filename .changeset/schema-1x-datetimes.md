---
"market-data-sanity-checker": patch
---

Keep accepting the timezone-less datetimes that 1.x accepted, such as `2024-01-02T14:30:00` and the CSV export form `2024-01-02 14:30:00`, in bar timestamps and corporate-action dates. They are read as before, in the local time of the process. Impossible calendar dates such as `2024-02-30 09:30:00` are still rejected.

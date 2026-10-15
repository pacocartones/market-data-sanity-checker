# Incident cases

One file per case, so two contributions never touch the same line. Add **one new file** per pull request; do not edit `../incidents.md` (its table is generated).

Copy any existing file for the shape: a front matter block with `case`, `source` and `reported_by` (each a JSON string in double quotes), then four sections in this order: `What happened`, `Evidence`, `A checker should report`, `The check does NOT establish`. Name the file with lowercase words joined by hyphens.

`pnpm incidents:check` tells you whether your file is well formed. Read the checklist in [`../incidents.md`](../incidents.md) before you open the pull request.

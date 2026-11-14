# Scoreboard automation activation

The workflow preserves Monday 05:23 UTC and manual/main. A read-only context job requires the exact repository/main/event, event SHA, SCOREBOARD_APP_CLIENT_ID and SCOREBOARD_AUTOMATION_READY=true. Without activation, producer/environment jobs do not run.

The producer has a read-only repository token and no persisted checkout credentials. Only the calculation step maps SCOREBOARD_DATA_API_KEY to the CLI's ALPHA_VANTAGE_API_KEY. Use the new secret name exclusively in the protected scoreboard-data environment, not as a repository secret. Referencing an environment or setting a flag does not prove its protection.

Delivery uses a new runner and only Node built-ins plus the trusted pure README renderer. It installs no application dependencies and never executes artifact data. Before obtaining the App token it checks artifact metadata (ID, name/run/branch/repository/SHA/digest/size), downloads raw bytes without decompression, then validates one bounded JSON payload. The payload contains exactly four fixed logical files, file hashes and run/attempt/SHA identity. Each file is schema/cross-file checked, including quorum and canonical README/descriptor.

The publisher requires the App output explicitly, with no PAT or repository-token fallback. It builds a tree from the verified main SHA containing only four fixed scoreboard paths, attributes the commit to the App bot, and creates/updates only bot/scoreboard and its PR. Existing branch updates use GraphQL beforeOid compare-and-swap, not a blind force push. A PR created by the App should trigger normal checks; actual App/CI integration remains an activation prerequisite.

Pending external configuration, requiring a separate maintainer decision:
- Protect scoreboard-data and scoreboard-delivery with main-only ref policies. Add SCOREBOARD_DATA_API_KEY and SCOREBOARD_DELIVERY_APP_KEY only in their respective environments.
- Install a dedicated App only on this repository with contents and pull-requests write, without actions write. Set its public client ID in SCOREBOARD_APP_CLIENT_ID.
- Restrict creation/update/deletion of bot/scoreboard to that App. Require PR plus the intended human writer for main, without GitHub Actions/App bypass; preserve required checks.
- After validating the new key, retire the old repository ALPHA_VANTAGE_API_KEY so historical definitions lose that copy. No secret or setting is changed here.
- Only after testing those controls, set SCOREBOARD_AUTOMATION_READY=true. An absent environment can be auto-created without protections, so do not use the flag as a substitute for verification.

Use a new manual/main run or rerun all jobs after a failure; a delivery-only rerun rejects a payload from another attempt. Manual and scheduled runs share one non-cancelling concurrency group. Main is rechecked before writes, but checking main and updating bot are not atomic together. An API failure after branch update may leave a valid data-only branch without a new PR; do not broaden credentials to recover. No-op data makes no commit. This preparation does not globally disable historical workflows or close the security findings.

Current payload limits: JSON 1 MiB, README/CSV 256 KiB each, descriptor 32 KiB, raw envelope 3 MiB. These are explicit resource limits checked against current fixtures, not performance benchmarks. Raw artifact metadata is checked before download; the download action itself is not claimed to impose a streaming limit. Validate real weekly outputs before activation.

The automation profile explicitly requests all 30 Yahoo symbols and the first 25 Alpha Vantage symbols in non-premium mode. The validator binds daily skips to that profile, not to counts asserted by the payload; Yahoo cannot claim quota skips. A future provider/cap/premium change needs a corresponding reviewed contract and test update. Local CLI configuration remains independent.

# market-data-sanity-checker — Bitácora

> Maintainer's working log — public by design (Spanish).
> Registro cronológico de sesiones de trabajo. Plan y OKR: [plan de acción](plan-de-accion.md).
> Convención: fechas absolutas, evidencia citada (rutas, números, comandos).
> Memoria consolidada de aprendizajes de todos los repos: **LEARNINGS.md** y el checklist de
> fin de sesión en **`0. README.md`** viven en la **raíz del workspace local** (no en este
> repo), así que desde GitHub no son enlazables — se abren localmente junto al checkout.

## 2026-07-31 — Día 1: del backlog a v1.0.0 (fases 0–4 completas)

### Qué se hizo

- **Fase 0** (commit inicial): repo + CI + schema canónico Zod + ingestion CSV/JSON +
  scoring + CLI. Decisión clave: `adjustmentFactor` por barra (convención Qlib) y
  `source` obligatorio (provenance).
- **Fase 1** (v0.1.0): rules engine + 12 reglas OHLCV. Enjambre de 5 agentes sobre un
  contrato + 2 ejemplares propios. Guardián de calibración (random-walk plausible) y
  guardián de robustez (datasets degenerados) desde el principio — el primero cazó un
  falso positivo real en `PRICE_SPIKE_INTRADAY` antes de publicar (solución: banda
  económica 10% tipo clearly-erroneous, Nasdaq Rule 11890).
- **Fase 2** (v0.2.0): 13 reglas más (corporate actions, fundamentals, metadata) con
  checksum ISIN real (ISO 6166). Golden tests de contrato sobre fixtures de casos reales
  (11 goldens revisados a mano). Fix de arquitectura: el engine preserva severidad
  degradada deliberada (CURRENCY_SUSPECT info) salvo override de usuario.
- **Fase 3** (v0.3.0): conectores Yahoo (keyless) + Alpha Vantage (env key) como plugins;
  compare engine con 5 compare-rules; CLI `check --provider` / `compare` / `providers`.
  **Calibración real de 50 tickers Yahoo**: 0 críticos; 3 falsos positivos encontrados y
  corregidos en la regla (`DIV_NOT_ADJUSTED` vs ajuste esperado, `EXDATE_MISPLACED`
  suelo 2%, `RETURN_SPIKE` puerta económica 4%). Verdadero positivo: HON 1907:2000
  (spin-off codificado como split). Scoreboard semanal (GitHub Action) + primer audit
  (Yahoo 88.5/100 media, 30 símbolos).
- **Fase 4** (v1.0.0): `mdsc.config.json` validado con zod (regla desconocida = error con
  catálogo), alertas CI (`--fail-on`/`--min-score` con exit codes), audit history JSONL
  (`.mdsc/history/<SYMBOL>.jsonl` + `mdsc history` con tendencia), dashboard HTML
  autocontenido (`--html`, escape total de datos, SVG inline, funciona sin JS), y
  scoreboard emitiendo `latest.csv` + `datapackage.json` (Frictionless/OKF).

### Estado final verificado

223/223 tests · lint/typecheck/build verdes · CI remota verde · demo real: dashboard
HTML generado, history con tendencia, gating con exit codes correctos (1 crítico, 0
limpio, 1 fail-on, 1 min-score), config file con override de severidad aplicado.

### Decisiones relevantes (y por qué)

- **Solo fuentes sin key en v1** (Yahoo): Stooq descartado por anti-bot PoW (fragile y
  de dudosa licitud para un trust product); el compare espera keys del usuario.
- **Umbrales corregidos solo con evidencia real** (calibración de 50 tickers), nunca por
  intuición; cada corrección quedó documentada en el JSDoc de la regla.
- **Dashboard = HTML estático autocontenido**, no Next.js: 80% del valor de "web" al 10%
  del coste y cero superficie de mantenimiento. La web app completa queda para cuando
  haya tracción (ver plan, fase 4.5).
- **Monetización aplazada** por diseño: primero reputación e infraestructura.

### Aprendido (candidatos a 04-CONOCIMIENTO)

- pnpm 11 ignora el campo `pnpm` de package.json: builds nativos se aprueban en
  `pnpm-workspace.yaml` (`allowBuilds`/`onlyBuiltDependencies`).
- Calibrar umbrales contra datos reales > contra intuición: 3 reglas corregidas en un
  solo run de calibración; el guardián sintético no basta (los FP de DIV_NOT_ADJUSTED
  solo aparecen con factores 0.999x reales).
- Yahoo chart API: las fechas exigen `gmtoffset` del exchange; UTC a secas desplaza el
  día en mercados no-US.
- Patrón enjambre para corpus: contrato + ejemplar propio + agentes paralelos con
  verificación acotada + integración con guardianes.

### Siguiente paso

Decisión de Paco: **lanzamiento público** (repo público + npm + awesome-quant + post
r/algotrading con hallazgos). Material listo en `scoreboard/` y `calibration/`.

## 2026-07-31 (sesión 2) — Auditoría total de 7 agentes + remediación completa (v1.1.0)

### Qué se hizo

Auditoría de raíz con 7 agentes especializados (código, seguridad, tests/CI, SEO, AEO/docs,
UI/UX, corrección de dominio) → ~40 hallazgos con reproducción empírica. Remediación en 3
oleadas (10 agentes más) hasta v1.1.0. 323 tests verdes.

### Hallazgos graves corregidos (los que hacían mentir al trust layer)

- `compare` con 0 fechas compartidas → "100/100, sources agree". Fix: guards
  `INSUFFICIENT_OVERLAP` (critical si 0) y `SYMBOL_MISMATCH` (AAPL vs MSFT ya no informa).
- Dataset vacío/1 barra → 95-100 "reliable". Fix: regla `INSUFFICIENT_DATA` + mensaje de
  cobertura en CLI ("N bars · M dividends · K splits checked").
- `EXDATE_AFTER_PAYDATE` (critical) era falsa: FINRA 11140(b)(2) manda ex-date DESPUÉS del
  pay date para especiales ≥25%. Ahora warning y exime esos casos.
- `SPLIT_RATIO_IMPROBABLE` disparaba sobre spin-offs reales (el propio HON 1907:2000 del
  scoreboard): near-one ahora es "probable spin-off" (info); rama extreme cita AMZN/GOOGL 20:1.
- `SPLIT_NOT_ADJUSTED` no disparaba con ruido de mercado (tolerancia absoluta 2pp) y no
  conocía 20:1/7:1/1:20: tolerancia relativa 5% + tabla ampliada.
- Cita falsa de Rule 11890 (tiers reales 10/5/3% por precio) corregida a FINRA 11892.
- `RETURN_SPIKE` penalizaba 33/50 limpios (earnings moves): ahora tier info si |z|<5 y |ret|<8%.
- Config traicionaba su filosofía: typo en params keys, Infinity y claves top-level se
  tragaban en silencio → estricta en las tres dimensiones.
- `fetch` sin timeout (cuelgue reproducido) → 15s configurable.
- Scoreboard sin quorum (Yahoo caído → publica "mean 0") → aborta si >20% fallos.

### Verificación con datos reales (recalibración 50 tickers Yahoo, post-fix)

0 críticos · 42 findings (22 info / 20 warning; antes 41 warning) · media 88.5 → 91.8 ·
HON ya no es FP (info spin-off) · 3 reglas nuevas silenciosas en datos reales (sin FP).

### Gobernanza y lanzamiento preparado

Actions pineadas por SHA, permisos mínimos, Dependabot, CodeQL, zizmor, SECURITY.md,
release workflow con npm provenance, CSP en dashboards. AEO: llms.txt, FAQ, when-not-to-use,
fórmula del score documentada, badges, TOC, compare overlay. Docs del dueño a `docs/maintainer/`.

### Siguiente paso

Lanzamiento público (decisión de Paco): repo público + `NPM_TOKEN` para el release workflow +
topics/GitHub social preview + npm publish v1.1.0 + PR a awesome-quant + post r/algotrading.

## 2026-07-31 (sesión 3, cierre) — Lanzamiento iniciado: público + awesome-quant; npm pendiente

### Qué se hizo

- **Polish pro pre-lanzamiento**: assets reales (screenshot dashboard MOB.ST en README +
  social preview 1280×640 vía Edge headless), archivos de comunidad (CITATION.cff,
  CODE_OF_CONDUCT.md, issue/PR templates, .gitattributes), cobertura medida (86.7%
  statements / 99.2% funciones con @vitest/coverage-v8 + step en CI), sync de
  docs/fixtures.md y CONTRIBUTING.md (2 inconsistencias más corregidas).
- **GitHub SEO**: description + 19 topics aplicados. Tag `v1.1.0` + GitHub Release con notas.
- **Pre-flight checklist**: 10/10 ítems verdes (registrado en `docs/maintainer/lanzamiento-checklist.md`).
- **Repo hecho PÚBLICO** (2026-07-31 ~23:45).
- **PR a awesome-quant**: [#529](https://github.com/wilsonfreitas/awesome-quant/pull/529),
  sección Market Data & Data Sources. Pendiente de revisión.

### Pendiente para la siguiente sesión

Checklist completa en `docs/maintainer/lanzamiento-checklist.md`. Resumen:
1. npm: token → `gh secret set NPM_TOKEN` + `gh variable set NPM_PUBLISH_ENABLED --body true`
   (o `npm login` local + `npm publish`). Verificar con `npm view` y `npx`.
2. Social preview (1 clic en Settings).
3. Posts r/algotrading + Show HN (borradores en la checklist).
4. Vigilar PR #529; métricas a la semana; Alpha Vantage key para scoreboard multi-proveedor.

## 2026-07-31 (cierre final) — Pausa del lanzamiento: privado hasta prueba de Paco

Decisión de Paco: el lanzamiento se pausa **antes** del punto de no retorno mediático.
Repo revertido a **privado** (~23:55) y PR awesome-quant #529 cerrada temporalmente con
nota amable (la rama del fork sigue viva para reenviar). Todo el trabajo queda intacto:
metadata, Release v1.1.0, assets, gobernanza, checklist de salida en
`docs/maintainer/lanzamiento-checklist.md` (actualizada con paso 0 "re-abrir").
Siguiente paso cuando Paco lo pruebe: hacer público + reenviar PR + npm publish + posts.

## 2026-08-02 (sesión 4) — Prueba de Paco superada; dashboard v2 interactivo + onboarding (v1.2.0-dev)

### Qué se hizo

- **Prueba personal de Paco superada**: `mdsc rules` (36 reglas), `check --provider yahoo`
  en vivo (AAPL 95/100, TSLA 85/100 + `demo.html`). Sin incidencias.
- **Decisión de Paco**: antes de publicar, subir el listón de producto — "quiero mejorar
  el dashboard mucho" + mejor info de onboarding. La **promoción** (awesome-quant, posts)
  queda **aplazada mucho después del lanzamiento**; él avisará.
- **Dashboard v2** (`src/report/html.ts` → paquete `src/report/html/`: `shared.ts`,
  `check.ts`, `compare.ts`, `index.ts`; import path estable):
  - Gráfico principal con ejes reales (grid, ticks precio/fecha), marcadores por severidad
    con `data-fi` → click salta al finding; tooltip hover (fecha/OHLC/volumen) vía JS.
  - Score explicado: desglose de penalizaciones regla a regla (100 → −40/−15/−5 → final,
    usando `SEVERITY_PENALTY` de `src/scoring/score.ts` como fuente única) + chips DAMA.
  - Findings como cards con badge `block`/`flag`/`review` + filtros por severidad (JS).
  - Header con contexto: cobertura (barras/dividendos/splits), rango, moneda, versión.
  - Compare v2: overlay con ejes + tooltip con ambos cierres y gap %.
- **Onboarding**: quickstart 30s en README, `docs/examples.md` (5 casos reales con salida
  verificada), `llms.txt` sync, screenshot README regenerado **desde el fixture** (estable,
  coincide con la narrativa del −50%), changeset `.changeset/dashboard-v2.md` (minor → v1.2.0).
- **`.gitignore` endurecido**: `.env*`, `.mdsc/` (history de `--save`), `/*.html` (dashboards
  ad-hoc en raíz como el `demo.html` de la prueba).
- **Infografía animada de arquitectura** (`docs/assets/trust-layer-flow.svg`, estilo
  free-llm-api-hub: SVG artesanal con CSS animation y `prefers-reduced-motion`): mapa
  DATA SOURCES → MDSC (trust layer) → YOUR PRODUCT embebido en el README tras el tagline.

### Decisiones relevantes (y por qué)

- **JS inline permitido** (decisión de Paco): se renuncia al CSP `script-src 'none'`;
  nuevo CSP `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'`.
  Sigue siendo 1 archivo offline, cero recursos externos.
- **Progressive enhancement**: todo el contenido es HTML/SVG estático legible sin JS;
  el `<script>` es una constante fija sin datos interpolados. Datos solo en el blob
  `<script type="application/json" id="mdsc-data">` con `JSON.stringify(...).replaceAll('<','\\u003c')`
  (un dato corrupto jamás rompe el `</script>`).
- **El payload NO incluye URLs ni explanations**: findings reducidos a
  `{i, rule, severity, action, date}` — las reference URLs en el blob violarían el
  invariante de tests "no http(s) fuera de hrefs", y la prosa ya está en las cards estáticas.
- **Screenshot desde fixture, no desde dato vivo**: MOB.ST en vivo ya no muestra el split
  (hoy dispara PRICE_SPIKE_INTRADAY); el fixture es estable y reproducible.

### Estado final verificado

331/331 tests (+8 nuevos: payload, escape `</script>`, fallback estático, cobertura,
desglose, chips DAMA) · lint/typecheck/build verdes · 3 dashboards reales generados e
inspeccionados (check MOB.ST, clean CSV, compare) · screenshot revisado visualmente.

### Siguiente paso

Commit de v1.2.0-dev (propuesto, pendiente de Paco). Después, cuando Paco avise:
release v1.2.0 → repo público → npm publish. La promoción (awesome-quant, posts) va
mucho después, a su señal.

## 2026-08-02 (sesión 4, continuación) — Batería de pruebas de Paco + pausa larga

### Qué se hizo

- **Commits**: `0216498` (feat v1.2.0 dashboard+docs), `808cc90` (infografía SVG animada
  de arquitectura en README, estilo free-llm-api-hub), `5b687e5` (fix UX PowerShell).
- **Paco ejecutó la guía de pruebas completa** (7 pasos: rules, checks en vivo, fixtures
  trampa, dashboard interactivo, compare, gating con exit codes, batería automática).
  Resultado: todo correcto salvo 2 fallos con la **misma raíz**: PowerShell se traga las
  comas sin comillas (operador de array), así que `--files a.csv,b.csv` llegaba como
  `a.csv b.csv`. Fix: mensajes de error con la forma entrecomillada + aviso explícito de
  PowerShell, nota en README y docs/examples.md.
- **Falsa alarma aclarada**: `--fail-on warning --min-score 80` sobre AAPL devuelve exit 0
  correctamente (solo 1 finding info; para ver exit 1 hay que usar un fixture corrupto).
- **Decisión de Paco**: el repo se queda **PRIVADO y pausado** — se retomará más adelante.

### Aprendido (candidatos a 04-CONOCIMIENTO)

- **PowerShell es un entorno de pruebas obligatorio** para cualquier CLI: la coma sin
  comillas es operador de array y mutila flags tipo `--files a,b` / `--providers a,b`.
  Defensa: mensajes de error que muestren la forma entrecomillada.
- `--virtual-time-budget=3000` en Chrome headless para capturar SVGs con CSS animations
  escalonadas (sin él, el screenshot sale en el frame 0 con los elementos a opacity 0).
- Screenshot de README mejor desde fixture que desde dato vivo: estable y coherente con
  la narrativa (MOB.ST en vivo ya no muestra el split de 2023).

### Estado al pausar

- `main`: 3 commits por encima de v1.1.0 → próximo release **v1.2.0** (changeset
  `.changeset/dashboard-v2.md` listo). 331 tests verdes, lint/typecheck/build verdes.
- Repo **privado**. npm **sin publicar**. PR awesome-quant **cerrada** (rama viva en fork).
- Al retomar: release v1.2.0 → repo público → npm publish → (mucho después, a señal de
  Paco) promoción. Checklist: `docs/maintainer/lanzamiento-checklist.md`.

### 2026-08-02 (noche) — auditoría de estado previa a posible salida; Paco decide seguir en pausa

Kimi auditó el estado real de salida antes de proponer relanzar (los registros del hub estaban
desactualizados). Verificado hoy en esta máquina:

- **331/331 tests** (corrida local) · **CI en verde desde 2026-07-31** (zizmor + CI + CodeQL —
  el "CI rojo" del registro anterior estaba obsoleto) · árbol limpio en `cef9500`.
- **Nombre `market-data-sanity-checker` libre en npm** (404 a 2026-08-02).
- v1.1.0 documentada + v1.2.0-dev commiteada (`0216498`, changeset `dashboard-v2.md` minor
  pendiente de consumir).
- Checklist de lanzamiento completa y vigente; PR awesome-quant preparada (rama viva en fork).
- Sin auth de npm en el entorno (`ENEEDAUTH`): el token/login es de Paco.

**Decisión de Paco (2026-08-02, noche): seguir en pausa, para más adelante.** Sin fecha; al
retomar, la secuencia sigue siendo: release v1.2.0 → repo público → npm publish → promoción a
su señal.

## 2026-08-09 (sesión 5) — Release v1.2.0 preparada + CI endurecido; publicación bloqueada solo por el token npm

### Qué se hizo

Commits en `main` (todos empujados y validados, head `c29d2fe`):

- `2af84bd` **release v1.2.0**: changeset `dashboard-v2.md` consumido, CHANGELOG (entrada
  byte-idéntica al changeset), bump 1.1.0 → 1.2.0. Tarball validado a fondo: 11 archivos,
  sin secretos ni rutas absolutas, `--version` → 1.2.0, instalación E2E como consumidor
  (CLI + SDK + `--html`) OK.
- `8be809b` **typedoc reproducible**: devDependency `^0.28.20` + lockfile; eliminado el
  `pnpm add -D typedoc` de `docs.yml`; `docs/api/` a `.gitignore`. Sin cambios de versiones
  en el lockfile (solo aditivo).
- `d518bd5` **fix provenance**: `NPM_CONFIG_PROVENANCE` → `PNPM_CONFIG_PROVENANCE` (ver
  Aprendido).
- `145203e` **BOMs UTF-8** fuera de `docs.yml`, `typedoc.json`, `README.md` (byte-exacto,
  sin tocar line-endings). `GOVERNANCE.md` sigue con BOM (pendiente menor).
- `0c12afd` **permisos Pages acotados**: `pages: write` + `id-token: write` movidos del
  workflow al job `deploy` (único que los necesita; least privilege). Deploy verificado.
- `cddfd68` **zizmor pineado** `version: 1.28.0` (ver Aprendido).
- `5b06d14` **gate humano**: job de release vinculado al environment `release` (required
  reviewer = pacocartones, `prevent_self_review: false`, branch policy protegida,
  `can_admins_bypass: true` — configurado vía API y verificado).
- `e1073af` **concurrency** con `cancel-in-progress` en ci/codeql/scoreboard/zizmor
  (grupo `workflow-ref-event_name`; release sin cancel a propósito).
- `f4c1a95` + `c80e024` **anotaciones artipacked**: el primer intento (comentarios encima
  de `- uses:`) era **inerte** (fuera del span del finding); fix moviéndolos dentro del
  step. Verificado con la persona `auditor`: artipacked 2 → 0.
- `1a0da89` indentación de `typedoc` en package.json (24 → 28, alineada).
- `c29d2fe` `docs/agents/issue-tracker.md` (spec source para el skill code-review).
- Checklist actualizado: sección 1.1 con la configuración reproducible del environment
  `release` + advertencia de plan.

Además: ramas `fix/dependabot-alerts` (local y remota) borradas tras verificar que su
contenido está íntegro en main (squash de la PR #7); auditoría de los **26 findings
suprimidos** de zizmor (persona `auditor`): ninguno crítico, dos merecen decisión
(environment de release — resuelto en `5b06d14` — y concurrency — resuelto en `e1073af`).

### Decisiones relevantes (y por qué)

- **Publicación vía GitHub Actions con provenance** (Opción A del checklist), no local:
  requiere el token npm del propietario; todo lo demás está listo.
- **`prevent_self_review: false`** en el environment: en un repo de un solo propietario,
  quien empuja debe poder aprobar su propio run; activarlo bloquearía la publicación.
- **`NPM_TOKEN` como environment secret** acotado a `release` — un secret de repo
  sortearía el gate (documentado en el checklist).
- **`release.yml` sin `cancel-in-progress`** a propósito: cancelar un publish a medias es
  más peligroso que dejarlo encolado.
- **Comentarios de zizmor dentro del span del finding** (ver Aprendido) — la posición
  correcta es dentro del nodo del step, no encima del `- uses:`.

### Estado final verificado

Head `c29d2fe` en `origin/main`: **CI (331 tests, lint, typecheck, build, ubuntu/windows ×
node 22/24) ✅ · CodeQL ✅ · Deploy API Docs ✅ · zizmor ✅ · Release ⏭️ skipped** (esperado:
publicación desactivada). Árbol local limpio. Sin PRs abiertos (los 2 relevantes, #6 y #7,
merged; los 5 de dependabot de actions, cerrados por decisión previa).

### Aprendido (candidatos a 04-CONOCIMIENTO)

- **pnpm 11 ignora `NPM_CONFIG_*` y lee `PNPM_CONFIG_*`** (verificado localmente:
  `PNPM_CONFIG_PROVENANCE=true` → `provenance = true`; `NPM_CONFIG_PROVENANCE` → sin
  efecto). En workflows con pnpm, las env de config van con el prefijo `PNPM_CONFIG_`.
- **zizmor**: los comentarios `# zizmor: ignore[...]` solo se honran **dentro del span del
  finding** (el nodo completo del step: `- uses:` + `with:`); encima del `- uses:` son
  inertes. Los suprimidos de la persona `regular` no se emiten en ningún formato — usar
  `--persona=auditor --format=json` para enumerarlos (campo `ignored`).
- **zizmor-action**: su `latest` no es libre — usa imágenes digest-pinned vía
  `support/versions`; al pinear, usar una versión existente en ese archivo y subir la
  action antes de saltar de versión.
- **Un BOM UTF-8 puede enmascarar el parseo de zizmor**: con BOM no reconocía el bloque
  `permissions` de docs.yml (por eso el head anterior "pasaba"); al quitarlo salió un
  finding legítimo de permisos.
- **Concurrency en GH Actions**: incluir `github.event_name` en el grupo para que un push
  no cancele runs programados (cron) ni dispatches manuales.
- **GitHub: required reviewers en repos privados es exclusivo de Enterprise**; en
  Free/Pro/Team la regla se configura vía API pero GitHub no pausa el job. Verificar en
  el primer publish real que el run aparezca como *Waiting for approval*.
- **API de environments**: `PUT /repos/{o}/{r}/environments/{env}` usa body con
  `reviewers`/`prevent_self_review`/`deployment_branch_policy`/`can_admins_bypass`
  (`protection_rules` es solo de respuesta).

### Siguiente paso

Único bloqueante: **el token npm** (granular, scope publish). Al tenerlo:
`gh secret set NPM_TOKEN --env release` + `gh variable set NPM_PUBLISH_ENABLED --body true`
→ push → aprobar el job en Actions → verificar `npm view market-data-sanity-checker
version` (1.2.0) y la attestation (`dist.attestations`). Luego: repo público (paso 0) y
promoción a señal de Paco. Checklist: `docs/maintainer/lanzamiento-checklist.md`.

## 2026-08-11 — Estrategia/OKR creada en `_docs/` (estándar del workspace)

- El sistema `01. ESTRATEGIA / OKR + OKF` que citaba el plan de acción **no existía**; la
  auditoría del workspace (2026-08-11) lo resolvió creando
  `_docs/market-data-sanity-checker/01-estrategia.md` (norte/método + OKR O1–O3 con estado) y
  `00-dossier.md`. Las referencias del plan se actualizaron para apuntar ahí (workspace
  local, no enlazable desde GitHub).
- El repo pasa a formar parte del estándar `_docs/` del workspace (ver `_docs/README.md` —
  workspace local): su plan y esta bitácora siguen viviendo aquí (public by design) y quedan
  declarados como excepción in-repo en el validador.

---

## 2026-08-11 — Scoreboard vía PR + release v1.2.0

- **Scoreboard a entrega vía PR** (`scoreboard.yml`, commit `435c7a9`): el push directo con
  `git-auto-commit` + `[skip ci]` fallaba con GH006 ("2 of 2 required status checks are
  expected") desde el primer run programado (08-10) — la auditoría semanal se perdía. Ahora el
  drift se empuja a `bot/scoreboard` y se entrega como PR (`gh pr view` con filtro de estado;
  warning accionable si Actions no puede crear PRs). zizmor audita el workflow nuevo (pasó vía
  los runs de los PRs de Dependabot, que auditan los workflows de main).
- **Verificación con run real** (dispatch 31498123296): auditoría semanal generada → rama
  `bot/scoreboard` (`3a6f36c`, 4 ficheros) empujada con el contenido real y solo falló en crear
  el PR por el permiso de Actions — acción del owner.
- **Release v1.2.0** (tag anotado + release GitHub, 2026-08-11): **primer tag/release real del
  repo** (antes la memoria afirmaba releases que no existían). El checklist de lanzamiento
  corrige el estado: el repo es **PÚBLICO** (verificado por API).
- **Fallo transitorio de GitHub** (13:41–13:42Z): algunos push/PR events no generaban runs
  (los de Dependabot/PR/dispatch sí); se resolvió solo — los runs de push de `435c7a9`/`af3d6b6`
  no existen; cobertura vía PRs de Dependabot y próximos push/PR.
- **Pendiente del owner:** activar "Allow GitHub Actions to create and approve pull requests" o
  crear `GH_PAT` en ESTE repo también — la rama `bot/scoreboard` queda lista para mergear
  manualmente hasta entonces (ver handoff, sección 0).

### Checklist de fin de sesión (aplicado el 2026-08-11)

| Casilla | Resultado | Evidencia |
|---|---|---|
| ¿Algo me sorprendió/rompió? | ✅ Sí | el scoreboard caía con GH006 desde el 08-10 sin que la memoria lo registrara; el fallo transitorio de GitHub (push events sin runs, 13:41–13:42Z) — se resolvió solo |
| ¿Ejecuté acciones públicas? | ✅ Sí | un solo hilo con control: pushes a main (`435c7a9`, `af3d6b6`, `9b55b39`), tag + release v1.2.0, dispatch de prueba; nada desde agentes paralelos |
| ¿Trabajé en un repo? | ✅ Sí | mdsc (scoreboard, release, checklist de lanzamiento) — en la misma sesión que free-llm-api-hub y marketing-agency |
| ¿Escribí una nota de sesión del maintainer? | ⏭️ No aplica | sin sesión nueva; la regla del estándar `_docs/` (06-sesiones) se aplicó en marketing-agency |
| ¿Hubo actividad externa? | ⏭️ Sin cambios | 0 PRs/issues externos (repo recién público; lanzamiento completo a señal de Paco) |
| ¿Usé enjambres? | ⏭️ No aplica | todo en el hilo principal |
| ¿Probé bot/workflow con datos? | ✅ Sí, drift deliberado | dispatch `31498123296` del scoreboard refactorizado: auditoría semanal real → `bot/scoreboard` (`3a6f36c`); nunca datos reales |
| ¿Workflows con push directo + `[skip ci]`? | ✅ Detectado y corregido | `scoreboard.yml` a entrega vía PR (`435c7a9`); zizmor audita el workflow nuevo (pasó); LEARNINGS Transversal + casilla |
| ¿Concluí "no hay API para X"? | ⏭️ No aplica | sin conclusión negativa hoy |
| ¿Queda pendiente operativo? | ✅ Sí | `npm publish` (KR1.2), clave Alpha Vantage (KR3.3), PR a awesome-quant (KR2.1), activar el ajuste de PRs de Actions en este repo |
| ¿Audité la coherencia docs-memoria? | ✅ Sí | la auditoría del workspace destapó releases inexistentes → release v1.2.0 real creada; checklist de lanzamiento corregido (repo PÚBLICO) |
| ¿Ejecuté `node check-learnings.mjs`? | ✅ Sí | exit 0 al cierre (este repo declarado como excepción in-repo en el validador) |
| ¿Dejé el handoff de retoma? | ✅ Sí | `_docs/SESION-CIERRE-2026-08-11.md` — sección 0 incluye ESTE repo en el pendiente del owner |
| ¿Apliqué este checklist? | ✅ Sí | esta tabla |

---

## Registro de contribuidores externos

> Este repo aún **no tiene contribuidores externos** — es la métrica del OKR
> **KR2.2** del [plan de acción](plan-de-accion.md) (*PRs externas recibidas — 0 → ≥1*)
> y la validación de la rama B del proyecto. La tabla resumen de todos los repos (con el
> checklist de bienvenida y la plantilla de entrada) vive en `0. README.md` — sección
> *Registro de contribuidores externos* (workspace local). Este registro es el detalle por
> repo; ambos deben mantenerse en sync.
>
> _Sin entradas todavía. Cuando llegue la primera (issue o PR externa), registrar aquí_:
> handle, PR/issue, cambio, verificación de cuenta real, bienvenida enviada y siguiente paso.
> Nota: el repo es **público desde 2026-08-11** (verificado por API) pero el lanzamiento
> completo (npm + promoción) sigue a señal de Paco — un contribuidor externo puede aparecer ya
> (KR2.2); el lanzamiento lo propiciará.

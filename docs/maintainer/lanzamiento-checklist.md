# Lanzamiento — checklist de salida (pendiente de completar)

> **Estado: ✅ ACTIVA (2026-08-09) — v1.2.0 preparada y validada; publicación en npm
> bloqueada solo por el token.** Release v1.2.0 lista en `main` (changeset consumido,
> CHANGELOG, tarball validado: 11 archivos, sin secretos, E2E como consumidor OK). CI
> endurecido: zizmor pineado 1.28.0 y verde, gate humano (environment `release`, ver 1.1),
> concurrency, permisos acotados. **Lo único que falta para publicar**: `NPM_TOKEN` como
> environment secret de `release` + variable `NPM_PUBLISH_ENABLED=true` (paso 1). Repo
> **PÚBLICO desde 2026-08-11** (verificado en la auditoría del workspace; paso 0 completado —
> la PR a awesome-quant y los posts siguen pendientes). La promoción (awesome-quant,
> posts r/algotrading y Show HN) va mucho después del lanzamiento, a señal de Paco. No
> retomar la PR #529 hasta entonces.
> Plan y OKR: [plan-de-accion](plan-de-accion.md) · Sesiones: [bitácora](bitacora.md).

## Hecho ✅

- [x] Pre-flight: 323 tests, lint/typecheck/build, lockfile, tarball npm (11 archivos, 134.8 kB), sin secretos
- [x] Metadata: description + 19 topics + Release v1.1.0 con notas
- [x] Assets: `docs/assets/dashboard-mob-st.png` (en README) y `docs/assets/social-preview.png`
- [x] Gobernanza: Dependabot (ya abrió PRs), zizmor ✓, CodeQL (auto-activa en público), release workflow listo
- [x] ~~Repo PÚBLICO~~ → **revertido a PRIVADO** (2026-07-31 ~23:55, pendiente prueba de Paco)
- [x] ~~PR a awesome-quant #529~~ → **cerrada temporalmente** con nota amable; reenviar la misma entrada al reabrir

## Pendiente (en este orden) ⏳

### 0. Repo público (completado 2026-08-11)

- ✅ Repo **público** (verificado con `gh api … .visibility == "public"` el 2026-08-11).
- ⏳ Reenviar PR a awesome-quant: la rama `pacocartones:add-market-data-sanity-checker`
  sigue viva en el fork; basta reabrir/recrear la PR con el mismo cuerpo (bitácora sesión 3).

```bash
# referencia del comando usado al abrirlo (si algún día hay que replicarlo):
gh repo edit --visibility public --accept-visibility-change-consequences
```

### 1. Publicar en npm (bloquea a los posts)

Opción A (recomendada, con provenance — requiere el environment `release`, ver 1.1):
```bash
# 1. Crear token granular publish en https://www.npmjs.com/settings/~/tokens
# 2. Registrarlo como SECRET DE ENVIRONMENT y activar el workflow:
gh secret set NPM_TOKEN --env release
gh variable set NPM_PUBLISH_ENABLED --body true
# 3. Push cualquier commit (o re-run del workflow Release) → el job se pausa
#    esperando tu aprobación (Actions → Review deployments) → publica v1.2.0
#    con attestation de provenance
```
Opción B (local): `npm login` en terminal (abre navegador) y luego `npm publish` desde el repo.

Verificación tras publicar:
```bash
npm view market-data-sanity-checker version   # debe decir 1.2.0
npx market-data-sanity-checker --version      # instala y corre
```

### 1.1. Configurar el environment `release` (gate humano)

El job de release va vinculado al environment `release` (`environment: release`
en `.github/workflows/release.yml`): con la publicación activa, el job **se
pausa** hasta que un reviewer requerido lo aprueba en la UI (Actions → Review
deployments). El secret `NPM_TOKEN` debe ser un **environment secret** acotado
a `release` — un secret a nivel de repo **sortea el gate** (el workflow lo lee
igual, pero sin protección de entorno).

**Estado actual (configurado 2026-08-09):**

| Regla | Valor |
|---|---|
| required_reviewers | `pacocartones` (id 253313177) |
| prevent_self_review | `false` — necesario: en un repo de un solo propietario, quien empuja debe poder aprobar su propio run |
| deployment_branch_policy | solo ramas protegidas (`protected_branches: true`) |
| can_admins_bypass | `true` (default de GitHub) |

Verificar en cualquier momento:
```bash
gh api repos/pacocartones/market-data-sanity-checker/environments/release \
  --jq '{rules: [.protection_rules[].type], policy: .deployment_branch_policy, bypass: .can_admins_bypass}'
```

**Reproducir** (si el repo se migra o el environment se borra):

Vía UI: Settings → Environments → `release` → *Required reviewers* +
*Deployment branches* (solo protegidas).

Vía API (id de pacocartones: `gh api user --jq .id`):
```bash
gh api --method PUT repos/pacocartones/market-data-sanity-checker/environments/release \
  --input - <<'EOF'
{
  "reviewers": [{"type": "User", "id": 253313177}],
  "prevent_self_review": false,
  "deployment_branch_policy": {"protected_branches": true, "custom_branch_policies": false},
  "can_admins_bypass": true
}
EOF
```

**⚠️ Limitación de plan:** GitHub documenta que las reglas *required reviewers*
solo se aplican en **repos públicos** en planes Free/Pro/Team; en repos privados
son exclusivas de **Enterprise**. En Free/Pro/Team la regla se configura pero el
job **puede no pausarse**. Al primer publish real, confirmar que el run aparece
como *Waiting for approval*; si no, el plan no soporta el gate en privado (el
publish saldría sin gate humano — el secret de entorno seguiría protegiendo el
token).

**Orden del primer publish con gate:**
1. `gh secret set NPM_TOKEN --env release` (pide el valor por stdin)
2. `gh variable set NPM_PUBLISH_ENABLED --body true`
3. Push a `main` → el job se pausa → aprobar en Actions → publish con provenance
4. Verificar attestation: `npm view market-data-sanity-checker dist.attestations`

### 2. Social preview (1 clic, solo web)

Settings → General → Social preview → subir `docs/assets/social-preview.png` (1280×640).

### 3. Posts de lanzamiento (con npm ya publicado)

**r/algotrading** — título:
> I audited 50 liquid symbols from Yahoo Finance with an open-source sanity checker — here's what real market data looks like

Cuerpo: trust layer (TypeScript, MIT), valida/puntúa/explica anomalías antes del backtest.
Hallazgos concretos: splits registrados como ratios 1907:2000 (spin-offs mal etiquetados),
factores de ajuste pre-ex-date estaleados, y el 2:1 que parece un crash de −50% (caso MOB.ST).
36 reglas con referencia a incidente real (Berkshire $185 2024, GBX/GBP ×100, ISIN ticker reuse).
Calibrado a 0 falsos críticos; scoreboard semanal público regenerado por CI. Link al repo.

**Show HN** — título:
> Show HN: I checked 50 symbols of market data; here's an open-source sanity checker for the ways they break

Primer comentario del autor: la historia de Berkshire a $185 y los $48M de IBKR → por qué
existe → 3 ejemplos con tickers → enlace npm + repo.

### 4. Seguimiento posterior

- [ ] Vigilar PR awesome-quant #529 (responder el mismo día si piden cambios)
- [ ] Tras 1 semana: registrar métricas en bitácora (estrellas, npm downloads, tráfico del scoreboard)
- [ ] Alpha Vantage free key como secreto → scoreboard comparativo multi-proveedor
- [x] Dependabot PRs: revisar/mergear las razonables — ✅ triage completo el 2026-08-11 (10 PRs: 6 mergeados, eslint 10 + codeql 4.37.6 aplicados en main, TS 6 cerrado por romper el build) — ver bitácora

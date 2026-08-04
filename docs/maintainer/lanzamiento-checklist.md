# Lanzamiento — checklist de salida (pendiente de completar)

> **Estado: ⏸️ PAUSA LARGA por decisión de Paco (2026-08-02) — repo PRIVADO; se retomará
> más adelante.** Todo el trabajo queda commiteado en `main`: v1.2.0-dev lista
> (dashboard v2 interactivo, onboarding, infografía, fix UX PowerShell; changeset en
> `.changeset/dashboard-v2.md`). **Al retomar**: release v1.2.0 → hacer público (paso 0) →
> publicar en npm (paso 1). La promoción (awesome-quant, posts r/algotrading y Show HN)
> va mucho después del lanzamiento, a señal de Paco. No retomar la PR #529 hasta entonces.
> Plan y OKR: [plan-de-accion](plan-de-accion.md) · Sesiones: [bitácora](bitacora.md).

## Hecho ✅

- [x] Pre-flight: 323 tests, lint/typecheck/build, lockfile, tarball npm (11 archivos, 134.8 kB), sin secretos
- [x] Metadata: description + 19 topics + Release v1.1.0 con notas
- [x] Assets: `docs/assets/dashboard-mob-st.png` (en README) y `docs/assets/social-preview.png`
- [x] Gobernanza: Dependabot (ya abrió PRs), zizmor ✓, CodeQL (auto-activa en público), release workflow listo
- [x] ~~Repo PÚBLICO~~ → **revertido a PRIVADO** (2026-07-31 ~23:55, pendiente prueba de Paco)
- [x] ~~PR a awesome-quant #529~~ → **cerrada temporalmente** con nota amable; reenviar la misma entrada al reabrir

## Pendiente (en este orden) ⏳

### 0. Re-abrir (tras la prueba de Paco)

```bash
gh repo edit --visibility public --accept-visibility-change-consequences
# Reenviar PR a awesome-quant: la rama pacocartones:add-market-data-sanity-checker
# sigue viva en el fork; basta reabrir/recrear la PR con el mismo cuerpo (bitácora sesión 3).
```

### 1. Publicar en npm (bloquea a los posts)

Opción A (recomendada, con provenance):
```bash
# 1. Crear token granular publish en https://www.npmjs.com/settings/~/tokens
# 2. Registrarlo y activar el workflow:
gh secret set NPM_TOKEN
gh variable set NPM_PUBLISH_ENABLED --body true
# 3. Push cualquier commit (o re-run del workflow Release) → publica v1.1.0 con attestation
```
Opción B (local): `npm login` en terminal (abre navegador) y luego `npm publish` desde el repo.

Verificación tras publicar:
```bash
npm view market-data-sanity-checker version   # debe decir 1.1.0
npx market-data-sanity-checker --version      # instala y corre
```

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
- [ ] Dependabot PRs: revisar/mergear las razonables

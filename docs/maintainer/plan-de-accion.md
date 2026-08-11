# market-data-sanity-checker — Plan de acción

> Maintainer's working log — public by design (Spanish).
> Estrategia / OKR + OKF del propietario: `_docs/market-data-sanity-checker/01-estrategia.md`
> (workspace local, no enlazable desde GitHub).
> La documentación pública del proyecto está en `README.md` y `docs/` (inglés).
> Bitácora de sesiones: [bitácora](bitacora.md).

## Qué es (una frase)

Trust layer OSS para datos de mercado: valida, puntúa (`sanity_score` 0–100) y explica
anomalías en OHLCV, dividendos, splits, fundamentals y metadata **antes** de que
contaminen un screener/dashboard/tracker. TypeScript, CLI + SDK, cero falsos positivos
como principio de diseño. Repo: github.com/pacocartones/market-data-sanity-checker
(privado hasta lanzamiento).

## Estado (2026-07-31)

**v1.0.0 lista.** Plan de 4 fases ejecutado completo en el día 2026-07-31:

| Fase | Entregable | Evidencia |
|---|---|---|
| 0 — Fundaciones | schema Zod, ingestion CSV/JSON, scoring, CLI, CI | commit inicial, CI verde |
| 1 — OHLCV | 12 reglas + engine + per-rule config | v0.1.0, 82 tests |
| 2 — Corporate + fundamentals + metadata | 13 reglas + identifiers (ISIN checksum) + golden tests | v0.2.0, 146 tests |
| 3 — Multi-source | conectores (Yahoo, Alpha Vantage) + compare engine + scoreboard + calibración real | v0.3.0, 197 tests |
| 4 — Plataforma | mdsc.config.json, alertas CI (`--fail-on`/`--min-score`), audit history, dashboard HTML, OKF datapackage | v1.0.0, 223 tests |

Hitos verificados con datos reales: calibración de 50 tickers Yahoo (0 críticos; 3
refinamientos de umbrales aplicados y documentados en `calibration/latest.json`);
scoreboard semanal automatizado (`scoreboard/` + GitHub Action lunes 05:23 UTC);
verdadero positivo estrella: el "split" 1907:2000 de HON (spin-off mal codificado).

## OKR del repo (ciclo 2026-07-31 → 2026-10-31)

> Alineado con la estrategia del workspace (`_docs/market-data-sanity-checker/01-estrategia.md`).
> Convención: 0.7 = bien. Anti-vanidad:
> miden causa (uso, contribución, auditoría operativa), no estrellas.

### O1 · Publicar la v1.0.0 con lanzamiento que demuestre la tesis

| KR | Baseline | Target | Fuente de dato |
|---|---|---|---|
| KR1.1 — v1.0.0 en GitHub con CI verde y CHANGELOG | ✅ 2026-07-31 | hecho | releases de GitHub |
| KR1.2 — Repo público + paquete en npm | privado / sin publicar | publicados | npm `market-data-sanity-checker` |
| KR1.3 — Calibración de 50 tickers con 0 falsos críticos | ✅ 2026-07-31 | re-ejecutar cada minor release | `calibration/latest.json` |
| KR1.4 — Post de lanzamiento con hallazgos reales (r/algotrading) | sin publicar | ≥1 post con datos del scoreboard | enlace + captura en bitácora |

### O2 · Ser infraestructura que otros builders usan y citan

| KR | Baseline | Target | Fuente |
|---|---|---|---|
| KR2.1 — Inclusión en awesome-lists del nicho | 0 | ≥ 2 (awesome-quant + 1) | PRs registradas en `contribuciones.csv` |
| KR2.2 — PRs externas recibidas (no issues: código) | 0 | ≥ 1 | `contribuciones.csv` nivel externo-inverso |
| KR2.3 — Descargas npm semanales (termómetro, no objetivo) | 0 | medido | npm stats (solo termómetro) |

### O3 · Auditoría continua operando sola

| KR | Baseline | Target | Fuente |
|---|---|---|---|
| KR3.1 — Scoreboard semanal regenerado por la Action | 1 run manual | ≥ 4 semanas consecutivas | `scoreboard/latest.csv` (datapackage OKF) |
| KR3.2 — `scoreboard/datapackage.json` válido Frictionless | ✅ 2026-07-31 | mantener | `scoreboard/datapackage.json` |
| KR3.3 — Segunda fuente activa en el scoreboard (Alpha Vantage key) | solo Yahoo | AV en el ranking + compare | `scoreboard/latest.json` comparisons |

## Próximos pasos (en orden)

1. **Decisión de Paco: lanzamiento público** — hacer el repo público, `npm publish`,
   PR a awesome-quant, post r/algotrading con los hallazgos reales (HON 1907:2000,
   calibración 50 tickers, scoreboard).
2. Registrar Alpha Vantage free key como secreto del repo → scoreboard comparativo.
3. Fase 4.5+ (solo si tracción): reglas custom en JS/TS (plugins de usuario), API hosted,
   más conectores (FMP, Finnhub, Polygon).

## Riesgos activos

- **Lanzamiento sin segundo proveedor**: el compare es la feature estrella pero con una
  sola fuente keyless el demo se queda cojo. Mitigación: Alpha Vantage free key (25 req/día
  bastan para la cesta semanal de 30 símbolos si se cachea).
- **Rate limits de Yahoo** en el scoreboard semanal: mitigado con delay 300 ms y cesta de
  30; si Yahoo endurece, el Action falla visible (mejor que datos mudos).
- **Poco glamuroso = poca tracción inicial**: aceptado; el activo es reputación de largo
  plazo (ver `01-estrategia.md` del workspace, sección norte/método).

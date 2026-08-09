# Issue tracker — workflow para resolver referencias de issues desde commits

Documento de referencia para agentes. Cuando una revisión necesita la **spec de
origen** de un cambio (p. ej. el eje Spec del skill `code-review`), este
workflow resuelve las referencias de issues que aparecen en los mensajes de
commit y obtiene el contenido de la issue.

## Repositorio: GitHub, `pacocartones/market-data-sanity-checker`

- El tracker es **GitHub Issues/PRs** (repo privado). `gh` está autenticado
  como `pacocartones` (propietario) — usar `gh` en vez de la API cruda.
- Convención de commits de este repo: prefijos conventional (`fix(ci):`,
  `chore(release):`, `ci:`, `style(...)`, `docs:`) y, salvo excepción, **sin
  referencias numéricas** en el mensaje. Cuando un cambio sí referencia una
  issue, la mención es `#N` en el asunto o el cuerpo (`Closes #N`, `fixes #N`).
- Los cambios de release/CI se rigen por **changesets** (`.changeset/*.md`) y
  por las notas de sesión en `docs/maintainer/bitacora.md` — ver paso 4.

## Paso 1 — Extraer las referencias del rango de commits

```bash
git log <fixed-point>..HEAD --format='%s%n%b%n---' | grep -oE '(Closes|closes|fixes|Fixes) #[0-9]+|#[0-9]+' | sort -u
```

Los merges de PR de GitHub añaden `(#NNN)` al asunto del merge commit — el
patrón `#[0-9]+` los captura también. Apuntar cada referencia: si `#N` es una
**issue** (`gh issue view`) o una **PR** (`gh pr view`), no asumir.

## Paso 2 — Resolver cada referencia

```bash
gh issue view 123 --json number,title,state,labels,body
gh pr view 123 --json number,title,state,body,mergedAt
```

Para una vista rápida en texto plano basta `gh issue view 123`. Si el repo
estuviera público y `gh` no estuviera disponible, la API equivalente es
`curl https://api.github.com/repos/pacocartones/market-data-sanity-checker/issues/123`
(con `-H "Authorization: Bearer $GH_TOKEN"` para repos privados).

## Paso 3 — Interpretar el resultado

- **La spec es el título + el cuerpo de la issue** (y, si la issue es una PR
  mergeada, el cuerpo de la PR). En el informe Spec, **citar la línea exacta**
  de la issue para cada hallazgo, no parafrasear.
- Estado de la issue: si está abierta, el cambio revisado puede ser trabajo en
  curso de esa issue (spec parcial); si está cerrada/mergeada, la spec está
  completa y el diff debe cubrirla entera.
- Labels pueden indicar la categoría (bug/feature/chore) pero no son spec.

## Paso 4 — Sin referencias en los commits

Orden de búsqueda, en este repo:

1. **Changeset**: `ls .changeset/*.md` — cada feature/release lleva un changeset
   que describe el cambio para el consumidor; es el artefacto spec más fiable
   cuando no hay issue. El changeset **aplicado** se refleja en `CHANGELOG.md`
   (mismo texto, byte a byte).
2. **Spec file**: archivos en `docs/`, `specs/` o `.scratch/` cuyo nombre
   coincida con la rama o la feature (p. ej. `docs/examples.md` documenta
   casos reales; `docs/maintainer/lanzamiento-checklist.md` es la spec del
   proceso de release).
3. **Bitácora**: `docs/maintainer/bitacora.md` — notas por sesión de qué se
   pidió y qué se hizo; útil para cambios de infraestructura/CI sin issue.
4. **Convenciones del repo**: `CONTRIBUTING.md` documenta el contrato de
   reglas (ID, severidad, referencia, fixture, explicación) — sirve de spec
   implícita para cambios de reglas.

Si nada de esto existe → el eje Spec reporta **"no spec available"** y evalúa
solo contra lo que el usuario pidió explícitamente (registrado en la
conversación), sin inventar requisitos.

## Notas

- No mutar nada: este workflow es de **lectura** (issues, PRs, archivos). No
  editar ni comentar en el tracker.
- GitLab (`!67`) no aplica: el repo es GitHub-only.
- Si `gh` no responde (auth caducada), reintentar con `gh auth refresh` antes
  de declarar la issue inaccesible.

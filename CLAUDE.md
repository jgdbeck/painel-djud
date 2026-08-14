# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static, build-free panel for prioritizing and tracking DJUD's data demands (judicialização de medicamentos). Five files loaded by plain `<link>` and `<script src>` — no npm, no bundler. UI, seed data, and copy are all pt-BR; keep new strings in Portuguese.

| File | Role |
|---|---|
| `index.html` | markup only |
| `app.css` | all styles |
| `config.js` | `CONFIG.SHEET_API` — the only file that differs between dev and production |
| `data.js` | `COORDS`, `PRIOS`, `COMPS`, `STATUS`, `PRIO_LABEL`, `SEED` |
| `app.js` | all logic |
| `apps-script/Codigo.gs` | versioned copy of the server that runs in Google Apps Script |

Scripts are **classic, not modules** — deliberately, so `file://` keeps working. Load order (`config` → `data` → `app`) matters.

## Running and testing

```bash
python3 -m http.server 8000      # serve the panel
cd test && npm install && npm test   # 79 assertions, jsdom
```

`test/smoke.js` loads the real page in jsdom and drives both modes; the sheet is stubbed via `fetch`, so it needs no network and no password. Node lives **only** in `test/` — never add a dependency, build step, or `type="module"` to the panel itself.

Since `const`/`let` at script top level are not `window` properties, the test injects a bridge object (`window.__t`) after the app scripts to reach internal state. Extend that bridge rather than exporting things from `app.js`.

`README.md` has the operational setup for the Google Sheet backend.

## Architecture

**Two runtime modes, switched by one constant.** `CONFIG.SHEET_API` drives `const LIVE = !!CONFIG.SHEET_API`:

- Empty → *modo demonstração*: `localStorage`, everyone can edit, "Reiniciar" restores `SEED`.
- A `/exec` URL → *conectado*: data lives in a Google Sheet. Reading is public; editing needs the shared password.

`localStore` and `sheetStore` implement the same interface and `const store = LIVE ? sheetStore : localStore` picks one. Add any new persistence operation to **both**.

**Store contract**: the store talks to storage and returns the canonical object; **the caller mutates `DATA` and then calls `store.persist()`**. `persist()` writes localStorage in demo mode and is a no-op in sheet mode. Getting this backwards is what caused the old create-doesn't-appear bug — `create()` returns the object carrying the server-generated id, and only the caller pushes it into `DATA`.

**Writes roll back.** `wireDrop` and `saveEdit` snapshot the previous value, apply optimistically, and restore it in `catch`. Keep that shape — without it a failed save leaves the screen showing data the sheet never received.

**Rendering** is imperative, no framework. `go(screen)` toggles `.hidden` and calls `refreshCurrent()`, which dispatches to `renderHomeSummary()` / `renderBoard()` / `renderDash()`. Everything is built with template strings, so **all user-supplied text must go through `esc()`** — that plus the enum/number coercion in `normalize()` is the entire XSS defense.

Board filters live in `F`, dashboard filters in the separate `FA`.

## The Apps Script API

One route, operation in the `action` field. Two platform limits shape it — violating either breaks the app in ways that look like unrelated CORS or parsing errors:

- **Apps Script cannot answer a CORS preflight.** Every POST must stay a *simple request*: `Content-Type: text/plain;charset=utf-8`, no extra headers. The password travels in the body precisely because an `Authorization` header would trigger the preflight.
- **Apps Script cannot set an HTTP status.** Responses are always 200; success lives in the body as `{ok:true, data}` / `{ok:false, error, code}`. `code:"auth"` makes the client drop the saved password and re-prompt.

Server-side: `id` must stay column A (`rowOf_` scans it), every write runs inside `LockService`, and `replaceAll_` refuses an empty list so a bad import can't wipe the sheet.

## Data model

`normalize()` is the funnel for everything entering `DATA` — seed, sheet rows, imported JSON. It applies defaults **and coerces types**, which is load-bearing: Sheets returns `prio` `"1"` as the number `1`, and a numeric `id` would break every `===` comparison.

`COORDS` is the source of truth for coordinations: `full` is stored, `short` displayed, `dot` colors the section, and **array order drives section order and `coordRank()` sorting**. `prioRank()` derives from `PRIOS` order.

Enums live in `data.js` **only**. `<option>` lists are generated in `fillSelects()`, and CSS matches the raw value via attribute selectors (`[data-comp="Muito alta"]`, `[data-status="Não iniciada"]`). Adding an enum value means editing `data.js` plus one CSS rule — no hidden third copy.

## Gotchas

- `SEED` is the demo-mode starting point only. In connected mode it is never read; editing it does nothing to the sheet.
- Changing `Codigo.gs` requires publishing a **new version of the existing deployment**, not a new deployment — a new one gets a different URL and silently orphans `config.js`.
- localStorage keys: `djud_demandas_v3` (demo data), `djud_pass` (edit password).

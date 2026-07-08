# AI CSV Importer — GrowEasy CRM

Upload a lead export in **any** column layout. An LLM works out what each column means, extracts every row into the GrowEasy CRM schema, and tells you exactly what it did and why.

> **Submission** · GrowEasy Software Developer assignment
> **Position applied for:** **Software Developer Intern**
> **Live app:** _(deploying — Vercel URL)_ · **API:** _(deploying — Render URL)_
> **Repository:** <https://github.com/ydv-sahil/AI-powered-CSV-Importer>

---

## The actual problem

Parsing CSV is trivial. The hard part is that `Full Name`, `Client Name`, `Person`, and `lead_name` are all the `name` column — and `Contact` might be a phone number, an email address, or a person, depending on the file.

This project treats that as a **two-phase** problem, and that split is the core design decision:

| Phase | Runs | Sees | Decides |
|---|---|---|---|
| **1. Field mapping** | Once per file | Headers + 8 rows sampled across the file | What each column *means* |
| **2. Extraction** | Once per batch of 25 rows | Those rows + the mapping from phase 1 | What each *value* is |

Semantics is a whole-file question — you cannot tell whether `Contact` holds a name or a number by staring at one row. Values are a per-row question. Separating them means the expensive reasoning happens once, each batch prompt stays small, and batches stay independent — so they parallelise and retry cleanly.

Phase 1 is also **non-fatal**: if it fails, extraction proceeds with no mapping hint and infers field-by-field. Worse output, but still output.

### Trust, don't just prompt

Every rule in the brief is stated in the prompt **and enforced in code**:

| Rule | Prompt | Enforced in |
|---|---|---|
| `crm_status` ∈ 4 values | ✅ | [`normalize.ts`](backend/src/domain/normalize.ts) — clamps, and maps ~30 synonyms (`Hot` → `GOOD_LEAD_FOLLOW_UP`) |
| `data_source` ∈ 5 values | ✅ | `normalizeDataSource` — anything else becomes `""` |
| `new Date(created_at)` parses | ✅ | [`dates.ts`](backend/src/domain/dates.ts) — day-first, Excel serials, Unix ts, `May 13, 2026` |
| First email/mobile wins, rest → `crm_note` | ✅ | `normalizeRecord` |
| One record = one CSV row | ✅ | `escapeForCsvCell` — real newlines become `\n` |
| Skip rows with no email **and** no mobile | ✅ | `normalizeRecord` returns `{ ok: false }` |

A model that hallucinates `crm_status: "HOT"`, returns three emails in one cell, or writes a literal newline **cannot** corrupt the output. The worst it can do is lose information into `crm_note` — where it's still visible.

### Nothing disappears

Every input row ends in exactly one of `records` or `skipped`, with a reason. Rows are matched to model output by an echoed `__row` index, **never by array position** — so a model that returns 24 records for a 25-row batch loses one row instead of silently shifting every subsequent record onto the wrong lead.

A batch that exhausts its retries doesn't vanish either: its rows are reported as skipped, with the error attached.

---

## Screens

**Upload** → drag & drop or file picker.
**Preview** → the CSV parsed **in the browser**, before any AI runs (no tokens spent).
**Confirm** → the only button that calls the backend.
**Result** → imported records, skipped rows with reasons, totals, and the AI's column mapping with per-column confidence.

The mapping panel is the difference between *"the import worked"* and *"I trust the import"* — a user who sees `Reach → email (medium)` catches a bad mapping before it reaches their CRM.

---

## Quick start

**Prerequisites:** Node 18.17+ and a Gemini API key ([free, no credit card](https://aistudio.google.com/apikey)).

```bash
git clone https://github.com/ydv-sahil/AI-powered-CSV-Importer.git
cd AI-powered-CSV-Importer

# 1. Backend
cd backend
npm install
cp .env.example .env        # then paste your key into GEMINI_API_KEY
npm run dev                 # → http://localhost:4000

# 2. Frontend (new terminal)
cd frontend
npm install
cp .env.example .env.local  # defaults to http://localhost:4000
npm run dev                 # → http://localhost:3000
```

Open <http://localhost:3000> and drop in a file from [`samples/`](samples/).

### No API key? Run the whole thing anyway

```bash
# backend/.env
LLM_PROVIDER=mock
```

A deterministic header-matching stub replaces the model. The full pipeline — batching, retries, validation, SSE progress — runs unchanged. Useful for frontend work and for the test suite.

### Docker

```bash
echo "GEMINI_API_KEY=your-key-here" > .env
docker compose up --build
```

---

## Try it on something messy

[`samples/`](samples/) has three files, each built to break a naive importer:

| File | What it tests |
|---|---|
| `facebook-lead-export.csv` | Real FB Lead Ads shape — `full_name`, `phone_number`, `created_time`, ad metadata. One row has no contact details at all (must be **skipped**). |
| `realestate-crm-messy.csv` | Two emails in one cell, two phones in one cell, an **Excel serial date** (`45790`), a real newline inside a quoted note, `Closed Won`/`Junk`/`Hot` statuses, a walk-in with no contact info, and an email sitting in the `Alternate Contact` column. |
| `ambiguous-columns.csv` | The hard one. Headers are `Ref, Person, Reach, Org, Where, Owner, When, Note`. **`Reach` holds an email on some rows and a phone number on others** — no whole-file mapping can be right, so extraction has to place each value per-row. `Where` holds `"Kochi, Kerala"` (city + state in one cell). |

---

## API

Base URL: `http://localhost:4000`

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/api/health` | — | Status, active model, configured limits |
| `GET` | `/api/schema` | — | CRM fields + allowed enum values |
| `POST` | `/api/import` | `multipart/form-data`, field `file` | `ImportResult` JSON |
| `POST` | `/api/import/stream` | `multipart/form-data`, field `file` | `text/event-stream` of progress events |
| `POST` | `/api/export` | `{ records, filename? }` | `text/csv` download |

```bash
curl -F "file=@samples/realestate-crm-messy.csv" http://localhost:4000/api/import | jq
```

**Response**

```jsonc
{
  "records": [ /* CrmRecord[] — all 15 fields, always strings */ ],
  "skipped": [
    { "rowNumber": 5, "reason": "No email or mobile number found", "raw": { /* the original row */ } }
  ],
  "summary": { "totalRows": 7, "totalImported": 6, "totalSkipped": 1, "failedBatches": 0 },
  "fieldMapping": {
    "entries": [
      { "sourceColumn": "Client Name", "crmField": "name", "confidence": "high", "reason": "…" }
    ],
    "unmappedColumns": ["Sr No", "Budget", "Loan Required"]
  }
}
```

### Why SSE, not WebSockets

The channel is one-way. SSE is plain HTTP, so it survives every proxy and PaaS ingress untouched, and there's no connection lifecycle to manage.

`EventSource` can only issue a `GET`, and we need to `POST` a multipart file — so [`api.ts`](frontend/src/lib/api.ts) reads the response body and parses the (very small) SSE framing by hand, yielding events from an async generator.

Events: `parsed` → `mapping` → `batch`×N (with `retry` interleaved) → `done` | `error`.

---

## Architecture

```
backend/src/
├── domain/          # The CRM contract. No I/O, no framework, 100% unit-tested.
│   ├── crm.ts       #   Field list, enums, Zod schemas — the single source of truth
│   ├── normalize.ts #   Enforces every AI Instruction rule in code
│   └── dates.ts     #   Anything date-ish → "YYYY-MM-DD HH:mm:ss"
├── services/
│   ├── csv.service.ts        # Buffer → rows. BOM, ragged rows, duplicate headers
│   ├── extraction.service.ts # Batching, concurrency, retry, __row alignment
│   ├── export.service.ts     # Records → RFC 4180 CSV
│   └── llm/
│       ├── types.ts          # ← the seam. Everything above is provider-agnostic
│       ├── prompts.ts        # ← the actual product
│       ├── gemini.provider.ts
│       └── mock.provider.ts
├── controllers/     # HTTP in, HTTP out. No business logic.
├── middleware/      # Upload, errors. One error shape for the whole API.
└── utils/           # retry + backoff, bounded concurrency, LLM-JSON recovery
```

Dependencies point inward: `controllers → services → domain`. `domain/` imports nothing but Zod, which is why it's the easiest part to test and the part most likely to survive a rewrite.

Swapping Gemini for OpenAI or Claude is **one new file** implementing `LlmProvider` plus one case in the factory. Nothing else knows which model is answering.

### Things that took the most thought

- **`utils/json.ts`** — models truncate mid-object at the token ceiling. Rather than lose a whole batch, we walk the string (respecting escapes and string literals), find the last complete element, and close the brackets. A 25-row batch that got cut off at row 22 yields 22 rows, not zero.
- **Bounded concurrency + full-jitter backoff** — three batches in flight, capped for the Gemini free tier's 15 req/min. Without jitter, N parallel batches hit a 429 together and retry together, forever.
- **`FatalError` vs `RetryableError`** — a bad API key is retried zero times. A 429 is retried three.
- **Date ambiguity** — `05/06/2026` is read day-first (5 June), matching Indian CRM exports. `06/29/2026` flips automatically, because 29 cannot be a month. `31-02-2026` is rejected rather than silently rolled to 3 March, which is what `new Date()` does.
- **Virtualized table inside a real `<table>`** — two spacer rows instead of absolutely-positioned divs, so `<thead>` sticky positioning and screen-reader table semantics both survive. A 5,000-row import mounts ~20 rows.

---

## Tests

```bash
cd backend && npm test
```

55 unit tests over the parts where correctness is decidable:

- **`normalize.test.ts`** — the skip rule, first-email-wins, synonym clamping, newline escaping, null tolerance, hallucinated-key rejection
- **`dates.test.ts`** — every format, plus the property that output always satisfies `new Date(x)`
- **`csv.service.test.ts`** — BOM, quoted commas, embedded newlines, duplicate headers, ragged rows
- **`json.test.ts`** — markdown fences, prose preambles, braces inside strings, truncated responses

`config/env.ts` validates at import time, so `vitest.config.ts` sets `LLM_PROVIDER=mock` — the tests never need a key or a network.

---

## Deployment

**Backend → Render / Railway**

| Setting | Value |
|---|---|
| Root directory | `backend` |
| Build | `npm ci && npm run build` |
| Start | `npm start` |
| Env | `GEMINI_API_KEY`, `NODE_ENV=production`, `CORS_ORIGIN=https://your-app.vercel.app` |

**Frontend → Vercel**

| Setting | Value |
|---|---|
| Root directory | `frontend` |
| Env | `NEXT_PUBLIC_API_BASE_URL=https://your-backend.onrender.com` |

`NEXT_PUBLIC_*` is inlined at **build** time — set it before deploying, then redeploy if it changes.

> **Render free tier** spins down after 15 minutes idle; the first request takes ~30s. The frontend shows a `NETWORK_ERROR` panel with a retry rather than hanging.

---

## Configuration

All backend config is validated at boot ([`config/env.ts`](backend/src/config/env.ts)) — a missing key crashes the process with a readable message instead of surfacing as a 500 on the first upload of the day.

| Variable | Default | Notes |
|---|---|---|
| `LLM_PROVIDER` | `gemini` | `gemini` \| `mock` |
| `GEMINI_API_KEY` | — | Required unless `mock` |
| `GEMINI_MODEL` | `gemini-2.0-flash` | |
| `BATCH_SIZE` | `25` | Rows per LLM call |
| `BATCH_CONCURRENCY` | `3` | Tuned for the free tier's rate limit |
| `MAX_RETRIES` | `3` | Attempts per batch, including the first |
| `MAX_FILE_SIZE_BYTES` | `5242880` | 5 MB |
| `MAX_ROWS` | `5000` | |
| `CORS_ORIGIN` | `*` | Comma-separated list in production |

---

## Bonus checklist

| | |
|---|---|
| ✅ Drag & drop upload | ✅ Progress indicators during AI processing |
| ✅ Streaming / incremental parsing | ✅ Retry mechanism for failed AI batches |
| ✅ Virtualized table | ✅ Dark mode |
| ✅ Unit tests | ✅ Docker setup |
| ✅ Deployment-ready | ✅ This README |

Plus: server-sent progress events, per-column mapping confidence, CSV export of the result, a mock provider so the app runs with no API key, graceful shutdown, and a `/api/health` endpoint that reports the active model.

---

## Known limits

- **Stateless.** No database — a refresh loses the result. Deliberate: the brief says a DB is optional, and adding one buys nothing for a single-shot import.
- **5,000 rows / 5 MB.** Both are `env` vars. Beyond that you'd want a job queue and a polling endpoint, not a longer HTTP request.
- **Gemini free tier is 15 requests/minute.** A 5,000-row file is 200 batches ≈ 14 minutes wall-clock at the default concurrency. Raise `BATCH_CONCURRENCY` on a paid key.
- **`possession_time` is passed through as written** (`Dec 2027`, `Ready to move`) rather than normalized to a date, because "ready to move" isn't one.

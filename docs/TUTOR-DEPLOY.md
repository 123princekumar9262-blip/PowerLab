# "Ask a doubt" tutor — server-side Gemini on Vercel

The tutor's Gemini key now lives **only on the server**. The browser calls the lab's own endpoint
`POST /api/tutor` (file `api/tutor.ts`, a Vercel Function); the function reads the key at request time,
calls Gemini and streams the answer back. No key is in the JavaScript bundle — the build fails if one is
(`scripts/check-bundle-secrets.mjs`, run by `npm run build`).

## Request flow

```
browser (AskPanel)                         Vercel Function  api/tutor.ts                     Google Gemini
  POST /api/tutor                    ─▶   1. POST + JSON only, same-site Origin
  { context, messages }                    2. body ≤ 32 kB; shape, roles, lengths validated
  (no key, no model)                       3. rate limits: per client / minute + day, all / day
                                           4. builds the tutor instructions (server-side)
                                           5. fixed model, maxOutputTokens 900, 30 s timeout  ─▶  streamGenerateContent
  ◀─ text/event-stream  data: {"t": …}     6. re-streams the text only; fixed error texts      ◀─  (key in x-goog-api-key)
```

## Environment variables (Vercel → Project → Settings → Environment Variables)

| Name | Required | Value |
|---|---|---|
| `GEMINI_API_KEY` | **yes** | A **new** Gemini API key (Google AI Studio → Get API key). Server-side only. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | strongly recommended | Added automatically when you connect an Upstash Redis database (Vercel → Storage / Marketplace → Upstash for Redis, free plan). `KV_REST_API_URL` / `KV_REST_API_TOKEN` are accepted too. Without them, rate limits hold only within one warm function instance — **not** a global limit. |
| `TUTOR_DAILY_LIMIT` | optional | Questions per day for all students together (default 800). |
| `TUTOR_ALLOWED_ORIGINS` | optional | Extra sites allowed to call the tutor, comma-separated (e.g. a custom domain if it is served from a different host). The deployment's own host is always allowed. |

**Never** create `VITE_GEMINI_API_KEY` (or any `VITE_…` key): Vite copies `VITE_` variables into the
browser bundle. Delete it from Vercel if it exists.

### Steps

1. **Revoke the exposed key** in Google AI Studio / Google Cloud (it was in an earlier bundle and in a chat
   transcript) and **create a new one**. Optionally set a daily quota or budget alert on the Google project.
2. Vercel → your project → **Settings → Environment Variables**:
   - delete `VITE_GEMINI_API_KEY` if present (all environments);
   - add `GEMINI_API_KEY` = the new key, for **Production** (and **Preview** if preview deployments should
     answer too). Mark it **Sensitive**.
3. (Recommended) Vercel → **Storage** (or Marketplace) → **Upstash for Redis** → create and connect it to the
   project; this adds the `UPSTASH_REDIS_REST_*` variables.
4. **Redeploy** (Deployments → … → Redeploy, or push a commit): environment variables only take effect in a
   new deployment.
5. Check: open a lab → Ask → ask a question. The response header `x-tutor-ratelimit` should read `shared` once
   Redis is connected (`instance` without it).

## Local development

Put the key in `.env.local` as `GEMINI_API_KEY=…` (not `VITE_…`; the file is git-ignored). `npm run dev` and
`npm run preview` serve the same `/api/tutor` handler (vite.config.ts), reading the key in the Node process only.

## Remaining risks

- Without Upstash Redis the per-client and daily limits are per function instance only.
- Rate limiting is per IP address: students behind one school network share the per-client limit
  (8/minute, 60/day) — raise it in `api/tutor.ts` (`RATE`) if needed. There is no login, so a determined
  user can still spend up to the daily cap; the daily cap and a Google-side quota bound the cost.
- The Origin check stops other websites' pages, not scripts that call the endpoint directly; those are
  bounded by the rate limits.

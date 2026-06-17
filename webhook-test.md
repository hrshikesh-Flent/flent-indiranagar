# Flent Callback Webhook — Integration Test

## Env vars required

| Variable | Description |
|---|---|
| `FLENT_CALLBACK_SECRET` | Shared secret from Flent — set in Vercel project settings, never commit |
| `FLENT_WEBHOOK_URL` | Optional override; defaults to `https://demand-mweb.vercel.app/api/webhooks/callbacks` |

## Smoke-test with curl

Replace `YOUR_SECRET` with the value Flent sends you out-of-band.
Replace `YOUR_VERCEL_URL` with your deployed function URL (e.g. `https://flent-indiranagar.vercel.app`).

```bash
# ── Successful submission ────────────────────────────────────────────────────
curl -s -X POST https://YOUR_VERCEL_URL/api/submit-lead \
  -H "Content-Type: application/json" \
  -d '{
    "name":    "Asha Kumar",
    "phone":   "+919876543210",
    "email":   "asha@example.com",
    "type":    "room",
    "budget":  "30-35k",
    "movein":  "month",
    "area":    "indiranagar",
    "page_url": "https://hrshikesh-flent.github.io/flent-indiranagar/"
  }'

# Expected → { "success": true, "idempotency_key": "<uuid>" }
# Vercel log → { "event": "flent_callback_ok", "callback_id": "...", "deduplicated": false, "attempt": 1 }
```

```bash
# ── Deduplicated (re-send the same idempotency_key) ─────────────────────────
IDEM_KEY="<paste the uuid from the response above>"

curl -s -X POST https://YOUR_VERCEL_URL/api/submit-lead \
  -H "Content-Type: application/json" \
  -d "{
    \"name\":            \"Asha Kumar\",
    \"phone\":           \"+919876543210\",
    \"email\":           \"asha@example.com\",
    \"type\":            \"room\",
    \"budget\":          \"30-35k\",
    \"movein\":          \"month\",
    \"area\":            \"indiranagar\",
    \"idempotency_key\": \"$IDEM_KEY\",
    \"page_url\":        \"https://hrshikesh-flent.github.io/flent-indiranagar/\"
  }"

# Expected → { "success": true, "idempotency_key": "<same uuid>" }
# Vercel log → { "event": "flent_callback_ok", "callback_id": "...", "deduplicated": true, "attempt": 1 }
```

## Deploy steps

1. Push this repo to GitHub (already done).
2. Go to vercel.com → Add New Project → import `hrshikesh-Flent/flent-indiranagar`.
3. In project settings → Environment Variables, add `FLENT_CALLBACK_SECRET`.
4. Deploy. Vercel serves `index.html` as the static site and `api/submit-lead.js` as the serverless function.
5. Update the custom domain (or note the `.vercel.app` URL) — the `/api/submit-lead` call in `index.html` uses a relative path, so it works automatically.

## Retry behaviour

| Scenario | What happens |
|---|---|
| Flent returns 200 | Log `flent_callback_ok`, done |
| Flent returns 200 `deduplicated: true` | Log `flent_callback_ok` with `deduplicated: true`, done |
| Flent returns 400 / 401 | Log `flent_callback_fatal`, no retry |
| Flent returns 5xx | Retry after 2 s, then 6 s (2 retries max within 30 s function timeout) |
| All retries exhausted | Log `flent_callback_failed` with error for ops follow-up |

'use strict';

const { randomUUID } = require('crypto');

const ENDPOINT = process.env.FLENT_WEBHOOK_URL
  || 'https://demand-mweb.vercel.app/api/webhooks/callbacks';
const SECRET   = process.env.FLENT_CALLBACK_SECRET;

// Two quick retries within the 30 s serverless timeout.
// Full policy (30 s → 2 m → 10 m → 1 h → 6 h) requires a durable queue.
const RETRY_DELAYS_MS = [2000, 6000];

function log(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function normalizePhone(raw = '') {
  const digits = raw.replace(/\D/g, '');
  if (raw.trimStart().startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return `+${digits}`;
}

// "20-25k" → 20000, "150k+" → 150000
function budgetLower(range = '') {
  const m = range.match(/^(\d+)/);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  return n < 1000 ? n * 1000 : n;
}

async function postToFlent(payload, idempotencyKey) {
  let lastErr;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'X-Webhook-Secret':  SECRET,
          'X-Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8000),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        log({
          event:        'flent_callback_ok',
          callback_id:  data.callback_id,
          deduplicated: data.deduplicated ?? false,
          attempt:      attempt + 1,
          idempotency_key: idempotencyKey,
        });
        return;
      }

      // 400 / 401 — do not retry
      if (res.status === 400 || res.status === 401) {
        log({ event: 'flent_callback_fatal', status: res.status, error: data.error, idempotency_key: idempotencyKey });
        return;
      }

      lastErr = new Error(`HTTP ${res.status}: ${data.error ?? 'server error'}`);
    } catch (err) {
      lastErr = err;
    }

    if (attempt < RETRY_DELAYS_MS.length) {
      await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }

  log({ event: 'flent_callback_failed', error: lastErr?.message, idempotency_key: idempotencyKey });
}

module.exports = async function handler(req, res) {
  // Allow the GitHub Pages origin to call this function
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, phone, email, type, config, area, budget, movein, idempotency_key, page_url } = req.body ?? {};

  if (!name?.trim() || !phone?.trim()) {
    return res.status(400).json({ error: 'name and phone are required' });
  }

  const idempotencyKey   = idempotency_key || randomUUID();
  const normalizedPhone  = normalizePhone(phone);
  const livingPref       = type === 'room' ? 'Private Room' : type === 'full' ? 'Full Home' : undefined;

  if (!SECRET) {
    log({ event: 'flent_callback_skip', reason: 'FLENT_CALLBACK_SECRET not configured' });
    return res.status(200).json({ success: true, idempotency_key: idempotencyKey });
  }

  const notesParts = [
    livingPref && `Living preference: ${livingPref}`,
    config     && `Configuration: ${config}`,
  ].filter(Boolean);

  const flentPayload = {
    name:  name.trim(),
    phone: normalizedPhone,
    ...(email?.trim()  && { email: email.trim() }),
    location_preference: area || 'Indiranagar',
    ...(budget         && { budget: budgetLower(budget) }),
    ...(movein         && { move_in_date: movein }),
    source:        'sem_form',
    submitted_at:  new Date().toISOString(),
    utm_source:    'indiranagar landing page',
    page_url:      page_url || 'https://hrshikesh-flent.github.io/flent-indiranagar/',
    external_ref:  `indiranagar_lp_${idempotencyKey.slice(0, 8)}`,
    ...(notesParts.length && { requirement_notes: notesParts.join('. ') }),
  };

  await postToFlent(flentPayload, idempotencyKey);

  return res.status(200).json({ success: true, idempotency_key: idempotencyKey });
};

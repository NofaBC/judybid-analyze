// api/test-tango.js
// ⚠️  TEMPORARY DIAGNOSTIC ENDPOINT — DELETE BEFORE PRODUCTION IMPLEMENTATION ⚠️
//
// Calls the Tango (MakeGov) SLED opportunities endpoint and returns the raw schema.
// TANGO_API_KEY is sent in the X-API-KEY header — server-side only, never returned.
//
// Confirmed endpoint (Tango API 4.25.0, released 2026-09-10):
//   GET https://tango.dev/api/sled/opportunities/
//   Auth: X-API-KEY header (not Bearer, not query param)
//   Default: returns open solicitations only
//   Coverage: state, local, education (SLED) — Beta

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const apiKey = process.env.TANGO_API_KEY;

  if (!apiKey) {
    return res.status(503).json({
      _diagnostic: true,
      error: 'TANGO_API_KEY environment variable is not configured',
      hint: 'Add TANGO_API_KEY to Vercel → Project → Settings → Environment Variables',
    });
  }

  // Small, controlled diagnostic query
  // Default already returns open solicitations — no status param needed
  const params = new URLSearchParams({
    limit: '5',
    // jurisdiction=local|state|education  ← can narrow if needed
    // state=MD                            ← can narrow by state
  });

  const url = `https://tango.dev/api/sled/opportunities/?${params.toString()}`;

  let httpStatus, contentType, rawBody;

  try {
    const apiRes = await fetch(url, {
      headers: {
        'X-API-KEY': apiKey,     // Tango auth header — never returned to browser
        'Accept':    'application/json',
      },
    });

    httpStatus  = apiRes.status;
    contentType = apiRes.headers.get('content-type');
    const text  = await apiRes.text();

    try { rawBody = JSON.parse(text); }
    catch { rawBody = text; }

  } catch (e) {
    return res.status(200).json({
      _diagnostic:     'TEMPORARY — DELETE BEFORE PRODUCTION',
      _endpointCalled: url,
      networkError:    e.message,
    });
  }

  // ── Schema summary ──────────────────────────────────────────────────────────
  const topLevelFields = typeof rawBody === 'object' && rawBody !== null
    ? Object.keys(rawBody) : null;

  // Tango pagination uses results[] (standard DRF shape)
  const dataArray = rawBody?.results ?? rawBody?.data ?? null;
  const sampleRecord = Array.isArray(dataArray) ? (dataArray[0] ?? null) : null;
  const sampleFields = sampleRecord ? Object.keys(sampleRecord) : null;

  const pagination = {
    count:    rawBody?.count    ?? null,
    next:     rawBody?.next     ?? null,
    previous: rawBody?.previous ?? null,
    limit:    5,   // what we requested
  };

  res.status(200).json({
    _diagnostic:        'TEMPORARY — DELETE BEFORE PRODUCTION',
    _endpointCalled:     url,
    _httpStatus:         httpStatus,
    _contentType:        contentType,
    _topLevelFields:     topLevelFields,
    _dataArrayField:     dataArray !== null ? (rawBody?.results ? 'results' : 'data') : 'NOT FOUND',
    _recordCount:        Array.isArray(dataArray) ? dataArray.length : null,
    _sampleRecordFields: sampleFields,
    _pagination:         pagination,
    _sampleRecord:       sampleRecord,
    raw:                 rawBody,   // full unmodified response
  });
}

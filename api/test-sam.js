// api/test-sam.js
// ⚠️  TEMPORARY DIAGNOSTIC ENDPOINT — DELETE BEFORE PRODUCTION IMPLEMENTATION ⚠️
//
// Calls the official SAM.gov Get Opportunities API v2 and returns the raw schema.
// SAM_API_KEY is passed as a URL query parameter (SAM.gov's required auth method).
// The key is NEVER included in any response field — redacted from all logged URLs.
//
// Set SAM_API_KEY in Vercel → Project → Settings → Environment Variables.
// Get your key: https://sam.gov/profile/details → Public API Key

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const apiKey = process.env.SAM_API_KEY;

  if (!apiKey) {
    return res.status(503).json({
      _diagnostic: true,
      error: 'SAM_API_KEY environment variable is not configured',
      hint: 'Add SAM_API_KEY to Vercel → Project → Settings → Environment Variables',
    });
  }

  // SAM.gov format dates: MM/dd/yyyy
  function samDate(offsetDays) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${mm}/${dd}/${d.getFullYear()}`;
  }

  // Controlled diagnostic query — small, safe, recent active opportunities
  const params = new URLSearchParams({
    limit:      '5',
    q:          'software',
    postedFrom:  samDate(-30),   // last 30 days
    postedTo:    samDate(0),     // today
    api_key:     apiKey,         // SAM.gov requires this as a query param, not a header
  });

  const BASE   = 'https://api.sam.gov/opportunities/v2/search';
  const fullUrl = `${BASE}?${params.toString()}`;

  // Safe URL for returning in the response (key redacted)
  const safeUrl = `${BASE}?${params.toString().replace(apiKey, '[REDACTED]')}`;

  let httpStatus, contentType, rawBody;

  try {
    const apiRes = await fetch(fullUrl, {
      headers: { Accept: 'application/json' },
    });

    httpStatus  = apiRes.status;
    contentType = apiRes.headers.get('content-type');
    const text  = await apiRes.text();

    try { rawBody = JSON.parse(text); }
    catch { rawBody = text; }

  } catch (e) {
    return res.status(200).json({
      _diagnostic:   'TEMPORARY — DELETE BEFORE PRODUCTION',
      _endpointCalled: safeUrl,
      networkError:  e.message,
    });
  }

  // ── Schema summary ──────────────────────────────────────────────────────────
  const topLevelFields = typeof rawBody === 'object' && rawBody !== null
    ? Object.keys(rawBody) : null;

  // SAM.gov v2 wraps results in opportunitiesData
  const dataArray =
    rawBody?.opportunitiesData ??
    rawBody?.data              ??
    rawBody?.results           ??
    null;

  const sampleRecord = Array.isArray(dataArray) ? (dataArray[0] ?? null) : null;
  const sampleFields = sampleRecord ? Object.keys(sampleRecord) : null;

  const pagination = {
    totalRecords: rawBody?.totalRecords ?? rawBody?.total ?? null,
    limit:        rawBody?.limit        ?? null,
    offset:       rawBody?.offset       ?? null,
    hasMore:      Array.isArray(dataArray) && dataArray.length === 5 ? 'likely yes — increase limit to confirm' : null,
  };

  res.status(200).json({
    _diagnostic:        'TEMPORARY — DELETE BEFORE PRODUCTION',
    _endpointCalled:     safeUrl,   // key is REDACTED here
    _httpStatus:         httpStatus,
    _contentType:        contentType,

    _topLevelFields:     topLevelFields,
    _dataArrayField:     dataArray
      ? (rawBody?.opportunitiesData ? 'opportunitiesData' : rawBody?.data ? 'data' : 'results')
      : 'NOT FOUND — check raw below for structure',
    _recordCount:        Array.isArray(dataArray) ? dataArray.length : null,
    _sampleRecordFields: sampleFields,

    _pagination:         pagination,
    _sampleRecord:       sampleRecord,

    raw: rawBody,   // full unmodified response
  });
}

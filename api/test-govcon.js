// api/test-govcon.js
// ⚠️  TEMPORARY DIAGNOSTIC ENDPOINT — DELETE BEFORE PRODUCTION IMPLEMENTATION ⚠️
//
// Confirmed endpoint: GET https://govcon-data.p.rapidapi.com/contracts?page=1&limit=50
// API key is server-side only — never exposed to browser or logs.

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const apiKey  = process.env.GOVCONTRACT_API_KEY;
  const apiHost = process.env.GOVCONTRACT_API_HOST;

  if (!apiKey || !apiHost) {
    return res.status(503).json({
      error: 'Missing GOVCONTRACT_API_KEY or GOVCONTRACT_API_HOST',
      keyConfigured:  !!apiKey,
      hostConfigured: !!apiHost,
    });
  }

  const url = `https://${apiHost}/contracts?page=1&limit=10`; // limit=10 keeps response small for inspection

  let httpStatus, contentType, rawBody;

  try {
    const apiRes = await fetch(url, {
      method: 'GET',
      headers: {
        'x-rapidapi-key':  apiKey,
        'x-rapidapi-host': apiHost,
        'Accept':          'application/json',
      },
    });

    httpStatus   = apiRes.status;
    contentType  = apiRes.headers.get('content-type');
    const text   = await apiRes.text();

    try {
      rawBody = JSON.parse(text);
    } catch {
      rawBody = text;
    }

  } catch (e) {
    return res.status(200).json({
      _diagnostic:  'TEMPORARY ENDPOINT — DELETE BEFORE PRODUCTION',
      _apiHost:      apiHost,
      networkError:  e.message,
    });
  }

  // ── Schema summary ────────────────────────────────────────────────────────
  const topLevelFields = typeof rawBody === 'object' && rawBody !== null
    ? Object.keys(rawBody)
    : null;

  // Try to find the array of contracts — common field names
  const dataArray =
    rawBody?.contracts   ??
    rawBody?.data        ??
    rawBody?.results     ??
    rawBody?.items       ??
    rawBody?.records     ??
    null;

  const sampleRecord   = Array.isArray(dataArray) ? dataArray[0]  ?? null : null;
  const sampleFields   = sampleRecord ? Object.keys(sampleRecord) : null;

  // Pagination — common shapes
  const pagination =
    rawBody?.pagination  ??
    rawBody?.meta        ??
    rawBody?.page_info   ??
    {
      total:    rawBody?.total    ?? rawBody?.count    ?? null,
      page:     rawBody?.page     ?? rawBody?.current_page ?? null,
      per_page: rawBody?.per_page ?? rawBody?.limit     ?? null,
      has_next: rawBody?.has_next ?? rawBody?.next_page ?? null,
    };

  res.status(200).json({
    _diagnostic:       'TEMPORARY ENDPOINT — DELETE BEFORE PRODUCTION',
    _endpointCalled:   `https://${apiHost}/contracts?page=1&limit=10`,
    _httpStatus:        httpStatus,
    _contentType:       contentType,
    _topLevelFields:    topLevelFields,
    _dataArrayField:    dataArray !== null
      ? (rawBody?.contracts ? 'contracts' : rawBody?.data ? 'data' : rawBody?.results ? 'results' : rawBody?.items ? 'items' : 'records')
      : 'NOT FOUND — check raw for structure',
    _recordCount:       Array.isArray(dataArray) ? dataArray.length : null,
    _sampleRecordFields: sampleFields,
    _pagination:        pagination,
    _sampleRecord:      sampleRecord,
    raw:                rawBody,   // full unmodified response
  });
}

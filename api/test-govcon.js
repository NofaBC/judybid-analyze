// api/test-govcon.js
// ⚠️  TEMPORARY DIAGNOSTIC ENDPOINT — DELETE BEFORE PRODUCTION IMPLEMENTATION ⚠️
//
// Purpose: make one real call to the GovCon Data API and return the raw response
// so we can inspect the exact schema before writing the normalizer.
//
// Security: reads GOVCONTRACT_API_KEY server-side only — never exposed to browser.
// The API key is NOT included in any response field or log line.

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const apiKey  = process.env.GOVCONTRACT_API_KEY;
  const apiHost = process.env.GOVCONTRACT_API_HOST;

  if (!apiKey || !apiHost) {
    return res.status(503).json({
      _diagnostic: true,
      error:            'Missing env vars',
      keyConfigured:    !!apiKey,
      hostConfigured:   !!apiHost,
    });
  }

  // RapidAPI convention: URL is https://{host}{path}?params
  // Try the most likely paths in order; stop on the first non-404.
  const PATHS = [
    '/searchContracts',
    '/contracts/search',
    '/search',
    '/v1/searchContracts',
    '/api/searchContracts',
    '/api/contracts',
  ];

  // Small, controlled query — adjust if the API uses different param names
  const QUERY = new URLSearchParams({
    state:  'MD',
    search: 'software',
    page:   '1',
  });

  const attempts = [];

  for (const path of PATHS) {
    const url = `https://${apiHost}${path}?${QUERY.toString()}`;

    let attempt = { path, status: null, contentType: null, body: null, error: null };

    try {
      const apiRes = await fetch(url, {
        headers: {
          'X-RapidAPI-Key':  apiKey,   // server-side only, never logged
          'X-RapidAPI-Host': apiHost,
          'Accept':          'application/json',
        },
      });

      attempt.status      = apiRes.status;
      attempt.contentType = apiRes.headers.get('content-type');

      const text = await apiRes.text();
      try {
        attempt.body = JSON.parse(text);
      } catch {
        attempt.body = text;   // keep raw text if not valid JSON
      }

    } catch (e) {
      attempt.error = e.message;
    }

    attempts.push(attempt);

    // Stop on the first response that is not 404/405 (hit or real error)
    if (attempt.status !== null && attempt.status !== 404 && attempt.status !== 405) {
      break;
    }
  }

  // Summarise the successful hit (or the last attempt)
  const hit = attempts.find(a => a.status === 200) || attempts[attempts.length - 1];

  res.status(200).json({
    _diagnostic:    'TEMPORARY ENDPOINT — DELETE BEFORE PRODUCTION',
    _apiHost:        apiHost,     // host is a domain, not a secret
    _pathsTried:     attempts.map(a => `${a.status ?? 'ERR'} ${a.path}`),
    _successfulPath: hit?.path ?? null,
    _httpStatus:     hit?.status ?? null,
    _contentType:    hit?.contentType ?? null,

    // Raw body of the first successful (or last) response:
    raw: hit?.body ?? null,

    // If it errored at network level:
    networkError: hit?.error ?? null,
  });
}

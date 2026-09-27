// /api/search-opportunities.js
// Calls the SAM.gov Get Opportunities API v2 server-side, normalizes records into
// JudyBid's internal opportunity format, and returns a clean array to the browser.
//
// SAM_API_KEY is a URL query parameter (SAM.gov's required auth method).
// The key is NEVER returned in the response — it is redacted before any logging.
//
// JudyBid scoring, fit labels, and match explanations are computed client-side
// from the normalized data; this function only fetches and normalizes.

// ── Set-aside code → JudyBid category ──────────────────────────────────────
const SETASIDE_MAP = {
  SBA:      'sbe',   SBP:     'sbe',   ISBEE: 'sbe',
  VOSB:     'veteran', VSB:   'veteran',
  SDVOSBC:  'sdvosb', SDVOSBS: 'sdvosb',
  WOSB:     'wosb',  EDWOSB:  'wosb',
  HZC:      'hubzone', HZS:   'hubzone',
  '8A':     '8a',    '8AN':   '8a',
  NONE:     'none',
};

// ── SAM.gov notice type → JudyBid vehicle ──────────────────────────────────
const VEHICLE_MAP = {
  'Solicitation':                     'RFP',
  'Combined Synopsis/Solicitation':   'RFP',
  'Presolicitation':                  'Pre-Solicitation',
  'Sources Sought':                   'Sources Sought',
  'Special Notice':                   'Special Notice',
  'Award Notice':                     'Bid',
  'Justification':                    'Special Notice',
  'Intent to Bundle':                 'Special Notice',
  'Sale of Surplus Property':         'Special Notice',
};

// ── SAM.gov notice type → JudyBid opportunity category ─────────────────────
const CATEGORY_MAP = {
  'market-research': ['Sources Sought', 'Presolicitation', 'Special Notice'],
  'solicitations':   ['Solicitation', 'Combined Synopsis/Solicitation', 'Award Notice'],
  'grants':          ['Award Notice'],
};

// ── Date helper: MM/dd/yyyy (SAM.gov format) ────────────────────────────────
function samDate(d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
}

// ── Normalize one SAM.gov opportunity into JudyBid format ──────────────────
function normalizeRecord(opp) {
  // NAICS — merge naicsCode (string) + naicsCodes (array) into number[]
  const naicsList = [];
  const addNaics = code => {
    const n = parseInt(code, 10);
    if (!isNaN(n) && !naicsList.includes(n)) naicsList.push(n);
  };
  if (opp.naicsCode) addNaics(opp.naicsCode);
  if (Array.isArray(opp.naicsCodes)) {
    opp.naicsCodes.forEach(nc => addNaics(typeof nc === 'object' ? nc?.code : nc));
  }

  // Location — prefer placeOfPerformance, fall back to officeAddress
  const pop = opp.placeOfPerformance;
  let location = '';
  if (pop?.state?.code) {
    location = pop.city?.name
      ? `${pop.city.name}, ${pop.state.code}`
      : pop.state.name || pop.state.code;
  } else if (opp.officeAddress?.city) {
    location = opp.officeAddress.state
      ? `${opp.officeAddress.city}, ${opp.officeAddress.state}`
      : opp.officeAddress.city;
  }

  // Set-aside
  const saCode  = (opp.typeOfSetAside || 'NONE').toUpperCase();
  const setAside = SETASIDE_MAP[saCode] || 'none';

  // Vehicle / notice type
  const vehicle = VEHICLE_MAP[opp.type] || opp.type || 'Bid';

  // Summary — SAM.gov description is often a URL to a separate resource.
  // When it is a URL, fall back to the title so the scoring engine has text.
  const rawDesc  = (opp.description || '').trim();
  const descIsUrl = /^https?:\/\//i.test(rawDesc);
  const summary   = descIsUrl ? (opp.title || '') : (rawDesc || opp.title || '');

  // Due date
  let dueDate = null;
  if (opp.responseDeadLine) {
    const parsed = new Date(opp.responseDeadLine);
    if (!isNaN(parsed)) dueDate = parsed;
  }

  // Posted date (ISO string for display)
  let postedDate = null;
  if (opp.postedDate) {
    const parsed = new Date(opp.postedDate);
    if (!isNaN(parsed)) postedDate = parsed.toISOString();
  }

  return {
    id:                 opp.noticeId           || crypto.randomUUID(),
    title:              opp.title              || '(Untitled)',
    agency:             opp.fullParentPathName || '',
    summary,
    keywords:           [],          // JudyBid extracts keywords from title + summary during scoring
    naics:              naicsList,
    location,
    dueDate,
    postedDate,
    solicitationNumber: opp.solicitationNumber || null,
    minBudget:          null,        // SAM.gov notices do not include budget — scored as neutral
    maxBudget:          null,
    setAsides:          setAside !== 'none' ? [setAside] : ['none'],
    vehicle,
    link:               opp.uiLink  || '#',
    source:             'SAM.gov',
  };
}

// ── Main handler ────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.SAM_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'SAM.gov API not configured (SAM_API_KEY missing)' });
  }

  const { naics = [], keywords = [], category = 'all' } = req.body || {};

  // Build SAM.gov query
  const today  = new Date();
  const from90 = new Date(); from90.setDate(today.getDate() - 90);

  const params = new URLSearchParams({
    limit:      '25',
    postedFrom:  samDate(from90),
    postedTo:    samDate(today),
    api_key:     apiKey,              // SAM.gov requires key as a query param — never returned to client
  });

  // Primary NAICS (SAM.gov accepts one per request)
  if (naics.length > 0) params.set('naics', String(naics[0]));

  // Keywords from profile capabilities (top 5 for focused results)
  const kw = keywords.filter(Boolean).slice(0, 5).join(' ').trim();
  if (kw) params.set('q', kw);

  // Category → SAM.gov notice type filter
  if (category !== 'all' && CATEGORY_MAP[category]) {
    params.set('type', CATEGORY_MAP[category].join(','));
  }

  const url = `https://api.sam.gov/opportunities/v2/search?${params.toString()}`;

  // Call SAM.gov
  let rawData;
  try {
    const apiRes = await fetch(url, { headers: { Accept: 'application/json' } });
    rawData = await apiRes.json();

    if (!apiRes.ok) {
      const msg = rawData?.errorMessage || rawData?.error || `SAM.gov returned HTTP ${apiRes.status}`;
      return res.status(apiRes.status).json({ error: msg });
    }
  } catch (e) {
    return res.status(502).json({ error: `SAM.gov unreachable: ${e.message}` });
  }

  const opportunities = (rawData?.opportunitiesData || []).map(normalizeRecord);

  res.status(200).json({
    opportunities,
    totalRecords: rawData?.totalRecords ?? opportunities.length,
    source:       'SAM.gov',
  });
}

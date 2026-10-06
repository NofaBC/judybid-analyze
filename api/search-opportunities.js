// /api/search-opportunities.js
// Unified opportunity search endpoint.
// source = 'all' | 'federal' | 'state-local' | 'education' | 'grants'
//
// ACCESS CONTROL: requires a verified Firebase ID token (active subscriber)
// OR a valid advisor access token. Unauthenticated requests → 401.
// Authenticated but non-entitled requests → 403.

import { verifyFirebaseToken, getAdminDb } from './_admin.js';

// Advisor bypass — must match the token and expiry in index.html boot section
const ADVISOR_TOKEN  = 'judybid-v1';
const ADVISOR_EXPIRY = Date.UTC(2026, 11, 31, 4, 59); // 2026-12-31 23:59 ET

/**
 * Returns { allowed: true } or { allowed: false, status, error }.
 * Order: advisor token check → Firebase ID token check → Firestore subscription.
 */
async function checkEntitlement(body) {
  const { idToken, advisorToken } = body || {};

  // ── Advisor bypass ───────────────────────────────────────────────
  if (advisorToken) {
    if (advisorToken === ADVISOR_TOKEN && Date.now() < ADVISOR_EXPIRY) {
      return { allowed: true };
    }
    return { allowed: false, status: 403, error: 'Advisor access token is invalid or has expired' };
  }

  // ── Firebase auth check ──────────────────────────────────────────
  if (!idToken) {
    return { allowed: false, status: 401, error: 'Sign in to search live government opportunities' };
  }

  let uid;
  try {
    uid = await verifyFirebaseToken(idToken);
  } catch {
    return { allowed: false, status: 401, error: 'Invalid authentication token — please sign in again' };
  }

  // ── Firestore subscription check ─────────────────────────────────
  try {
    const db     = getAdminDb();
    const doc    = await db.collection('users').doc(uid).get();
    const status = doc.data()?.subscription?.status || 'free';
    if (['active', 'past_due'].includes(status)) return { allowed: true };
    return {
      allowed: false,
      status:  403,
      error:   'An active JudyBid subscription is required to search live government opportunities',
    };
  } catch (e) {
    console.error('Subscription check error:', e.message);
    return { allowed: false, status: 500, error: 'Could not verify subscription status — try again shortly' };
  }
}
//
// 'all'         → SAM.gov (federal) + Tango SLED (all jurisdictions)
// 'federal'     → SAM.gov only
// 'state-local' → Tango SLED (state + local jurisdictions)
// 'education'   → Tango SLED (education jurisdiction)
// 'grants'      → SAM.gov only (Award Notice type filter, legacy behaviour)
//
// API keys are server-side only — never returned in responses.

// ── SAM.gov: Set-aside code → JudyBid category ──────────────────────────────
const SETASIDE_MAP = {
  SBA:'sbe', SBP:'sbe', ISBEE:'sbe',
  VOSB:'veteran', VSB:'veteran',
  SDVOSBC:'sdvosb', SDVOSBS:'sdvosb',
  WOSB:'wosb', EDWOSB:'wosb',
  HZC:'hubzone', HZS:'hubzone',
  '8A':'8a', '8AN':'8a',
  NONE:'none',
};

// ── SAM.gov: Notice type → JudyBid vehicle ──────────────────────────────────
const VEHICLE_MAP = {
  'Solicitation':                   'RFP',
  'Combined Synopsis/Solicitation': 'RFP',
  'Presolicitation':                'Pre-Solicitation',
  'Sources Sought':                 'Sources Sought',
  'Special Notice':                 'Special Notice',
  'Award Notice':                   'Bid',
  'Justification':                  'Special Notice',
  'Intent to Bundle':               'Special Notice',
  'Sale of Surplus Property':       'Special Notice',
};

// ── Tango SLED: source value → jurisdiction filter ──────────────────────────
const TANGO_JURISDICTION = {
  'all':         'state|local|education',
  'state-local': 'state|local',
  'education':   'education',
};

// ── Tango SLED: jurisdiction code → display label ───────────────────────────
const JURISDICTION_LABELS = {
  state:'State', local:'Local', education:'Education', unknown:'Other',
};

// ── Derive human-readable portal name from source URL ───────────────────────
function derivePortalName(sourceUrl) {
  if (!sourceUrl) return null;
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase().replace(/^www\./, '');
    if (host.includes('bonfirehub') || host.includes('gobonfire'))      return 'Bonfire';
    if (host.includes('demandstar'))                                     return 'DemandStar';
    if (host.includes('bidnet'))                                         return 'BidNet Direct';
    if (host.includes('planetbids'))                                     return 'PlanetBids';
    if (host.includes('periscope'))                                      return 'Periscope S2G';
    if (host.includes('bidexpress'))                                     return 'Bid Express';
    if (host.includes('jaggaer') || host.includes('sciquest'))           return 'Jaggaer';
    if (host.includes('ionwave'))                                        return 'Ion Wave';
    if (host.includes('hiepro'))                                         return 'Hawaii eProcurement';
    if (host.includes('hihands'))                                        return 'Hawaii HANDS';
    if (host.includes('georgia') && host.includes('procurement'))        return 'Georgia Procurement Registry';
    if (host.includes('doas.ga.gov'))                                    return 'Georgia Procurement Registry';
    if (host.includes('vendornet'))                                      return 'VendorNet';
    if (host.includes('publicsurplus'))                                  return 'Public Surplus';
    // Fallback: readable second-level domain segment
    const parts = host.split('.');
    if (parts.length >= 2) {
      const seg = parts[parts.length - 2];
      if (seg.length > 2 && !['gov','org','net','com','edu'].includes(seg)) {
        return seg.charAt(0).toUpperCase() + seg.slice(1);
      }
    }
    return null;
  } catch { return null; }
}

// ── Date helper: MM/dd/yyyy (SAM.gov required format) ───────────────────────
function samDate(d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
}

// ── Detect whether a URL is a direct solicitation link or a generic portal page ──
// Used to label state/local links accurately when deep linking is not available.
// Pattern: URLs with fewer than 2 path segments are almost always a portal root.
// Known portal-only hosts are listed explicitly.
function detectLinkType(url) {
  if (!url || url === '#') return 'none';
  try {
    const u        = new URL(url);
    const host     = u.hostname.toLowerCase();
    const segments = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean);

    // Known hosts that return portal root URLs rather than per-solicitation links
    const PORTAL_HOSTS = [
      'coloradovss.com',
      'bidnetdirect.com',
      'govbuys.com',
      'biddingo.com',
      'onvia.com',
      'bidspeed.com',
      'mmpurchasing.com',
    ];
    if (PORTAL_HOSTS.some(h => host === h || host.endsWith('.' + h))) return 'portal';

    // Root or single-segment paths are portal homepages, not specific solicitations
    if (segments.length < 2) return 'portal';

    return 'direct';
  } catch { return 'portal'; }
}

// ── Normalize one SAM.gov opportunity → JudyBid internal format ─────────────────
function normalizeSamRecord(opp) {
  const naicsList = [];
  const addNaics = code => {
    const n = parseInt(code, 10);
    if (!isNaN(n) && !naicsList.includes(n)) naicsList.push(n);
  };
  if (opp.naicsCode) addNaics(opp.naicsCode);
  if (Array.isArray(opp.naicsCodes)) {
    opp.naicsCodes.forEach(nc => addNaics(typeof nc === 'object' ? nc?.code : nc));
  }

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

  const saCode  = (opp.typeOfSetAside || 'NONE').toUpperCase();
  const setAside = SETASIDE_MAP[saCode] || 'none';
  const vehicle  = VEHICLE_MAP[opp.type] || opp.type || 'Bid';

  const rawDesc = (opp.description || '').trim();
  const summary = /^https?:\/\//i.test(rawDesc) ? (opp.title || '') : (rawDesc || opp.title || '');

  let dueDate = null;
  if (opp.responseDeadLine) {
    const p = new Date(opp.responseDeadLine);
    if (!isNaN(p)) dueDate = p;
  }

  return {
    id:                 opp.noticeId           || crypto.randomUUID(),
    title:              opp.title              || '(Untitled)',
    agency:             opp.fullParentPathName || '',
    summary,
    keywords:           [],
    naics:              naicsList,
    location,
    dueDate,
    postedDate:         opp.postedDate ? new Date(opp.postedDate).toISOString() : null,
    solicitationNumber: opp.solicitationNumber || null,
    minBudget:          null,
    maxBudget:          null,
    setAsides:          setAside !== 'none' ? [setAside] : ['none'],
    vehicle,
    link:               opp.uiLink || '#',
    source:             'SAM.gov',
    linkType:           'direct',   // SAM.gov uiLink is always a specific solicitation URL
  };
}

// ── Normalize one Tango SLED opportunity → JudyBid internal format ──────────
function normalizeTangoRecord(opp) {
  const level  = opp.organization?.level   || 'unknown';
  const state  = (opp.organization?.state  || '').toLowerCase();
  const agency = opp.organization?.agency  || opp.organization?.name || '';

  // NIGP codes from category_codes (scheme === 'nigp')
  const nigpCodes = (opp.category_codes || [])
    .filter(c => c.scheme === 'nigp')
    .map(c => String(c.code));

  // Generate keyword tokens: NIGP codes + other category codes + solicitation type
  // These are matched against signals.keywords (profile capabilities + NIGP codes)
  const keywords = [
    ...(opp.category_codes || []).map(c => String(c.code).toLowerCase()),
    ...(opp.solicitation_type ? [opp.solicitation_type.toLowerCase()] : []),
  ].filter((v, i, a) => a.indexOf(v) === i); // unique

  const vehicle = opp.solicitation_type || 'Bid';

  let dueDate = null;
  if (opp.response_deadline) {
    const p = new Date(opp.response_deadline);
    if (!isNaN(p)) dueDate = p;
  }

  const portalName = derivePortalName(opp.source_url);

  return {
    id:                  opp.opportunity_id    || crypto.randomUUID(),
    title:               opp.title             || '(Untitled)',
    agency,
    // SLED list response has no description — use title for keyword scoring
    summary:             opp.title             || '',
    keywords,                                     // category codes + solicitation type
    naics:               [],                      // NAICS mid-migration on SLED — do not infer
    location:            state,                   // 2-letter state abbreviation
    dueDate,
    postedDate:          opp.posted_date || null,
    solicitationNumber:  opp.solicitation_number || null,
    minBudget:           null,                    // SLED notices do not include budget
    maxBudget:           null,
    setAsides:           ['none'],                // Unknown unless explicitly provided
    vehicle,
    link:                opp.source_url || '#',
    source:              'Tango',
    linkType:            detectLinkType(opp.source_url),  // 'direct' | 'portal' | 'none'

    // SLED-specific display fields
    jurisdictionLevel:   level,
    jurisdictionDisplay: JURISDICTION_LABELS[level] || 'Other',
    portalName:          portalName || 'State/Local Procurement Portal',
    nigpCodes,
    categoryCodes:       opp.category_codes || [],
  };
}

// ── Deduplicate: source ID first, then solicitation# + agency ───────────────
function deduplicateOpportunities(opportunities) {
  const seenIds   = new Set();
  const seenSolNr = new Set();
  return opportunities.filter(opp => {
    if (seenIds.has(opp.id)) return false;
    seenIds.add(opp.id);
    if (opp.solicitationNumber && opp.agency) {
      const key = `${opp.solicitationNumber}|${opp.agency}`.toLowerCase();
      if (seenSolNr.has(key)) return false;
      seenSolNr.add(key);
    }
    return true;
  });
}

// ── Server-side keyword filter (mirrors client-side filterKeywords) ──────────
// Applied before building the SAM.gov q= param so filler words never pollute
// the search query and cause irrelevant solicitations to surface.
const SEARCH_STOPWORDS = new Set([
  'a','an','and','are','as','at','be','by','for','from','in','is','it',
  'of','on','or','the','to','with','we','our','your','their','this','that',
  'these','those','can','will','all','any','but','not','was','were','been',
  'have','has','had','do','does','did','so','if','up','no','its','also',
  'they','them','then','than','more','into','over','about','after','before',
  'between','through','during','other','such','which','would','could',
  'should','shall','may','use','used','using','provide','providing',
  'including','includes','various','specific','general','related',
  'required','within','across',
  'service','services','business','company','commercial','government',
  'solution','solutions','support',
]);
const SEARCH_SHORT_ALLOWLIST = new Set(['ai','it','bi','db','qa','ui','ux','ml','ip','os','gis','api','erp','crm','cms']);

function filterSearchKeywords(tokens) {
  return (tokens || []).filter(t => {
    if (SEARCH_STOPWORDS.has(t)) return false;
    if (t.length < 3 && !SEARCH_SHORT_ALLOWLIST.has(t)) return false;
    return true;
  });
}

// ── Fetch from SAM.gov ───────────────────────────────────────────────────────
// SAM.gov v2 accepts exactly one NAICS code per request.
// We fan out one request per profile NAICS code (max 3), then merge and
// deduplicate by noticeId so every relevant code is represented.
async function fetchSamOpportunities({ naics, keywords, source }, apiKey) {
  const today  = new Date();
  const from90 = new Date(); from90.setDate(today.getDate() - 90);

  // Strip stopwords before building q= — only meaningful terms reach SAM.gov
  const cleanKw = filterSearchKeywords(keywords).slice(0, 6).join(' ').trim();

  const baseParams = {
    postedFrom: samDate(from90),
    postedTo:   samDate(today),
    api_key:    apiKey,
  };
  if (cleanKw)             baseParams.q    = cleanKw;
  if (source === 'grants') baseParams.type = 'Award Notice';

  const naicsCodes = (naics || []).slice(0, 3);

  if (naicsCodes.length === 0) {
    // No NAICS provided — fall back to keyword-only query
    const params = new URLSearchParams({ limit: '25', ...baseParams });
    const apiRes = await fetch(
      `https://api.sam.gov/opportunities/v2/search?${params.toString()}`,
      { headers: { Accept: 'application/json' } }
    );
    const data = await apiRes.json();
    if (!apiRes.ok) throw new Error(data?.errorMessage || data?.error || `SAM.gov returned ${apiRes.status}`);
    return (data?.opportunitiesData || []).map(normalizeSamRecord);
  }

  // One request per NAICS; 15 results each keeps the merged total manageable.
  const perLimit = naicsCodes.length > 1 ? '15' : '25';
  const settled  = await Promise.allSettled(
    naicsCodes.map(async code => {
      const params = new URLSearchParams({ limit: perLimit, naics: String(code), ...baseParams });
      const apiRes = await fetch(
        `https://api.sam.gov/opportunities/v2/search?${params.toString()}`,
        { headers: { Accept: 'application/json' } }
      );
      const data = await apiRes.json();
      if (!apiRes.ok) throw new Error(`SAM.gov NAICS ${code}: ${apiRes.status}`);
      return (data?.opportunitiesData || []).map(normalizeSamRecord);
    })
  );

  // Merge results and deduplicate by noticeId
  const seen   = new Set();
  const merged = [];
  for (const r of settled) {
    if (r.status !== 'fulfilled') {
      console.warn('SAM.gov NAICS request failed:', r.reason?.message);
      continue;
    }
    for (const opp of r.value) {
      if (!seen.has(opp.id)) { seen.add(opp.id); merged.push(opp); }
    }
  }
  return merged;
}

// ── Fetch from Tango SLED ────────────────────────────────────────────────────
async function fetchTangoOpportunities({ states, keywords }, jurisdictions, apiKey) {
  const params = new URLSearchParams({ limit: '25' });

  if (jurisdictions)     params.set('jurisdiction', jurisdictions);

  // State filter: pipe-separated 2-letter abbreviations derived from user's service area
  if (states?.length > 0) params.set('state', states.slice(0, 5).join('|'));

  const kw = (keywords || []).filter(Boolean).slice(0, 5).join(' ').trim();
  if (kw) params.set('search', kw);

  const url    = `https://tango.dev/api/sled/opportunities/?${params.toString()}`;
  const apiRes = await fetch(url, {
    headers: { 'X-API-KEY': apiKey, Accept: 'application/json' },
  });
  const data   = await apiRes.json();

  if (!apiRes.ok) {
    throw new Error(data?.detail || data?.error || `Tango returned ${apiRes.status}`);
  }
  return (data?.results || []).map(normalizeTangoRecord);
}

// ── Main handler ──────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── Server-side access control ───────────────────────────────────────
  const entitlement = await checkEntitlement(req.body);
  if (!entitlement.allowed) {
    return res.status(entitlement.status).json({ error: entitlement.error });
  }
  // ── End access control ─────────────────────────────────────────────

  const { naics = [], keywords = [], source = 'all', states = [] } = req.body || {};

  const samKey   = process.env.SAM_API_KEY;
  const tangoKey = process.env.TANGO_API_KEY;

  // Determine which source(s) to call
  const callSam    = ['all', 'federal', 'grants'].includes(source) && !!samKey;
  const callTango  = !!TANGO_JURISDICTION[source] && !!tangoKey;
  const tangoJuris = TANGO_JURISDICTION[source] || null;

  if (!callSam && !callTango) {
    return res.status(503).json({
      error:         'No opportunity sources configured',
      opportunities: [],
      sources: {
        sam:   { count: 0, error: samKey   ? null : 'SAM_API_KEY not configured' },
        tango: { count: 0, error: tangoKey ? null : 'TANGO_API_KEY not configured' },
      },
    });
  }

  // Fan out in parallel — partial success is acceptable
  const [samResult, tangoResult] = await Promise.allSettled([
    callSam   ? fetchSamOpportunities({ naics, keywords, source }, samKey)          : Promise.resolve([]),
    callTango ? fetchTangoOpportunities({ states, keywords }, tangoJuris, tangoKey) : Promise.resolve([]),
  ]);

  const samOpps    = samResult.status   === 'fulfilled' ? samResult.value        : [];
  const tangoOpps  = tangoResult.status === 'fulfilled' ? tangoResult.value      : [];
  const samError   = samResult.status   === 'rejected'  ? samResult.reason?.message  : null;
  const tangoError = tangoResult.status === 'rejected'  ? tangoResult.reason?.message : null;

  if (samError)   console.error('SAM.gov error:', samError);
  if (tangoError) console.error('Tango SLED error:', tangoError);

  // Combine (SAM.gov first) and deduplicate
  const combined = deduplicateOpportunities([...samOpps, ...tangoOpps]);

  res.status(200).json({
    opportunities: combined,
    totalRecords:  combined.length,
    sources: {
      sam:   { count: samOpps.length,   error: samError   || null },
      tango: { count: tangoOpps.length, error: tangoError || null },
    },
  });
}

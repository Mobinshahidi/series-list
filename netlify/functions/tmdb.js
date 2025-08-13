// Netlify function: TV search proxy with robust matching (TV ONLY)
// File path: netlify/functions/tmdb.js

const TMDB_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE = "https://api.themoviedb.org/3";

function normTitle(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\.\'\u2019]/g, "")
    .replace(/&/g, "and")
    .replace(/:|—|–|-/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function normNoSpace(s) {
  return normTitle(s).replace(/\s+/g, "");
}

const STOP = new Set(["the", "a", "an", "of", "and", "or", "with", "to"]);
function tokens(s) {
  return normTitle(s)
    .split(" ")
    .filter((t) => t && !STOP.has(t));
}
function jaccard(a, b) {
  const A = new Set(a),
    B = new Set(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  const uni = new Set([...a, ...b]).size;
  return uni ? inter / uni : 0;
}
function yearOf(r) {
  const d = r.first_air_date || "";
  return d ? Number(d.slice(0, 4)) : undefined;
}

function pickBest(inputTitle, inputYear, candidates) {
  const nInput = normTitle(inputTitle);
  const nsInput = normNoSpace(inputTitle);
  const tInput = tokens(inputTitle);

  // 1) Exact normalized title (with and without spaces)
  const exacts = candidates.filter((c) => {
    const n = normTitle(c.name);
    return n === nInput || normNoSpace(c.name) === nsInput;
  });
  if (exacts.length) {
    return exacts.sort((a, b) => {
      const ay = yearOf(a) || 0,
        by = yearOf(b) || 0;
      const da = Math.abs((ay || 0) - (inputYear || 0));
      const db = Math.abs((by || 0) - (inputYear || 0));
      return da - db || (b.popularity || 0) - (a.popularity || 0);
    })[0];
  }

  // 2) Score by token overlap + year closeness + popularity (require some overlap)
  const scored = candidates
    .map((c) => {
      const jac = jaccard(tInput, tokens(c.name));
      const y = yearOf(c);
      const yDelta =
        typeof inputYear === "number" && y ? Math.abs(y - inputYear) : 999;
      const yearScore = y
        ? yDelta === 0
          ? 1
          : yDelta === 1
            ? 0.6
            : yDelta === 2
              ? 0.3
              : 0
        : 0.2;
      const pop = (c.popularity || 0) / 100;
      const score = jac * 3 + yearScore * 1 + pop * 0.5;
      return { c, score };
    })
    .filter((o) => o.score > 0.3) // need reasonable similarity
    .sort((a, b) => b.score - a.score);

  return scored.length ? scored[0].c : candidates[0];
}

export async function handler(event) {
  try {
    if (!TMDB_KEY)
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Missing TMDB_API_KEY" }),
      };

    const q = (event.queryStringParameters?.q || "").trim();
    const year = Number(event.queryStringParameters?.year || 0) || undefined;
    if (!q)
      return { statusCode: 400, body: JSON.stringify({ error: "Missing q" }) };

    // Search TV only; do NOT hard filter by year to avoid excluding near-year matches
    const params = new URLSearchParams({
      api_key: TMDB_KEY,
      query: q,
      include_adult: "false",
      language: "en-US",
    });
    const res = await fetch(`${TMDB_BASE}/search/tv?${params}`);
    if (!res.ok) throw new Error(`TMDB search failed: ${res.status}`);
    const sJson = await res.json();

    const candidates = (sJson.results || []).map((r) => ({
      id: r.id,
      name: r.name,
      first_air_date: r.first_air_date,
      vote_average: r.vote_average,
      popularity: r.popularity,
      poster_path: r.poster_path,
    }));

    if (!candidates.length) {
      // No match found – return a minimal object so UI shows the card
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: "No results" }),
      };
    }

    const best = pickBest(q, year, candidates);

    // Fetch full TV details
    const detailUrl = new URL(`${TMDB_BASE}/tv/${best.id}`);
    detailUrl.searchParams.set("api_key", TMDB_KEY);
    const dRes = await fetch(detailUrl);
    if (!dRes.ok) throw new Error(`TMDB details failed: ${dRes.status}`);
    const d = await dRes.json();

    const payload = {
      id: d.id,
      name: d.name,
      overview: d.overview,
      date: d.first_air_date || null,
      vote_average: d.vote_average,
      status: d.status,
      networks: (d.networks || []).map((n) => n.name),
      poster_path: d.poster_path,
      tmdbUrl: `https://www.themoviedb.org/tv/${d.id}`,
    };

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: String(err) }) };
  }
}

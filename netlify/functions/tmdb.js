// Netlify function: tv search proxy with accuracy checks
// File path: netlify/functions/tmdb.js

// No need for node-fetch — Netlify’s Node 18 runtime has fetch built‑in
const TMDB_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE = "https://api.themoviedb.org/3";

function normTitle(s) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\.\'\u2019]/g, "")
    .replace(/&/g, "and")
    .replace(/:|—|–|-/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pickBest(inputTitle, inputYear, results = []) {
  const nInput = normTitle(inputTitle);
  const yearStr = String(inputYear);
  const withYear = (r) => (r.first_air_date || "").startsWith(yearStr);

  let exactYear = results.filter(
    (r) => normTitle(r.name) === nInput && withYear(r),
  );
  if (exactYear.length) return exactYear[0];

  let exactAny = results.filter((r) => normTitle(r.name) === nInput);
  if (exactAny.length) return exactAny[0];

  let sameYear = results
    .filter(withYear)
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  if (sameYear.length) return sameYear[0];

  return results[0];
}

export async function handler(event) {
  try {
    if (!TMDB_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Missing TMDB_API_KEY" }),
      };
    }

    const q = (event.queryStringParameters?.q || "").trim();
    const year = Number(event.queryStringParameters?.year || 0) || undefined;
    if (!q)
      return { statusCode: 400, body: JSON.stringify({ error: "Missing q" }) };

    const searchUrl = new URL(`${TMDB_BASE}/search/tv`);
    searchUrl.searchParams.set("api_key", TMDB_KEY);
    searchUrl.searchParams.set("query", q);
    searchUrl.searchParams.set("include_adult", "false");
    if (year) searchUrl.searchParams.set("first_air_date_year", String(year));

    const sRes = await fetch(searchUrl);
    if (!sRes.ok) throw new Error(`TMDB search failed: ${sRes.status}`);
    const sJson = await sRes.json();
    const results = Array.isArray(sJson.results) ? sJson.results : [];

    if (results.length === 0) {
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          inputTitle: q,
          inputYear: year,
          note: "No results",
        }),
      };
    }

    const best = pickBest(q, year, results);

    const detailUrl = new URL(`${TMDB_BASE}/tv/${best.id}`);
    detailUrl.searchParams.set("api_key", TMDB_KEY);

    const dRes = await fetch(detailUrl);
    if (!dRes.ok) throw new Error(`TMDB details failed: ${dRes.status}`);
    const d = await dRes.json();

    const payload = {
      id: d.id,
      name: d.name,
      overview: d.overview,
      first_air_date: d.first_air_date,
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

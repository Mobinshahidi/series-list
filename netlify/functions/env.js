// Exposes TMDB_KEY from Netlify env to the browser.
exports.handler = async () => {
  return {
    statusCode: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
    body: JSON.stringify({ TMDB_KEY: process.env.TMDB_KEY || "" }),
  };
};

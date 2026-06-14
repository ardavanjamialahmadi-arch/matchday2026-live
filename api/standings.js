// MatchDay 2026 — group standings proxy (Vercel serverless function).
//
// Returns the live group tables (position, points, played, GD) for the World
// Cup group stage. Like /api/scores, the football-data.org token stays
// server-side in a Vercel Environment Variable and never reaches the browser.
//
// Setup: needs FOOTBALL_DATA_TOKEN (already set for /api/scores).

module.exports = async (req, res) => {
  try {
    const token = process.env.FOOTBALL_DATA_TOKEN || '';
    if (!token) {
      res.status(500).json({ error: 'Missing FOOTBALL_DATA_TOKEN env var', groups: [] });
      return;
    }

    const upstream = await fetch('https://api.football-data.org/v4/competitions/WC/standings', {
      headers: { 'X-Auth-Token': token }
    });
    if (!upstream.ok) {
      res.status(502).json({ error: 'football-data.org returned ' + upstream.status, groups: [] });
      return;
    }
    const data = await upstream.json();

    // The standings array has one entry per group (type TOTAL). Map each to a
    // compact table the front-end can render directly.
    const groups = (data.standings || [])
      .filter((s) => s.type === 'TOTAL')
      .map((s) => ({
        name: (s.group || '').replace('GROUP_', '') || (s.stage || ''),
        table: (s.table || []).map((row) => ({
          pos: row.position,
          team: row.team && row.team.name,
          crest: row.team && row.team.crest,
          played: row.playedGames,
          won: row.won,
          draw: row.draw,
          lost: row.lost,
          gd: row.goalDifference,
          points: row.points
        }))
      }))
      .filter((g) => g.table.length);

    // Cache at the edge for 60s — standings only change when a match finishes.
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json({ updated: new Date().toISOString(), groups: groups });
  } catch (e) {
    res.status(500).json({ error: String(e), groups: [] });
  }
};

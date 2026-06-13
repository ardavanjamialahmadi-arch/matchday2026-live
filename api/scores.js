// MatchDay 2026 — live World Cup scores proxy (Vercel serverless function).
const STAGE_LABELS = {
  GROUP_STAGE: 'Group Stage', LAST_16: 'Round of 16', QUARTER_FINALS: 'Quarter-final',
  SEMI_FINALS: 'Semi-final', THIRD_PLACE: 'Third place', FINAL: 'Final'
};
module.exports = async (req, res) => {
  try {
    const token = process.env.FOOTBALL_DATA_TOKEN || '';
    if (!token) { res.status(500).json({ error: 'Missing FOOTBALL_DATA_TOKEN env var', matches: [] }); return; }
    const upstream = await fetch('https://api.football-data.org/v4/competitions/WC/matches', {
      headers: { 'X-Auth-Token': token }
    });
    if (!upstream.ok) { res.status(502).json({ error: 'football-data.org returned ' + upstream.status, matches: [] }); return; }
    const data = await upstream.json();
    const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
    const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET';
    const matches = (data.matches || []).map((m) => {
      const st = m.status;
      let status = 'UPCOMING';
      if (st === 'IN_PLAY' || st === 'PAUSED') status = 'LIVE';
      else if (st === 'FINISHED') status = 'FT';
      const ft = (m.score && m.score.fullTime) || {};
      const grp = (m.group || '').replace('GROUP_', '');
      return {
        home: m.homeTeam && m.homeTeam.name, away: m.awayTeam && m.awayTeam.name,
        crestHome: m.homeTeam && m.homeTeam.crest, crestAway: m.awayTeam && m.awayTeam.crest,
        status: status, hs: ft.home == null ? null : ft.home, as: ft.away == null ? null : ft.away,
        min: m.minute ? (m.minute + "'") : (st === 'PAUSED' ? 'HT' : ''),
        label: grp ? ('Group ' + grp) : (STAGE_LABELS[m.stage] || 'World Cup'),
        venue: m.venue || '', date: fmtDate(m.utcDate), time: fmtTime(m.utcDate), utc: m.utcDate
      };
    });
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
    res.status(200).json({ updated: new Date().toISOString(), matches: matches });
  } catch (e) { res.status(500).json({ error: String(e), matches: [] }); }
};

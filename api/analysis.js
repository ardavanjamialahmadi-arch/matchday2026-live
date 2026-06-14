// MatchDay 2026 — AI match analysis (Vercel serverless function).
//
// Generates FRESH World Cup match previews with Claude (the Anthropic API),
// for the next few upcoming fixtures. The API key stays server-side.
//
// Env vars (Vercel → Settings → Environment Variables):
//   FOOTBALL_DATA_TOKEN  — to look up upcoming fixtures (already set)
//   ANTHROPIC_API_KEY    — your Claude key from console.anthropic.com
//
// Cost: ~3-4 short articles per generation on Haiku 4.5 (~$0.004), cached 6h
//       → only ~4 generations/day → roughly $0.50/month.

module.exports = async (req, res) => {
  try {
    const fdToken = process.env.FOOTBALL_DATA_TOKEN || '';
    const aiKey = process.env.ANTHROPIC_API_KEY || '';
    if (!aiKey) { res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY env var', articles: [] }); return; }

    // 1. Get the next few upcoming World Cup fixtures.
    //    NOTE: football-data marks not-yet-started matches as SCHEDULED *or*
    //    TIMED (TIMED only once an exact kickoff time is locked in). Filtering
    //    on ?status=TIMED alone misses most of the schedule, so we fetch all
    //    matches and pick the soonest upcoming ones in code (same approach as
    //    /api/scores).
    let fixtures = [];
    try {
      const r = await fetch('https://api.football-data.org/v4/competitions/WC/matches', {
        headers: { 'X-Auth-Token': fdToken }
      });
      if (r.ok) {
        const d = await r.json();
        const now = Date.now();
        fixtures = (d.matches || [])
          .filter((m) => (m.status === 'SCHEDULED' || m.status === 'TIMED') && new Date(m.utcDate).getTime() > now)
          .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
          .slice(0, 4)
          .map((m) => ({
            home: m.homeTeam && m.homeTeam.name,
            away: m.awayTeam && m.awayTeam.name,
            group: (m.group || '').replace('GROUP_', ''),
            date: new Date(m.utcDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })
          }));
      }
    } catch (e) { /* fall through with no fixtures */ }

    if (!fixtures.length) { res.status(200).json({ articles: [] }); return; }

    // 2. Ask Claude to write a short preview for each fixture.
    const list = fixtures.map((f) => `- ${f.home} vs ${f.away} (Group ${f.group}, ${f.date})`).join('\n');
    const system = 'You are an expert football journalist writing concise, engaging match previews for MatchDay 2026, a FIFA World Cup 2026 fan site. ' +
      'The 2026 FIFA World Cup is co-hosted by the United States, Canada, and Mexico — never refer to any other host country or venue (e.g. never say Qatar, Russia, or Brazil). ' +
      'Do not invent specific venues, player names, or stats you are unsure of; keep previews focused on the teams, their style, and the matchup. ' +
      'Voice: knowledgeable, energetic, and neutral. Never give betting or gambling advice.';
    const userMsg =
      'Write a short preview for each of these upcoming World Cup 2026 fixtures:\n' + list + '\n\n' +
      'Return ONLY a JSON array — no markdown, no commentary, nothing outside the array. ' +
      'Each element is an object with exactly these keys:\n' +
      '"title": a catchy headline, max 60 characters;\n' +
      '"excerpt": a one-sentence teaser, max 120 characters;\n' +
      '"body": two short paragraphs of analysis, each wrapped in <p>...</p> HTML tags, ending with a predicted scoreline;\n' +
      '"tag": the exact string "Match Preview".';

    const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': aiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 2048,
        system: system,
        messages: [{ role: 'user', content: userMsg }]
      })
    });
    if (!aiResp.ok) {
      const t = await aiResp.text();
      res.status(502).json({ error: 'anthropic ' + aiResp.status + ': ' + t.slice(0, 200), articles: [] });
      return;
    }
    const aiData = await aiResp.json();
    const text = (aiData.content && aiData.content[0] && aiData.content[0].text) || '';

    // 3. Pull the JSON array out of Claude's reply (robust to stray text).
    let articles = [];
    try {
      const start = text.indexOf('['), end = text.lastIndexOf(']');
      articles = JSON.parse(text.slice(start, end + 1));
    } catch (e) {
      res.status(200).json({ error: 'parse_failed', articles: [] });
      return;
    }

    const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    articles = (Array.isArray(articles) ? articles : []).slice(0, 6).map((a) => ({
      title: String(a.title || 'Match Preview'),
      excerpt: String(a.excerpt || ''),
      body: String(a.body || ''),
      tag: String(a.tag || 'Match Preview'),
      date: today,
      read: '3 min'
    }));

    // Cache at the edge so Claude is called at most ~4×/day regardless of traffic.
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    res.status(200).json({ articles });
  } catch (e) {
    res.status(500).json({ error: String(e), articles: [] });
  }
};

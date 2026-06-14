// MatchDay 2026 — newsletter signup (Vercel serverless function).
//
// Saves the email to Supabase, adds the contact to Brevo, and sends a branded
// welcome email — all server-side so the Brevo API key never reaches the browser.
//
// Env vars (Vercel → Settings → Environment Variables):
//   BREVO_API_KEY       — your Brevo API key (starts xkeysib-...)
//   BREVO_SENDER_EMAIL  — a sender you've VERIFIED in Brevo (e.g. your email)
//   BREVO_LIST_ID       — (optional) the numeric id of a Brevo contact list
//
// If BREVO_API_KEY / BREVO_SENDER_EMAIL aren't set yet, the signup still saves
// to Supabase and returns success (just without sending an email).

const SUPABASE_URL = 'https://qukmdzrjkvqnjgfpexxz.supabase.co';
const SUPABASE_ANON = 'sb_publishable_16t-FyMIZgXd0Ekrh4E2LQ_S350qtfa';

function welcomeHtml() {
  return '' +
  '<!doctype html><html><body style="margin:0;padding:0;background:#f2f2f5;">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f5;padding:24px 0;">' +
  '<tr><td align="center">' +
  '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">' +
  '<tr><td style="background:#0F1B2E;padding:28px 32px;text-align:center;">' +
  '<div style="font-size:26px;font-weight:bold;letter-spacing:2px;color:#FFD700;">MATCHDAY <span style="color:#ffffff;">2026</span></div>' +
  '<div style="color:#9fb0c8;font-size:13px;margin-top:6px;">FIFA World Cup 2026 · USA · Canada · Mexico</div>' +
  '</td></tr>' +
  '<tr><td style="padding:32px;">' +
  '<h1 style="margin:0 0 14px;font-size:22px;color:#0F1B2E;">You\'re in! ⚽</h1>' +
  '<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#333;">Welcome to <strong>The Daily Kick</strong> — thanks for joining MatchDay 2026.</p>' +
  '<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#333;">During the tournament you\'ll get match previews, our predictions, results recaps and bracket updates straight to your inbox. No spam, and you can unsubscribe anytime.</p>' +
  '<p style="margin:24px 0;text-align:center;">' +
  '<a href="https://matchday2026.net/" style="background:#FFD700;color:#0F1B2E;text-decoration:none;font-weight:bold;font-size:15px;padding:13px 28px;border-radius:8px;display:inline-block;">Visit MatchDay 2026 →</a>' +
  '</p>' +
  '<p style="margin:0;font-size:15px;line-height:1.6;color:#333;">See you at the match,<br/>The MatchDay 2026 team</p>' +
  '</td></tr>' +
  '<tr><td style="background:#f7f7f9;padding:18px 32px;text-align:center;color:#888;font-size:12px;line-height:1.5;">' +
  'You\'re receiving this because you signed up at matchday2026.net.' +
  '</td></tr>' +
  '</table></td></tr></table></body></html>';
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }

    // Read + parse the body (Vercel may or may not pre-parse it).
    let body = req.body;
    if (body === undefined) {
      body = await new Promise((resolve) => { let d = ''; req.on('data', (c) => d += c); req.on('end', () => resolve(d)); });
    }
    if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
    const email = ((body && body.email) || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { res.status(400).json({ error: 'invalid_email' }); return; }

    // 1. Save to Supabase (duplicate-safe; the anon key is public and fine here).
    try {
      await fetch(SUPABASE_URL + '/rest/v1/subscribers', {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ email: email })
      });
    } catch (e) { /* keep going — email still matters */ }

    const brevoKey = process.env.BREVO_API_KEY || '';
    const sender = process.env.BREVO_SENDER_EMAIL || '';
    const listId = process.env.BREVO_LIST_ID || '';
    if (!brevoKey || !sender) {
      // Brevo not configured yet — signup saved, but no email sent.
      res.status(200).json({ ok: true, emailed: false });
      return;
    }

    // 2. Add the contact to Brevo (and to a list if one is configured).
    try {
      const contact = { email: email, updateEnabled: true };
      if (listId) contact.listIds = [Number(listId)];
      await fetch('https://api.brevo.com/v3/contacts', {
        method: 'POST',
        headers: { 'api-key': brevoKey, 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(contact)
      });
    } catch (e) { /* contact may already exist — ignore */ }

    // 3. Send the welcome email.
    let emailed = false;
    try {
      const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': brevoKey, 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: { name: 'MatchDay 2026', email: sender },
          to: [{ email: email }],
          subject: 'Welcome to MatchDay 2026 ⚽',
          htmlContent: welcomeHtml()
        })
      });
      emailed = r.ok;
      if (!r.ok) { const t = await r.text(); console.error('Brevo send failed:', r.status, t.slice(0, 300)); }
    } catch (e) { console.error('Brevo send error:', String(e)); }

    res.status(200).json({ ok: true, emailed: emailed });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};

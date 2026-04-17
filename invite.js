// api/invite.js
// Requires SUPABASE_SERVICE_ROLE_KEY in Vercel environment variables

module.exports = async function handler(req, res) {
  // CORS headers — must be set before anything else
  res.setHeader('Access-Control-Allow-Origin', 'https://jgimprovements-arch.github.io');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { email, name, role, market, hourly_rate } = req.body || {};
  if (!email || !name) {
    res.status(400).json({ error: 'email and name required' });
    return;
  }

  const SB_URL = 'https://nuykvchgecpiuikoerze.supabase.co';
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE_KEY) {
    res.status(500).json({ error: 'Service key not configured' });
    return;
  }

  try {
    // 1. Send Supabase Auth invite
    const inviteRes = await fetch(SB_URL + '/auth/v1/invite', {
      method: 'POST',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': 'Bearer ' + SERVICE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: email,
        data: { name: name, role: role, market: market }
      })
    });

    const inviteData = await inviteRes.json();
    if (!inviteRes.ok) {
      res.status(400).json({ error: inviteData.message || inviteData.msg || 'Invite failed' });
      return;
    }

    // 2. Upsert employee record
    await fetch(SB_URL + '/rest/v1/employees', {
      method: 'POST',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': 'Bearer ' + SERVICE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        name: name,
        email: email.toLowerCase(),
        role: role || 'Technician',
        market: market || 'Appleton',
        hourly_rate: parseFloat(hourly_rate) || 0,
        active: true
      })
    });

    res.status(200).json({ success: true, message: 'Invite sent to ' + email });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

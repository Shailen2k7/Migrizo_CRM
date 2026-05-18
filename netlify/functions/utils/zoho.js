// netlify/functions/utils/zoho.js
// Manages Zoho OAuth tokens — auto-refreshes when expired

const { supabase } = require('./supabase');

const ZOHO_ACCOUNTS = 'https://accounts.zoho.in';
const CLIENT_ID     = process.env.ZOHO_CLIENT_ID;
const CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;

/**
 * Returns a valid Zoho access token.
 * Reads from DB → refreshes if expired → returns token + api_domain
 */
async function getValidToken() {
  const { data: tokenRow, error } = await supabase
    .from('zoho_tokens')
    .select('*')
    .eq('id', 1)
    .single();

  if (error || !tokenRow) {
    throw new Error('Zoho not connected. Go to Settings → Integrations → Connect Zoho Bigin.');
  }

  const now = new Date();
  const expiresAt = new Date(tokenRow.expires_at);
  const fiveMinsFromNow = new Date(now.getTime() + 5 * 60 * 1000);

  // Still valid for at least 5 minutes
  if (expiresAt > fiveMinsFromNow) {
    return { token: tokenRow.access_token, domain: tokenRow.api_domain };
  }

  // Refresh the token
  const res = await fetch(`${ZOHO_ACCOUNTS}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token:  tokenRow.refresh_token,
      client_id:      CLIENT_ID,
      client_secret:  CLIENT_SECRET,
      grant_type:     'refresh_token'
    })
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
  }

  const newExpiry = new Date(Date.now() + data.expires_in * 1000).toISOString();
  await supabase.from('zoho_tokens').update({
    access_token: data.access_token,
    expires_at:   newExpiry,
    updated_at:   new Date().toISOString()
  }).eq('id', 1);

  return { token: data.access_token, domain: tokenRow.api_domain };
}

/**
 * Makes an authenticated request to the Bigin API.
 * Handles token refresh automatically.
 */
async function biginRequest(path, options = {}) {
  const { token, domain } = await getValidToken();
  const url = `${domain}/bigin/v2${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Zoho-oauthtoken ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bigin API error ${res.status}: ${text}`);
  }

  return res.json();
}

/**
 * CORS + JSON response helper
 */
function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
    },
    body: JSON.stringify(body)
  };
}

module.exports = { getValidToken, biginRequest, jsonResponse };

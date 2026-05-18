// netlify/functions/zoho-callback.js
// Handles Zoho OAuth callback after user grants access.
// Exchanges the auth code for access + refresh tokens and stores in Supabase.

const { supabase } = require('./utils/supabase');

exports.handler = async (event) => {
  const { code, error: oauthError } = event.queryStringParameters || {};

  if (oauthError) {
    return redirect('/settings.html?zoho_error=' + encodeURIComponent(oauthError));
  }

  if (!code) {
    return redirect('/settings.html?zoho_error=no_code');
  }

  try {
    const res = await fetch('https://accounts.zoho.in/oauth/v2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        redirect_uri:  process.env.ZOHO_REDIRECT_URI,
        grant_type:    'authorization_code'
      })
    });

    const data = await res.json();

    if (!data.access_token || !data.refresh_token) {
      console.error('Token exchange failed:', data);
      return redirect('/settings.html?zoho_error=token_failed');
    }

    const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
    const apiDomain = data.api_domain || 'https://www.zohoapis.in';

    // Upsert into zoho_tokens (single row, id=1)
    const { error: dbError } = await supabase.from('zoho_tokens').upsert({
      id:            1,
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      expires_at:    expiresAt,
      api_domain:    apiDomain,
      updated_at:    new Date().toISOString()
    });

    if (dbError) {
      console.error('DB error saving tokens:', dbError);
      return redirect('/settings.html?zoho_error=db_failed');
    }

    // Trigger initial sync of leads from Bigin
    // (fire and forget — sync runs in background)
    fetch(`${process.env.URL}/.netlify/functions/sync-bigin`, { method: 'POST' })
      .catch(() => {}); // don't block redirect on this

    return redirect('/settings.html?zoho_connected=1');

  } catch (err) {
    console.error('OAuth callback error:', err);
    return redirect('/settings.html?zoho_error=' + encodeURIComponent(err.message));
  }
};

function redirect(location) {
  return { statusCode: 302, headers: { Location: location } };
}

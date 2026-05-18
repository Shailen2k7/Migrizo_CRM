// netlify/functions/zoho-auth.js
// Redirects to Zoho OAuth consent screen
// Called when admin clicks "Connect Zoho Bigin" in Settings

exports.handler = async (event) => {
  const clientId    = process.env.ZOHO_CLIENT_ID;
  const redirectUri = process.env.ZOHO_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return {
      statusCode: 500,
      body: 'Missing ZOHO_CLIENT_ID or ZOHO_REDIRECT_URI environment variables'
    };
  }

  const scopes = [
    'ZohoBigin.modules.ALL',
    'ZohoBigin.settings.ALL',
    'ZohoBigin.users.READ',
    'ZohoBigin.notifications.ALL'
  ].join(',');

  const authUrl = new URL('https://accounts.zoho.in/oauth/v2/auth');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');

  return {
    statusCode: 302,
    headers: { Location: authUrl.toString() }
  };
};

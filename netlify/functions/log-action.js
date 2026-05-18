// netlify/functions/log-action.js
// Lightweight endpoint to write to audit_log from frontend actions
// that don't go through write-record (e.g. page views, filter changes, exports)

const { supabase } = require('./utils/supabase');
const { jsonResponse } = require('./utils/zoho');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return jsonResponse(200, {});
  if (event.httpMethod !== 'POST')    return jsonResponse(405, { error: 'Method not allowed' });

  let body;
  try { body = JSON.parse(event.body); }
  catch { return jsonResponse(400, { error: 'Invalid JSON' }); }

  const {
    user_id, user_name, user_email,
    action, entity_type, entity_id, entity_name,
    before_state, after_state
  } = body;

  if (!action || !entity_type) {
    return jsonResponse(400, { error: 'action and entity_type required' });
  }

  try {
    await supabase.from('audit_log').insert({
      user_id:     user_id || null,
      user_name:   user_name || 'Unknown',
      user_email:  user_email || '',
      action,
      entity_type,
      entity_id:   entity_id || null,
      entity_name: entity_name || null,
      before_state: before_state || null,
      after_state:  after_state || null,
      ip_address:  event.headers['x-forwarded-for'] || null,
      created_at:  new Date().toISOString()
    });
    return jsonResponse(200, { logged: true });
  } catch (err) {
    console.error('log-action error:', err.message);
    return jsonResponse(500, { error: err.message });
  }
};

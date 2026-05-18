// netlify/functions/write-record.js
// Unified write endpoint: create or update Contacts, Deals, Tasks in Bigin

const { supabase }    = require('./utils/supabase');
const { biginRequest, jsonResponse } = require('./utils/zoho');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return jsonResponse(200, {});
  if (event.httpMethod !== 'POST')    return jsonResponse(405, { error: 'Method not allowed' });

  let body;
  try { body = JSON.parse(event.body); }
  catch { return jsonResponse(400, { error: 'Invalid JSON' }); }

  const {
    module,          // 'Contacts' | 'Deals' | 'Tasks'
    operation,       // 'create' | 'update'
    id,              // required for update
    data,            // payload fields
    user_id,
    user_name,
    user_email
  } = body;

  if (!module || !operation || !data) {
    return jsonResponse(400, { error: 'module, operation, and data are required' });
  }
  if (operation === 'update' && !id) {
    return jsonResponse(400, { error: 'id is required for update' });
  }

  try {
    let biginRes, action, entityId;

    if (operation === 'create') {
      biginRes = await biginRequest(`/${module}`, {
        method: 'POST',
        body: JSON.stringify({ data: [data] })
      });
      action   = `${module.toLowerCase().slice(0,-1)}_created`;
      entityId = biginRes?.data?.[0]?.details?.id || null;
    } else {
      biginRes = await biginRequest(`/${module}/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ data: [data] })
      });
      action   = `${module.toLowerCase().slice(0,-1)}_updated`;
      entityId = id;
    }

    // Audit log
    await supabase.from('audit_log').insert({
      user_id:      user_id || null,
      user_name:    user_name || 'Unknown',
      user_email:   user_email || '',
      action,
      entity_type:  module.toLowerCase(),
      entity_id:    entityId,
      entity_name:  data.Full_Name || data.Deal_Name || data.Subject || entityId,
      after_state:  data,
      ip_address:   event.headers['x-forwarded-for'] || event.headers['client-ip'] || null,
      created_at:   new Date().toISOString()
    }).catch(e => console.warn('audit log failed:', e.message));

    // Invalidate cache so next fetch is fresh
    if (module === 'Contacts') {
      if (entityId) {
        await supabase.from('leads_cache').delete().eq('zoho_id', entityId).catch(()=>{});
      }
    }
    if (module === 'Tasks') {
      if (entityId) {
        await supabase.from('tasks_cache').delete().eq('zoho_id', entityId).catch(()=>{});
      }
    }

    return jsonResponse(200, { success: true, id: entityId, bigin: biginRes });

  } catch (err) {
    console.error('write-record error:', err.message);
    return jsonResponse(500, { error: err.message });
  }
};

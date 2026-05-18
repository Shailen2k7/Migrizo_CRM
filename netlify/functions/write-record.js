// netlify/functions/write-record.js
// Updates a record in Bigin + writes to audit_log in Supabase.
// Used for: stage changes, payment recording, note additions, etc.

const { supabase }    = require('./utils/supabase');
const { biginRequest, jsonResponse } = require('./utils/zoho');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return jsonResponse(200, {});
  if (event.httpMethod !== 'POST')    return jsonResponse(405, { error: 'Method not allowed' });

  let body;
  try { body = JSON.parse(event.body); }
  catch { return jsonResponse(400, { error: 'Invalid JSON' }); }

  const {
    module,           // 'Contacts', 'Deals', 'Tasks', 'Notes'
    recordId,         // Zoho record ID
    fields,           // { Stage: 'Qualified', ... }
    action,           // 'stage_changed', 'payment_recorded', 'note_added', etc.
    entityType,       // 'lead', 'deal', 'task'
    entityName,       // display name for audit log
    beforeState,      // snapshot before change
    user_id,          // from frontend (Supabase auth)
    user_name,
    user_email
  } = body;

  if (!module || !recordId || !fields) {
    return jsonResponse(400, { error: 'module, recordId, and fields are required' });
  }

  try {
    // 1. Write to Bigin
    const biginRes = await biginRequest(`/${module}/${recordId}`, {
      method: 'PUT',
      body: JSON.stringify({ data: [fields] })
    });

    // 2. Log to audit_log
    const auditEntry = {
      user_id:      user_id  || null,
      user_name:    user_name || 'Unknown',
      user_email:   user_email || '',
      action:       action || 'record_updated',
      entity_type:  entityType || module.toLowerCase(),
      entity_id:    recordId,
      entity_name:  entityName || recordId,
      before_state: beforeState || null,
      after_state:  fields,
      ip_address:   event.headers['x-forwarded-for'] || event.headers['client-ip'] || null,
      created_at:   new Date().toISOString()
    };

    await supabase.from('audit_log').insert(auditEntry);

    // 3. Invalidate cache for this record
    if (entityType === 'lead' || module === 'Contacts') {
      await supabase.from('leads_cache')
        .update({ stage: fields.Stage, amount_paid: fields.Amount_Paid__c, payment_phase: fields.Payment_Phase__c, synced_at: new Date().toISOString() })
        .eq('zoho_id', recordId);
    }

    return jsonResponse(200, { success: true, bigin: biginRes });

  } catch (err) {
    console.error('write-record error:', err.message);
    return jsonResponse(500, { error: err.message });
  }
};

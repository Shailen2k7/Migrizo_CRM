// netlify/functions/sync-bigin.js
// Performs a full sync from Bigin → Supabase cache.
// Called: (1) after first OAuth connection, (2) manually from Settings → Re-sync now

const { supabase }    = require('./utils/supabase');
const { biginRequest, jsonResponse } = require('./utils/zoho');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return jsonResponse(200, {});

  try {
    const results = { contacts: 0, deals: 0, tasks: 0 };

    // ── Contacts ──────────────────────────────────────────────
    const contactFields = 'Full_Name,Phone,Mobile,Email,Tag,Lead_Score__c,Owner,Modified_Time';
    let page = 1, hasMore = true;
    const allContacts = [];

    while (hasMore) {
      const data = await biginRequest(`/Contacts?fields=${contactFields}&per_page=200&page=${page}&sort_by=Modified_Time`);
      const records = data.data || [];
      allContacts.push(...records);
      hasMore = data.info?.more_records === true;
      page++;
      if (page > 10) break; // safety: max 2000 contacts
    }

    // ── Deals ──────────────────────────────────────────────────
    const dealFields = 'Deal_Name,Stage,Amount,Amount_Paid__c,Payment_Phase__c,Contact_Name,Owner,Modified_Time';
    const dealsData  = await biginRequest(`/Deals?fields=${dealFields}&per_page=200&sort_by=Modified_Time`);
    const deals      = dealsData.data || [];
    results.deals    = deals.length;

    // Build contact → deal map
    const dealMap = {};
    deals.forEach(d => {
      const cid = d.Contact_Name?.id;
      if (cid) dealMap[cid] = d;
    });

    // Normalize + upsert contacts
    const leadsToUpsert = allContacts.map(c => {
      const deal = dealMap[c.id] || {};
      return {
        zoho_id:       c.id,
        full_name:     c.Full_Name || '',
        phone:         c.Phone || c.Mobile || '',
        email:         c.Email || '',
        score:         parseInt(c.Lead_Score__c) || 0,
        tags:          parseTags(c.Tag),
        stage:         deal.Stage || 'New Inquiry',
        amount_paid:   parseFloat(deal.Amount_Paid__c) || 0,
        total_fee:     parseFloat(deal.Amount) || 0,
        payment_phase: deal.Payment_Phase__c || null,
        owner_name:    c.Owner?.name || '',
        raw:           { contact: c, deal },
        synced_at:     new Date().toISOString()
      };
    });

    if (leadsToUpsert.length > 0) {
      // Batch upsert in chunks of 50
      for (let i = 0; i < leadsToUpsert.length; i += 50) {
        const chunk = leadsToUpsert.slice(i, i + 50);
        await supabase.from('leads_cache').upsert(chunk, { onConflict: 'zoho_id' });
      }
    }
    results.contacts = leadsToUpsert.length;

    // ── Tasks ──────────────────────────────────────────────────
    const taskFields = 'Subject,Due_Date,Status,Who_Id,Description,Priority';
    const tasksData  = await biginRequest(`/Tasks?fields=${taskFields}&per_page=200&sort_by=Due_Date`);
    const tasks      = (tasksData.data || []).map(t => ({
      zoho_id:      t.id,
      subject:      t.Subject || '',
      due_date:     t.Due_Date ? new Date(t.Due_Date).toISOString() : null,
      status:       t.Status || 'Not Started',
      contact_id:   t.Who_Id?.id || null,
      contact_name: t.Who_Id?.name || '',
      priority:     t.Priority || 'Normal',
      description:  t.Description || '',
      raw:          t,
      synced_at:    new Date().toISOString()
    }));

    if (tasks.length > 0) {
      await supabase.from('tasks_cache').upsert(tasks, { onConflict: 'zoho_id' });
    }
    results.tasks = tasks.length;

    console.log('Sync complete:', results);
    return jsonResponse(200, { success: true, synced: results });

  } catch (err) {
    console.error('sync-bigin error:', err.message);
    return jsonResponse(500, { error: err.message });
  }
};

function parseTags(tagField) {
  if (!tagField) return [];
  if (Array.isArray(tagField)) return tagField.map(t => t.name || t);
  if (typeof tagField === 'string') return tagField.split(',').map(t => t.trim()).filter(Boolean);
  return [];
}

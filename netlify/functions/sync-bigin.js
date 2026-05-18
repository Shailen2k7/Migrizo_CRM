// netlify/functions/sync-bigin.js
// Full sync from Bigin → Supabase cache

const { supabase }    = require('./utils/supabase');
const { biginRequest, jsonResponse } = require('./utils/zoho');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return jsonResponse(200, {});

  try {
    const results = { contacts: 0, deals: 0, tasks: 0 };

    // ── Contacts (standard fields only) ──────────────────────
    const contactFields = 'Full_Name,Phone,Mobile,Email,Owner,Created_Time,Modified_Time';
    let allContacts = [];
    let page = 1, hasMore = true;

    while (hasMore && page <= 10) {
      const data = await biginRequest(`/Contacts?fields=${contactFields}&per_page=200&page=${page}`);
      const records = data.data || [];
      allContacts.push(...records);
      hasMore = data.info?.more_records === true && records.length === 200;
      page++;
    }
    console.log(`Fetched ${allContacts.length} contacts`);

    // ── Deals ─────────────────────────────────────────────────
    let deals = [];
    try {
      const dealFields = 'Deal_Name,Stage,Amount,Contact_Name,Owner,Modified_Time';
      const dealsData  = await biginRequest(`/Deals?fields=${dealFields}&per_page=200`);
      deals = dealsData.data || [];
      console.log(`Fetched ${deals.length} deals`);
    } catch(e) {
      console.warn('Deals fetch failed:', e.message);
    }
    results.deals = deals.length;

    // ── Try custom fields separately (don't fail if missing) ──
    let customMap = {};
    try {
      const customData = await biginRequest(`/Contacts?fields=Full_Name,Lead_Score__c,Tag&per_page=200`);
      (customData.data || []).forEach(c => {
        customMap[c.id] = {
          score: parseInt(c.Lead_Score__c) || 0,
          tags:  parseTags(c.Tag)
        };
      });
    } catch(e) {
      console.warn('Custom fields unavailable:', e.message);
    }

    // ── Tasks ─────────────────────────────────────────────────
    let tasks = [];
    try {
      const taskFields = 'Subject,Due_Date,Status,Who_Id,Description,Priority';
      const tasksData  = await biginRequest(`/Tasks?fields=${taskFields}&per_page=200`);
      tasks = (tasksData.data || []).map(t => ({
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
      console.log(`Fetched ${tasks.length} tasks`);
    } catch(e) {
      console.warn('Tasks fetch failed:', e.message);
    }
    results.tasks = tasks.length;

    // Build deal map
    const dealMap = {};
    deals.forEach(d => {
      const cid = d.Contact_Name?.id;
      if (cid) dealMap[cid] = d;
    });

    // Normalize contacts
    const leads = allContacts.map(c => {
      const deal   = dealMap[c.id] || {};
      const custom = customMap[c.id] || {};
      return {
        zoho_id:       c.id,
        full_name:     c.Full_Name || '',
        phone:         c.Phone || c.Mobile || '',
        email:         c.Email || '',
        score:         custom.score || 0,
        tags:          custom.tags || [],
        stage:         deal.Stage || 'New Inquiry',
        amount_paid:   parseFloat(deal.Amount_Paid__c) || 0,
        total_fee:     parseFloat(deal.Amount) || 0,
        payment_phase: deal.Payment_Phase__c || null,
        owner_name:    c.Owner?.name || '',
        raw:           { contact: c, deal },
        synced_at:     new Date().toISOString()
      };
    });

    // Upsert in chunks
    for (let i = 0; i < leads.length; i += 50) {
      const { error } = await supabase.from('leads_cache')
        .upsert(leads.slice(i, i + 50), { onConflict: 'zoho_id' });
      if (error) console.warn('Upsert error:', error.message);
    }
    results.contacts = leads.length;

    if (tasks.length > 0) {
      await supabase.from('tasks_cache').upsert(tasks, { onConflict: 'zoho_id' });
    }

    console.log('Sync complete:', results);
    return jsonResponse(200, { success: true, synced: results });

  } catch (err) {
    console.error('sync-bigin error:', err.message, err.stack);
    return jsonResponse(500, { error: err.message });
  }
};

function parseTags(t) {
  if (!t) return [];
  if (Array.isArray(t)) return t.map(x => x.name || x);
  if (typeof t === 'string') return t.split(',').map(x => x.trim()).filter(Boolean);
  return [];
}

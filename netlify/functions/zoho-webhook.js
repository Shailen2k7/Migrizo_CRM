// netlify/functions/zoho-webhook.js
// Receives real-time webhook from Bigin when any record changes.
// Keeps Supabase cache in sync automatically — no polling needed.
//
// Setup in Bigin: Settings → Developer Space → Webhooks
// URL: https://migrizo-crm.netlify.app/.netlify/functions/zoho-webhook
// Events: Create, Edit, Delete on Contacts, Deals, Tasks, Events

const { supabase }    = require('./utils/supabase');
const { biginRequest } = require('./utils/zoho');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 200, body: 'ok' };

  let payload;
  try { payload = JSON.parse(event.body); }
  catch { return { statusCode: 200, body: 'ignored' }; }

  const operations = Array.isArray(payload) ? payload : [payload];

  for (const op of operations) {
    const { module, id, operation } = op;
    if (!module || !id) continue;

    try {
      if (operation === 'delete') {
        await handleDelete(module, id);
      } else {
        await handleUpsert(module, id);
      }
    } catch (err) {
      console.error(`Webhook error for ${module}/${id}:`, err.message);
      // Don't fail — acknowledge webhook even if cache update fails
    }
  }

  return { statusCode: 200, body: 'synced' };
};

async function handleDelete(module, id) {
  if (module === 'Contacts') {
    await supabase.from('leads_cache').delete().eq('zoho_id', id);
  } else if (module === 'Tasks') {
    await supabase.from('tasks_cache').delete().eq('zoho_id', id);
  } else if (module === 'Events') {
    await supabase.from('events_cache').delete().eq('zoho_id', id);
  }
}

async function handleUpsert(module, id) {
  if (module === 'Contacts') {
    const fields = 'Full_Name,Phone,Mobile,Email,Tag,Lead_Score__c,Owner';
    const data   = await biginRequest(`/Contacts/${id}?fields=${fields}`);
    const c      = data?.data?.[0];
    if (!c) return;

    // Also fetch associated deal
    const dealsData = await biginRequest(`/Deals?criteria=(Contact_Name:equals:${id})&fields=Stage,Amount,Amount_Paid__c,Payment_Phase__c&per_page=1`);
    const deal = dealsData?.data?.[0] || {};

    await supabase.from('leads_cache').upsert({
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
    }, { onConflict: 'zoho_id' });

  } else if (module === 'Tasks') {
    const fields = 'Subject,Due_Date,Status,Who_Id,Description,Priority';
    const data   = await biginRequest(`/Tasks/${id}?fields=${fields}`);
    const t      = data?.data?.[0];
    if (!t) return;

    await supabase.from('tasks_cache').upsert({
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
    }, { onConflict: 'zoho_id' });
  }
}

function parseTags(tagField) {
  if (!tagField) return [];
  if (Array.isArray(tagField)) return tagField.map(t => t.name || t);
  if (typeof tagField === 'string') return tagField.split(',').map(t => t.trim()).filter(Boolean);
  return [];
}

// netlify/functions/get-leads.js
// Returns all leads (Contacts + Deals) from cache or directly from Bigin.

const { supabase }    = require('./utils/supabase');
const { biginRequest, jsonResponse } = require('./utils/zoho');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return jsonResponse(200, {});

  try {
    const stage  = event.queryStringParameters?.stage  || null;
    const search = event.queryStringParameters?.search || null;
    const limit  = parseInt(event.queryStringParameters?.limit || '200');

    // Try cache first
    let query = supabase.from('leads_cache').select('*').order('full_name');
    if (stage)  query = query.eq('stage', stage);
    if (search) query = query.or(`full_name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);
    query = query.limit(limit);

    const { data: cached, error: cacheErr } = await query;

    if (!cacheErr && cached && cached.length > 0) {
      return jsonResponse(200, { leads: cached, source: 'cache', total: cached.length });
    }

    // Cache miss — fetch directly from Bigin and populate cache
    console.log('Cache miss — fetching from Bigin...');

    // Fetch Contacts
    const fields = 'Full_Name,Phone,Mobile,Email,Tag,Lead_Score__c,Owner';
    const contactsData = await biginRequest(`/Contacts?fields=${fields}&per_page=200&sort_order=desc`);
    const contacts = contactsData.data || [];

    // Fetch Deals (pipeline data)
    const dealFields = 'Deal_Name,Stage,Amount,Amount_Paid__c,Payment_Phase__c,Contact_Name,Owner,Modified_Time';
    const dealsData  = await biginRequest(`/Deals?fields=${dealFields}&per_page=200`);
    const deals      = dealsData.data || [];

    // Build a map: contact_id → deal
    const dealMap = {};
    deals.forEach(d => {
      const cid = d.Contact_Name?.id;
      if (cid) dealMap[cid] = d;
    });

    // Normalize
    const leads = contacts.map(c => {
      const deal = dealMap[c.id] || {};
      return {
        zoho_id:        c.id,
        full_name:      c.Full_Name || '',
        phone:          formatPhone(c.Phone || c.Mobile || ''),
        email:          c.Email || '',
        score:          parseInt(c.Lead_Score__c) || 0,
        tags:           parseTags(c.Tag),
        stage:          deal.Stage || 'New Inquiry',
        amount_paid:    parseFloat(deal.Amount_Paid__c) || 0,
        total_fee:      parseFloat(deal.Amount) || 0,
        payment_phase:  deal.Payment_Phase__c || null,
        owner_name:     c.Owner?.name || 'Manik Verma',
        raw: { contact: c, deal }
      };
    });

    // Upsert into cache
    if (leads.length > 0) {
      await supabase.from('leads_cache').upsert(
        leads.map(l => ({ ...l, synced_at: new Date().toISOString() })),
        { onConflict: 'zoho_id' }
      );
    }

    // Filter after normalizing if query params set
    let filtered = leads;
    if (stage)  filtered = filtered.filter(l => l.stage === stage);
    if (search) {
      const s = search.toLowerCase();
      filtered = filtered.filter(l =>
        l.full_name.toLowerCase().includes(s) ||
        l.phone.includes(s) ||
        l.email.toLowerCase().includes(s)
      );
    }

    return jsonResponse(200, { leads: filtered, source: 'bigin', total: filtered.length });

  } catch (err) {
    console.error('get-leads error:', err.message);
    return jsonResponse(500, { error: err.message });
  }
};

// Helpers
function formatPhone(raw) {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+91 ${digits.slice(0,5)} ${digits.slice(5)}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+91 ${digits.slice(2,7)} ${digits.slice(7)}`;
  return raw;
}

function parseTags(tagField) {
  if (!tagField) return [];
  if (Array.isArray(tagField)) return tagField.map(t => t.name || t);
  if (typeof tagField === 'string') return tagField.split(',').map(t => t.trim()).filter(Boolean);
  return [];
}

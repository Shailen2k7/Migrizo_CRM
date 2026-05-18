// netlify/functions/get-leads.js
// Fetches contacts + deals from Bigin, caches in Supabase

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

    // Cache miss — fetch from Bigin using only STANDARD fields
    console.log('Fetching from Bigin...');

    // Standard Bigin fields only (no custom fields)
    const contactFields = 'Full_Name,Phone,Mobile,Email,Owner,Created_Time,Modified_Time';
    let contactsData;
    try {
      contactsData = await biginRequest(`/Contacts?fields=${contactFields}&per_page=200`);
    } catch (err) {
      console.error('Bigin contacts error:', err.message);
      return jsonResponse(500, { error: 'Bigin API error: ' + err.message });
    }

    const contacts = contactsData.data || [];
    console.log(`Fetched ${contacts.length} contacts`);

    // Fetch deals separately
    const dealFields = 'Deal_Name,Stage,Amount,Contact_Name,Owner,Modified_Time';
    let deals = [];
    try {
      const dealsData = await biginRequest(`/Deals?fields=${dealFields}&per_page=200`);
      deals = dealsData.data || [];
      console.log(`Fetched ${deals.length} deals`);
    } catch (err) {
      console.warn('Deals fetch failed (non-fatal):', err.message);
    }

    // Try to fetch custom fields separately — don't fail if they don't exist
    let customFieldMap = {};
    try {
      const customData = await biginRequest(`/Contacts?fields=Full_Name,Lead_Score__c,Tag&per_page=200`);
      (customData.data || []).forEach(c => {
        customFieldMap[c.id] = {
          score: parseInt(c.Lead_Score__c) || 0,
          tags: parseTags(c.Tag)
        };
      });
    } catch (err) {
      console.warn('Custom fields not available (Lead_Score__c / Tag) — skipping');
    }

    // Build contact → deal map
    const dealMap = {};
    deals.forEach(d => {
      const cid = d.Contact_Name?.id;
      if (cid) dealMap[cid] = d;
    });

    // Normalize
    const leads = contacts.map(c => {
      const deal    = dealMap[c.id] || {};
      const custom  = customFieldMap[c.id] || {};
      const score   = custom.score || 0;
      const tags    = custom.tags || [];
      const paid    = parseFloat(deal.Amount_Paid__c) || 0;
      const total   = parseFloat(deal.Amount) || 0;

      return {
        zoho_id:       c.id,
        full_name:     c.Full_Name || '',
        phone:         formatPhone(c.Phone || c.Mobile || ''),
        email:         c.Email || '',
        score,
        tags,
        stage:         deal.Stage || 'New Inquiry',
        amount_paid:   paid,
        total_fee:     total,
        payment_phase: deal.Payment_Phase__c || null,
        owner_name:    c.Owner?.name || '',
        raw:           { contact: c, deal },
        synced_at:     new Date().toISOString()
      };
    });

    // Upsert into cache
    if (leads.length > 0) {
      for (let i = 0; i < leads.length; i += 50) {
        const chunk = leads.slice(i, i + 50);
        const { error: upsertErr } = await supabase.from('leads_cache')
          .upsert(chunk, { onConflict: 'zoho_id' });
        if (upsertErr) console.warn('Cache upsert warning:', upsertErr.message);
      }
    }

    // Apply filters
    let filtered = leads;
    if (stage)  filtered = filtered.filter(l => l.stage === stage);
    if (search) {
      const s = search.toLowerCase();
      filtered = filtered.filter(l =>
        l.full_name.toLowerCase().includes(s) ||
        l.phone.includes(s) ||
        (l.email || '').toLowerCase().includes(s)
      );
    }

    return jsonResponse(200, { leads: filtered, source: 'bigin', total: filtered.length });

  } catch (err) {
    console.error('get-leads fatal error:', err.message, err.stack);
    return jsonResponse(500, { error: err.message });
  }
};

function formatPhone(raw) {
  if (!raw) return '';
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

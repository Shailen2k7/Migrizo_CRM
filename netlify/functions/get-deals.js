// netlify/functions/get-deals.js
// Returns pipeline deals from Bigin (standard fields only)

const { biginRequest, jsonResponse } = require('./utils/zoho');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return jsonResponse(200, {});

  try {
    const fields = 'Deal_Name,Stage,Amount,Contact_Name,Owner,Modified_Time,Closing_Date';
    let biginData;
    try {
      biginData = await biginRequest(`/Deals?fields=${fields}&per_page=200`);
    } catch(err) {
      console.warn('Bigin deals fetch:', err.message);
      return jsonResponse(200, { deals: [], warning: err.message });
    }

    const deals = (biginData.data || []).map(d => ({
      zoho_id:        d.id,
      deal_name:      d.Deal_Name || '',
      stage:          d.Stage || '',
      total_fee:      parseFloat(d.Amount) || 0,
      amount_paid:    0, // custom field, populated below if available
      payment_phase:  null,
      contact_name:   d.Contact_Name?.name || '',
      contact_id:     d.Contact_Name?.id || null,
      owner:          d.Owner?.name || '',
      modified_time:  d.Modified_Time,
      closing_date:   d.Closing_Date,
      pct_paid:       0
    }));

    // Try to fetch custom payment fields separately (won't break if missing)
    try {
      const customData = await biginRequest(`/Deals?fields=Deal_Name,Amount_Paid__c,Payment_Phase__c&per_page=200`);
      const customMap = {};
      (customData.data || []).forEach(d => {
        customMap[d.id] = {
          amount_paid:   parseFloat(d.Amount_Paid__c) || 0,
          payment_phase: d.Payment_Phase__c || null
        };
      });
      deals.forEach(d => {
        const c = customMap[d.zoho_id];
        if (c) {
          d.amount_paid = c.amount_paid;
          d.payment_phase = c.payment_phase;
          d.pct_paid = d.total_fee > 0 ? Math.round((d.amount_paid / d.total_fee) * 100) : 0;
        }
      });
    } catch(_) {
      // custom fields don't exist — that's fine
    }

    return jsonResponse(200, { deals, total: deals.length });

  } catch (err) {
    console.error('get-deals error:', err.message);
    return jsonResponse(500, { error: err.message });
  }
};

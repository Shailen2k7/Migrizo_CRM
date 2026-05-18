// netlify/functions/get-deals.js
// Returns pipeline deals (payment milestones) from Bigin

const { biginRequest, jsonResponse } = require('./utils/zoho');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return jsonResponse(200, {});

  try {
    const phase = event.queryStringParameters?.phase || null;

    const fields = 'Deal_Name,Stage,Amount,Amount_Paid__c,Payment_Phase__c,Contact_Name,Owner,Modified_Time,Days_In_Stage__c';
    let path = `/Deals?fields=${fields}&per_page=200&sort_by=Modified_Time&sort_order=desc`;
    if (phase) path += `&criteria=(Payment_Phase__c:equals:${encodeURIComponent(phase)})`;

    const data = await biginRequest(path);
    const deals = (data.data || []).map(d => ({
      zoho_id:        d.id,
      deal_name:      d.Deal_Name || '',
      stage:          d.Stage || '',
      total_fee:      parseFloat(d.Amount) || 0,
      amount_paid:    parseFloat(d.Amount_Paid__c) || 0,
      payment_phase:  d.Payment_Phase__c || 'Kickstart',
      contact_name:   d.Contact_Name?.name || '',
      contact_id:     d.Contact_Name?.id || null,
      owner:          d.Owner?.name || '',
      days_in_stage:  parseInt(d.Days_In_Stage__c) || 0,
      modified_time:  d.Modified_Time,
      pct_paid:       d.Amount > 0 ? Math.round((parseFloat(d.Amount_Paid__c) / parseFloat(d.Amount)) * 100) : 0
    }));

    return jsonResponse(200, { deals, total: deals.length });

  } catch (err) {
    console.error('get-deals error:', err.message);
    return jsonResponse(500, { error: err.message });
  }
};

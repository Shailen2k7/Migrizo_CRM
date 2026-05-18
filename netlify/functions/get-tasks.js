// netlify/functions/get-tasks.js
// Returns tasks (follow-ups) from Bigin

const { supabase }    = require('./utils/supabase');
const { biginRequest, jsonResponse } = require('./utils/zoho');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return jsonResponse(200, {});

  try {
    const status = event.queryStringParameters?.status || null;
    const today  = new Date(); today.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

    // Try cache first
    let query = supabase.from('tasks_cache').select('*').order('due_date');
    if (status === 'Overdue')   query = query.lt('due_date', today.toISOString()).neq('status', 'Completed');
    if (status === 'Today')     query = query.gte('due_date', today.toISOString()).lt('due_date', tomorrow.toISOString());
    if (status === 'Upcoming')  query = query.gte('due_date', tomorrow.toISOString()).neq('status', 'Completed');
    if (status === 'Completed') query = query.eq('status', 'Completed');
    query = query.limit(200);

    const { data: cached } = await query;
    if (cached && cached.length > 0) {
      return jsonResponse(200, { tasks: cached, source: 'cache' });
    }

    // Fetch fresh from Bigin (standard fields only)
    const fields = 'Subject,Due_Date,Status,Who_Id,Description,Priority,Created_Time,Modified_Time';
    let biginData;
    try {
      biginData = await biginRequest(`/Tasks?fields=${fields}&per_page=200`);
    } catch(err) {
      // No tasks endpoint or empty
      console.warn('Bigin tasks fetch:', err.message);
      return jsonResponse(200, { tasks: [], source: 'bigin', warning: err.message });
    }

    const tasks = (biginData.data || []).map(t => ({
      zoho_id:      t.id,
      subject:      t.Subject || '',
      due_date:     t.Due_Date ? new Date(t.Due_Date).toISOString() : null,
      status:       t.Status || 'Not Started',
      contact_id:   t.Who_Id?.id || null,
      contact_name: t.Who_Id?.name || '',
      priority:     t.Priority || 'Normal',
      description:  t.Description || '',
      synced_at:    new Date().toISOString(),
      raw:          t
    }));

    if (tasks.length > 0) {
      await supabase.from('tasks_cache').upsert(tasks, { onConflict: 'zoho_id' }).catch(()=>{});
    }

    return jsonResponse(200, { tasks, source: 'bigin' });

  } catch (err) {
    console.error('get-tasks error:', err.message);
    return jsonResponse(500, { error: err.message });
  }
};

// netlify/functions/get-tasks.js
// Returns follow-up tasks from cache (or live from Bigin on cache miss)

const { supabase }    = require('./utils/supabase');
const { biginRequest, jsonResponse } = require('./utils/zoho');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return jsonResponse(200, {});

  try {
    const status = event.queryStringParameters?.status || null; // 'Overdue','Today','Upcoming','Completed'
    const today  = new Date(); today.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

    // Try cache
    let query = supabase.from('tasks_cache').select('*').order('due_date');
    if (status === 'Overdue')   query = query.lt('due_date', today.toISOString()).eq('status', 'Not Started');
    if (status === 'Today')     query = query.gte('due_date', today.toISOString()).lt('due_date', tomorrow.toISOString());
    if (status === 'Upcoming')  query = query.gte('due_date', tomorrow.toISOString());
    if (status === 'Completed') query = query.eq('status', 'Completed');
    query = query.limit(200);

    const { data: cached, error: cacheErr } = await query;

    if (!cacheErr && cached && cached.length > 0) {
      return jsonResponse(200, { tasks: cached, source: 'cache' });
    }

    // Fetch from Bigin
    const fields = 'Subject,Due_Date,Status,Who_Id,Description,Priority';
    const biginData = await biginRequest(`/Tasks?fields=${fields}&per_page=200&sort_by=Due_Date`);
    const tasks = (biginData.data || []).map(t => ({
      zoho_id:       t.id,
      subject:       t.Subject || '',
      due_date:      t.Due_Date ? new Date(t.Due_Date).toISOString() : null,
      status:        t.Status || 'Not Started',
      contact_id:    t.Who_Id?.id || null,
      contact_name:  t.Who_Id?.name || '',
      priority:      t.Priority || 'Normal',
      description:   t.Description || '',
      raw:           t
    }));

    if (tasks.length > 0) {
      await supabase.from('tasks_cache').upsert(
        tasks.map(t => ({ ...t, synced_at: new Date().toISOString() })),
        { onConflict: 'zoho_id' }
      );
    }

    return jsonResponse(200, { tasks, source: 'bigin' });

  } catch (err) {
    console.error('get-tasks error:', err.message);
    return jsonResponse(500, { error: err.message });
  }
};

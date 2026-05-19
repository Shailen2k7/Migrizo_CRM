// netlify/functions/get-case.js
// Returns one case with all its tasks (grouped by caller as needed).
// Query: ?id=<uuid>

const { supabase }    = require('./utils/supabase');
const { jsonResponse } = require('./utils/zoho');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return jsonResponse(200, {});

  const id = event.queryStringParameters?.id;
  if (!id) return jsonResponse(400, { error: 'id is required' });

  try {
    const { data: c, error: cErr } = await supabase
      .from('cases').select('*').eq('id', id).single();
    if (cErr || !c) return jsonResponse(404, { error: 'Case not found' });

    const { data: tasks, error: tErr } = await supabase
      .from('case_tasks')
      .select('*')
      .eq('case_id', id)
      .order('stage', { ascending: true })
      .order('sort_order', { ascending: true });
    if (tErr) throw new Error(tErr.message);

    return jsonResponse(200, { case: c, tasks: tasks || [] });
  } catch (err) {
    console.error('get-case error:', err.message);
    return jsonResponse(500, { error: err.message });
  }
};

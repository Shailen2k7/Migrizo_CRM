// netlify/functions/get-cases.js
// Lists all cases with per-stage progress aggregates.
// Query params (all optional): status, stage, search

const { supabase }    = require('./utils/supabase');
const { jsonResponse } = require('./utils/zoho');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return jsonResponse(200, {});

  try {
    const statusFilter = event.queryStringParameters?.status || null;
    const stageFilter  = event.queryStringParameters?.stage  || null;
    const search       = event.queryStringParameters?.search || null;

    let query = supabase.from('cases').select('*').order('updated_at', { ascending: false });
    if (statusFilter) query = query.eq('status', statusFilter);
    if (stageFilter)  query = query.eq('current_stage', parseInt(stageFilter));
    if (search) {
      query = query.or(
        `client_name.ilike.%${search}%,client_phone.ilike.%${search}%,client_email.ilike.%${search}%`
      );
    }

    const { data: cases, error: casesErr } = await query;
    if (casesErr) throw new Error(casesErr.message);

    if (!cases || cases.length === 0) {
      return jsonResponse(200, { cases: [], total: 0 });
    }

    // Pull task status for all returned cases in one round-trip
    const caseIds = cases.map(c => c.id);
    const { data: tasks, error: tasksErr } = await supabase
      .from('case_tasks')
      .select('case_id,stage,status')
      .in('case_id', caseIds);
    if (tasksErr) console.warn('case_tasks aggregate warning:', tasksErr.message);

    // Build progress map: case_id → { byStage: {1..6}, totalDone, totalAll }
    const emptyStages = () => ({1:{done:0,total:0},2:{done:0,total:0},3:{done:0,total:0},4:{done:0,total:0},5:{done:0,total:0},6:{done:0,total:0}});
    const progressMap = {};
    (tasks || []).forEach(t => {
      if (t.status === 'na') return;                 // N/A excluded from totals
      const p = progressMap[t.case_id] = progressMap[t.case_id] || { byStage: emptyStages(), totalDone: 0, totalAll: 0 };
      p.byStage[t.stage].total++;
      p.totalAll++;
      if (t.status === 'done') {
        p.byStage[t.stage].done++;
        p.totalDone++;
      }
    });

    const enriched = cases.map(c => ({
      ...c,
      progress: progressMap[c.id] || { byStage: emptyStages(), totalDone: 0, totalAll: 0 }
    }));

    return jsonResponse(200, { cases: enriched, total: enriched.length });
  } catch (err) {
    console.error('get-cases error:', err.message);
    return jsonResponse(500, { error: err.message });
  }
};

// netlify/functions/ai-coo.js
// Calls Anthropic Claude API to act as an AI Chief Operating Officer
// for the user's CRM data.

const { supabase }    = require('./utils/supabase');
const { jsonResponse } = require('./utils/zoho');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return jsonResponse(200, {});
  if (event.httpMethod !== 'POST')    return jsonResponse(405, { error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return jsonResponse(503, {
      error: 'AI COO is not configured. Add ANTHROPIC_API_KEY to your Netlify environment variables.',
      configured: false
    });
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return jsonResponse(400, { error: 'Invalid JSON' }); }

  const { question, context: extraContext } = body;
  if (!question) return jsonResponse(400, { error: 'question is required' });

  try {
    // Build CRM context — pull recent leads + deals + tasks summary
    const [leadsResp, tasksResp] = await Promise.all([
      supabase.from('leads_cache').select('full_name,stage,score,amount_paid,total_fee,phone,email,synced_at').order('synced_at', { ascending: false }).limit(50),
      supabase.from('tasks_cache').select('subject,due_date,status,contact_name,priority').order('due_date').limit(50)
    ]);

    const leads = leadsResp.data || [];
    const tasks = tasksResp.data || [];

    // Aggregate stats
    const totalLeads      = leads.length;
    const closedWon       = leads.filter(l => l.stage === 'Closed Won').length;
    const totalRevenue    = leads.reduce((s, l) => s + (parseFloat(l.amount_paid) || 0), 0);
    const totalPipeline   = leads.reduce((s, l) => s + (parseFloat(l.total_fee) || 0), 0);
    const pendingRevenue  = totalPipeline - totalRevenue;
    const conversionRate  = totalLeads > 0 ? ((closedWon / totalLeads) * 100).toFixed(1) : '0';
    const overdueTasks    = tasks.filter(t => t.due_date && new Date(t.due_date) < new Date() && t.status !== 'Completed').length;
    const todayTasks      = tasks.filter(t => {
      if (!t.due_date) return false;
      const d = new Date(t.due_date);
      const today = new Date(); today.setHours(0,0,0,0);
      return d >= today && d < new Date(today.getTime() + 86400000);
    }).length;

    // Stage breakdown
    const stageGroups = {};
    leads.forEach(l => { stageGroups[l.stage || 'Unspecified'] = (stageGroups[l.stage || 'Unspecified'] || 0) + 1; });

    const contextSummary = `
You are the AI Chief Operating Officer for Migrizo, a UK Global Talent Visa consultancy run by Shailen Pathak.
You have full visibility into the CRM data below. Be direct, actionable, and specific.

=== CURRENT CRM SNAPSHOT ===
Total active leads: ${totalLeads}
Closed deals: ${closedWon}
Conversion rate: ${conversionRate}%
Revenue collected: ₹${totalRevenue.toLocaleString('en-IN')}
Pipeline pending: ₹${pendingRevenue.toLocaleString('en-IN')}
Overdue tasks: ${overdueTasks}
Today's follow-ups: ${todayTasks}

Pipeline by stage:
${Object.entries(stageGroups).map(([s, n]) => `  - ${s}: ${n}`).join('\n')}

Recent leads (top 10):
${leads.slice(0, 10).map(l => `  - ${l.full_name} (${l.stage}) — Paid: ₹${l.amount_paid}/${l.total_fee}, Score: ${l.score}`).join('\n')}

Pending tasks (top 10):
${tasks.slice(0, 10).filter(t => t.status !== 'Completed').map(t => `  - ${t.subject} (${t.contact_name}) — Due: ${t.due_date ? new Date(t.due_date).toLocaleDateString() : 'no date'}, Priority: ${t.priority}`).join('\n')}
${extraContext ? '\n\nAdditional context from user:\n' + extraContext : ''}

Answer the user's question with sharp, actionable insight. Use numbers from the data. If data is missing, say so. Keep replies under 200 words unless asked for detail.`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1024,
        system: contextSummary,
        messages: [{ role: 'user', content: question }]
      })
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      return jsonResponse(500, { error: 'Claude API error: ' + errText });
    }

    const aiData = await aiRes.json();
    const reply = aiData.content?.[0]?.text || 'No response.';

    return jsonResponse(200, {
      answer: reply,
      stats: { totalLeads, closedWon, totalRevenue, pendingRevenue, conversionRate, overdueTasks, todayTasks }
    });

  } catch (err) {
    console.error('ai-coo error:', err.message);
    return jsonResponse(500, { error: err.message });
  }
};

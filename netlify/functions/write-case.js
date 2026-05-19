// netlify/functions/write-case.js
// Unified write endpoint for the Cases module.
// All operations go through one function (matches write-record.js pattern).
//
// Body: { operation, id?, case_id?, data?, user_id?, user_name?, user_email? }
//
// Supported operations:
//   create_case      — creates a case AND seeds default tasks for all 6 stages
//   update_case      — updates case meta fields
//   delete_case      — deletes a case and (cascades) its tasks
//   advance_stage    — moves case forward to a new current_stage
//   create_task      — adds a custom task to a stage
//   update_task      — updates label / status / notes / sort_order
//   delete_task      — removes a task
//   reseed_stage     — re-inserts default tasks for a stage (use with care)

const { supabase }    = require('./utils/supabase');
const { jsonResponse } = require('./utils/zoho');

// ────────────────────────────────────────────────────────────────
// Default task templates per stage.
// Edit these to change what gets seeded for new cases.
// ────────────────────────────────────────────────────────────────
const DEFAULT_TASKS = {
  1: [ // Roadmap Building
    'Kickoff consultation call held',
    'Career history & evidence audit completed',
    'Visa route confirmed (Digital Tech / Academia / Arts etc.)',
    'Endorsing body confirmed (Tech Nation / Royal Society / RAEng etc.)',
    'Talent vs Promise path decided',
    'Personal statement — first draft',
    'Reference architecture mapped (top achievements → criteria)',
    'Timeline & milestones agreed with client',
    'Service agreement signed',
    'Kickstart payment received (25%)'
  ],
  2: [ // Profile Building
    'Passport scan collected',
    'Experience certificates collected (all employers)',
    'Relieving letters collected',
    'Last 3 months salary slips',
    'Updated CV (endorsing body format)',
    'Achievement proofs compiled',
    'Domestic recognition evidence',
    'International recognition evidence',
    'LinkedIn profile optimized',
    'LinkedIn thought leadership posts (10+)',
    'Recommendation Letter 1 — drafter identified',
    'Recommendation Letter 1 — final signed copy',
    'Recommendation Letter 2 — drafter identified',
    'Recommendation Letter 2 — final signed copy',
    'Recommendation Letter 3 — drafter identified',
    'Recommendation Letter 3 — final signed copy',
    'Mentorship session with senior figure',
    'News / media publication arranged',
    'Framework or methodology developed and documented',
    'Academic paper / whitepaper published',
    'Speaking engagement / conference talk delivered',
    'Open source / community contribution evidenced',
    'Awards & nominations documented',
    'Profile Building progress payment received (30%)'
  ],
  3: [ // Final Documents Mapping and Testing
    'All evidence cross-mapped to endorsing body criteria',
    'Personal statement — final version',
    'CV finalized to spec',
    'All PDFs converted to spec (size, naming, format)',
    'Document inventory checklist verified',
    'Mock review by senior consultant',
    'Client final walkthrough call',
    'Sign-off from client received',
    'Endorsement stage payment received (30%)'
  ],
  4: [ // Endorsement Submission
    'Endorsing body portal account created',
    'Application form drafted',
    'All documents uploaded to portal',
    'Endorsement fee paid',
    'Application submitted',
    'Submission acknowledgement received',
    'Decision received (Approved / Rejected)'
  ],
  5: [ // Visa Application Submission
    'UKVI visa application started',
    'Biometrics appointment booked',
    'All documents uploaded to UKVI',
    'Visa application fee paid',
    'IHS (healthcare surcharge) paid',
    'Biometrics submitted',
    'Priority service selected (if applicable)',
    'Visa decision received',
    'Vignette / eVisa / BRP collected',
    'Final payment received (15%)'
  ],
  6: [ // Post Arrival Services
    'Welcome to UK pack delivered',
    'National Insurance number application guided',
    'UK bank account opening guided',
    'Accommodation guidance provided',
    'GP registration completed',
    'Testimonial / case study collected',
    'Referral program introduced',
    '6-month check-in completed',
    '12-month check-in completed'
  ]
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return jsonResponse(200, {});
  if (event.httpMethod !== 'POST')    return jsonResponse(405, { error: 'Method not allowed' });

  let body;
  try { body = JSON.parse(event.body); }
  catch { return jsonResponse(400, { error: 'Invalid JSON' }); }

  const { operation, id, case_id, data = {}, user_id, user_name, user_email } = body;
  if (!operation) return jsonResponse(400, { error: 'operation is required' });

  try {
    let result;

    switch (operation) {

      // ─────────────────────────────────────────────────────────
      case 'create_case': {
        if (!data.client_name) throw new Error('client_name is required');
        const payload = {
          bigin_contact_id:        data.bigin_contact_id || null,
          client_name:             data.client_name,
          client_phone:            data.client_phone || null,
          client_email:            data.client_email || null,
          visa_route:              data.visa_route || 'UK Global Talent Visa',
          current_stage:           data.current_stage || 1,
          status:                  data.status || 'active',
          target_endorsement_date: data.target_endorsement_date || null,
          case_notes:              data.case_notes || '',
          created_by:              user_id || null
        };
        const { data: newCase, error: cErr } = await supabase
          .from('cases').insert(payload).select().single();
        if (cErr) throw new Error(cErr.message);

        // Seed default tasks across all 6 stages
        const rows = [];
        for (const stage of [1, 2, 3, 4, 5, 6]) {
          DEFAULT_TASKS[stage].forEach((label, idx) => {
            rows.push({
              case_id:    newCase.id,
              stage,
              label,
              sort_order: idx,
              status:     'not_started',
              is_custom:  false
            });
          });
        }
        if (rows.length > 0) {
          const { error: tErr } = await supabase.from('case_tasks').insert(rows);
          if (tErr) console.warn('default task seed warning:', tErr.message);
        }

        await logAudit('case_created', 'case', newCase.id, newCase.client_name,
          payload, user_id, user_name, user_email, event);

        result = { case: newCase, tasks_seeded: rows.length };
        break;
      }

      // ─────────────────────────────────────────────────────────
      case 'update_case': {
        if (!id) throw new Error('id is required');
        const allowed = ['client_name','client_phone','client_email','visa_route',
                         'current_stage','status','target_endorsement_date',
                         'case_notes','bigin_contact_id'];
        const updates = {};
        allowed.forEach(k => { if (data[k] !== undefined) updates[k] = data[k]; });
        if (Object.keys(updates).length === 0) throw new Error('no updatable fields supplied');

        const { data: updated, error: uErr } = await supabase
          .from('cases').update(updates).eq('id', id).select().single();
        if (uErr) throw new Error(uErr.message);

        await logAudit('case_updated', 'case', id, updated.client_name,
          updates, user_id, user_name, user_email, event);

        result = { case: updated };
        break;
      }

      // ─────────────────────────────────────────────────────────
      case 'delete_case': {
        if (!id) throw new Error('id is required');
        const { error: dErr } = await supabase.from('cases').delete().eq('id', id);
        if (dErr) throw new Error(dErr.message);
        await logAudit('case_deleted', 'case', id, null, null,
          user_id, user_name, user_email, event);
        result = { deleted: true };
        break;
      }

      // ─────────────────────────────────────────────────────────
      case 'advance_stage': {
        if (!id) throw new Error('id is required');
        const newStage = data.current_stage;
        if (!newStage || newStage < 1 || newStage > 6) {
          throw new Error('Valid current_stage (1-6) required');
        }
        const { data: updated, error: aErr } = await supabase
          .from('cases').update({ current_stage: newStage }).eq('id', id).select().single();
        if (aErr) throw new Error(aErr.message);

        // If advancing to stage 6 with everything done, optionally auto-mark completed.
        // (Left as a manual toggle in the UI for now — predictable wins.)

        await logAudit('case_stage_advanced', 'case', id, updated.client_name,
          { current_stage: newStage }, user_id, user_name, user_email, event);

        result = { case: updated };
        break;
      }

      // ─────────────────────────────────────────────────────────
      case 'create_task': {
        if (!case_id) throw new Error('case_id is required');
        if (!data.label) throw new Error('label is required');
        if (!data.stage) throw new Error('stage is required');

        // Auto-assign next sort_order for this stage
        const { data: maxRow } = await supabase
          .from('case_tasks').select('sort_order')
          .eq('case_id', case_id).eq('stage', data.stage)
          .order('sort_order', { ascending: false }).limit(1);
        const nextOrder = (maxRow && maxRow[0]?.sort_order != null) ? maxRow[0].sort_order + 1 : 0;

        const payload = {
          case_id,
          stage:      data.stage,
          label:      data.label,
          status:     data.status || 'not_started',
          notes:      data.notes || '',
          sort_order: nextOrder,
          is_custom:  true
        };
        const { data: newTask, error: ntErr } = await supabase
          .from('case_tasks').insert(payload).select().single();
        if (ntErr) throw new Error(ntErr.message);
        result = { task: newTask };
        break;
      }

      // ─────────────────────────────────────────────────────────
      case 'update_task': {
        if (!id) throw new Error('id is required');
        const updates = {};
        ['label','status','notes','stage','sort_order'].forEach(k => {
          if (data[k] !== undefined) updates[k] = data[k];
        });
        if (data.status === 'done') {
          updates.completed_at = new Date().toISOString();
        } else if (data.status && data.status !== 'done') {
          updates.completed_at = null;
        }
        const { data: updated, error: utErr } = await supabase
          .from('case_tasks').update(updates).eq('id', id).select().single();
        if (utErr) throw new Error(utErr.message);
        result = { task: updated };
        break;
      }

      // ─────────────────────────────────────────────────────────
      case 'delete_task': {
        if (!id) throw new Error('id is required');
        const { error: dtErr } = await supabase.from('case_tasks').delete().eq('id', id);
        if (dtErr) throw new Error(dtErr.message);
        result = { deleted: true };
        break;
      }

      // ─────────────────────────────────────────────────────────
      case 'reseed_stage': {
        if (!case_id) throw new Error('case_id is required');
        if (!data.stage) throw new Error('stage is required');
        const stage = data.stage;
        // Delete existing non-custom tasks for that stage, then re-seed defaults
        await supabase.from('case_tasks').delete()
          .eq('case_id', case_id).eq('stage', stage).eq('is_custom', false);
        const rows = (DEFAULT_TASKS[stage] || []).map((label, idx) => ({
          case_id, stage, label, sort_order: idx, status: 'not_started', is_custom: false
        }));
        if (rows.length > 0) {
          const { error: rsErr } = await supabase.from('case_tasks').insert(rows);
          if (rsErr) throw new Error(rsErr.message);
        }
        result = { reseeded: rows.length };
        break;
      }

      // ─────────────────────────────────────────────────────────
      default:
        throw new Error('Unknown operation: ' + operation);
    }

    return jsonResponse(200, { success: true, ...result });
  } catch (err) {
    console.error('write-case error:', err.message);
    return jsonResponse(500, { error: err.message });
  }
};

// ────────────────────────────────────────────────────────────────
async function logAudit(action, entity_type, entity_id, entity_name,
                        after_state, user_id, user_name, user_email, event) {
  try {
    await supabase.from('audit_log').insert({
      user_id:     user_id || null,
      user_name:   user_name || 'Unknown',
      user_email:  user_email || '',
      action,
      entity_type,
      entity_id,
      entity_name: entity_name || null,
      after_state: after_state || null,
      ip_address:  event.headers['x-forwarded-for'] || event.headers['client-ip'] || null,
      created_at:  new Date().toISOString()
    });
  } catch (e) {
    console.warn('audit log skipped:', e.message);
  }
}

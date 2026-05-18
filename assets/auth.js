// assets/auth.js — Supabase auth + CRM API layer

const SUPABASE_URL      = 'https://whcrxkufczhqgnshzajt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndoY3J4a3VmY3pocWduc2h6YWp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwNzY5MzQsImV4cCI6MjA5NDY1MjkzNH0.5ZyptBpQOxacrgWqBTT7TR6zT9ugHRsr0z3teaY0YXs';

let _sb = null;
function getClient() {
  if (_sb) return _sb;
  if (!window.supabase) throw new Error('Supabase SDK not loaded yet');
  _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _sb;
}

async function requireAuth() {
  try {
    const sb = getClient();
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = '/login.html?returnTo=' + returnTo;
      return null;
    }
    _patchUserDisplay(session.user);
    return session;
  } catch(e) { console.error('Auth error:', e); window.location.href = '/login.html'; return null; }
}

function _patchUserDisplay(user) {
  try {
    const meta = user.user_metadata || {};
    const name = meta.full_name || user.email?.split('@')[0] || 'User';
    const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    const uName   = document.querySelector('.user-name');
    const uRole   = document.querySelector('.user-role');
    const uAvatar = document.querySelector('.user-card .user-avatar');
    if (uName)   uName.textContent   = name;
    if (uRole)   uRole.textContent   = meta.role === 'admin' ? 'Admin' : 'Counselor';
    if (uAvatar) uAvatar.textContent = initials;
    const userCard = document.querySelector('.user-card');
    if (userCard) {
      userCard.title = 'Click to sign out';
      userCard.style.cursor = 'pointer';
      userCard.onclick = () => { if (confirm('Sign out?')) signOut(); };
    }
    // Update userName in greeting if exists
    const userNameSpan = document.getElementById('userName');
    if (userNameSpan) userNameSpan.textContent = name.split(' ')[0];
  } catch(e) {}
}

async function signOut() {
  try { await getClient().auth.signOut(); } catch(e) {}
  window.location.href = '/login.html';
}

async function getCurrentUser() {
  try {
    const { data: { user } } = await getClient().auth.getUser();
    return user;
  } catch(e) { return null; }
}

async function updateProfile(updates) {
  // Updates user_metadata in Supabase auth
  const { data, error } = await getClient().auth.updateUser({ data: updates });
  if (error) throw error;
  return data.user;
}

// API helpers
async function apiGet(fn, params = {}) {
  const url = new URL('/.netlify/functions/' + fn, window.location.origin);
  Object.entries(params).forEach(([k, v]) => { if (v != null) url.searchParams.set(k, v); });
  const res = await fetch(url.toString());
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'API ' + fn + ' failed: ' + res.status);
  return json;
}

async function apiPost(fn, body = {}) {
  const user = await getCurrentUser();
  const res = await fetch('/.netlify/functions/' + fn, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...body,
      user_id:    user?.id,
      user_name:  user?.user_metadata?.full_name || user?.email,
      user_email: user?.email
    })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'API ' + fn + ' failed: ' + res.status);
  return json;
}

window.requireAuth    = requireAuth;
window.signOut        = signOut;
window.getCurrentUser = getCurrentUser;
window.updateProfile  = updateProfile;

window.CRM = {
  leads:    (p) => apiGet('get-leads', p),
  tasks:    (p) => apiGet('get-tasks', p),
  deals:    (p) => apiGet('get-deals', p),
  sync:     ()  => apiPost('sync-bigin'),
  log:      (a, o) => apiPost('log-action', { action: a, ...o }),
  
  // Create a new contact in Bigin
  addLead:  (lead) => apiPost('write-record', { module: 'Contacts', operation: 'create', data: lead }),
  
  // Update a contact in Bigin (e.g. change stage by updating deal)
  updateLead: (zohoId, updates) => apiPost('write-record', { module: 'Contacts', operation: 'update', id: zohoId, data: updates }),
  
  // Update a deal (stage, amount paid, etc)
  updateDeal: (dealId, updates) => apiPost('write-record', { module: 'Deals', operation: 'update', id: dealId, data: updates }),
  
  // Create a deal
  addDeal: (deal) => apiPost('write-record', { module: 'Deals', operation: 'create', data: deal }),
  
  // Create a follow-up task
  addTask: (task) => apiPost('write-record', { module: 'Tasks', operation: 'create', data: task }),
  
  // Mark task complete
  completeTask: (taskId) => apiPost('write-record', { module: 'Tasks', operation: 'update', id: taskId, data: { Status: 'Completed' } }),
  
  // Call AI COO
  askAI: (question, context) => apiPost('ai-coo', { question, context })
};

// ===== SELF-CHECK (debug aid) =====
console.log('[Migrizo] auth.js loaded ✓', { CRM: !!window.CRM, askAI: !!(window.CRM && window.CRM.askAI), requireAuth: !!window.requireAuth, version: '20260518' });

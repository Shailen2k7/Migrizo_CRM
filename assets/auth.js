// assets/auth.js
// Included on every page. Handles:
//  1. Supabase client init
//  2. Session guard (redirects to login.html if not authenticated)
//  3. Patches topbar/sidebar with real user name
//  4. Data fetch helpers (get leads, tasks, deals)
//  5. Audit log helper

const SUPABASE_URL      = 'https://whcrxkufczhqgnshzajt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndoY3J4a3VmY3pocWduc2h6YWp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwNzY5MzQsImV4cCI6MjA5NDY1MjkzNH0.5ZyptBpQOxacrgWqBTT7TR6zT9ugHRsr0z3teaY0YXs';

// Supabase client (UMD version loaded via CDN in each page <head>)
const _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
window._sbClient = _sb; // expose for inline scripts if needed

// ─────────────────────────────────────────────
// Session guard — call on every protected page
// ─────────────────────────────────────────────
async function requireAuth() {
  const { data: { session } } = await _sb.auth.getSession();
  if (!session) {
    const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login.html?returnTo=${returnTo}`;
    return null;
  }
  // Patch user display
  _patchUserDisplay(session.user);
  return session;
}

function _patchUserDisplay(user) {
  const meta = user.user_metadata || {};
  const name = meta.full_name || user.email?.split('@')[0] || 'User';
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  // Sidebar user card
  const uName     = document.querySelector('.user-name');
  const uRole     = document.querySelector('.user-role');
  const uAvatar   = document.querySelector('.user-card .user-avatar');
  if (uName)   uName.textContent   = name;
  if (uRole)   uRole.textContent   = meta.role === 'admin' ? 'Admin' : 'Counselor';
  if (uAvatar) uAvatar.textContent = initials;

  // Sidebar user card → clicking signs out via dropdown (if ever added)
  const userCard = document.querySelector('.user-card');
  if (userCard) {
    userCard.title = `Signed in as ${user.email}\nClick to sign out`;
    userCard.style.cursor = 'pointer';
    userCard.addEventListener('click', () => {
      if (confirm(`Sign out as ${name}?`)) signOut();
    });
  }
}

// ─────────────────────────────────────────────
// Auth actions
// ─────────────────────────────────────────────
async function signOut() {
  await _sb.auth.signOut();
  window.location.href = '/login.html';
}

async function getCurrentUser() {
  const { data: { user } } = await _sb.auth.getUser();
  return user;
}

// ─────────────────────────────────────────────
// Data fetchers (call Netlify Functions)
// ─────────────────────────────────────────────
async function apiGet(functionName, params = {}) {
  const url = new URL(`/.netlify/functions/${functionName}`, window.location.origin);
  Object.entries(params).forEach(([k, v]) => { if (v != null) url.searchParams.set(k, v); });
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`API ${functionName} failed: ${res.status}`);
  return res.json();
}

async function apiPost(functionName, body = {}) {
  const user = await getCurrentUser();
  const res = await fetch(`/.netlify/functions/${functionName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...body,
      user_id:    user?.id,
      user_name:  user?.user_metadata?.full_name || user?.email,
      user_email: user?.email
    })
  });
  if (!res.ok) throw new Error(`API ${functionName} failed: ${res.status}`);
  return res.json();
}

// Convenience wrappers
window.CRM = {
  leads:  (params)         => apiGet('get-leads', params),
  tasks:  (params)         => apiGet('get-tasks', params),
  deals:  (params)         => apiGet('get-deals', params),
  write:  (body)           => apiPost('write-record', body),
  log:    (action, opts)   => apiPost('log-action', { action, ...opts }),
  sync:   ()               => apiPost('sync-bigin'),

  // Helper: update a Bigin record + log it
  async updateRecord({ module, recordId, fields, action, entityType, entityName, beforeState }) {
    const user = await getCurrentUser();
    return apiPost('write-record', {
      module, recordId, fields, action, entityType, entityName, beforeState,
      user_id:    user?.id,
      user_name:  user?.user_metadata?.full_name || user?.email,
      user_email: user?.email
    });
  }
};

// Make requireAuth globally available
window.requireAuth = requireAuth;
window.signOut = signOut;
window.getCurrentUser = getCurrentUser;

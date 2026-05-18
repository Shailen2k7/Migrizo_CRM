// ==================== SHARED APP JS ====================

// Initialize Lucide icons
if (window.lucide) lucide.createIcons();

// Sidebar nav — placeholder for # links so they highlight
document.querySelectorAll('.nav-item').forEach(n => {
  n.addEventListener('click', (e) => {
    if (n.getAttribute('href') === '#') {
      e.preventDefault();
      document.querySelectorAll('.nav-item').forEach(x => x.classList.remove('active'));
      n.classList.add('active');
    }
  });
});

// Time-aware greeting
function setGreeting() {
  const g = document.getElementById('greetingText');
  if (!g) return;
  const h = new Date().getHours();
  if (h >= 5 && h < 12) g.textContent = 'Good morning';
  else if (h >= 12 && h < 17) g.textContent = 'Good afternoon';
  else if (h >= 17 && h < 22) g.textContent = 'Good evening';
  else g.textContent = 'Hello';

  const subEl = document.getElementById('greetingSub');
  if (subEl) {
    const d = new Date();
    const dateStr = d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    subEl.textContent = `${dateStr} · Here's what's happening in your business`;
  }
}
setGreeting();

// Toast helper
window.showToast = function(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    t.id = 'toast';
    t.innerHTML = '<i data-lucide="check-circle"></i><span id="toastText"></span>';
    document.body.appendChild(t);
    if (window.lucide) lucide.createIcons();
  }
  document.getElementById('toastText').textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 1800);
};

// Global copy-button handler
document.addEventListener('click', async (e) => {
  const cb = e.target.closest('.copy-btn');
  if (!cb) return;
  e.stopPropagation();
  if (cb.dataset.link) { window.open(cb.dataset.link, '_blank'); return; }
  const txt = cb.dataset.copy;
  try { await navigator.clipboard.writeText(txt); } catch(_) {}
  cb.classList.add('copied');
  const orig = cb.innerHTML;
  cb.innerHTML = '<i data-lucide="check"></i>';
  if (window.lucide) lucide.createIcons();
  window.showToast(`Copied: ${txt}`);
  setTimeout(() => { cb.classList.remove('copied'); cb.innerHTML = orig; if (window.lucide) lucide.createIcons(); }, 1200);
});

// Tabs (any element with [data-tab-group])
document.querySelectorAll('[data-tab-group]').forEach(group => {
  group.addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (!t) return;
    group.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    const target = t.dataset.tabTarget;
    if (target) {
      document.querySelectorAll(`[data-tab-pane="${group.dataset.tabGroup}"]`).forEach(p => p.style.display = 'none');
      const pane = document.querySelector(`[data-tab-pane="${group.dataset.tabGroup}"][data-tab-id="${target}"]`);
      if (pane) pane.style.display = '';
    }
  });
});

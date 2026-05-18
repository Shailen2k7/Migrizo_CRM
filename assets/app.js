// ==================== SHARED APP JS ====================

if (window.lucide) lucide.createIcons();

document.querySelectorAll('.nav-item').forEach(n => {
  n.addEventListener('click', (e) => {
    if (n.getAttribute('href') === '#') {
      e.preventDefault();
      document.querySelectorAll('.nav-item').forEach(x => x.classList.remove('active'));
      n.classList.add('active');
    }
  });
});

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

window.fmt = {
  inr(v) { return '₹' + (parseFloat(v) || 0).toLocaleString('en-IN'); },
  inrShort(v) {
    const n = parseFloat(v) || 0;
    if (n >= 10000000) return '₹' + (n/10000000).toFixed(2) + 'Cr';
    if (n >= 100000)   return '₹' + (n/100000).toFixed(2) + 'L';
    if (n >= 1000)     return '₹' + (n/1000).toFixed(1) + 'K';
    return '₹' + n;
  },
  date(d) { if (!d) return '—'; try { return new Date(d).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }); } catch(_) { return '—'; } },
  dateShort(d) { if (!d) return '—'; try { return new Date(d).toLocaleDateString('en-IN', { day:'numeric', month:'short' }); } catch(_) { return '—'; } },
  time(d) { if (!d) return '—'; try { return new Date(d).toLocaleTimeString('en-IN', { hour:'numeric', minute:'2-digit' }); } catch(_) { return '—'; } },
  phone(p) {
    if (!p) return '—';
    const d = String(p).replace(/\D/g, '');
    if (d.length === 10) return '+91 ' + d.slice(0,5) + ' ' + d.slice(5);
    if (d.length === 12 && d.startsWith('91')) return '+91 ' + d.slice(2,7) + ' ' + d.slice(7);
    return p;
  },
  initials(name) {
    if (!name) return '?';
    return name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
  },
  daysFromNow(d) {
    if (!d) return null;
    return Math.round((new Date(d) - new Date()) / (1000*60*60*24));
  }
};

window.showToast = function(msg, kind = 'success') {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; t.id = 'toast'; document.body.appendChild(t); }
  t.className = 'toast ' + (kind === 'error' ? 'toast-error' : kind === 'info' ? 'toast-info' : '');
  const icon = kind === 'error' ? 'alert-circle' : kind === 'info' ? 'info' : 'check-circle';
  t.innerHTML = `<i data-lucide="${icon}"></i><span>${msg}</span>`;
  if (window.lucide) lucide.createIcons();
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2400);
};

window.openModal = function(opts) {
  closeModal();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = '__modal_backdrop';
  backdrop.innerHTML = `
    <div class="modal-card" style="${opts.width ? 'max-width:' + opts.width + 'px' : ''}">
      <div class="modal-head">
        <h3 class="modal-title">${opts.title || 'Modal'}</h3>
        <button class="modal-close" id="__modal_close"><i data-lucide="x"></i></button>
      </div>
      <div class="modal-body" id="__modal_body"></div>
      <div class="modal-foot">
        <button class="btn-secondary" id="__modal_cancel">Cancel</button>
        <button class="btn-primary" id="__modal_submit">${opts.submitLabel || 'Save'}</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  const bodyEl = document.getElementById('__modal_body');
  if (typeof opts.body === 'string') bodyEl.innerHTML = opts.body;
  else if (opts.body instanceof HTMLElement) bodyEl.appendChild(opts.body);
  if (window.lucide) lucide.createIcons();
  document.getElementById('__modal_close').onclick = closeModal;
  document.getElementById('__modal_cancel').onclick = closeModal;
  backdrop.onclick = (e) => { if (e.target === backdrop) closeModal(); };
  document.getElementById('__modal_submit').onclick = async () => {
    const btn = document.getElementById('__modal_submit');
    btn.disabled = true; btn.textContent = 'Saving...';
    try { if (opts.onSubmit) await opts.onSubmit(); closeModal(); }
    catch(err) { btn.disabled = false; btn.textContent = opts.submitLabel || 'Save'; window.showToast('Error: ' + err.message, 'error'); }
  };
  requestAnimationFrame(() => backdrop.classList.add('show'));
};
window.closeModal = function() {
  const b = document.getElementById('__modal_backdrop');
  if (b) b.remove();
};

document.addEventListener('click', async (e) => {
  const cb = e.target.closest('.copy-btn');
  if (!cb) return;
  e.stopPropagation();
  if (cb.dataset.link) { window.open(cb.dataset.link, '_blank'); return; }
  const txt = cb.dataset.copy;
  try { await navigator.clipboard.writeText(txt); } catch(_) {}
  window.showToast('Copied: ' + txt);
});

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

window.emptyState = function(opts) {
  return `
    <div class="empty-state">
      <div class="empty-icon"><i data-lucide="${opts.icon || 'inbox'}"></i></div>
      <h3 class="empty-title">${opts.title || 'No data yet'}</h3>
      <p class="empty-msg">${opts.message || ''}</p>
      ${opts.action ? `<button class="btn-primary" id="${opts.actionId || 'emptyAction'}">${opts.action}</button>` : ''}
    </div>`;
};

// rebuild-notifications.js
// Notification bell, list rendering, toasts, and realtime-update wiring.
// Extracted from rebuild.html for module-size hygiene.
//
// Depends on globals defined in rebuild.html:
//   - sb               : Supabase client
//   - state            : Shared state object (uses state.pmEmail, state.notifications, state.unreadCount, state.selectedProjectId, state.tab, state.notifMenuOpen)
//   - selectProject    : Function to select a project by id
// Depends on globals defined in rebuild-utils.js:
//   - timeAgo
// Depends on globals defined elsewhere on the page:
//   - toast            : Global toast helper
//
// Entry points called from rebuild.html init():
//   - wireNotifBell()
//   - loadNotifications()
// Also re-called from setupRealtime() to refresh on inserts.

// ──── Notifications ────
async function loadNotifications() {
  if (!sb || !state.pmEmail) return;
  const { data } = await sb.from('rebuild_notifications')
    .select('*')
    .eq('recipient_email', state.pmEmail.toLowerCase())
    .order('created_at', { ascending: false })
    .limit(50);
  state.notifications = data || [];
  renderNotifBadge();

  // Send any backlogged email alerts that never went out (e.g., PM was offline when trigger fired)
  // Atomic claim: only send if email_sent_at is still NULL.
  for (const n of state.notifications.filter(x => !x.email_sent_at)) {
    try {
      const { data: claimed } = await sb.from('rebuild_notifications')
        .update({ email_sent_at: new Date().toISOString() })
        .eq('id', n.id)
        .is('email_sent_at', null)
        .select();
      if (!claimed || !claimed.length) continue;
      // Build deep link to the right project + tab
      const tabForEvent = {
        vendor_submitted: 'selections',
        customer_approved: 'selections',
        customer_rejected: 'selections',
        customer_changes_requested: 'selections',
        install_approved: 'selections',
        install_changes_requested: 'selections',
        journal_mention: 'journal',
        customer_journal: 'journal',
        todo_assigned: 'todos',
        todo_completed: 'todos',
        wo_signed: 'workorders',
        wo_auto_drafted: 'workorders',
        invoice_received: 'workorders',
      };
      const targetTab = tabForEvent[n.event_type] || 'phases';
      const ctaUrl = n.project_id
        ? `https://jgimprovements-arch.github.io/jg-dispatch/rebuild.html#p=${n.project_id}&t=${targetTab}`
        : 'https://jgimprovements-arch.github.io/jg-dispatch/rebuild.html';
      await fetch(MESSAGE_HOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'email',
          to_email: n.recipient_email,
          from_email: 'info@jg-restoration.com',
          from_name: 'JG Platform',
          recipient_name: n.recipient_email,
          recipient_type: 'pm_alert',
          subject: '🔔 ' + n.title + ' — JG Platform',
          body: buildBrandedEmail({
            preheader: n.title,
            headline: n.title,
            intro: n.body || '',
            bodyHtml: '',
            ctaLabel: 'Open in JG Platform',
            ctaUrl,
            signoffName: 'JG Platform',
          }),
          attachment_count: 0, attachment_urls: '',
        }),
        mode: 'no-cors',
      });
    } catch (e) { console.error('Backfill notif email failed:', e); }
  }
}

function renderNotifBadge() {
  const unread = state.notifications.filter(n => !n.read_at).length;
  const badge = $('#notifBadge');
  if (!badge) return;
  if (unread > 0) {
    badge.textContent = unread > 99 ? '99+' : unread;
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }
}

function renderNotifList() {
  const wrap = $('#notifList');
  if (!wrap) return;
  const unread = state.notifications.filter(n => !n.read_at);
  if (!unread.length) {
    wrap.innerHTML = '<div class="notif-empty">All caught up 🎉</div>';
    return;
  }
  wrap.innerHTML = unread.map(n => {
    const icon = {
      vendor_submitted: '📋',
      customer_approved: '✅',
      customer_rejected: '❌',
      customer_changes_requested: '↻',
      install_approved: '📅',
      install_changes_requested: '↻',
      journal_mention: '💬',
      customer_journal: '🧑',
      todo_assigned: '✅',
      todo_completed: '✔',
      wo_signed: '✍',
      wo_auto_drafted: '📝',
      invoice_received: '📥',
    }[n.event_type] || '🔔';
    return `
      <div class="notif-item ${n.read_at ? '' : 'unread'}" data-id="${n.id}" data-project="${n.project_id || ''}">
        <div class="notif-title">${icon} ${n.title}</div>
        <div class="notif-body">${n.body || ''}</div>
        <div class="notif-time">${timeAgo(n.created_at)}</div>
      </div>`;
  }).join('');
  wrap.querySelectorAll('.notif-item').forEach(el => {
    el.addEventListener('click', async () => {
      const id = el.dataset.id;
      const projId = el.dataset.project;
      const n = state.notifications.find(x => x.id === id);

      // Mark read
      if (n && !n.read_at) {
        n.read_at = new Date().toISOString();
        await sb.from('rebuild_notifications').update({ read_at: n.read_at }).eq('id', id);
        renderNotifBadge();
        renderNotifList();
      }

      // Map event type → which tab to land on
      const tabForEvent = {
        vendor_submitted: 'selections',
        customer_approved: 'selections',
        customer_rejected: 'selections',
        customer_changes_requested: 'selections',
        install_approved: 'selections',
        install_changes_requested: 'selections',
        journal_mention: 'journal',
        customer_journal: 'journal',
        todo_assigned: 'todos',
        todo_completed: 'todos',
        wo_signed: 'workorders',
        wo_auto_drafted: 'workorders',
        invoice_received: 'workorders',
      };
      const targetTab = tabForEvent[n?.event_type] || 'selections';

      // Switch project if needed
      if (projId && projId !== state.activeProjectId) {
        state.tab = targetTab;
        await selectProject(projId);
      } else if (projId) {
        state.tab = targetTab;
        renderDetail();
      }

      // Scroll to and flash-highlight the specific item
      if (n?.selection_id) {
        setTimeout(() => {
          const card = document.querySelector(`.selection-card[data-id="${n.selection_id}"], .jr-entry[data-id="${n.selection_id}"]`);
          if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            card.style.transition = 'box-shadow .3s, outline .3s';
            card.style.outline = '3px solid var(--orange)';
            card.style.boxShadow = '0 0 0 6px rgba(232,93,4,.15)';
            setTimeout(() => {
              card.style.outline = '';
              card.style.boxShadow = '';
            }, 2400);
          }
        }, 400);
      }

      // Close panel
      $('#notifPanel').classList.remove('on');
      state.notifPanelOpen = false;
    });
  });
}

// timeAgo moved to rebuild-utils.js

function showNotifToast(n) {
  const t = document.createElement('div');
  t.className = 'notif-toast';
  t.innerHTML = `<div class="nt-title">🔔 ${n.title}</div><div class="nt-body">${n.body || ''}</div>`;
  document.body.appendChild(t);
  t.addEventListener('click', () => {
    t.remove();
    $('#notifBell')?.click();
  });
  setTimeout(() => t.remove(), 6000);
}

function wireNotifBell() {
  const panel = $('#notifPanel');
  const markAll = $('#notifMarkAll');
  if (!panel) return;
  // Delegated click — works even after detail panel re-renders
  document.addEventListener('click', (e) => {
    const bellEl = e.target.closest('#notifBell');
    if (bellEl) {
      e.stopPropagation();
      state.notifPanelOpen = !state.notifPanelOpen;
      if (state.notifPanelOpen) {
        renderNotifList();
        panel.classList.add('on');
      } else {
        panel.classList.remove('on');
      }
      return;
    }
    // Click outside closes
    if (!state.notifPanelOpen) return;
    if (!panel.contains(e.target)) {
      panel.classList.remove('on');
      state.notifPanelOpen = false;
    }
  });
  markAll.addEventListener('click', async () => {
    const unread = state.notifications.filter(n => !n.read_at);
    if (!unread.length) return;
    const ids = unread.map(n => n.id);
    await sb.from('rebuild_notifications').update({ read_at: new Date().toISOString() }).in('id', ids);
    state.notifications.forEach(n => { if (!n.read_at) n.read_at = new Date().toISOString(); });
    renderNotifBadge();
    renderNotifList();
  });
}

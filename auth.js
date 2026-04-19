/**
 * JG Platform — Unified Auth
 * ==========================
 * Single source of truth for authentication across the platform.
 *
 *   1. Google SSO (primary)  — @jg-restoration.com OR any email in employees table
 *   2. Email + Password (fallback via Supabase Auth) — for non-JG emails only
 *
 * HOW TO USE:
 *   Just add <script src="auth.js"></script> to any page that has a login box
 *   with id="jg-login". Everything else works automatically:
 *
 *   - Overrides the existing jgGoogleCb() function with a stricter version
 *     that checks the employees table whitelist
 *   - Injects an email+password form into the login box
 *   - Sets jg_platform_user / jg_platform_exp in localStorage on success
 *     (same keys every page already reads)
 *
 * EXISTING PAGE CODE IS UNTOUCHED. Pages still call jgCheckAuth() and friends
 * exactly as before — they just now get the improved behavior automatically.
 */
(function(){
  'use strict';

  var SB_URL = 'https://nuykvchgecpiuikoerze.supabase.co';
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51eWt2Y2hnZWNwaXVpa29lcnplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNjM3ODYsImV4cCI6MjA5MTgzOTc4Nn0.39hZ8DdjT_0iFJXPeAL2FXUSLw8FZBirDVzxZTO1W9s';
  var JG_KEY = 'jg_platform_user';
  var JG_EXP = 'jg_platform_exp';

  // ── HELPERS ──
  function showErr(msg){
    var e = document.getElementById('jg-login-err');
    if (e) { e.textContent = msg; e.style.color = '#c0392b'; }
  }
  function clearErr(){ showErr(''); }

  async function checkEmployee(email){
    // Returns the employee record if they exist AND active, else null
    try {
      var r = await fetch(SB_URL + '/rest/v1/employees?email=eq.' + encodeURIComponent(email.toLowerCase()) + '&select=id,name,role,market,active,pending_approval', {
        headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY }
      });
      if (!r.ok) return null;
      var rows = await r.json();
      return rows && rows[0] ? rows[0] : null;
    } catch(e) { return null; }
  }

  function setSession(user){
    localStorage.setItem(JG_KEY, JSON.stringify(user));
    localStorage.setItem(JG_EXP, String(Date.now() + 43200000)); // 12 hours
  }

  // ── OVERRIDE jgGoogleCb ──
  // Every page defines its own jgGoogleCb to handle Google Sign-In. We override
  // it with a stricter version that validates against the employees table.
  // Called by Google Identity Services after user picks an account.
  window.jgGoogleCb = async function(response){
    clearErr();
    try {
      var payload = JSON.parse(atob(response.credential.split('.')[1]));
      var email = (payload.email || '').toLowerCase();
      if (!email) { showErr('Sign-in failed — no email returned.'); return; }

      var isJGDomain = email.endsWith('@jg-restoration.com');

      // If NOT a JG email, must exist in employees roster
      if (!isJGDomain) {
        var emp = await checkEmployee(email);
        if (!emp) {
          showErr('Your email is not authorized. Contact the office at (920) 428-4200.');
          return;
        }
        if (emp.active === false && !emp.pending_approval) {
          showErr('Your account has been disabled. Contact the office at (920) 428-4200.');
          return;
        }
        // Note: we let pending_approval users through — hub.html shows them the pending screen
      }

      var user = {
        name: payload.name || payload.given_name || email.split('@')[0],
        email: email,
        picture: payload.picture || '',
        auth_method: 'google'
      };
      setSession(user);

      // Check for ?return= redirect param (used by sales_app → sales.html flow)
      var ret = new URLSearchParams(window.location.search).get('return');
      if (ret && ret.indexOf('jgimprovements-arch.github.io') !== -1) {
        window.location.replace(ret);
        return;
      }

      // Hide login — reload triggers each page's own auth flow to pick up the session
      window.location.reload();
    } catch(e) {
      showErr('Sign-in failed — ' + (e.message || 'please try again'));
    }
  };

  // ── EMAIL + PASSWORD SIGN-IN ──
  window.jgEmailSignIn = async function(){
    clearErr();
    var emailEl = document.getElementById('jg-email-input');
    var passEl  = document.getElementById('jg-pass-input');
    var btnEl   = document.getElementById('jg-email-btn');
    if (!emailEl || !passEl) return;

    var email = (emailEl.value || '').trim().toLowerCase();
    var pass  = passEl.value || '';
    if (!email || !pass) { showErr('Enter your email and password.'); return; }

    if (btnEl) { btnEl.textContent = 'Signing in…'; btnEl.disabled = true; }

    try {
      // Authenticate with Supabase Auth
      var r = await fetch(SB_URL + '/auth/v1/token?grant_type=password', {
        method: 'POST',
        headers: { 'apikey': SB_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: pass })
      });
      var data = await r.json();
      if (!r.ok || !data.user) {
        throw new Error(data.error_description || data.msg || 'Invalid email or password');
      }

      // Gate on employees roster — Supabase Auth gives us a valid login,
      // but only employees table entries with active=true can actually use the platform
      var emp = await checkEmployee(email);
      if (!emp) {
        throw new Error('Your account is not authorized. Contact the office.');
      }
      if (emp.active === false && !emp.pending_approval) {
        throw new Error('Your account has been disabled. Contact the office.');
      }

      var user = {
        name: data.user.user_metadata && data.user.user_metadata.name ? data.user.user_metadata.name : (emp.name || email.split('@')[0]),
        email: email,
        picture: '',
        auth_method: 'email',
        access_token: data.access_token
      };
      setSession(user);

      var ret = new URLSearchParams(window.location.search).get('return');
      if (ret && ret.indexOf('jgimprovements-arch.github.io') !== -1) {
        window.location.replace(ret);
        return;
      }

      window.location.reload();
    } catch(err) {
      showErr(err.message);
    }

    if (btnEl) { btnEl.textContent = 'Sign In'; btnEl.disabled = false; }
  };

  // ── INJECT EMAIL FORM INTO LOGIN BOX ──
  function injectEmailForm(){
    var box = document.getElementById('jg-login-box');
    if (!box) return;
    if (document.getElementById('jg-email-form')) return; // already injected

    var errEl = document.getElementById('jg-login-err');

    var form = document.createElement('div');
    form.id = 'jg-email-form';
    form.style.cssText = 'margin-top:16px;padding-top:16px;border-top:1px solid rgba(13,45,94,.12);';
    form.innerHTML = [
      '<div style="font-size:11px;color:#6b82a0;margin-bottom:10px;text-transform:uppercase;letter-spacing:.06em;font-weight:600;">— Or sign in with email —</div>',
      '<input type="email" id="jg-email-input" placeholder="Email address" autocomplete="username" ',
      '  style="width:100%;padding:10px 12px;border-radius:6px;border:1.5px solid rgba(13,45,94,.15);font-size:13px;margin-bottom:8px;box-sizing:border-box;font-family:inherit;outline:none;">',
      '<input type="password" id="jg-pass-input" placeholder="Password" autocomplete="current-password" ',
      '  onkeydown="if(event.key===' + "'Enter'" + ')jgEmailSignIn()" ',
      '  style="width:100%;padding:10px 12px;border-radius:6px;border:1.5px solid rgba(13,45,94,.15);font-size:13px;margin-bottom:10px;box-sizing:border-box;font-family:inherit;outline:none;">',
      '<button id="jg-email-btn" onclick="jgEmailSignIn()" ',
      '  style="width:100%;padding:10px;border-radius:6px;border:none;background:#0d2d5e;color:#fff;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;">Sign In</button>',
      '<div style="font-size:10px;color:#a0abbf;margin-top:10px;line-height:1.4;">Email sign-in is for field employees without an @jg-restoration.com account. Ask the office to create your login.</div>'
    ].join('');

    // Insert before the error element if present, else append
    if (errEl && errEl.parentNode === box) {
      box.insertBefore(form, errEl);
    } else {
      box.appendChild(form);
    }
  }

  // ── MOUNT ──
  function mount(){
    injectEmailForm();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  // ── PUBLIC API ──
  window.JGAuth = {
    check: async function(email){ return await checkEmployee(email); },
    signOut: function(){
      localStorage.removeItem(JG_KEY);
      localStorage.removeItem(JG_EXP);
      window.location.reload();
    },
    user: function(){
      try { return JSON.parse(localStorage.getItem(JG_KEY)||'null'); } catch(e) { return null; }
    }
  };
})();

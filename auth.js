(function () {
  const CLERK_SESSION_KEY = 'tp_clerk_session';

  function now() {
    return Date.now();
  }

  function parseJSON(raw) {
    try {
      return JSON.parse(raw || 'null');
    } catch (err) {
      return null;
    }
  }

  function parseClerkSession() {
    return parseJSON(localStorage.getItem(CLERK_SESSION_KEY));
  }

  function isClerkEnabled() {
    return window.CLERK_ENABLED === true && !!window.CLERK_PUBLISHABLE_KEY;
  }

  function isLoginPage() {
    const path = window.location.pathname || '';
    return path.endsWith('/login.html') || path.endsWith('login.html');
  }

  function isLoggedIn() {
    const s = parseClerkSession();
    if (!s || !s.exp || s.provider !== 'clerk') return false;
    return s.exp > now();
  }

  function getNextFromUrl() {
    const params = new URLSearchParams(window.location.search || '');
    return params.get('next');
  }

  function buildTarget(pageName) {
    const next = window.location.pathname + window.location.search + window.location.hash;
    return pageName + '?next=' + encodeURIComponent(next);
  }

  function requireAuth() {
    if (window.AUTH_DISABLED === true) return;
    if (isLoginPage()) return;

    if (!isLoggedIn()) {
      window.location.replace(buildTarget('login.html'));
    }
  }

  function setClerkSession(sessionData) {
    const ttlMs = window.AUTH_TTL_MS || (30 * 24 * 60 * 60 * 1000);
    const payload = {
      provider: 'clerk',
      exp: now() + ttlMs,
      userId: sessionData && sessionData.userId ? sessionData.userId : null,
      email: sessionData && sessionData.email ? sessionData.email : null,
      firstName: sessionData && sessionData.firstName ? sessionData.firstName : null,
      lastName: sessionData && sessionData.lastName ? sessionData.lastName : null,
      imageUrl: sessionData && sessionData.imageUrl ? sessionData.imageUrl : null,
      group: sessionData && sessionData.group ? sessionData.group : 'Usuario'
    };

    localStorage.setItem(CLERK_SESSION_KEY, JSON.stringify(payload));
  }

  function clearClerkSession() {
    localStorage.removeItem(CLERK_SESSION_KEY);
  }

  function logout() {
    clearClerkSession();
  }

  function getRequestIdentity() {
    const clerk = parseClerkSession();
    if (!clerk || clerk.provider !== 'clerk' || !clerk.userId) {
      return { userId: null, email: null, name: null };
    }

    const fullName = [clerk.firstName, clerk.lastName].filter(Boolean).join(' ').trim() || null;
    return {
      userId: clerk.userId,
      email: clerk.email || null,
      name: fullName
    };
  }

  function getSessionProfile() {
    const clerk = parseClerkSession();
    if (!clerk || clerk.provider !== 'clerk' || !clerk.userId || !clerk.exp || clerk.exp <= now()) return null;

    const fullName = [clerk.firstName, clerk.lastName].filter(Boolean).join(' ').trim();
    const name = fullName || clerk.email || 'Usuario';
    const initials = name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p.charAt(0).toUpperCase())
      .join('') || 'U';

    return {
      name,
      email: clerk.email || '',
      group: clerk.group || 'Usuario',
      imageUrl: clerk.imageUrl || '',
      initials
    };
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function patchFetchWithUserHeaders() {
    if (window.__TP_FETCH_PATCHED__) return;
    if (typeof window.fetch !== 'function') return;

    const originalFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      const requestInit = init ? { ...init } : {};
      const headers = new Headers(requestInit.headers || {});
      const identity = getRequestIdentity();

      if (identity.userId) headers.set('X-User-Id', identity.userId);
      if (identity.email) headers.set('X-User-Email', identity.email);
      if (identity.name) headers.set('X-User-Name', identity.name);

      requestInit.headers = headers;
      return originalFetch(input, requestInit);
    };

    window.__TP_FETCH_PATCHED__ = true;
  }

  function ensureMenuStyles() {
    if (document.getElementById('tpUserMenuStyle')) return;
    const style = document.createElement('style');
    style.id = 'tpUserMenuStyle';
    style.textContent = `
      .tp-user-menu { position: fixed; top: 12px; right: 14px; z-index: 9999; font-family: Inter, sans-serif; }
      .tp-user-menu-btn { display:flex; align-items:center; gap:10px; border:1px solid rgba(255,255,255,.18); background: rgba(10,10,11,.92); color:#fafafa; border-radius:12px; padding:8px 10px; min-width: 220px; cursor:pointer; }
      .tp-user-avatar { width:34px; height:34px; border-radius:50%; background:#fbbf24; color:#111; display:flex; align-items:center; justify-content:center; font-weight:800; overflow:hidden; flex-shrink:0; }
      .tp-user-avatar img { width:100%; height:100%; object-fit:cover; display:block; }
      .tp-user-meta { line-height:1.25; min-width:0; flex:1; text-align:left; }
      .tp-user-name { font-size:13px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .tp-user-group { font-size:11px; color:#a1a1aa; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .tp-user-caret { color:#a1a1aa; font-size:12px; }
      .tp-user-dropdown { display:none; position:absolute; top:calc(100% + 8px); right:0; width:280px; border-radius:12px; border:1px solid rgba(255,255,255,.14); background:#10131c; box-shadow:0 16px 34px rgba(0,0,0,.4); overflow:hidden; }
      .tp-user-menu.open .tp-user-dropdown { display:block; }
      .tp-user-profile { padding:12px; border-bottom:1px solid rgba(255,255,255,.08); }
      .tp-user-profile .tp-user-name { font-size:14px; }
      .tp-user-profile .tp-user-email { color:#a1a1aa; font-size:12px; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .tp-user-profile .tp-user-group { margin-top:6px; font-size:12px; color:#fbbf24; font-weight:600; }
      .tp-user-actions a, .tp-user-actions button { width:100%; border:0; border-top:1px solid rgba(255,255,255,.06); background:transparent; color:#fafafa; text-decoration:none; text-align:left; padding:11px 12px; cursor:pointer; font-size:13px; display:block; }
      .tp-user-actions a:hover, .tp-user-actions button:hover { background:rgba(255,255,255,.06); }
    `;
    document.head.appendChild(style);
  }

  function mountUserMenu() {
    if (isLoginPage()) return;
    if (window.AUTH_DISABLED === true) return;
    if (document.getElementById('tpUserMenu')) return;

    const profile = getSessionProfile();
    if (!profile) return;

    ensureMenuStyles();

    const menu = document.createElement('div');
    menu.id = 'tpUserMenu';
    menu.className = 'tp-user-menu';

    const avatarHtml = profile.imageUrl
      ? `<img src="${escapeHtml(profile.imageUrl)}" alt="Foto do usuario">`
      : `<span>${escapeHtml(profile.initials)}</span>`;

    menu.innerHTML = `
      <button type="button" class="tp-user-menu-btn" id="tpUserMenuBtn" aria-haspopup="menu" aria-expanded="false">
        <span class="tp-user-avatar">${avatarHtml}</span>
        <span class="tp-user-meta">
          <span class="tp-user-name">${escapeHtml(profile.name)}</span>
          <span class="tp-user-group">Grupo: ${escapeHtml(profile.group)}</span>
        </span>
        <span class="tp-user-caret">&#9662;</span>
      </button>
      <div class="tp-user-dropdown" id="tpUserMenuDropdown">
        <div class="tp-user-profile">
          <div class="tp-user-name">${escapeHtml(profile.name)}</div>
          <div class="tp-user-email">${escapeHtml(profile.email || 'Sem e-mail')}</div>
          <div class="tp-user-group">Permissao: ${escapeHtml(profile.group)}</div>
        </div>
        <div class="tp-user-actions">
          <a href="configuracoes.html">Configuracoes de precos</a>
          <button type="button" id="tpUserLogoutBtn">Sair</button>
        </div>
      </div>
    `;

    document.body.appendChild(menu);

    const btn = document.getElementById('tpUserMenuBtn');
    const logoutBtn = document.getElementById('tpUserLogoutBtn');

    btn.addEventListener('click', function () {
      const isOpen = menu.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(isOpen));
    });

    document.addEventListener('click', function (event) {
      if (!menu.contains(event.target)) {
        menu.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      }
    });

    logoutBtn.addEventListener('click', async function () {
      try {
        if (window.Clerk && typeof window.Clerk.signOut === 'function') {
          await window.Clerk.signOut();
        }
      } catch (err) {
        console.warn('Falha ao encerrar sessao no Clerk:', err);
      } finally {
        logout();
        window.location.replace('login.html');
      }
    });
  }

  window.requireAuth = requireAuth;
  window.authLogin = function () { return false; };
  window.authLogout = logout;
  window.authIsLoggedIn = isLoggedIn;
  window.authGetNext = getNextFromUrl;
  window.authSetClerkSession = setClerkSession;
  window.authClearClerkSession = clearClerkSession;
  window.authIsClerkEnabled = isClerkEnabled;
  window.authGetSessionProfile = getSessionProfile;

  patchFetchWithUserHeaders();

  document.addEventListener('DOMContentLoaded', function () {
    requireAuth();
    mountUserMenu();
  });
})();

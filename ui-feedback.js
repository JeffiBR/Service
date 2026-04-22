(function () {
  if (window.tpFeedback && window.tpFeedback.__ready) return;

  function isLoggedInSafe() {
    try {
      if (typeof window.authIsLoggedIn === 'function') return !!window.authIsLoggedIn();
      const raw = localStorage.getItem('tp_auth_session');
      if (!raw) return false;
      const session = JSON.parse(raw);
      return !!(session && session.token && Number(session.exp || 0) > Date.now());
    } catch (_) {
      return false;
    }
  }

  function ensureStyle() {
    if (document.getElementById('tpFeedbackStyle')) return;
    const style = document.createElement('style');
    style.id = 'tpFeedbackStyle';
    style.textContent = `
      .tp-feedback-wrap {
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 2147483200;
        width: min(92vw, 430px);
        display: grid;
        gap: 8px;
        pointer-events: none;
      }
      .tp-toast {
        border-left: 4px solid;
        border-radius: 10px;
        padding: 10px 12px;
        display: flex;
        align-items: center;
        gap: 10px;
        box-shadow: 0 14px 28px rgba(0,0,0,.22);
        transition: transform .2s ease, opacity .2s ease, background-color .2s ease;
        transform: translateY(-8px) scale(.98);
        opacity: 0;
        pointer-events: auto;
      }
      .tp-toast.show {
        transform: translateY(0) scale(1);
        opacity: 1;
      }
      .tp-toast:hover {
        transform: translateY(-1px) scale(1.01);
      }
      .tp-toast .tp-icon {
        width: 20px;
        height: 20px;
        flex-shrink: 0;
      }
      .tp-toast .tp-text {
        margin: 0;
        font-size: 12px;
        line-height: 1.35;
        font-weight: 700;
      }
      .tp-toast.success {
        background: #dcfce7;
        border-left-color: #22c55e;
        color: #14532d;
      }
      .tp-toast.info {
        background: #dbeafe;
        border-left-color: #3b82f6;
        color: #1e3a8a;
      }
      .tp-toast.warning {
        background: #fef3c7;
        border-left-color: #f59e0b;
        color: #78350f;
      }
      .tp-toast.error {
        background: #fee2e2;
        border-left-color: #ef4444;
        color: #7f1d1d;
      }
      @media (max-width: 640px) {
        .tp-feedback-wrap {
          left: 12px;
          right: 12px;
          width: auto;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureWrap() {
    ensureStyle();
    let wrap = document.getElementById('tpFeedbackWrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'tpFeedbackWrap';
      wrap.className = 'tp-feedback-wrap';
      document.body.appendChild(wrap);
    }
    return wrap;
  }

  function iconSvg() {
    return `
      <svg stroke="currentColor" viewBox="0 0 24 24" fill="none" class="tp-icon" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M13 16h-1v-4h1m0-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></path>
      </svg>
    `;
  }

  function show(type, message, options) {
    const opts = options || {};
    const onlyLogged = opts.onlyLogged !== false;
    if (onlyLogged && !isLoggedInSafe()) return null;
    const text = String(message || '').trim();
    if (!text) return null;

    const wrap = ensureWrap();
    const t = String(type || 'info').toLowerCase();
    const kind = (t === 'sucesso' ? 'success' : (t === 'erro' ? 'error' : (t === 'aviso' ? 'warning' : t)));
    const toast = document.createElement('div');
    toast.className = `tp-toast ${kind}`;
    toast.setAttribute('role', 'alert');
    toast.innerHTML = `${iconSvg()}<p class="tp-text">${text}</p>`;
    wrap.appendChild(toast);

    requestAnimationFrame(function () {
      toast.classList.add('show');
    });

    const timeoutMs = Math.max(1200, Number(opts.durationMs || 3200));
    const timer = setTimeout(function () {
      toast.classList.remove('show');
      setTimeout(function () {
        if (toast.parentElement) toast.parentElement.removeChild(toast);
      }, 220);
    }, timeoutMs);

    toast.addEventListener('click', function () {
      clearTimeout(timer);
      toast.classList.remove('show');
      setTimeout(function () {
        if (toast.parentElement) toast.parentElement.removeChild(toast);
      }, 150);
    });

    return toast;
  }

  function detectActionLabel(url, method) {
    const u = String(url || '').toLowerCase();
    const m = String(method || 'GET').toUpperCase();
    if (m === 'DELETE') return 'Exclusao concluida com sucesso.';
    if (u.includes('marketplace') && m === 'POST') return 'Acao do marketplace realizada com sucesso.';
    if (u.includes('recarga') && m === 'POST') return 'Recarga registrada com sucesso.';
    if (m === 'POST') return 'Cadastro/acao realizada com sucesso.';
    if (m === 'PUT' || m === 'PATCH') return 'Alteracoes salvas com sucesso.';
    return 'Acao concluida com sucesso.';
  }

  function installAutoFetchFeedback() {
    if (window.__tpFeedbackFetchPatched) return;
    if (typeof window.fetch !== 'function') return;
    window.__tpFeedbackFetchPatched = true;
    const rawFetch = window.fetch.bind(window);
    window.fetch = async function (input, init) {
      const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      const isMutating = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
      const requestUrl = (typeof input === 'string' ? input : (input && input.url ? input.url : ''));

      try {
        const response = await rawFetch(input, init);
        if (isMutating && isLoggedInSafe()) {
          const urlLc = String(requestUrl || '').toLowerCase();
          const ignore = urlLc.includes('/auth/ping') || urlLc.includes('/auth/login') || urlLc.includes('/auth/logout');
          if (!ignore) {
            if (response.ok) show('success', detectActionLabel(requestUrl, method), { onlyLogged: true, durationMs: 2600 });
            else show('error', 'Nao foi possivel concluir esta acao.', { onlyLogged: true, durationMs: 3400 });
          }
        }
        return response;
      } catch (err) {
        if (isMutating && isLoggedInSafe()) {
          show('error', 'Falha de conexao ao executar a acao.', { onlyLogged: true, durationMs: 3400 });
        }
        throw err;
      }
    };
  }

  window.tpFeedback = {
    __ready: true,
    show: show,
    success: function (message, options) { return show('success', message, options); },
    info: function (message, options) { return show('info', message, options); },
    warning: function (message, options) { return show('warning', message, options); },
    error: function (message, options) { return show('error', message, options); }
  };
  window.tpNotify = window.tpFeedback.show;
  window.tpNotifySuccess = window.tpFeedback.success;
  window.tpNotifyInfo = window.tpFeedback.info;
  window.tpNotifyWarning = window.tpFeedback.warning;
  window.tpNotifyError = window.tpFeedback.error;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      ensureWrap();
      installAutoFetchFeedback();
    });
  } else {
    ensureWrap();
    installAutoFetchFeedback();
  }
})();

(function () {
  function normalizeAscii(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9 .,\-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function emvField(id, value) {
    const text = String(value || '');
    return id + pad2(text.length) + text;
  }

  function crc16(payload) {
    let crc = 0xFFFF;
    for (let i = 0; i < payload.length; i += 1) {
      crc ^= payload.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j += 1) {
        if ((crc & 0x8000) !== 0) crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
        else crc = (crc << 1) & 0xFFFF;
      }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  function buildPixCode(params) {
    const key = String(params.pix_key || '').trim();
    if (!key) return '';
    const merchantName = normalizeAscii(params.pix_merchant_name || 'PRECO CERTO').slice(0, 25) || 'PRECO CERTO';
    const merchantCity = normalizeAscii(params.pix_city || 'ARAPIRACA').slice(0, 15) || 'ARAPIRACA';
    const desc = normalizeAscii(params.description || '').slice(0, 99);
    const amount = Number(params.amount || 0).toFixed(2);
    const txid = normalizeAscii(params.txid || 'RECARGA').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || 'RECARGA';

    const merchantAccount = emvField('00', 'br.gov.bcb.pix')
      + emvField('01', key)
      + (desc ? emvField('02', desc) : '');
    const additionalData = emvField('05', txid);

    const payloadWithoutCRC =
      emvField('00', '01') +
      emvField('26', merchantAccount) +
      emvField('52', '0000') +
      emvField('53', '986') +
      emvField('54', amount) +
      emvField('58', 'BR') +
      emvField('59', merchantName) +
      emvField('60', merchantCity) +
      emvField('62', additionalData) +
      '6304';

    return payloadWithoutCRC + crc16(payloadWithoutCRC);
  }

  function formatTimer(totalSeconds) {
    const sec = Math.max(0, Number(totalSeconds || 0));
    const mm = Math.floor(sec / 60);
    const ss = sec % 60;
    return `${pad2(mm)}:${pad2(ss)}`;
  }

  function createPixRecargaUI(options) {
    const opts = options || {};
    const el = opts.elements || {};
    const onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : function () {};
    const formatMoney = typeof opts.formatMoney === 'function'
      ? opts.formatMoney
      : function (v) { return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };

    const state = {
      timerId: null,
      expiresAt: 0,
      expired: false
    };

    function stopTimer() {
      if (state.timerId) {
        clearInterval(state.timerId);
        state.timerId = null;
      }
      state.expiresAt = 0;
    }

    function updateTimerUi() {
      if (!el.timer) return;
      if (!state.expiresAt) {
        el.timer.textContent = '';
        return;
      }
      const left = Math.max(0, Math.floor((state.expiresAt - Date.now()) / 1000));
      if (left <= 0) {
        stopTimer();
        state.expired = true;
        el.timer.textContent = 'PIX expirado (05:00). Gere um novo pedido para pagar.';
        if (el.copyBtn) el.copyBtn.disabled = true;
        onStatus('Tempo de pagamento PIX expirado. Envie uma nova solicitação para gerar outro codigo.', 'error');
        return;
      }
      el.timer.textContent = `Tempo para pagar: ${formatTimer(left)}`;
    }

    function startTimer(seconds) {
      stopTimer();
      state.expired = false;
      state.expiresAt = Date.now() + (Math.max(1, Number(seconds || 300)) * 1000);
      updateTimerUi();
      state.timerId = setInterval(updateTimerUi, 1000);
    }

    function close() {
      stopTimer();
      if (el.overlay) el.overlay.classList.remove('open');
    }

    async function copyPixCode() {
      if (state.expired) {
        throw new Error('PIX expirado. Gere um novo pedido para pagar.');
      }
      const code = String(el.codeField && el.codeField.value ? el.codeField.value : '').trim();
      if (!code) throw new Error('Codigo PIX vazio.');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        el.codeField.select();
        document.execCommand('copy');
      }
      onStatus('Codigo PIX copiado com sucesso.', 'ok');
    }

    function open(payload) {
      const data = payload || {};
      const recarga = data.recarga || {};
      const pixConfig = data.pixConfig || {};
      const clienteNome = normalizeAscii(data.clienteNome || 'Cliente');
      const valorPago = Number(recarga.valor_pago || recarga.valor || 0);
      const valorCredito = Number(recarga.valor_credito || recarga.valor || 0);
      const descricao = `Recarga R$ ${formatMoney(valorCredito)} - ${clienteNome}`;
      const txid = `RCG${String(recarga.id || Date.now()).replace(/\D+/g, '').slice(0, 22)}`;
      const pixCode = buildPixCode({
        pix_key: pixConfig.pix_key,
        pix_merchant_name: pixConfig.pix_merchant_name,
        pix_city: pixConfig.pix_city,
        amount: valorPago,
        description: descricao,
        txid
      });

      if (!pixCode) {
        throw new Error('A chave PIX não esta configurada. Avise o desenvolvedor.');
      }

      if (el.resumo) {
        el.resumo.textContent = `Recarga #${recarga.id} | Operadora ${recarga.operadora} | Crédito R$ ${formatMoney(valorCredito)} | Valor a pagar R$ ${formatMoney(valorPago)}.`;
      }
      if (el.codeField) el.codeField.value = pixCode;
      if (el.qrImage) el.qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(pixCode)}`;
      if (el.copyBtn) el.copyBtn.disabled = false;
      if (el.overlay) el.overlay.classList.add('open');
      startTimer(Number(data.timeoutSeconds || 300));
    }

    if (el.closeBtn) {
      el.closeBtn.addEventListener('click', close);
    }
    if (el.overlay) {
      el.overlay.addEventListener('click', function (event) {
        if (event.target === el.overlay) close();
      });
    }
    if (el.copyBtn) {
      el.copyBtn.addEventListener('click', async function () {
        try {
          await copyPixCode();
        } catch (err) {
          onStatus(err && err.message ? err.message : 'Falha ao copiar codigo PIX.', 'error');
        }
      });
    }

    return { open, close };
  }

  window.PixRecarga = {
    buildPixCode,
    createUI: createPixRecargaUI
  };
})();

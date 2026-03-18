'use strict';

(function () {
  function ensureToastStack() {
    let stack = document.getElementById('ui-toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = 'ui-toast-stack';
      document.body.appendChild(stack);
    }
    return stack;
  }

  function toast(message, opts = {}) {
    const type = opts.type || 'info';
    const duration = opts.duration ?? 3200;
    const stack = ensureToastStack();
    const el = document.createElement('div');
    el.className = `ui-toast ${type}`;
    el.textContent = String(message || '');
    stack.appendChild(el);
    setTimeout(() => el.remove(), duration);
  }

  function confirmDanger(opts = {}) {
    const title = opts.title || '确认操作';
    const message = opts.message || '该操作可能不可撤销，是否继续？';
    const confirmText = opts.confirmText || '确认';
    const cancelText = opts.cancelText || '取消';

    return new Promise((resolve) => {
      const mask = document.createElement('div');
      mask.className = 'ui-confirm-mask';
      mask.innerHTML = `
        <div class="ui-confirm-box">
          <h3>${title}</h3>
          <p>${message}</p>
          <div class="ui-confirm-actions">
            <button class="btn">${cancelText}</button>
            <button class="btn danger">${confirmText}</button>
          </div>
        </div>
      `;
      const [cancelBtn, okBtn] = mask.querySelectorAll('button');
      const cleanup = (ret) => {
        mask.remove();
        resolve(ret);
      };
      cancelBtn.addEventListener('click', () => cleanup(false));
      okBtn.addEventListener('click', () => cleanup(true));
      mask.addEventListener('click', (e) => {
        if (e.target === mask) cleanup(false);
      });
      document.body.appendChild(mask);
    });
  }

  function renderLoadingLines(count = 4) {
    return `<div class="ui-state-loading">${Array.from({ length: count }).map(() => '<div class="ui-skeleton-line"></div>').join('')}</div>`;
  }

  function renderEmpty(message) {
    return `<div class="ui-empty">${message || '暂无数据'}</div>`;
  }

  window.UIFeedback = {
    toast,
    confirmDanger,
    renderLoadingLines,
    renderEmpty,
  };
})();

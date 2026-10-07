/* ============================================================================
 * js/auth.js —— 登录屏（screen-login）
 *
 * 【本阶段不做真正的后端登录】
 *   这里只管把学号 / 姓名写进 Store，然后放行到实验说明屏。
 *   POST /api/login 是第 5 波（M14）的事，现在代码里不许留 fetch 调用——
 *   留一个连不上的接口比没有接口更糟：断网时学生连实验都进不去。
 *
 * 【为什么不用 alert() 报错】
 *   一是 alert 会打断实验流程（模态框挡着，要手动点掉），
 *   二是手机上 alert 又丑又容易被系统当作骚扰拦截。
 *   错误就写在按钮下面那行红字里。
 * ==========================================================================*/

(function () {
  'use strict';

  var screen = document.getElementById('screen-login');
  if (!screen) return;

  /* --------------------------------------------------------------------------
   * 1. 重建本屏内容
   *
   * 契约要求这两屏的 DOM 由 JS 填（见任务书"改 index.html 只需要两处"）。
   * 目前还没有输入框的样式类，所以用行内样式，颜色一律引用 var(--c-*)。
   * ------------------------------------------------------------------------ */

  var fieldStyle =
    'width:100%;padding:10px 12px;margin:6px 0 16px;' +
    'background:var(--c-surface-2);border:1px solid var(--c-border);' +
    'border-radius:var(--radius-sm);color:var(--c-text);font-size:0.95rem;';

  var labelStyle =
    'display:block;font-size:0.85rem;color:var(--c-text-dim);';

  screen.innerHTML = [
    '<h2>登录</h2>',
    '<div class="card">',
    '  <div class="card-head">填写学号与姓名，或以游客身份直接开始</div>',
    '',
    '  <label for="loginId" style="' + labelStyle + '">学号</label>',
    '  <input id="loginId" type="text" autocomplete="off" inputmode="numeric"',
    '         placeholder="例如 202628061234"',
    '         style="' + fieldStyle + 'font-family:var(--font-mono);">',
    '',
    '  <label for="loginName" style="' + labelStyle + '">姓名</label>',
    '  <input id="loginName" type="text" autocomplete="off"',
    '         placeholder="你的姓名"',
    '         style="' + fieldStyle + 'font-family:var(--font-sans);">',
    '',
    '  <div class="btn-row">',
    '    <button class="btn btn-primary" id="loginStart">开始实验 →</button>',
    '    <button class="btn btn-ghost" id="loginGuest">暂不登录（游客模式）</button>',
    '  </div>',
    '',
    '  <p id="loginMsg" style="margin-top:14px;font-size:0.85rem;' +
    'color:var(--c-danger);display:none;">请填写学号和姓名后再开始</p>',
    '</div>',
  ].join('\n');

  /* --------------------------------------------------------------------------
   * 2. 取回元素
   * ------------------------------------------------------------------------ */

  var idInput   = document.getElementById('loginId');
  var nameInput = document.getElementById('loginName');
  var msg       = document.getElementById('loginMsg');

  function showMsg() { msg.style.display = 'block'; }
  function hideMsg() { msg.style.display = 'none'; }

  /* --------------------------------------------------------------------------
   * 3. 行为
   * ------------------------------------------------------------------------ */

  // 「开始实验」：两个框 trim() 后都不能为空
  function startExperiment() {
    var id   = idInput.value.trim();
    var name = nameInput.value.trim();

    if (id === '' || name === '') {
      showMsg();
      // 把光标送到第一个没填的框里，省得用户自己找
      (id === '' ? idInput : nameInput).focus();
      return;
    }

    hideMsg();
    Store.setStudent(id, name);
    showScreen('brief');
  }

  // 「暂不登录（游客模式）」：不校验任何输入，直接放行
  function startAsGuest() {
    hideMsg();
    Store.setStudent(null, null);
    showScreen('brief');
  }

  document.getElementById('loginStart').addEventListener('click', startExperiment);
  document.getElementById('loginGuest').addEventListener('click', startAsGuest);

  // 回车即提交（两个框都支持；姓名框是最后一个，回车最自然）
  function onKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      startExperiment();
    }
  }

  idInput.addEventListener('keydown', onKeydown);
  nameInput.addEventListener('keydown', onKeydown);

  // 用户开始重新输入就把红字收掉，别一直挂在屏幕上
  idInput.addEventListener('input', hideMsg);
  nameInput.addEventListener('input', hideMsg);

  /* --------------------------------------------------------------------------
   * 4. 进屏时预填
   *
   * 从结果页"重新开始"回到登录屏时，Store.student 还留着上一次的值，
   * 直接填回输入框，学生不用重打一遍。
   * ------------------------------------------------------------------------ */

  if (Store.student) {
    idInput.value   = Store.student.id   || '';
    nameInput.value = Store.student.name || '';   // 游客模式这里是 null → 空框
  }

})();

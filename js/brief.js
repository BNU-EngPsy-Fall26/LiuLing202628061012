/* ============================================================================
 * js/brief.js —— 实验说明屏（screen-brief）
 *
 * 玩家进来遇到的第一屏"有内容"的页面，要把三件事讲清楚：
 *   ① 三轮结构：难度不变，变的是"判错的代价"
 *   ② 选试次模式：标准版 30 / 快速版 16（二选一，全程不许换）
 *   ③ 操作方式：看主诉 + 生命体征 → 二选一 → 立刻给反馈
 *
 * 【不许把模式文案抄死在 HTML 里】
 *   每轮多少位患者、大概几分钟，全部读 window.TRIAL_MODES（config.js 是唯一真源）。
 *   哪天把标准版改成 24 位，这里跟着变，不会出现"说明页写 30、实际跑 24"的事故。
 * ==========================================================================*/

(function () {
  'use strict';

  var screen = document.getElementById('screen-brief');
  if (!screen) return;

  var MODES = window.TRIAL_MODES;
  var STD   = MODES.standard;
  var QUICK = MODES.quick;

  /* --------------------------------------------------------------------------
   * 1. 两个模式选项（由 TRIAL_MODES 生成，顺序即配置里的顺序）
   *
   * 用原生 radio + label：键盘（方向键）和读屏都能用，
   * 而且"默认选中"只是一个 checked 属性的事。
   * ------------------------------------------------------------------------ */

  var optionStyle =
    'display:flex;gap:10px;align-items:flex-start;margin-top:10px;' +
    'padding:12px 14px;border:1px solid var(--c-border);' +
    'border-radius:var(--radius-sm);cursor:pointer;';

  var modeKeys = Object.keys(MODES);
  var modeHtml = '';

  for (var i = 0; i < modeKeys.length; i++) {
    var key = modeKeys[i];
    var m   = MODES[key];

    // 默认选中标准版（d′ 估计更稳，除非时间紧张没人该选快速版）
    var checked = (key === 'standard') ? ' checked' : '';

    modeHtml +=
      '<label class="mode-option" data-mode="' + key + '" style="' + optionStyle + '">' +
        '<input type="radio" name="trialMode" value="' + key + '"' + checked +
               ' style="margin-top:4px;accent-color:var(--c-primary);">' +
        '<span style="flex:1;">' +
          '<span style="display:block;color:var(--c-text);">' + m.label + '</span>' +
          '<span style="display:block;font-size:0.85rem;color:var(--c-text-dim);">' +
            m.desc +
          '</span>' +
        '</span>' +
      '</label>';
  }

  /* --------------------------------------------------------------------------
   * 2. 重建本屏内容
   * ------------------------------------------------------------------------ */

  var paraStyle = 'margin-bottom:8px;';

  screen.innerHTML = [
    '<h2>实验说明</h2>',

    // —— ① 三轮结构 ★ 这屏的核心 ——
    '<div class="card">',
    '  <div class="card-head">你要值班三轮</div>',
    '  <p style="' + paraStyle + '">你要在急诊分诊台值班三轮，每轮 ' +
        STD.trialsPerRound + ' 位患者（快速版 ' + QUICK.trialsPerRound + ' 位）。</p>',
    '  <p style="' + paraStyle + '">三轮里，你要判断的难度是一样的——</p>',
    '  <p style="' + paraStyle + '">但每一轮“判错的代价”会变。</p>',
    '  <p style="margin-bottom:0;">请仔细读每轮开始前的提示。</p>',
    '</div>',

    // —— ② 试次模式 ——
    '<div class="card">',
    '  <div class="card-head">选择试次模式</div>',
    '  <p style="color:var(--c-text-dim);font-size:0.9rem;margin-bottom:4px;">' +
        '全场三轮必须用同一种模式，中途不换。</p>',
    modeHtml,
    '</div>',

    // —— ③ 操作方式 ——
    '<div class="card">',
    '  <div class="card-head">怎么玩</div>',
    '  <p style="' + paraStyle + '">每轮你会看到一位患者的主诉和生命体征。</p>',
    '  <p style="' + paraStyle + '">判断他需不需要立即紧急处理 —— ' +
        '点「立即紧急处理」或「可以等待」。</p>',
    '  <p style="' + paraStyle + '">你看不到患者的真实情况，只能根据有限的信息判断。</p>',
    '  <p style="margin-bottom:0;">判断完会立刻告诉你结果，然后进入下一位。</p>',
    '</div>',

    // —— 出口 ——
    '<div class="btn-row">',
    '  <button class="btn btn-primary" id="briefStart">开始第一轮 →</button>',
    '</div>',

    '<p style="margin-top:14px;font-size:0.8rem;color:var(--c-text-dim);">' +
      '本实验只记录你的判断结果，不涉及任何真实医疗场景。</p>',
  ].join('\n');

  /* --------------------------------------------------------------------------
   * 3. 行为
   * ------------------------------------------------------------------------ */

  var options = screen.querySelectorAll('.mode-option');

  // 选中的那项：主色描边 + 内嵌底色；没选中的用默认描边
  function paintModes() {
    for (var j = 0; j < options.length; j++) {
      var on = options[j].querySelector('input[type="radio"]').checked;
      options[j].style.borderColor = on ? 'var(--c-primary)' : 'var(--c-border)';
      options[j].style.background  = on ? 'var(--c-surface-2)' : 'transparent';
    }
  }

  // 切换模式：立刻写进 Store —— 游戏引擎（M6）和结果页（M8）都要读它
  for (var k = 0; k < options.length; k++) {
    (function (el) {
      el.querySelector('input[type="radio"]').addEventListener('change', function () {
        Store.setMode(el.getAttribute('data-mode'));
        paintModes();
      });
    })(options[k]);
  }

  paintModes();   // 进屏时先按默认选中态上一次色

  // 「开始第一轮」：没手动选过就用标准版兜底，然后进游戏屏
  document.getElementById('briefStart').addEventListener('click', function () {
    if (Store.mode === null || Store.mode === undefined) {
      Store.setMode('standard');
    }
    showScreen('game');
  });

})();

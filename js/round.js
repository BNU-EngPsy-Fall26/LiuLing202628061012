/* ============================================================================
 * js/round.js —— 轮次过渡屏（模块 M7）
 *
 * 【这一屏为什么值得单独做】
 *   它是全场情绪最重的两屏：第 1 轮之后被告知"资源告急、你多收一个别人就没床位"，
 *   第 2 轮之后被告知"你漏掉的人里，有几位在等待期间病情恶化了"。
 *   玩家对"代价变了"的体感，八成来自这两屏 —— 不是来自结果页那张表。
 *   所以文案要留白（保留换行）、数字要放大、节奏要慢下来。
 *
 * 【文案从哪来】
 *   一个字都不写死在这里。全部读 js/config.js 的 ROUNDS[nextRound-1]，
 *   里面只有两个占位符要替换（契约 3.5）：
 *     {round2M} → 上一轮的真实漏报数
 *     {n}       → Math.floor(漏报数 / 2)，也就是"病情恶化的几位"
 *   别的一律不碰。
 *
 *   ★ 漏报数为 0 时改读 ROUNDS[nextRound-1].introIfNoMiss（契约 3.5）——
 *     用 intro 那套会念成"有 0 位其实是危重患者，其中 0 位病情恶化"。
 *     那段文案里没有占位符，所以不做任何替换。
 *
 * 【本屏的 DOM 也是运行时重建的】
 *   和 auth.js / brief.js 一样。index.html 里 screen-round 那段骨架里
 *   onclick="nextRound()" 指向的是 M1 的假流程，那段假流程这次已经删掉了，
 *   所以本屏由这里整个重建，事件走 addEventListener。
 * ==========================================================================*/

window.RoundScreen = (function () {
  'use strict';

  var screen = document.getElementById('screen-round');

  if (!screen) {
    return {
      show: function () { console.warn('[RoundScreen] 找不到 #screen-round'); },
    };
  }

  /* --------------------------------------------------------------------------
   * 1. DOM 小工具
   *    文案里的字全部走 textContent —— 占位符换出来的数字不会被当成 HTML
   * ------------------------------------------------------------------------ */

  function makeEl(tag, css, text) {
    var node = document.createElement(tag);
    if (css) node.style.cssText = css;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  /* --------------------------------------------------------------------------
   * 2. 挑文案 + 替换占位符（契约 3.5：只替换那两个）
   *
   *   spec         ROUNDS[nextRound - 1]
   *   missCount    上一轮的真实漏报数
   *
   *   ★ missCount === 0 时改用 spec.introIfNoMiss：intro 那套会念成
   *     "有 0 位其实是危重患者，其中 0 位在等待期间病情恶化"，自相矛盾。
   *     （契约 3.5 专门为这种情况补了一段"这个阶段判断得很稳"。）
   * ------------------------------------------------------------------------ */

  function fillIntro(spec, missCount) {
    var miss = (typeof missCount === 'number' && isFinite(missCount)) ? missCount : 0;

    var intro = (miss === 0 && spec.introIfNoMiss) ? spec.introIfNoMiss
                                                   : (spec.intro || '');

    // "其中有几位病情恶化"（契约 3.5）。M = 0 时算出来是 0，
    // 但那种情况走的是 introIfNoMiss，里面根本没有 {n}，替换不会发生
    var worsened = Math.floor(miss / 2);

    // 只有带占位符的那段文案（第 2 → 3 轮）需要报"恶化几位"
    var hasPlaceholder = intro.indexOf('{round2M}') >= 0;

    var text = intro
      .replace('{round2M}', String(miss))
      .replace('{n}',       String(worsened));

    // 文案第一行是标题（⚠ / 📋 开头那行），其余是正文。
    // 拆开是为了把标题单独放大 —— 正文用 .round-intro（white-space: pre-wrap，
    // main.css 里已有）保留换行
    var lines = text.split('\n');
    var title = lines.shift() || '';
    var body  = lines.join('\n').replace(/^\n+/, '').replace(/\s+$/, '');

    return { title: title, body: body, miss: miss, worsened: worsened,
             hasPlaceholder: hasPlaceholder, noMiss: (miss === 0 && !!spec.introIfNoMiss) };
  }

  /* --------------------------------------------------------------------------
   * 3. 漏报数字看板
   *
   *   ★ 放大显示：这一段是整屏的视觉重心。
   *   数字用等宽字体（契约 2.3：数字必须等宽，否则数字会左右跳）。
   *
   *   ★ 只在"复盘屏"（第 2 → 3 轮）出现，第 1 → 2 轮不放 —— 理由见 show() 里
   *     那段注释，简单说：第 1 → 2 轮要玩家变【更保守】，这时候告诉他
   *     "你漏了 N 位" 会把他往【更大胆】推，正好和这一轮的操纵方向相反。
   * ------------------------------------------------------------------------ */

  function buildMissBoard(miss, worsened, withWorsened) {
    // 0 位漏报是好消息，别用危险红 —— 这一段配的是"判断得很稳"那句文案
    var color = (miss > 0) ? 'var(--c-danger)' : 'var(--c-normal)';

    var box = makeEl('div',
      'background:var(--c-surface-2);' +
      'border-left:3px solid ' + color + ';' +
      'border-radius:var(--radius-sm);' +
      'padding:16px 18px;margin-bottom:20px;');
    box.className = 'round-miss';

    box.appendChild(makeEl('div',
      'font-size:0.74rem;color:var(--c-text-dim);' +
      'letter-spacing:0.16em;margin-bottom:8px;', '上一轮漏报'));

    var row = makeEl('div', 'display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;');

    // 那个大数字
    row.appendChild(makeEl('span',
      'font-family:var(--font-mono);font-variant-numeric:tabular-nums;' +
      'font-size:2.7rem;font-weight:700;line-height:1;color:' + color + ';',
      String(miss)));

    row.appendChild(makeEl('span',
      'font-size:0.95rem;color:var(--c-text);',
      '位危重患者被你判为「可以等待」'));

    box.appendChild(row);

    if (withWorsened) {
      box.appendChild(makeEl('div',
        'margin-top:10px;font-size:0.9rem;color:var(--c-text-dim);',
        '其中 ' + worsened + ' 位在等待期间病情恶化'));
    }

    return box;
  }

  /* --------------------------------------------------------------------------
   * 4. show(finishedRound, nextRound, missCount, onNext)
   *
   *   finishedRound  刚跑完的那一轮（1 | 2）
   *   nextRound      即将开始的（2 | 3）；本轮的名字和文案都从它取
   *   missCount      上一轮的真实漏报数
   *   onNext         点「进入第 N 轮」之后的回调（引擎在那里开下一轮）
   * ------------------------------------------------------------------------ */

  function show(finishedRound, nextRound, missCount, onNext) {
    var spec = (window.ROUNDS && window.ROUNDS[nextRound - 1]) || {};

    var filled = fillIntro(spec, missCount);

    /* ------------------------------------------------------------------------
     * ★ 漏报看板只出现在"复盘屏"（第 2 → 3 轮），第 1 → 2 轮绝不出现。
     *
     *   第 1 → 2 轮要玩家变【更保守】（误收的代价上升）。
     *   这时候告诉他"上一轮你漏了 N 位"，他会想"那我该更大胆一点"——
     *   正好和这一轮的操纵方向相反，等于自己削弱实验效果。
     *   第 2 → 3 轮才是该放的地方：那一轮的文案本身就在说"你漏掉人了"，
     *   看板是给那句话配的证据。
     *
     *   判断依据取自 config 而不是写死轮次号：这一轮的文案提到漏报数
     *   （有 {round2M}，或备了 introIfNoMiss），说明它就是复盘屏。
     * ---------------------------------------------------------------------- */
    var tellsMissStory = (spec.intro && spec.intro.indexOf('{round2M}') >= 0) ||
                         !!spec.introIfNoMiss;

    /* ------------------------------------------------------------------------
     * 骨架。里面全是本文件写死的静态标签，没有任何外部数据，
     * 所以用 innerHTML 拼是安全的；玩家数据一律走下面的 textContent。
     * ---------------------------------------------------------------------- */
    screen.innerHTML = [
      '<h2 id="roundEndTitle"></h2>',
      '<div class="card" style="padding:28px 24px;">',
      '  <div id="roundTone" style="font-size:1.12rem;font-weight:600;' +
          'line-height:1.5;color:var(--c-text);margin-bottom:20px;"></div>',
      '  <div id="roundMiss"></div>',
      '  <div id="roundBody" class="round-intro"></div>',
      '  <div class="btn-row" style="margin-top:22px;">',
      '    <button class="btn btn-primary" id="roundNext"></button>',
      '  </div>',
      '</div>',
    ].join('\n');

    document.getElementById('roundEndTitle').textContent = '第 ' + finishedRound + ' 轮结束';
    document.getElementById('roundTone').textContent      = filled.title;
    document.getElementById('roundBody').textContent      = filled.body;

    if (tellsMissStory) {
      document.getElementById('roundMiss').appendChild(
        buildMissBoard(filled.miss, filled.worsened, filled.hasPlaceholder)
      );
    }

    var nextBtn = document.getElementById('roundNext');
    nextBtn.textContent = '进入第 ' + nextRound + ' 轮 →';

    nextBtn.addEventListener('click', function () {
      nextBtn.disabled = true;                 // 防连点：开下一轮时本来也会换屏
      if (typeof onNext === 'function') onNext();
    });

    showScreen('round');
  }

  /* ------------------------------------------------------------------------ */

  return {
    show: show,
  };

})();

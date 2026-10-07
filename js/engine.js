/* ============================================================================
 * js/engine.js —— 游戏状态机（模块 M6-b）
 *
 * 【这个文件干什么】
 *   把"一轮一轮往下跑"这件事管起来：
 *     生成试次序列 → 出一位患者 → 等玩家点 → 算结果 → 反馈 1.2 秒 → 下一位
 *     一轮跑完 → 存进 Store → 交给过渡屏（M7）→ 下一轮 → 三轮跑完进结果页
 *
 * 【三条它必须守住的东西】
 *
 *   1. ★ 判断之前不许读 patient.hasSignal（契约第 8 节铁律第 3 条）
 *      全文件只有一处读它：respond() 里算 outcome 的那一行，
 *      而且读完立刻交给 Scoring.outcomeOf() —— 判断已经做完了。
 *      序列里的真值存在闭包变量里，不写进 DOM、不进 data-*、不 console.log，
 *      玩家按 F12 也看不到。
 *
 *   2. ★ 每轮必须正好 nSignal 个信号 + nNoise 个噪音，洗牌决定顺序
 *      不许"每次 50% 随机" —— 那样每轮实际的信号数会在 15 上下浮动，
 *      P(S) 就不是精确的 0.5 了，三轮之间也没法比（契约 3.4.1 硬约束 1）。
 *
 *   3. ★ 状态不放全局变量
 *      本文件的 state 是 IIFE 的闭包变量，window 上一个都不挂 ——
 *      契约 5.3 的规矩是"跨模块的数据放 Store，只有一个模块自己用的放局部变量"。
 *      轮次结果是要给别人看的，那些都走 Store.pushRound()。
 *
 * 【依赖】
 *   Store        —— student / mode / rounds（契约 5.3）
 *   Utils        —— shuffle / rand01（契约 5.4：不许自己实现）
 *   PatientGen   —— generate()（契约 5.1 / M4）
 *   PatientCard  —— render()（契约 5.1 / M5）
 *   Scoring      —— outcomeOf / summarizeRound（契约 5.2 / M6-a）
 *   RoundScreen  —— show()（M7），只在第 1、2 轮结束时用到
 *   window.ROUNDS / window.D_PRIME / window.TRIAL_MODES —— js/config.js
 * ==========================================================================*/

window.Engine = (function () {
  'use strict';

  /* --------------------------------------------------------------------------
   * 0. 常量
   * ------------------------------------------------------------------------ */

  var TOTAL_ROUNDS = 3;      // 契约第 1 节：一场实验恒为三轮
  var FEEDBACK_MS  = 1200;   // 契约 3.1：反馈停留 1.2 秒

  var HINT_WAIT    = '看清主诉和生命体征，再点下面的按钮。';
  var HINT_FEEDBACK = '已记录 —— 正在送入下一位……';

  /* --------------------------------------------------------------------------
   * 1. 本轮专用的假 rng（mulberry32）
   *
   *   Utils 的每个随机函数都收一个 { next: () => 0~1 } 的 rng 对象，
   *   不传就退化成 Math.random（utils.js 第 24 行）。
   *   这里给每轮一个固定种子的 rng，好处是：同一场实验里
   *   "哪个位置是信号患者""每位患者的体征"都是从同一个种子推出来的，
   *   出问题时把种子报给我就能一模一样地复现那一批患者。
   *
   *   种子由 Engine.start() 定一次（Engine.seed() 可以取到），
   *   每一轮的种子从它推出来，所以三轮之间不会撞成同一批患者。
   *
   *   ⚠️ 这是"复现用"的 rng，不是"公平性"用的 —— 公平性由
   *      nSignal / nNoise 的精确配比保证（见 startRound）。
   * ------------------------------------------------------------------------ */

  function makeRng(seed) {
    var a = seed >>> 0;

    return {
      next: function () {
        a = (a + 0x6D2B79F5) | 0;
        var t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
    };
  }

  /* --------------------------------------------------------------------------
   * 2. 本模块的私有状态（闭包变量，不挂 window）
   *
   *   round       当前第几轮（1~3）
   *   sequence    本轮的真值序列：true = 信号患者，false = 噪音患者
   *   index       走到本轮第几位（0 起）
   *   patient     当前这一位患者（含 hasSignal / severity，绝不出这个闭包）
   *   startedAt   当前这张卡片出现的时间戳（算反应时用）
   *   awaiting    true = 正在等玩家点。它是"按钮能不能点"的唯一判据，
   *               也是防止连点、防止 1.2 秒内重复记录的那道闸
   *   trials      本轮已经记录下来的 Trial（契约 4.2）
   *   patientRng  出患者 + 洗牌序列用
   *   cardRng     反馈文案用（和上面那个分开，免得抽一句话就打乱患者序列）
   * ------------------------------------------------------------------------ */

  var state = {
    sessionSeed: 0,
    sessionStartedAt: null,
    round: 1,
    sequence: [],
    index: 0,
    patient: null,
    startedAt: 0,
    awaiting: false,
    trials: [],
    patientRng: null,
    cardRng: null,
  };

  /* --------------------------------------------------------------------------
   * 3. 游戏屏的 DOM（做法 B）
   *
   *   本屏由本文件在运行时重建，用 addEventListener 绑事件 ——
   *   和 auth.js / brief.js 的做法一致。index.html 里那两个
   *   onclick="finishRound()" 是骨架留下的假流程，运行时会被这里整个换掉
   *   （为免留下指向已删函数的死代码，index.html 那边那两行也顺手改成了
   *    Engine.respond(...)，但真正的绑定在这里）。
   *
   *   保留 id="gameTitle"，和骨架里的元素同名，方便对照。
   * ------------------------------------------------------------------------ */

  var screen = document.getElementById('screen-game');

  // 没有这一屏也不要把整页 JS 拖垮：返回一组空壳，
  // 这样 brief.js 那行 Engine.start() 依旧是可调用的（点了没反应，但不报错）
  if (!screen) {
    return {
      start: function () { console.warn('[Engine] 找不到 #screen-game'); },
      respond: function () {},
      seed: function () { return 0; },
      sessionStartedAt: function () { return null; },
    };
  }

  screen.innerHTML = [
    '<h2 id="gameTitle">第 1 轮 · 常规值班</h2>',

    // 进度行：左「患者 07 / 30」，右「击中 3 · 误报 1」
    '<div id="gameMeta" style="display:flex;justify-content:space-between;' +
        'align-items:baseline;gap:12px;flex-wrap:wrap;margin:2px 0 14px;">',
    '  <span id="gameProgress" style="font-family:var(--font-mono);' +
        'font-variant-numeric:tabular-nums;font-size:0.9rem;' +
        'color:var(--c-primary);letter-spacing:0.04em;">患者 — / —</span>',
    '  <span id="gameCounts" style="font-family:var(--font-mono);' +
        'font-variant-numeric:tabular-nums;font-size:0.82rem;' +
        'color:var(--c-text-dim);letter-spacing:0.04em;">击中 0 · 误报 0</span>',
    '</div>',

    // 患者卡片的宿主容器：PatientCard.render() 每次都把它清空重画
    '<div id="patientCardHost"></div>',

    '<div class="btn-row" style="margin-top:16px;">',
    '  <button class="btn btn-danger" id="gameYes">立即紧急处理</button>',
    '  <button class="btn btn-ghost"  id="gameNo">可以等待</button>',
    '</div>',

    '<p id="gameHint" style="margin-top:12px;font-size:0.8rem;' +
        'color:var(--c-text-dim);">' + HINT_WAIT + '</p>',
  ].join('\n');

  var el = {
    title:    document.getElementById('gameTitle'),
    progress: document.getElementById('gameProgress'),
    counts:   document.getElementById('gameCounts'),
    host:     document.getElementById('patientCardHost'),
    hint:     document.getElementById('gameHint'),
    yes:      document.getElementById('gameYes'),
    no:       document.getElementById('gameNo'),
  };

  /* --------------------------------------------------------------------------
   * 3.1 ★ 判断按钮的唯二入口
   *
   *   上面那段 innerHTML 已经把 M1 那对 onclick="finishRound()" 的按钮换掉了，
   *   所以 index.html 里的行内绑定到这里就失效了 —— 必须自己绑。
   *   （index.html 那两行也顺手改成了 Engine.respond(...)，那只是"万一这段
   *    重建没跑起来"的兜底，不是这里的主路径。）
   *
   *   respond 的闸门在 respond() 里（state.awaiting），不在这儿 ——
   *   所以就算哪天有人绕过按钮直接调 Engine.respond()，也照样记不了重账。
   * ------------------------------------------------------------------------ */

  el.yes.addEventListener('click', function () { respond(true);  });
  el.no.addEventListener('click',  function () { respond(false); });

  /* --------------------------------------------------------------------------
   * 4. 显示层的小函数
   *    ★ 这几个函数只读 state 里的"计数"和"位置"，一律不碰 patient.hasSignal
   * ------------------------------------------------------------------------ */

  // 两位数：「患者 07 / 30」
  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  // 模式没选过就按标准版兜底（brief.js 点「开始第一轮」时已经兜过一次，
  // 这里是防"从开发导航直接蹦进来"的保险，宁可跑标准版也不要卡在半路）
  function modeOf() {
    return Store.currentMode() || window.TRIAL_MODES.standard;
  }

  function setHeader(roundNo) {
    var spec = (window.ROUNDS && window.ROUNDS[roundNo - 1]) || {};
    el.title.textContent = '第 ' + roundNo + ' 轮 · ' + (spec.name || '');
  }

  function setProgress() {
    var total = state.sequence.length || modeOf().trialsPerRound;
    var pos   = Math.min(state.index + 1, total);
    el.progress.textContent = '患者 ' + pad2(pos) + ' / ' + total;
  }

  // 已记录的击中 / 误报数。数的是"已经做完的试次"，不含正在等判断的这位
  function setCounts() {
    var H = 0, FA = 0;
    for (var i = 0; i < state.trials.length; i++) {
      if (state.trials[i].outcome === 'H')  H  += 1;
      if (state.trials[i].outcome === 'FA') FA += 1;
    }
    el.counts.textContent = '击中 ' + H + ' · 误报 ' + FA;
  }

  // 判断期间必须灰掉：否则玩家能连点两次，一次判断会被记成两笔
  function setButtons(enabled) {
    var list = [el.yes, el.no];
    for (var i = 0; i < list.length; i++) {
      list[i].disabled = !enabled;
      list[i].style.opacity = enabled ? '' : '0.45';
      list[i].style.cursor  = enabled ? '' : 'not-allowed';
    }
    el.hint.textContent = enabled ? HINT_WAIT : HINT_FEEDBACK;
  }

  /* --------------------------------------------------------------------------
   * 5. 开始一轮
   * ------------------------------------------------------------------------ */

  function startRound(roundNo) {
    var mode = modeOf();

    state.round  = roundNo;
    state.trials = [];
    state.index  = 0;
    state.patient = null;
    state.awaiting = false;
    state.startedAt = 0;

    // 每轮一套自己的 rng：种子从场次种子推出来，三轮互不相同、
    // 但同一场实验重放时能一模一样地复现
    state.patientRng = makeRng((state.sessionSeed + roundNo * 0x9E3779B1) >>> 0);
    state.cardRng    = makeRng((state.sessionSeed ^ roundNo * 0x85EBCA6B) >>> 0);

    // ★ 序列：正好 nSignal 个 true + nNoise 个 false，再洗牌
    //   不是"每位 50% 随机" —— 理由是契约 3.4.1 的硬约束 1：
    //   随机抛硬币会让每轮实际信号数在 15 上下浮动，P(S) 就不再是 0.5，
    //   三轮的 c 也没法放在一起比了
    var pool = [];
    var i;
    for (i = 0; i < mode.nSignal; i++) pool.push(true);
    for (i = 0; i < mode.nNoise;  i++) pool.push(false);
    state.sequence = Utils.shuffle(pool, state.patientRng);

    setHeader(roundNo);
    setProgress();
    setCounts();
    setButtons(false);

    showScreen('game');
    nextTrial();
  }

  /* --------------------------------------------------------------------------
   * 6. 出下一位患者
   * ------------------------------------------------------------------------ */

  function nextTrial() {
    if (state.index >= state.sequence.length) { finishRound(); return; }

    // ⚠️ 这里取到的是"这一位是不是真信号"。它是本轮序列的真值，
    //    只能作为 generate() 的输入，不许写进 DOM、不许记日志。
    //    generate() 拿它去采样 severity，之后信号/噪音两条路完全一样（契约 3.2 铁律）。
    var hasSignal = state.sequence[state.index];

    var patient = PatientGen.generate({
      hasSignal: hasSignal,
      dPrime:    window.D_PRIME,      // 三轮相同（config.js 是唯一真源）
      rng:       state.patientRng,    // ★ 这个口子要留着，复现同一批患者靠它
    });

    state.patient   = patient;
    state.startedAt = performance.now();
    state.awaiting  = true;

    PatientCard.render(el.host, patient, { reveal: false });
    setButtons(true);
    setProgress();
  }

  /* --------------------------------------------------------------------------
   * 7. 玩家点了按钮
   * ------------------------------------------------------------------------ */

  function respond(responded) {
    // 闸门一：正在等判断才记账。
    // 反馈的 1.2 秒里、以及这一轮已经跑完之后点到的，全部忽略
    if (!state.awaiting || !state.patient) return;

    state.awaiting = false;                       // 立刻上锁，连点无效
    setButtons(false);

    var patient = state.patient;
    var rtMs    = Math.round(performance.now() - state.startedAt);

    /* ========================================================================
     * ★★★ 全文件唯一允许读 patient.hasSignal 的地方 ★★★
     *   判断已经做完了 —— 玩家点下的这一刻，结果就定死了。
     *   这一行的唯一用途是交给 Scoring.outcomeOf() 分到 H/M/FA/CR 四类里。
     *   在它之前的所有判断（按钮能不能点、该出哪位患者）都不看它。
     * ====================================================================== */
    var outcome = Scoring.outcomeOf(patient.hasSignal, responded);

    // 记账：契约 4.2 的 Trial，字段名一个不多一个不少
    state.trials.push({
      round:     state.round,
      index:     state.index + 1,   // 从 1 开始
      patient:   patient,
      responded: !!responded,
      outcome:   outcome,
      rtMs:      rtMs,
    });

    // 反馈态：这时候必须把真相告诉玩家（PatientCard 里那唯一一次读取同理）
    PatientCard.render(el.host, patient, {
      reveal:  true,
      outcome: outcome,
      rng:     state.cardRng,
    });

    setCounts();

    window.setTimeout(function () {
      state.index += 1;
      nextTrial();
    }, FEEDBACK_MS);
  }

  /* --------------------------------------------------------------------------
   * 8. 一轮结束
   * ------------------------------------------------------------------------ */

  function finishRound() {
    state.awaiting = false;
    state.patient  = null;
    setButtons(false);

    var result = Scoring.summarizeRound(state.round, state.trials, modeOf());

    Store.pushRound(result);   // ★ 不自己在别处存一份，rounds 的唯一真源是 Store

    if (state.round < TOTAL_ROUNDS) {
      // 过渡屏会自己 showScreen('round')，点按钮后再回调进来开下一轮。
      // 第 1 → 2 轮的文案里没有占位符，missCount 只是给过渡屏当数字看板用；
      // 第 2 → 3 轮的那段文案要靠它替换 {round2M} / {n}
      RoundScreen.show(state.round, state.round + 1, result.counts.M, function () {
        startRound(state.round + 1);
      });
      return;
    }

    // 第三轮跑完 → 结果页（M8 的地盘，这里先直接跳）
    //
    // 留给 M8 的接口，别自己另发明一套：
    //   var session = Scoring.summarizeSession(
    //       Store.student, Store.mode, Store.rounds, Engine.sessionStartedAt());
    showScreen('results');
  }

  /* --------------------------------------------------------------------------
   * 9. 出口（契约里约定的两个，外加两个给调试和 M8 用的小门）
   * ------------------------------------------------------------------------ */

  setButtons(false);   // 进页面时按钮是灰的：没开局，点了也不该有反应

  return {

    // 从说明页点「开始第一轮」时调用（brief.js 第 133 行的回调）
    start: function () {
      // 已经跑过又回来点「开始第一轮」，说明是重开一局。
      // 上一局的 rounds 必须清掉（否则第二轮实验会带着第一轮的数据，
      // pushRound 还会在第 4 个上抛错），但 student / mode 刚在登录页和
      // 说明页填好，不能跟着清 —— 所以调 clearRounds() 而不是 reset()（契约 5.3）。
      Store.clearRounds();

      // 场次种子：只用来让每一轮的患者可复现，不参与任何"公平性"判定
      state.sessionSeed = ((Date.now() >>> 0) ^
                           Math.floor(Utils.rand01() * 0x100000000)) >>> 0;
      state.sessionStartedAt = new Date();

      startRound(1);
    },

    // 玩家点「立即紧急处理」/「可以等待」时调用
    respond: function (responded) {
      respond(!!responded);
    },

    // 本场实验的种子。把患者序列报给我复现时要用的就是它
    // （控制台敲 Engine.seed() —— 它不含任何患者信息，学生看到也无所谓）
    seed: function () {
      return state.sessionSeed;
    },

    // 实验开始的时刻。★ M8 调 Scoring.summarizeSession() 时请把它当第 4 个参数传进去，
    // 否则 Session.startedAt 会等于结束时刻，教师后台看到的时长恒为 0
    sessionStartedAt: function () {
      return state.sessionStartedAt;
    },

  };

})();

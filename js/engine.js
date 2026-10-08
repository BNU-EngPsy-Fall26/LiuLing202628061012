/* ============================================================================
 * js/engine.js —— 游戏状态机（模块 M6-b）
 *
 * 【这个文件干什么】
 *   把"一轮一轮往下跑"这件事管起来：
 *     生成试次序列 → 出一位患者 → 等玩家点 → 算结果 → 反馈 1.2 秒 → 下一位
 *     一轮跑完 → 存进 Store → 交给过渡屏（M7）→ 下一轮 → 三轮跑完进结果页
 *
 *   ★ M6-b 加了练习轮（契约 3.7）：说明页 → 练习轮 12 位 → 停顿屏 → 第一轮……
 *     练习轮和正式轮走的是【同一个】runRound()，只差 isPractice 这一个开关
 *     （不计分 + 顶部那句「练习 · 不计分」）。别把试次循环复制成两份。
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
 *   4. ★ 练习轮一笔都不许进 Store.rounds（契约 3.7）
 *      那 12 位是为了让玩家把标准校准过来用的，它们本身不是数据。
 *      轮次结果唯一的写入口就是 finishRound()，那里第一句就是
 *      "isPractice 就直接 return" —— M8 的结果页永远只会看到 3 条。
 *
 * 【依赖】
 *   Store        —— student / mode / rounds（契约 5.3）
 *   Utils        —— shuffle / rand01（契约 5.4：不许自己实现）
 *   PatientGen   —— generate()（契约 5.1 / M4）
 *   PatientCard  —— render()（契约 5.1 / M5）
 *   Scoring      —— outcomeOf / summarizeRound（契约 5.2 / M6-a）
 *                   + summarizeSession()，只在第 3 轮结束时用一次
 *   Submit       —— save() / send()（契约 6.1 / M14），只在第 3 轮结束时用。
 *                   ★ 是【可选】依赖：没加载也要能玩完（typeof 判断见 finishRound）
 *   RoundScreen  —— show()（M7），只在第 1、2 轮结束时用到
 *                   （练习轮跑完的停顿屏不走它，见 showPracticeEnd()）
 *   window.ROUNDS / window.D_PRIME / window.TRIAL_MODES —— js/config.js
 * ==========================================================================*/

window.Engine = (function () {
  'use strict';

  /* --------------------------------------------------------------------------
   * 0. 常量
   * ------------------------------------------------------------------------ */

  var TOTAL_ROUNDS = 3;      // 契约第 1 节：一场实验恒为三轮
  var FEEDBACK_MS  = 1200;   // 契约 3.1：反馈停留 1.2 秒

  /* 练习轮参数（契约 3.7）
   *
   *   12 位 = 6 信号 + 6 噪音，约 90 秒。★ 永远不随试次模式变 ——
   *   选了快速版也照样跑 12 位（它是"校准标准"用的，不是数据）。
   *
   *   nSignal 必须等于 nNoise：练习轮也得守住 P(S) = 0.5（契约 3.4.1 硬约束 1）。
   *   否则玩家在练习轮里练出来的标准，放到正式轮上是对不上的。
   *
   *   ⚠️ 按"config.js 是唯一真源"的规矩，这几个数字本该住在 js/config.js，
   *      但 config.js 里没有练习轮这一项，而本次任务只允许改 engine.js /
   *      brief.js —— 所以先落在离用它的地方最近的位置。哪天要挪，整块搬。
   */
  var PRACTICE = {
    roundIndex:     0,    // 0 表示练习轮（正式轮是 1 / 2 / 3）
    isPractice:     true,
    trialsPerRound: 12,
    nSignal:        6,
    nNoise:         6,
  };

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
   *   每一轮的种子从它推出来，所以各轮之间不会撞成同一批患者
   *   （练习轮的轮次号是 0，也在里面）。
   *
   *   ⚠️ 这是"复现用"的 rng，不是"公平性"用的 —— 公平性由
   *      nSignal / nNoise 的精确配比保证（见 runRound）。
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
   *   round       当前是第几"轮"：0 = 练习轮，1~3 = 正式轮
   *   isPractice  true = 练习轮。★ 全文件只有两处看它：
   *               setHeader() 决定顶部标不标「练习 · 不计分」，
   *               finishRound() 决定要不要写 Store。别让它在别处长出来
   *   trialsPerRound 本轮一共几位（练习轮 12，正式轮按模式 30 / 16）
   *   sequence    本轮的真值序列：true = 信号患者，false = 噪音患者
   *   index       走到本轮第几位（0 起）
   *   patient     当前这一位患者（含 hasSignal / severity，绝不出这个闭包）
   *   startedAt   当前这张卡片出现的时间戳（算反应时用）
   *   awaiting    true = 正在等玩家点。它是"按钮能不能点"的唯一判据，
   *               也是防止连点、防止 1.2 秒内重复记录的那道闸
   *   trials      本轮已经记录下来的 Trial（契约 4.2）。练习轮的这里也有 12 笔，
   *               但它们在 finishRound() 里被直接丢掉 —— 不进 Store
   *   patientRng  出患者 + 洗牌序列用
   *   cardRng     反馈文案用（和上面那个分开，免得抽一句话就打乱患者序列）
   * ------------------------------------------------------------------------ */

  var state = {
    sessionSeed: 0,
    sessionStartedAt: null,
    round: 1,
    isPractice: false,
    trialsPerRound: 0,
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

  // 模式没选过就按标准版兜底（brief.js 那颗开始按钮已经兜过一次，
  // 这里是防"从开发导航直接蹦进来"的保险，宁可跑标准版也不要卡在半路）
  function modeOf() {
    return Store.currentMode() || window.TRIAL_MODES.standard;
  }

  // 顶部标题：正式轮是「第 N 轮 · 轮次名」，练习轮是「练习 · 不计分」
  //
  // ★ 练习轮那行用 --c-watch（黄）而不是标题默认色：要一眼看出"这段不算数"，
  //   但它只是个提示，不是警报，所以别用红（契约 3.7 的"显眼但别太抢"）。
  //   颜色每次开局都写一遍（正式轮那支把 style.color 清空），
  //   免得练习轮染过的颜色被第一轮的标题继承过去。
  function setHeader(roundIndex, isPractice) {
    if (isPractice) {
      el.title.textContent = '练习 · 不计分';
      el.title.style.color = 'var(--c-watch)';
      return;
    }

    var spec = (window.ROUNDS && window.ROUNDS[roundIndex - 1]) || {};
    el.title.textContent = '第 ' + roundIndex + ' 轮 · ' + (spec.name || '');
    el.title.style.color = '';
  }

  function setProgress() {
    var total = state.trialsPerRound || state.sequence.length;
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
   * 5. 开始一轮 ★ 练习轮和正式轮共用这一个函数
   *
   *   opts.roundIndex       0 = 练习轮，1 / 2 / 3 = 正式轮
   *   opts.isPractice       true → 不计分、顶部标「练习 · 不计分」
   *   opts.trialsPerRound   ┐
   *   opts.nSignal          ├ 不传就按 Store.currentMode() 取（正式轮走这条）
   *   opts.nNoise           ┘
   *
   *   ★ 为什么不给练习轮复制一份试次循环出来：
   *     复制出来的第二份，以后改反馈逻辑（比如反馈里要不要显示生命体征、
   *     停留几毫秒）就得改两处。漏掉一处时，练习轮和正式轮会【悄悄】不一致 ——
   *     程序一个错都不报，只是玩家在练习里校准到的标准对不上正式轮，
   *     而练习轮存在的全部意义正是"校准到和正式轮一致"。
   *     抽成一个函数之后，"练习"和"正式"的差别只剩 isPractice 这一个开关。
   * ------------------------------------------------------------------------ */

  function runRound(opts) {
    opts = opts || {};

    var mode = modeOf();

    // 传了就用传的，没传就退回模式里的值。0 是个合法数字（不会走 fallback）
    function pick(v, fallback) {
      return (typeof v === 'number' && isFinite(v)) ? v : fallback;
    }

    var nSignal = pick(opts.nSignal, mode.nSignal);
    var nNoise  = pick(opts.nNoise,  mode.nNoise);

    state.round          = opts.roundIndex;
    state.isPractice     = !!opts.isPractice;
    state.trialsPerRound = pick(opts.trialsPerRound, mode.trialsPerRound);
    state.trials   = [];
    state.index    = 0;
    state.patient  = null;
    state.awaiting = false;
    state.startedAt = 0;

    // 每轮一套自己的 rng：种子从场次种子推出来，各轮互不相同、
    // 但同一场实验重放时能一模一样地复现那一批患者。
    // 练习轮的 roundIndex 是 0，用的种子和三场正式轮也不会撞。
    state.patientRng = makeRng((state.sessionSeed + state.round * 0x9E3779B1) >>> 0);
    state.cardRng    = makeRng((state.sessionSeed ^ state.round * 0x85EBCA6B) >>> 0);

    // ★ 序列：正好 nSignal 个 true + nNoise 个 false，再洗牌
    //   不是"每位 50% 随机" —— 理由是契约 3.4.1 的硬约束 1：
    //   随机抛硬币会让每轮实际信号数在 15 上下浮动，P(S) 就不再是 0.5，
    //   三轮的 c 也没法放在一起比了。练习轮同理（6 / 6）。
    var pool = [];
    var i;
    for (i = 0; i < nSignal; i++) pool.push(true);
    for (i = 0; i < nNoise;  i++) pool.push(false);
    state.sequence = Utils.shuffle(pool, state.patientRng);

    setHeader(state.round, state.isPractice);
    setProgress();
    setCounts();
    setButtons(false);

    showScreen('game');
    nextTrial();
  }

  // 正式轮：轮次号从 1 数起，其余参数一律从 Store.currentMode() 读
  function startRound(roundNo) {
    runRound({ roundIndex: roundNo, isPractice: false });
  }

  // 练习轮（契约 3.7）：永远 12 位，选了快速版也还是 12 位
  function startPractice() {
    runRound(PRACTICE);
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

    /* ★ 练习轮到这里就结束：不总结、不写 Store、不进结果页（契约 3.7）
     *
     *   state.trials 里那 12 笔（含玩家在练习轮里的命中率）直接丢掉 ——
     *   练习轮存在的意义是让玩家把标准校准到和正式轮一致，
     *   它本身不是数据，写进 Store 会污染 result 页的"三轮对比"。
     *   这是全文件唯一一处把试次丢掉的 return，别在别处再开一个口子。 */
    if (state.isPractice) {
      showPracticeEnd();
      return;
    }

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

    /* ★ 三轮跑完 = 全场结束，把 Session 交出去（契约 6.1）
     *
     *   【为什么"一局只提交一次"是结构保证的，不是靠计数器】
     *     提交只写在这一个分支里 —— 它是通向 showScreen('results') 的唯一一条路。
     *     第 1、2 轮在上面那个 if 里就 return 了，练习轮更早就 return 了，
     *     都到不了这几行。finishRound() 本身对一轮也只可能被调用一次
     *     （nextTrial 走完序列才调它，调完 awaiting 是 false，再也进不来）。
     *     所以这里不需要"提交过了吗"这种标志位 —— 那种标志位才是会漏的地方。
     *
     *   【startedAt 一个参数都不能少】不传的话教师后台看到的"用时"恒为 0
     *     （契约 5.2）。用 state.sessionStartedAt，和结果页那边取的是同一个值。
     *
     *   【send() 不 await、不 .then、不 .catch】它内部已经保证绝不 reject、
     *     不抛错、不弹窗（submit.js 头部注释）。再加一层反而多一条失败路径。
     *
     *   【typeof 这个判断要留着】submit.js 加载失败（路径写错 / 网络）
     *     不能把游戏带崩 —— 没有它，这里会 ReferenceError，玩家连结果页都看不到。
     */
    if (typeof Submit !== 'undefined') {
      var session = Scoring.summarizeSession(
        Store.student, Store.mode, Store.rounds, state.sessionStartedAt);

      Submit.save(session);   // 先落 localStorage：后端没通时成绩也不丢
      Submit.send(session);   // 发出去就不管了
    }

    // 第三轮跑完 → 结果页（M8）
    showScreen('results');
  }

  /* --------------------------------------------------------------------------
   * 8.1 练习结束的停顿屏（契约 3.7）
   *
   *   ★ 练习跑完【不能直接进第一轮】—— 中间必须有这一停，
   *     玩家才知道"从这里开始算数了"。少这一屏，练习轮就白做了。
   *
   *   借用 #screen-round 这一屏来显示（正式轮的过渡屏也用这屏）。
   *   练习结束之后它会被 RoundScreen.show() 整个重建掉，两边不冲突 ——
   *   本函数只往里写死文案，不注册任何会被 RoundScreen 撞到的状态。
   * ------------------------------------------------------------------------ */

  function showPracticeEnd() {
    var host = document.getElementById('screen-round');

    // 没这一屏也别把流程卡死在这里：宁可没有停顿，也要能开第一轮
    if (!host) {
      startRound(1);
      return;
    }

    host.innerHTML = [
      '<h2>练习结束</h2>',
      '<div class="card" style="padding:28px 24px;">',
      '  <p style="font-size:1.12rem;font-weight:600;line-height:1.5;' +
          'color:var(--c-text);margin-bottom:20px;">' +
          '接下来正式计分，规则和刚才一样。</p>',
      '  <div class="btn-row" style="margin-top:22px;">',
      '    <button class="btn btn-primary" id="practiceStart">开始第一轮 →</button>',
      '  </div>',
      '</div>',
    ].join('\n');

    var btn = document.getElementById('practiceStart');

    btn.addEventListener('click', function () {
      btn.disabled = true;      // 防连点：开第一轮时本来也会换屏
      startRound(1);
    });

    showScreen('round');
  }

  /* --------------------------------------------------------------------------
   * 9. 出口（契约里约定的两个，外加两个给调试和 M8 用的小门）
   * ------------------------------------------------------------------------ */

  setButtons(false);   // 进页面时按钮是灰的：没开局，点了也不该有反应

  return {

    // 从说明页那颗「开始（先练 12 位）」调用（brief.js 的 briefStart 回调）
    start: function () {
      // 已经跑过又回来点这颗按钮，说明是重开一局。
      // 上一局的 rounds 必须清掉（否则第二轮实验会带着第一轮的数据，
      // pushRound 还会在第 4 个上抛错），但 student / mode 刚在登录页和
      // 说明页填好，不能跟着清 —— 所以调 clearRounds() 而不是 reset()（契约 5.3）。
      Store.clearRounds();

      // 场次种子：只用来让每一轮的患者可复现，不参与任何"公平性"判定
      state.sessionSeed = ((Date.now() >>> 0) ^
                           Math.floor(Utils.rand01() * 0x100000000)) >>> 0;
      state.sessionStartedAt = new Date();

      // ★ 契约 3.7：正式三轮之前必做 12 位不计分的练习。
      //   练习跑完由 showPracticeEnd() 那屏的按钮回调 startRound(1)，
      //   而不是在这里接着往下走 —— 中间那一停是故意留的。
      startPractice();
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

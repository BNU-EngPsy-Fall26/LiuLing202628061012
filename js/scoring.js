/* ============================================================================
 * js/scoring.js —— 结果计算（模块 M6-a）
 *
 * 【这个文件干什么】
 *   把一堆"玩家做过的试次"（Trial，契约 4.2）算成
 *     · 一轮的结果  RoundResult（契约 4.3）
 *     · 整场的结果 Session    （契约 4.4）
 *   也就是信号检测论那几个数：P(H)、P(FA)、d′、c、β、准确率。
 *
 * 【为什么单独拆出来】
 *   它是纯函数：给同样的 trials，永远算出同一组数。
 *   不碰 DOM、不碰计时器、不读 Store。所以它可以脱离浏览器单独测，
 *   也是整个项目里最该先写、最该验的部分 —— 数是错的，后面全白搭。
 *
 * 【依赖】
 *   Utils —— zScore（CONTRACT.md 4.5：★ 不许自己实现 z() / dPrime）
 *   window.ROUNDS / window.D_PRIME / window.PRIOR —— 三轮参数（js/config.js）
 *   roundConfig —— TRIAL_MODES[mode]，nSignal / nNoise 从它读，★ 不许写死 15
 *
 * 【两组容易搞错的东西，写在这里免得后人踩】
 *   1. 「H + M」恒等于这一轮的信号总数（nSignal），
 *      「FA + CR」恒等于噪音总数（nNoise）。对不上就说明试次序列生成错了。
 *   2. 概率用【对数线性修正】(Hautus 1995)，不是直接用 H/nSignal：
 *         pH = (H + 0.5) / (nSignal + 1)
 *      不修正的话，H = 0 或 FA = nNoise 时 z() 会返回 ±Infinity，
 *      d′ 变成 Infinity 或 NaN，整页数据当场全废。
 * ==========================================================================*/

window.Scoring = (function () {
  'use strict';

  /* --------------------------------------------------------------------------
   * 0. 量尺（几位小数）
   *
   * 契约 4.3 的样例写的是：pH 0.781 / pFA 0.219 / dPrime 1.55 / c 0.00 /
   * beta 1.00 / accuracy 0.800。按这个量尺存，界面直接拿来显示，
   * 不会出现"结果页显示 1.5526453"这种读不出来的数。
   * ------------------------------------------------------------------------ */

  var DIGITS_PROB     = 3;   // pH、pFA、accuracy —— 概率三位
  var DIGITS_METRIC   = 2;   // dPrime、c、beta —— 指标两位
  var DIGITS_RT       = 0;   // 平均反应时取整毫秒

  // 四舍五入到 d 位小数；顺手把 -0 归一成 0（c 恰好为 0 时别显示成 "-0"）
  function roundTo(v, d) {
    if (typeof v !== 'number' || !isFinite(v)) return v;
    var f = Math.pow(10, d);
    var r = Math.round(v * f) / f;
    return r === 0 ? 0 : r;
  }

  /* --------------------------------------------------------------------------
   * 1. outcomeOf —— 一次试次属于四种结果里的哪一种
   *
   *   真实需要紧急处理 + 玩家说要急诊  → H  击中
   *   真实需要紧急处理 + 玩家说可以等  → M  漏报   ★ 第三轮代价最高的那个
   *   其实不需要       + 玩家说要急诊  → FA 误报
   *   其实不需要       + 玩家说可以等  → CR 正确拒斥
   *
   * 【为什么这个判断放在本文件、而不是引擎里】
   *   契约第 8 节铁律第 3 条：判断之前不许读 patient.hasSignal。
   *   引擎里唯一允许读它的地方就是"算出结果的这一刻"，
   *   而那一刻做的事正好是这一个判断 —— 所以引擎把 hasSignal 作为参数递进来，
   *   判断逻辑留在纯函数里，引擎那行读取得到了唯一的、看得见的用途。
   * ------------------------------------------------------------------------ */

  function outcomeOf(hasSignal, responded) {
    if (hasSignal)  return responded ? 'H' : 'M';
    return responded ? 'FA' : 'CR';
  }

  /* --------------------------------------------------------------------------
   * 2. 数一遍 trials 里的四种结果
   * ------------------------------------------------------------------------ */

  function countsOf(trials) {
    var counts = { H: 0, M: 0, FA: 0, CR: 0 };

    for (var i = 0; i < trials.length; i++) {
      var o = trials[i] && trials[i].outcome;
      if (Object.prototype.hasOwnProperty.call(counts, o)) counts[o] += 1;
    }
    return counts;
  }

  function sumCounts(list) {
    var out = { H: 0, M: 0, FA: 0, CR: 0 };
    for (var i = 0; i < list.length; i++) {
      out.H  += list[i].H;
      out.M  += list[i].M;
      out.FA += list[i].FA;
      out.CR += list[i].CR;
    }
    return out;
  }

  /* --------------------------------------------------------------------------
   * 3. 核心：一组计数 + 信号/噪音总数 → SDT 指标（CONTRACT.md 4.5，一字不改）
   *
   *   公式只在这里出现一次。改公式就改这一处，别处一律调这个函数。
   * ------------------------------------------------------------------------ */

  function metricsOf(counts, nSignal, nNoise, trials) {
    var pH  = (counts.H  + 0.5) / (nSignal + 1);   // 对数线性修正
    var pFA = (counts.FA + 0.5) / (nNoise  + 1);

    var zH = Utils.zScore(pH);                     // ★ 走 Utils，不许自己实现
    var zF = Utils.zScore(pFA);

    var dPrime = zH - zF;
    var c      = -0.5 * (zH + zF);

    // β = exp(c × d′) 的等价写法，契约 4.5 给的是这个形式，照抄
    var beta = Math.exp(-0.5 * (zH * zH - zF * zF));

    var total    = counts.H + counts.M + counts.FA + counts.CR;
    var accuracy = total > 0 ? (counts.H + counts.CR) / total : 0;

    // 平均反应时：只统计有 rtMs 的试次（理论上全都有，缺了也别让均值变 NaN）
    var rts = [];
    for (var i = 0; i < trials.length; i++) {
      var rt = trials[i] && trials[i].rtMs;
      if (typeof rt === 'number' && isFinite(rt)) rts.push(rt);
    }

    return {
      pH:       roundTo(pH,       DIGITS_PROB),
      pFA:      roundTo(pFA,      DIGITS_PROB),
      dPrime:   roundTo(dPrime,   DIGITS_METRIC),
      c:        roundTo(c,        DIGITS_METRIC),
      beta:     roundTo(beta,     DIGITS_METRIC),
      accuracy: roundTo(accuracy, DIGITS_PROB),
      meanRtMs: rts.length ? roundTo(Utils.mean(rts), DIGITS_RT) : 0,
    };
  }

  /* --------------------------------------------------------------------------
   * 4. 从 roundConfig（TRIAL_MODES[mode]）取信号/噪音总数
   *
   * ★ 契约 4.5 明令：nSignal / nNoise 从当前模式的配置里读，不许写死。
   *   nSignal 一定等于 nNoise（契约 3.4.1 的硬约束 1），所以 P(S) 恒为 0.5。
   *
   * 兜底：万一调用方忘了传 roundConfig，就用「H + M」当信号总数。
   *   这不是"猜"，而是结构上必然成立 —— 每位患者的 hasSignal 决定了它落在
   *   H/M 还是 FA/CR，所以 H + M 就是这一轮真实发过多少位信号患者。
   *   同时吭一声，免得这个集成错误被默默吞掉。
   * ------------------------------------------------------------------------ */

  function trialCountsFrom(roundConfig, counts, trialCount) {
    var hasConfig = roundConfig &&
                    typeof roundConfig.nSignal === 'number' &&
                    typeof roundConfig.nNoise  === 'number';

    if (!hasConfig) {
      console.warn('[Scoring] 没拿到 roundConfig（TRIAL_MODES[mode]），' +
                   'nSignal / nNoise 改用 H+M / FA+CR 兜底。');
    }

    var nSignal = hasConfig ? roundConfig.nSignal : (counts.H + counts.M);
    var nNoise  = hasConfig ? roundConfig.nNoise  : (counts.FA + counts.CR);

    // 序列生成（M6-b）如果漏发或多发了试次，这里能第一时间看出来
    if (trialCount !== nSignal + nNoise) {
      console.warn('[Scoring] 试次数对不上：trials=' + trialCount +
                   '，nSignal+nNoise=' + (nSignal + nNoise) + '。');
    }

    return { nSignal: nSignal, nNoise: nNoise };
  }

  /* --------------------------------------------------------------------------
   * 5. summarizeRound —— 一轮 → RoundResult（契约 4.3）
   *
   *   roundNo      1 | 2 | 3
   *   trials       Trial[]（契约 4.2），本轮的全部试次
   *   roundConfig  TRIAL_MODES[mode]（nSignal / nNoise 从它读）
   *
   * 轮次名、支付矩阵这些「实验设定」全部读 window.ROUNDS（config.js 是唯一真源），
   * ★ 不在这里写死任何数字 —— 三轮 d′ 相同、先验相同，是铁律（契约第 8 节）。
   * ------------------------------------------------------------------------ */

  function summarizeRound(roundNo, trials, roundConfig) {
    trials = trials || [];

    var spec   = (window.ROUNDS && window.ROUNDS[roundNo - 1]) || {};
    var counts = countsOf(trials);
    var n      = trialCountsFrom(roundConfig, counts, trials.length);

    return {
      round:         roundNo,
      roundName:     spec.name || '',
      systemDPrime:  window.D_PRIME,        // 三轮相同（config.js 是唯一真源）
      prior:         window.PRIOR,          // 三轮相同
      payoff:        spec.payoff || null,
      betaOpt:       spec.betaOpt,
      cOpt:          spec.cOpt,
      totalTrials:   trials.length,
      counts:        counts,
      metrics:       metricsOf(counts, n.nSignal, n.nNoise, trials),
    };
  }

  /* --------------------------------------------------------------------------
   * 6. summarizeSession —— 三轮 → Session（契约 4.4）
   *
   *   student  { id, name } | null（游客模式）
   *   mode     'standard' | 'quick'；也接受 TRIAL_MODES 里的整个对象
   *   rounds   RoundResult[]，长度恒为 3
   *   startedAt 可选。实验开始那一刻（Engine.sessionStartedAt() 或任意能被
   *            new Date() 吃的值）。不传就只有结束时间，时长会算成 0 ——
   *            教师后台要看时长，所以 M8 请把它传进来。
   *
   * 【overall 是什么】三轮的计数合并后再算一遍 SDT 指标。
   *   它不是三个 d′ 的平均 —— d′ 不是线性量，平均没有意义。
   *   正确做法就是把 90（或 48）个试次当成一大轮来算，
   *   所以 nSignal / nNoise 也要跟着乘以轮数。
   * ------------------------------------------------------------------------ */

  function toIso(v, fallbackMs) {
    var d = v ? new Date(v) : new Date(fallbackMs);
    return isNaN(d.getTime()) ? new Date(fallbackMs).toISOString() : d.toISOString();
  }

  function summarizeSession(student, mode, rounds, startedAt) {
    // 兼容 CONTRACT.md 5.2 写的 (student, rounds) 两个参数的调法
    if (Object.prototype.toString.call(mode) === '[object Array]') {
      startedAt = rounds;
      rounds = mode;
      mode = null;
    }

    rounds = rounds || [];

    // mode 允许传 key（'standard'）或 TRIAL_MODES 里的对象
    var modeKey = (typeof mode === 'string') ? mode
                : (mode && mode.id) ? mode.id
                : null;
    var modeCfg = (typeof mode === 'object' && mode) ? mode
                : (modeKey ? window.TRIAL_MODES[modeKey] : null);

    var now = Date.now();

    // overall：三轮计数合并，按「轮数 × 每轮信号数」重新算指标
    var merged = sumCounts(rounds.map(function (r) { return r.counts; }));
    var allTrials = [];
    var nSignal = 0;
    var nNoise  = 0;

    for (var i = 0; i < rounds.length; i++) {
      var r = rounds[i];
      var c = r.counts;
      // 每轮的 nSignal / nNoise 由该轮自己的计数还原（H+M / FA+CR），
      // 这样即使某一轮是别的模式跑的，合并出来的 P(S) 也不会被算歪
      nSignal += c.H + c.M;
      nNoise  += c.FA + c.CR;
      allTrials.push({ rtMs: r.metrics ? r.metrics.meanRtMs : null });
    }

    // 合并后的平均反应时：用各轮平均值按轮试次数加权
    var weightedRt = 0;
    var rtWeight   = 0;
    for (var j = 0; j < rounds.length; j++) {
      var m = rounds[j].metrics || {};
      var w = rounds[j].totalTrials || 0;
      if (typeof m.meanRtMs === 'number' && isFinite(m.meanRtMs)) {
        weightedRt += m.meanRtMs * w;
        rtWeight   += w;
      }
    }

    // 字段严格照契约 4.4，不多不少。
    // 游客模式：studentName 为 null（studentId 可能有，玩家只填了学号没填姓名）
    return {
      studentId:      (student && student.id)   ? student.id   : null,
      studentName:    (student && student.name) ? student.name : null,
      mode:           modeKey || (window.Store ? window.Store.mode : null),
      trialsPerRound: modeCfg ? modeCfg.trialsPerRound : (rounds[0] ? rounds[0].totalTrials : null),
      startedAt:     toIso(startedAt, now),
      finishedAt:    new Date(now).toISOString(),
      rounds:        rounds,
      overall: {
        totalTrials: rounds.reduce(function (s, r) { return s + (r.totalTrials || 0); }, 0),
        counts:      merged,
        metrics:     (function () {
          var mm = metricsOf(merged, nSignal, nNoise, []);
          if (rtWeight > 0) mm.meanRtMs = roundTo(weightedRt / rtWeight, DIGITS_RT);
          return mm;
        })(),
      },
    };
  }

  /* ------------------------------------------------------------------------ */

  return {
    summarizeRound:   summarizeRound,
    summarizeSession: summarizeSession,
    outcomeOf:        outcomeOf,
  };

})();

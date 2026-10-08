/* ============================================================================
 * js/patient.js —— 患者数据生成（模块 M4）
 *
 * 【这个文件干什么】
 *   把"这位患者是不是真的危重"（hasSignal）变成一整套玩家看得见的
 *   生命体征 + 主诉文案 + 来院方式，也就是 CONTRACT.md 4.1 的 Patient 对象。
 *
 *   它只生成数据，不碰 DOM（CONTRACT.md 5.1）——
 *   所以它可以在没有浏览器的环境里单独跑、单独测。
 *   卡片长什么样、怎么排版，是 M5（js/patient-card.js）的事，不是这里的事。
 *
 * 【依赖】
 *   Utils           —— 随机数 / clamp / round1 / pick（CONTRACT.md 4.5：不许自己实现）
 *   PatientData     —— 主诉词库、姓氏池、分档规则（**只读不改**）
 *   window.D_PRIME  —— dPrime 的缺省值（js/config.js）
 *
 * 【★ 铁律（CONTRACT.md 3.2 / 第 8 节）】
 *   信号患者和噪音患者只允许"输入的数字不同"，
 *   不允许"走不同的代码路径"。所以本文件里 hasSignal 只出现一次 ——
 *   就是第一步那个三元表达式。从它下一行开始，两种患者走的路一模一样。
 * ==========================================================================*/

window.PatientGen = (function () {
  'use strict';

  /* --------------------------------------------------------------------------
   * 0. 随机数一律走 Utils（CONTRACT.md 4.5：不许自己实现）
   *
   *   正态数     → Utils.randN(m, s, rng)
   *   0~1 均匀数 → Utils.rand01(rng)      ← 分档偏移判定、偏移方向用这个
   *   从数组抽   → Utils.pick(arr, rng)
   *
   * 【为什么均匀数不能拿 Utils.randN 顶替】
   *   adjacentChance 要的是"30% 的概率"、方向要的是"各 50%"，都是均匀数。
   *   用正态数代替会改变实际概率（P(N(0,1) < 0.3) = 0.62，不是 0.30），不成立。
   *
   * 【为什么每一处都必须把 rng 传下去】
   *   将来要用固定种子复现同一批患者，rng 必须一路透传到每一次取数，
   *   漏掉任何一处，复现出来的序列就对不上了。
   * ------------------------------------------------------------------------ */

  // 保留两位小数（severity 存进 Patient 时要用的量尺）
  function round2(x) {
    return Math.round(x * 100) / 100;
  }

  // 数字补成 4 位，'P-0001' ~ 'P-9999'
  function pad4(n) {
    return ('000' + n).slice(-4);
  }

  /* --------------------------------------------------------------------------
   * drawHint(severity, rules, pool, rng) —— 抽一条"有噪声的文字线索"
   *
   *   主诉（契约 3.3）和来院方式（契约 3.3.1）用的是【完全相同的机制】，
   *   只是池子和规则不同，所以这段逻辑只写一份，两边各调一次：
   *     ① 按 rules.bounds 定出实际档
   *     ② 以 rules.adjacentChance 的概率往相邻档偏一档，方向随机
   *     ③ 从该档的池子里随机抽一条
   *
   *   顺序不能换：先定档、再漂移、最后抽句 —— 漂移是在"档"上做的，
   *   不是重新按 severity 算一遍。
   *
   *   边界和比例一律读自 rules，本文件不许写死（契约 3.3）。
   *   注意 mild（下标 0）往 -1 偏会被夹住＝保持不变，所以 mild 实际是
   *   "有 15% 概率变 mid"；severe 同理。这是 patient-data.js 里说明过的行为。
   *
   *   ★ 这里不许看 hasSignal —— 它只收一个 severity 数值。
   *     信号患者和噪音患者走的就是这一条路径，没有第二条。
   * ------------------------------------------------------------------------ */

  function drawHint(severity, rules, pool, rng) {
    // ① 按 bounds 定出实际档位
    var tier = severity < rules.bounds[0] ? 'mild'
             : severity < rules.bounds[1] ? 'mid'
             :                              'severe';

    var idx = rules.order.indexOf(tier);

    // ② 以 adjacentChance 的概率往相邻档偏一档，方向随机 —— ★ 必须双向
    //    只往一个方向偏会教出错误的临床直觉，理由见 patient-data.js 的注释。
    if (Utils.rand01(rng) < rules.adjacentChance) {
      var dir = Utils.rand01(rng) < 0.5 ? -1 : 1;
      idx = Utils.clamp(idx + dir, 0, rules.order.length - 1);
    }

    // ③ 从该档随机抽一句
    return Utils.pick(pool[rules.order[idx]], rng);
  }

  /* --------------------------------------------------------------------------
   * generate(opts) —— 生成一位患者
   *
   *   opts.hasSignal  boolean   这位患者是否真的需要紧急处理
   *   opts.dPrime     number    本轮系统设定的 d′（缺省用 window.D_PRIME）
   *   opts.rng        可选      { next: function(){ return 0~1 } }
   *
   * → Patient（结构见 CONTRACT.md 4.1）
   * ------------------------------------------------------------------------ */
  function generate(opts) {
    opts = opts || {};

    var hasSignal = !!opts.hasSignal;
    var dPrime = (opts.dPrime === undefined || opts.dPrime === null)
                   ? window.D_PRIME
                   : opts.dPrime;
    var rng = opts.rng;   // 可能为 undefined，Utils 内部会兜底成 Math.random

    /* ======================================================================
     * 第一步：采样底层决策变量 severity（CONTRACT.md 3.2）
     *
     * ★★★ 全文件唯一允许出现 hasSignal 的地方就是这三行 ★★★
     * ==================================================================== */
    var severity = hasSignal
      ? Utils.randN(dPrime, 1, rng)   // 真危重：N(d′, 1)
      : Utils.randN(0, 1, rng);       // 其实没事：N(0, 1)

    /* ======================================================================
     * 第二步：从 severity 换算生命体征（CONTRACT.md 3.3，公式一字不改）
     *
     * 注意两个方向相反的指标：心率随 severity 升高，血压随 severity 降低。
     * 这是契约有意设计的真实生理表现，不要"顺手"统一方向。
     *
     * 舒张压刻意【不 clamp】：它跟着收缩压走，两者必须成比例，
     * 单独夹一下会把血压拆成两个对不上的数。
     * ==================================================================== */

    var hr   = Utils.clamp(Math.round(72 + severity * 14 + Utils.randN(0, 4, rng)), 45, 180);
    var sbp  = Utils.clamp(Math.round(118 - severity * 8 + Utils.randN(0, 5, rng)), 70, 200);
    var dbp  = Math.round(sbp * 0.63 + Utils.randN(0, 3, rng));
    var spo2 = Utils.clamp(Math.round(98 - severity * 3.2 + Utils.randN(0, 1, rng)), 70, 100);
    var temp = Utils.clamp(Utils.round1(36.8 + severity * 0.45 + Utils.randN(0, 0.2, rng)), 34.5, 41.5);

    var consciousness = severity < -0.5 ? '清醒'
                      : severity <  0.5 ? '嗜睡'
                      : severity <  1.5 ? '昏睡'
                      :                   '昏迷';

    /* ======================================================================
     * 第三步：抽两条"有噪声的文字线索" —— 主诉 + 来院方式
     *
     * 两条线索机制完全一样，只是池子和规则不同：
     *   主诉     读 PatientData.complaints + PatientData.tierRules
     *   来院方式 读 PatientData.arrivals   + PatientData.arrivalRules
     * 都走同一个 drawHint()，只是传进去的参数不一样。
     *
     * ★ 两条都【不许按 hasSignal 分档】：路径完全一样，
     *   唯一的差别是上面那个 severity 的数值不同（契约 3.2 / 3.3.1 铁律）。
     * ==================================================================== */

    var chiefComplaint = drawHint(severity, PatientData.tierRules,
                                  PatientData.complaints, rng);
    var arrival        = drawHint(severity, PatientData.arrivalRules,
                                  PatientData.arrivals, rng);

    /* ======================================================================
     * 第四步：拼出 Patient 对象（字段名严格照 CONTRACT.md 4.1）
     *
     * 先定 sex，再据此拼 name —— 称呼必须和性别一致。
     * age 与姓名、性别之间不需要任何相关性，各自独立随机。
     * ==================================================================== */

    var sex = Utils.rand01(rng) < 0.5 ? '男' : '女';
    var honorific = (sex === '男')
                      ? PatientData.honorifics.male
                      : PatientData.honorifics.female;
    var name = Utils.pick(PatientData.surnames, rng) + honorific;

    var age = 18 + Math.floor(Utils.rand01(rng) * 73);                   // 18 ~ 90
    var id  = 'P-' + pad4(1 + Math.floor(Utils.rand01(rng) * 9999));     // P-0001 ~ P-9999

    return {
      id:             id,
      name:           name,
      age:            age,
      sex:            sex,
      chiefComplaint: chiefComplaint,
      arrival:        arrival,        // ★ 来院方式 / 外观（契约 3.3.1）
      vitals: {
        temp:          temp,
        hr:            hr,
        sbp:           sbp,
        dbp:           dbp,
        spo2:          spo2,
        consciousness: consciousness,
      },
      severity:  round2(severity),  // ★ 底层决策变量（保留 2 位）。M5 不许渲染它
      hasSignal: hasSignal,         // ★ 真实情况。判断前不得泄露
    };
  }

  /* ------------------------------------------------------------------------ */

  return {
    generate: generate,
  };

})();

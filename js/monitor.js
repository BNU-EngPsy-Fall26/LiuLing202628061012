/* ============================================================================
 * js/monitor.js —— 监护仪面板（视觉层 · 第 1 阶段）
 *
 * 【它是什么】游戏屏里、患者卡片【上方】的那块"监护仪"（M视觉1c 重画过）：
 *   左边两块波形格（上：心电，下：血氧），右边一列三个大号读数；
 *   两块格子里都有暗绿方格网；心电那格左上角一颗报警灯。
 *   纯增量：删掉它（或者根本不调 render），整局照样跑得完。
 *
 * 【它从哪儿拿数】
 *   · 波形的心率、三组读数 —— 全部直接读 patient.vitals，一个字都不自己算。
 *     面板上的 118 必须就是卡片上的 118：两处读的是同一个 patient.vitals.hr。
 *   · 报警灯的档 —— 五项生命体征里【最差的那一档】（见第 3.1 节）。
 *   · 心电的【节律形态】—— 由 patient.severity 分三档（见第 2b 节）。
 *   · 心搏序列的随机部分 —— 由 patient.id 的字符串哈希做种子（见第 2b 节）。
 *   · 读数的颜色 —— 和患者卡片那一行用【同一张阈值表】（PatientCard.VITAL_RANGES）
 *     和同一批类名（.vital-normal / -watch / -danger，颜色定义在 styles/main.css）。
 *
 *   ★ 两条通道的分工（别搞混）：
 *     · 报警灯只读【体征】—— M视觉1b 定的，severity 一次都不读（那是泄漏）
 *     · 波形形态读【severity】—— M视觉1c 要的，让"危重"看得出来
 *     灯和波形是两条独立的通道。灯的规则不要搬到波形这边来。
 *
 * 【★ 铁律（CONTRACT.md 第 8 节）】
 *   ❌ 禁止：任何形式的 if (patient.hasSignal)
 *   ❌ 禁止：把 hasSignal 写进 DOM / data-* / class / title
 *   ❌ 禁止：console.log 打印 patient
 *   本文件的【代码里】一次都没有读过那个"真实答案"字段（它只允许出现在
 *   patient-card.js 和 engine.js 各自那唯一一处明文读取里）。
 *
 *   审计命令（在仓库根目录敲，那对方括号是 grep 的老写法：
 *   让命令本身不匹配自己这一行）：
 *
 *       grep -nE "has[S]ignal" js/monitor.js
 *
 *   判据：应当命中 4 行，且**【全部在文件开头的这段说明里】**（第 22 / 23 / 46 / 227 行）。
 *   只看代码、把注释行（`*` 块注释和 `//` 行注释）滤掉：
 *
 *       grep -nE "has[S]ignal" js/monitor.js | grep -vE "^[0-9]+: *(//|\*)"
 *
 *   判据：**0 命中**。命中 ≥1 行就说明有人把它写进了真代码，重点查是不是分支条件。
 *
 *   ★ 为什么注释里不把它藏起来：藏了之后 grep 是 0 命中，但那个 0 只说明
 *     "用了藏的手法"，不说明"没读"，审计反而变成走过场（patient-card.js 头部
 *     第 0 节也是这个道理）。
 *
 * 【★ frozen 参数是给测试用的，必须实现】
 *   波形一直在动 → 同一个患者渲染两次，Canvas 像素天然不同。
 *   于是"把 hasSignal 从 true 改成 false，判断态 DOM 必须一字不差"这条铁律自查
 *   会【永远失败】—— 而失败的原因不是泄题，是动画。
 *   所以 opts.frozen === true 时：画在固定相位 t = 0，且【不启动】requestAnimationFrame。
 *   平时是动的，测试时冻结。
 *
 * 【接口（任务书 §四）】
 *   window.Monitor.render(el, patient, opts)   el = #monitorPanel
 *   window.Monitor.stop()
 * ==========================================================================*/

window.Monitor = (function () {
  'use strict';

  /* --------------------------------------------------------------------------
   * 0. 常量
   * ------------------------------------------------------------------------ */

  var FALLBACK_ACCENT  = '#2ED3A6';   // tokens.css 的 --c-accent（心电那条）
  var FALLBACK_PRIMARY = '#22B8CF';   // tokens.css 的 --c-primary（血氧那条）
  var FALLBACK_HR      = 72;          // vitals.hr 缺失时的兜底心率

  /* 走纸速度：每秒多少像素（波形整体向左滚）。
   *
   * ★ M视觉1c 从 140 降到了 70。不是审美问题，是【算出来必须这样】：
   *   面板上波形格宽约 550px，140px/s 时一屏只有 3.9 秒 ≈ 5.2 拍（心率 80）。
   *   而任务书要求"偶发早搏"档每 8~12 拍才来一个早搏 —— 【一屏 5 拍里
   *   根本装不下一个早搏】，那一档就会和"规整窦性"长得一模一样，
   *   玩家看到的还是"每个病人波形都差不多"。
   *   降到 70px/s 之后一屏约 7.9 秒 ≈ 10.5 拍，早搏才稳定地出现在视野里。
   *   （真实监护仪走纸 25mm/s；照 12px 一个小格换算该是 300px/s，
   *     所以 70 和 140 都远慢于真机 —— 这一步没有把"真实感"换掉多少。）
   */
  var PX_PER_SECOND   = 70;
  var HR_MIN          = 30;          // 心率下限（防除零/防疯跑）
  var HR_MAX          = 240;         // 心率上限

  /* --------------------------------------------------------------------------
   * 1. 生命体征分档阈值 —— 只有一个真源：js/patient-card.js 的 VITAL_RANGES
   *
   * 【为什么现在能直接读它】M视觉1b 让 patient-card.js 把它导出来了
   *   （`PatientCard.VITAL_RANGES`）。在那之前这里抄过一份，抄两份的坏处是：
   *   改了一边忘了另一边时，两边会【悄悄】不一致 —— 卡片把 118 标成黄的、
   *   面板标成绿的，玩家以为哪里坏了，而程序一个错都不报。
   *
   * 【下面的 FALLBACK_RANGES】只在"单独加载 monitor.js、PatientCard 不在"
   *   时才用（比如某个只画面板的小页面）。这种情况下控制台会 warn 一句 ——
   *   它是兜底，不是第二份真源：只要 PatientCard 在，就一律走它那张表。
   *
   * 【格式】normal 是正常区间，watch 是需观察区间（可以有好几段），
   *   两个都不落在里面 → 危急；判断顺序 normal → watch → danger，
   *   **压在边界上的值算正常**（和 patient-card.js 完全一致）。
   *   consciousness 不是数字，按词表查；词表里没有的写法一律按"需观察"。
   * ------------------------------------------------------------------------ */

  var FALLBACK_RANGES = {
    temp: { label: '体温', unit: '°C', digits: 1, normal: [36.0, 37.5], watch: [[35.5, 36.0], [37.5, 38.5]] },
    hr:   { label: '心率', unit: '',   digits: 0, normal: [60, 100],   watch: [[50, 60], [100, 120]] },
    sbp:  { label: '血压', unit: '',   digits: 0, normal: [90, 140],   watch: [[85, 90], [140, 160]] },
    spo2: { label: '血氧', unit: '%',  digits: 0, normal: [95, Infinity], watch: [[90, 94]] },
    consciousness: { label: '意识', unit: '', levels: { '清醒': 'normal', '嗜睡': 'watch', '昏睡': 'danger', '昏迷': 'danger' } },
  };

  var warnedRanges = false;

  function ranges() {
    var pc = window.PatientCard;
    if (pc && pc.VITAL_RANGES) return pc.VITAL_RANGES;

    if (!warnedRanges) {
      warnedRanges = true;
      console.warn('[Monitor] 读不到 PatientCard.VITAL_RANGES，退回本文件里的兜底阈值。' +
                   '兜底那份可能已经和 patient-card.js 对不上 —— 请检查 js/monitor.js ' +
                   '有没有排在 js/patient-card.js 后面加载。');
    }
    return FALLBACK_RANGES;
  }

  // 分档 → main.css 里已有的类（和患者卡片用的是同一批）
  var BAND_CLASS = {
    normal: 'vital-normal',
    watch:  'vital-watch',
    danger: 'vital-danger',
  };

  // 分档的"好坏"次序：0 正常 < 1 需观察 < 2 危急。报警灯取五项里的最大值。
  var BAND_RANK = { normal: 0, watch: 1, danger: 2 };
  var RANK_BAND = ['normal', 'watch', 'danger'];

  /* --------------------------------------------------------------------------
   * 2. 两种心搏的形状 + 一种脉搏的形状
   *
   *   横轴 = 一个搏动内的相位 0~1，纵轴 = 相对基线的幅值（正常 R 波 = 1.0）。
   *   关键点之间【线性】插值 —— 心电的 QRS 就该是尖的、有棱角的。
   * ------------------------------------------------------------------------ */

  // —— 正常心搏（窦性）：P → Q → R → S → T，相位区间照任务书 §二① 那张表
  var BEAT = [
    [0.000,  0.00],
    [0.100,  0.00],
    [0.125,  0.15],   // P
    [0.150,  0.00],
    [0.280,  0.00],
    [0.320, -0.15],   // Q
    [0.350,  1.00],   // R ★ 最显眼的那一竖
    [0.380,  0.35],
    [0.410, -0.35],   // S
    [0.440,  0.00],
    [0.620,  0.00],
    [0.700,  0.30],   // T
    [0.780,  0.00],
    [1.000,  0.00],
  ];

  /* —— 早搏（室性期前收缩）★ M视觉1c 新增（任务书 §三）
   * 和上面那张表的三处差别就是"畸形"的全部含义：
   *   ① 没有 P 波      —— 起搏点不在窦房结，P 波消失
   *   ② 波峰矮         —— 0.60，不是 1.00
   *   ③ 波峰宽         —— 这里只是"形状占满整段"；真正让它显宽的是
   *                        调用方给它的时长（1.6 × 正常心搏，见 buildBeats）
   * 剩下的 Q/S 都做得更深更缓，一眼就能看出"这一拍不对"。
   */
  var BEAT_ECTOPIC = [
    [0.000,  0.00],
    [0.100, -0.18],   // 深 Q
    [0.300,  0.60],   // R：宽、矮
    [0.520, -0.30],   // 宽 S（★ 别挖太深：S 越深，这个波在画面上越"看不出来是个凸起"）
    [0.760,  0.00],
    [1.000,  0.00],
  ];

  /* —— 体积描记波（血氧那条）★ M视觉1c 新增（任务书 §四）
   *   主峰 → 快速回落 → 【切迹小台阶】→ 再落下去。
   *   和心电的区别不只是形状：这条用【平滑插值】（见 amplitudeSmooth），
   *   所以圆润、没有尖角 —— 这正是脉搏波的样子。
   */
  var PLETH = [
    [0.000, 0.04],
    [0.080, 0.10],
    [0.220, 1.00],   // 主峰
    [0.320, 0.66],   // 快速回落
    [0.440, 0.60],   // ↓ 切迹：从 0.66 落到 0.60 的一小级台阶
    [0.560, 0.58],   // ↑ 台阶走完
    [0.700, 0.22],   // 再落下去
    [0.860, 0.06],
    [1.000, 0.04],
  ];

  // 线性插值（心电用）：保住尖角
  function amplitudeAt(table, phase) {
    for (var i = 1; i < table.length; i++) {
      if (phase <= table[i][0]) {
        var p0 = table[i - 1], p1 = table[i];
        var span = p1[0] - p0[0];
        if (span <= 0) return p1[1];
        return p0[1] + (p1[1] - p0[1]) * ((phase - p0[0]) / span);
      }
    }
    return table[table.length - 1][1];
  }

  // 平滑插值（血氧用）：每段两端导数为 0，接起来就是一个圆润的 S —— 没有尖角
  function amplitudeSmooth(table, phase) {
    for (var i = 1; i < table.length; i++) {
      if (phase <= table[i][0]) {
        var p0 = table[i - 1], p1 = table[i];
        var span = p1[0] - p0[0];
        if (span <= 0) return p1[1];
        var u = (phase - p0[0]) / span;
        return p0[1] + (p1[1] - p0[1]) * (u * u * (3 - 2 * u));   // smoothstep
      }
    }
    return table[table.length - 1][1];
  }

  /* --------------------------------------------------------------------------
   * 2b. ★ 心搏序列：形态随 severity 变（任务书 §三）
   *
   *   【三档节律】
   *     severity < 0.4          规整窦性 —— R-R 抖动 ±5%，没有早搏
   *     0.4 ≤ severity < 1.1    偶发早搏 —— 每 8~12 拍一个宽大畸形的早搏
   *     severity ≥ 1.1          明显不齐 —— R-R 抖动 ±30%，每 4~6 拍一个早搏
   *
   *   【为什么"形态"比"密度"管用】20 万位患者的心率一半落在 70~95，
   *     光看密度只有 1.36 倍的差别 —— 真实的危重病人不是"跳得快一点"，
   *     而是【形状不对了】。早搏那个宽而矮的波，一眼就能看见。
   *
   *   【序列从哪儿来 —— 不引入新的随机源】
   *     种子 = patient.id 的字符串哈希（"P-0423" → 一个整数）。
   *     同一位患者永远得到同一串心搏：重渲染一致、frozen 那套自测才稳，
   *     接口也不用多一个 rng 参数。
   *
   *   ★ 铁律：只读 severity 和 vitals.hr，以及 patient.id。
   *     绝不读那位患者的真实答案（hasSignal）。翻转 hasSignal 波形一动不动。
   *
   *   【和报警灯的分工】灯只看体征（M视觉1b 定的），波形看 severity。
   *     两者是两条独立的通道，别把灯的规则搬到这里来。
   * ------------------------------------------------------------------------ */

  // severity 的三档切点。★ 现读 patient-data.js 的 tierRules.bounds：
  //   这和"主诉抽哪一档"用的是同一组数（0.4 / 1.1），语义上也确实是同一件事
  //   （severity 的三档），所以共用一份，不在这里写死第二份。
  function rhythmBounds() {
    var rules = window.PatientData && window.PatientData.tierRules;
    var b = rules && rules.bounds;
    return (b && typeof b[0] === 'number' && typeof b[1] === 'number') ? b : [0.4, 1.1];
  }

  var TIERS = ['regular', 'ectopic', 'irregular'];

  // 只看 severity 的"理想档"（不含漂移）—— 内部用，别拿它当观察者的口径
  function idealTier(severity) {
    if (!isNum(severity)) return 0;
    var b = rhythmBounds();
    if (severity < b[0]) return 0;
    if (severity < b[1]) return 1;
    return 2;
  }

  /* --------------------------------------------------------------------------
   * 2b.1 ★ 形态档位 = 理想档 + 40% 漂移（M视觉1d 新增）
   *
   *   【为什么要漂】M视觉1c 那版是直接按 severity 的三档画形态的，等于给了玩家
   *   一条【无噪声】的 severity 读数。量化下来：一个只看"波形档位"的观察者
   *   d′ = 1.06、准确率 76.0%，而理想观察者的天花板才 77.3% ——
   *   也就是说玩家盯着波形就能拿接近满分，体征都可以不看。这和 M视觉1b 里
   *   那盏灯是同一个病，只是症状更隐蔽（要"看懂宽大波"才用得上，所以当时没看出来）。
   *
   *   【为什么是 40%】和主诉/来院方式是同一套机制，只是比例不同：
   *       主诉 30% ／ 波形 40% ／ 来院方式 50%
   *   40% 能把 d′ 从 1.06 压到 ~0.85，和主诉一个量级。压不到 0 ——
   *   切点 0.4/1.1 正好落在最优判定阈值附近，掺了噪声它仍然是个不错的线索。
   *   再往下压要靠系统 d′ 那个旋钮，不在这份改动里。
   *
   *   【种子 = patient.id】和心搏序列同一个种子。三个理由缺一不可：
   *     ① 同一位患者重渲染时波形必须一致（否则 frozen 那套铁律自测会不稳）
   *     ② 不引入新的随机性来源，铁律那套照旧成立
   *     ③ 不用改 render 的接口（不加 opts.rng）
   *
   *   ★ 铁律：只看 severity 和 patient.id，绝不读 hasSignal。
   * ------------------------------------------------------------------------ */

  var DRIFT = 0.40;        // 漂到相邻档的概率

  function rhythmTier(patient) {
    var ideal = idealTier(patient && patient.severity);
    var rand  = makeRng(hashId(patient && patient.id) ^ 0x9E3779B9);

    if (rand() >= DRIFT) return TIERS[ideal];            // 六成：原档

    var dir = rand() < 0.5 ? -1 : 1;                     // 四成：往相邻档漂
    var i   = ideal + dir;
    if (i < 0) i = 0;                                    // 两端夹住
    if (i > 2) i = 2;
    return TIERS[i];
  }

  // "P-0423" → 一个稳定的 32 位整数（FNV-1a）。纯粹的字符串哈希，不含任何患者信息。
  function hashId(id) {
    var s = String(id === undefined || id === null ? '' : id);
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  // 和 patient.js / engine.js 里那个同款（同一个乘法散列），只是种子的来路不同
  function makeRng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var CYCLE_BEATS = 120;   // 一个循环 120 拍（hr 80 时约 90 秒）之后原样重复。
                           // 8 拍和 10 拍的早搏节奏正好走满整圈；9 拍的会在接缝处
                           // 差一拍（约 90 秒才发生一次，看不出来）。
                           // 圈太长还有性能账：beatAmplitudeAt 是线性找拍，圈越大每帧越慢。

  /* —— 早搏在时间轴上占多大地方（单位：一个正常心搏的时长）——
   *
   * ★ M视觉1c 返工：这三个数原来分别是 1.6 / 1.5 / 1.0（合计 3.1 拍），
   *   结果"早搏"那一档和"明显不齐"那一档看上去一模一样 ——
   *   两屏的主导特征都是"中间一个宽大波 + 一段长平线"，底下的常规拍都被挤没了。
   *   一个早搏事件吃掉 3.1 个正常拍，而"明显不齐"档每 4~6 拍就来一个，
   *   一屏 10.5 拍里 1~2 个事件就把 3~6 拍吃光，剩下的常规间隔太少，
   *   ±30% 的抖动摊在那几段上根本看不出来（实测：非早搏间隔 CV 只有 10.9%）。
   *
   *   真实的早搏是【提前来】+【完全代偿间歇】，一个事件的 R-R 合计约 2 倍正常 R-R。
   *   所以：把前一个拍压短（早搏提前），早搏波本身收窄一点，代偿间歇也短得多。
   *   事件合计 2.2 拍（原来是 3.1）—— 一屏能多留出 1 拍给常规拍。
   */
  var ECTOPIC_SPAN  = 1.2;   // 早搏波本身占的时长（宽大畸形的"宽"）
  var ECTOPIC_PAUSE = 0.26;  // 早搏之后的代偿间歇
  var PRE_ECTOPIC   = 0.6;   // 早搏【前】那一拍被压短 —— 这样早搏才是"提前"来的

  function buildBeats(patient, hr) {
    var tier  = rhythmTier(patient);          // ★ 含 40% 漂移，判档和画波形走的是同一个函数
    var base  = 60 / hr;                                   // 一个正常心搏的时长（秒）
    var rand  = makeRng(hashId(patient && patient.id) ^ 0x9E3779B9);

    /* R-R 抖动。任务书要的是"R-R 间隔 ±30%"，但这里抖的是【每个拍的时长】，
     * 而 R-R = 0.65×前一拍的时长 + 0.35×后一拍的时长（R 落在拍的 35% 处）。
     * 两个拍的时长一加权，方差只剩 0.65²+0.35² = 0.545 倍 ——
     * ±0.30 抖进去、±0.22 出来。所以这里给 0.40，落到 R-R 上才真的是 ±30%。
     * （自测⑭会把这个换算关系量出来，改这里就要看那条还绿不绿。） */
    var jitter = (tier === 'irregular') ? 0.40 : 0.05;

    // 早搏间隔：★ M视觉1d 把"明显不齐"那档从 4~6 拍改成了 8~10 拍。
    //   原来两档都是"早搏很多"，玩家没有基准去判断"3 个算不算多"；
    //   而"节奏整不整齐"是不需要基准的 —— 眼睛一看就知道。
    //   现在第三档的"乱"由底下的常规拍（±30% 抖动）自己承担，不靠数早搏个数。
    var every  = (tier === 'regular') ? 0
               :                        8 + Math.floor(rand() * 3);   // 另两档都是每 8~10 拍
    /* ★ 偶发早搏那档取的是 8~10，不是任务书写满的 8~12。
     *   理由和上面 PX_PER_SECOND 那段是同一个算式：一屏约 10.5 拍
     *   （70px/s × 7.9 秒），要是某位患者刚好抽到"每 12 拍一个"，
     *   他那张冻结帧里一个早搏都不会有 —— 又变成"看不出区别"。
     *   取 8~10 保证视野里【一定有】一个早搏，同时仍是"隔七八拍才来一个"的稀疏感。 */

    // 先把"哪几拍是早搏"排好，再按时长拼成一条连续的波形
    var flags = [];
    for (var i = 0; i < CYCLE_BEATS; i++) flags.push(every > 0 && (i % every) === every - 1);

    var list = [], t = 0;

    for (i = 0; i < CYCLE_BEATS; i++) {
      var isEctopic   = flags[i];
      var nextEctopic = flags[(i + 1) % CYCLE_BEATS];
      var dur;

      if (isEctopic) {
        dur = base * ECTOPIC_SPAN;              // 宽 —— 这就是"宽大"的来源
      } else if (nextEctopic) {
        dur = base * PRE_ECTOPIC;               // 被后面那拍早搏挤短
      } else {
        dur = base * (1 + (rand() * 2 - 1) * jitter);
      }

      list.push({ start: t, dur: dur, ectopic: isEctopic });
      t += dur;

      if (isEctopic) t += base * ECTOPIC_PAUSE;   // 代偿间歇
    }

    return { list: list, cycle: t, tier: tier, base: base };
  }

  // 某一时刻的幅值。t 可以是任意实数（向后走时靠取模绕回来）。
  function beatAmplitudeAt(beats, t) {
    var local = ((t % beats.cycle) + beats.cycle) % beats.cycle;
    var list  = beats.list;

    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (local >= b.start && local < b.start + b.dur) {
        return amplitudeAt(b.ectopic ? BEAT_ECTOPIC : BEAT, (local - b.start) / b.dur);
      }
    }
    return 0;    // 落在代偿间歇里：基线
  }

  // 血氧那条：只跟心率密度，规整、无早搏（任务书 §四）
  function plethAmplitudeAt(base, t) {
    var phase = ((t / base) % 1 + 1) % 1;
    return amplitudeSmooth(PLETH, phase);
  }

  /* --------------------------------------------------------------------------
   * 3. 小工具
   * ------------------------------------------------------------------------ */

  function isNum(v) {
    return (typeof v === 'number' && isFinite(v));
  }

  // 保留 0 位小数的显示文本；不是有限数就返回 null（页面上显示成占位符）
  function fmt0(v) {
    return isNum(v) ? String(Math.round(v)) : null;
  }

  // 与 patient-card.js 的 fmtBloodPressure() 完全一致：96/62；缺舒张压就只显示收缩压
  function fmtBloodPressure(vitals) {
    var s = fmt0(vitals.sbp);
    if (s === null) return null;
    var d = fmt0(vitals.dbp);
    return d === null ? s : s + '/' + d;
  }

  // 数值 / 词 → 分档。★ 和 patient-card.js 的 bandOf() 逐条对齐：
  //   · 数值缺失返回 null（那一项不参与分档，显示成占位符）
  //   · 顺序 normal → watch → danger（压在边界上的值算正常）
  //   · consciousness 查 levels 词表，词表里没有的写法一律 'watch'
  //     （不用红或绿去猜 —— 猜成绿会让玩家以为一切正常）
  function inRange(v, r) {
    return v >= r[0] && v <= r[1];
  }

  function bandOf(key, vitals) {
    var spec = ranges()[key];
    if (!spec) return null;

    if (spec.levels) {
      var word = vitals[key];
      if (!word) return null;
      return spec.levels[word] || 'watch';
    }

    var v = vitals[key];
    if (!isNum(v)) return null;

    if (inRange(v, spec.normal)) return 'normal';
    for (var i = 0; i < spec.watch.length; i++) {
      if (inRange(v, spec.watch[i])) return 'watch';
    }
    return 'danger';
  }

  /* --------------------------------------------------------------------------
   * 3.1 ★ 报警灯：档 = 五项生命体征里【最差的那一档】
   *
   * 【为什么不是 severity（M视觉1b 改的）】灯原来直接读 severity —— 那是底层决策
   *   变量本身，是个【无噪声】的读数，而主诉/来院方式这两条线索都按
   *   adjacentChance 故意掺了噪声。一条干净的 severity 通道等于把答案送到玩家手上，
   *   实测 d′ 会从 1.3 往 1.5 靠，游戏变简单（契约 3.3.1 讲的就是这件事）。
   *
   *   现在**一个比特都不多**：灯只汇总【已经显示在卡片上】的那五项，
   *   玩家自己也能看出"有一项偏黄"。而且这也更像真的监护仪 ——
   *   机器就是照着屏幕上那几个数报警的，没有哪台机器读得到 ground truth。
   *
   * 【用全部五项，不是面板上那三项】灯说的是"这位患者整体看起来怎么样"，
   *   而卡片上摆的就是五项。只看三项的话会出现"体温都烧到 39 度了、灯还是绿的"。
   *
   * 【为什么用 Object.keys(VITAL_RANGES) 而不是写死一张五项清单】
   *   清单和阈值来自同一张表，将来那张表加一项（比如呼吸频率），灯自动跟上，
   *   不用回来改这里 —— 少一个能忘的地方。
   * ------------------------------------------------------------------------ */

  function alarmBand(patient) {
    var vitals = (patient && patient.vitals) || {};
    var keys = Object.keys(ranges());
    var worst = 0, seen = false;

    for (var i = 0; i < keys.length; i++) {
      var band = bandOf(keys[i], vitals);
      if (band === null) continue;            // 这一项缺失：不参与，也不当它是正常
      seen = true;
      if (BAND_RANK[band] > worst) worst = BAND_RANK[band];
    }

    // 五项一项都读不出来时不报警（中性：绿常亮）。真要全都缺，
    // 问题在数据源那边，不该由一盏灯去猜。
    return RANK_BAND[seen ? worst : 0];
  }

  function makeEl(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  /* --------------------------------------------------------------------------
   * 4. 模块状态（闭包变量，不挂 window）
   * ------------------------------------------------------------------------ */

  // 走纸的"起点"。用模块加载时刻而不是每位患者的渲染时刻 ——
  // 换患者时波形是接着走的，不会一顿一顿地重新起头。
  var ORIGIN = (window.performance && performance.now) ? performance.now() : Date.now();

  var state = {
    rafId:   0,
    running: false,
    warned:  false,   // "容器不见了"只提醒一次，别刷屏
    hr:      72,
    t:       0,       // 当前画的是第几秒（frozen 时恒为 0）
    beats:   null,    // buildBeats() 的结果：这一位患者的心搏序列
    slots:   [],      // 两块画布：{ canvas, ctx, w, h }
    colorEcg:   FALLBACK_ACCENT,
    colorPleth: FALLBACK_PRIMARY,
  };

  function nowSeconds() {
    var t = (window.performance && performance.now) ? performance.now() : Date.now();
    return (t - ORIGIN) / 1000;
  }

  /* --------------------------------------------------------------------------
   * 5. 画一帧
   *
   *   横轴 → 时间：最右边那一列是"现在"，往左是"过去"。
   *   x 这一列对应的时间 tt = t - (W - x) / PX_PER_SECOND
   *   ★ 两条波形都用同一套时间轴、同一个走纸速度，所以它们是"同步"的 ——
   *     这正是真监护仪的样子（各条波形在时间上对齐）。
   * ------------------------------------------------------------------------ */

  function drawWave(slot, color, glowRgb, sampleAt) {
    var ctx = slot.ctx;
    if (!ctx) return;

    var w = slot.w, h = slot.h;
    if (!(w > 0) || !(h > 0)) return;

    ctx.clearRect(0, 0, w, h);

    var baseY = h * 0.72;        // 基线压在偏下的位置：波峰往上冲，波谷往下探
    var scale = h * 0.52;        // 幅值 1.0 → 0.52 × 高度

    var t = state.t;

    ctx.beginPath();
    for (var x = 0; x <= w; x += 1) {     // 每 1 个 CSS 像素取一个点
      var tt = t - (w - x) / PX_PER_SECOND;
      var y  = baseY - sampleAt(tt) * scale;
      if (x === 0) ctx.moveTo(x, y);
      else         ctx.lineTo(x, y);
    }

    ctx.lineJoin = 'round';
    ctx.lineCap  = 'round';

    /* ★ 光晕 —— 这块面板的灵魂（任务书 §二④）
     *
     * 任务书给的 CSS 是 box-shadow: 0 0 6px var(--c-accent),
     * 0 0 14px rgba(46,211,166,.35)。但 Canvas 里的线条不吃 box-shadow
     * （那会变成给整块画布描一个发光的方框），线条自己的光晕要用
     * shadowBlur / shadowColor 画 —— 视觉上是同一件事，而且光晕是【贴着线】的。
     * 所以这里来两遍，正好对应任务书那两层：先大模糊低透明度的一层，
     * 再小模糊的实色芯线。
     */
    ctx.save();
    ctx.shadowColor = 'rgba(' + glowRgb + ',.85)';
    ctx.shadowBlur  = 12;
    ctx.lineWidth   = 2.6;
    ctx.strokeStyle = 'rgba(' + glowRgb + ',.32)';
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur  = 6;
    ctx.lineWidth   = 1.6;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.restore();
  }

  function drawAll(t) {
    state.t = t;
    if (!state.beats) return;

    var beats = state.beats;

    // 心电：形态随 severity 变（规整 → 早搏 → 不齐）
    drawWave(state.slots[0], state.colorEcg, '46,211,166',
             function (tt) { return beatAmplitudeAt(beats, tt); });

    // 血氧：只有密度跟着心率走，形态永远是同一条圆润的脉搏波
    drawWave(state.slots[1], state.colorPleth, '34,184,207',
             function (tt) { return plethAmplitudeAt(beats.base, tt); });
  }

  function tick(ts) {
    if (!state.running) return;
    // rAF 给的是"从页面开始计时起"的毫秒数，和 performance.now() 同源
    drawAll((ts - ORIGIN) / 1000);
    state.rafId = window.requestAnimationFrame(tick);
  }

  /* --------------------------------------------------------------------------
   * 6. 面板的 DOM
   *    全部走 createElement + textContent —— 患者数据里的文字不会被当成 HTML
   * ------------------------------------------------------------------------ */

  function readoutCell(label, text, unit, band) {
    var cell = makeEl('div', 'monitor-readout');

    cell.appendChild(makeEl('div', 'monitor-readout-label', label));

    // 颜色用 main.css 里和患者卡片同一批的类名（契约 2.4）
    var value = makeEl('div',
      'monitor-readout-value ' + (BAND_CLASS[band] || ''));
    if (!band) value.style.color = 'var(--c-text-dim)';   // 数值缺失：中性灰

    if (text === null) {
      value.textContent = '—';
    } else {
      value.textContent = text;
      if (unit) value.appendChild(makeEl('span', 'monitor-readout-unit', unit));
    }

    cell.appendChild(value);
    return cell;
  }

  function buildPanel(patient) {
    var vitals = patient.vitals || {};

    var panel = makeEl('div', 'monitor-panel');

    /* —— 左：两条波形，各占一半高度（任务书 §一）
     *   ECG 那一格左上角挂着报警灯。 */
    var waves = makeEl('div', 'monitor-waves');

    var ecgScreen = makeEl('div', 'monitor-screen monitor-screen-ecg');
    ecgScreen.appendChild(makeEl('span', 'monitor-alarm ' + alarmBand(patient)));

    var ecg = makeEl('canvas', 'monitor-ecg');
    ecg.setAttribute('aria-hidden', 'true');
    ecgScreen.appendChild(ecg);
    waves.appendChild(ecgScreen);

    var plethScreen = makeEl('div', 'monitor-screen monitor-screen-pleth');
    var pleth = makeEl('canvas', 'monitor-pleth');
    pleth.setAttribute('aria-hidden', 'true');
    plethScreen.appendChild(pleth);
    waves.appendChild(plethScreen);

    panel.appendChild(waves);

    // —— 右：读数一列三格（心率 / 血氧 / 血压，顺序照任务书 §一 的示意图）
    var col = makeEl('div', 'monitor-readouts');
    col.appendChild(readoutCell('心率', fmt0(vitals.hr),   'bpm',  bandOf('hr',   vitals)));
    col.appendChild(readoutCell('血氧', fmt0(vitals.spo2), '%',    bandOf('spo2', vitals)));
    col.appendChild(readoutCell('血压', fmtBloodPressure(vitals), 'mmHg', bandOf('sbp', vitals)));
    panel.appendChild(col);

    return { panel: panel, canvases: [ecg, pleth] };
  }

  /* --------------------------------------------------------------------------
   * 7. Canvas 的尺寸
   *
   *   画布本身在 CSS 里是 width/height:100%，撑满它那一格；格子的高度由
   *   面板的固定高度 + flex 平分决定 —— 所以"布局不跳动"是靠
   *   .monitor-panel 上那个写死的高度保证的（见 main.css 第 11 节）。
   *   这里做的只是按 devicePixelRatio 给位图分配像素、缩放坐标系，
   *   让高分屏上的线不发虚。位图尺寸不影响布局。
   * ------------------------------------------------------------------------ */

  function canvasSlot(canvas) {
    if (!canvas) return { canvas: null, ctx: null, w: 0, h: 0 };

    var cssW = canvas.clientWidth  || 0;
    var cssH = canvas.clientHeight || 0;

    var dpr = window.devicePixelRatio || 1;
    if (!(dpr > 0)) dpr = 1;

    // 量不到尺寸（jsdom 没有布局引擎）就别折腾，直接放弃画图：
    // DOM 该有的照样有，只是没有波形 —— 不影响任何断言里的 DOM 比较。
    if (!(cssW > 0) || !(cssH > 0)) return { canvas: canvas, ctx: null, w: 0, h: 0 };

    canvas.width  = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);

    var ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return { canvas: canvas, ctx: null, w: 0, h: 0 };   // jsdom：只搭 DOM，不画

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { canvas: canvas, ctx: ctx, w: cssW, h: cssH };
  }

  function cssVar(name, fallback) {
    try {
      var v = window.getComputedStyle(document.documentElement).getPropertyValue(name);
      v = (v || '').trim();
      if (v) return v;
    } catch (e) { /* 读不到就用兜底色 */ }
    return fallback;
  }

  /* --------------------------------------------------------------------------
   * 8. 出口
   * ------------------------------------------------------------------------ */

  function stop() {
    state.running = false;
    if (state.rafId && window.cancelAnimationFrame) {
      window.cancelAnimationFrame(state.rafId);
    }
    state.rafId = 0;
    state.slots = [];
    state.beats = null;
  }

  function render(el, patient, opts) {
    // 先停上一轮循环：同一局里每换一位患者都调一次 render，
    // 不停的话每换一位就多一条 rAF 在跑（任务书 §四）。
    stop();

    if (!el) {
      if (!state.warned) {
        state.warned = true;
        console.warn('[Monitor] 找不到监护仪容器（#monitorPanel），面板不渲染。');
      }
      return;
    }

    el.innerHTML = '';
    if (!patient) return;

    opts = opts || {};

    var built = buildPanel(patient);
    el.appendChild(built.panel);

    var vitals = patient.vitals || {};
    var hr     = isNum(vitals.hr) ? vitals.hr : FALLBACK_HR;
    state.hr    = Math.min(HR_MAX, Math.max(HR_MIN, hr));
    state.beats = buildBeats(patient, state.hr);
    state.t     = 0;

    state.slots = [canvasSlot(built.canvases[0]), canvasSlot(built.canvases[1])];
    state.colorEcg   = cssVar('--c-accent',  FALLBACK_ACCENT);
    state.colorPleth = cssVar('--c-primary', FALLBACK_PRIMARY);

    // ★ frozen：画在固定相位 t = 0，且【不启动】动画循环（任务书 §四）。
    //   平时（opts.frozen 不是 true）走下面那支。
    if (opts.frozen === true || typeof window.requestAnimationFrame !== 'function') {
      drawAll(0);
      return;
    }

    state.running = true;
    state.rafId = window.requestAnimationFrame(tick);
  }

  return {
    render: render,
    stop:   stop,

    /* ★ 给自测用的口径（M视觉1d 任务书 §四③）。
     *   「只看波形档位的观察者 d′ 是多少」这条量化断言，判档必须走【画波形时用的
     *   那个函数】（含 40% 漂移），不能另写一份"理想档位" —— 否则测的是别的算法，
     *   不是画面上那条线。所以把真身原样交出去。
     *   它只读 patient.severity 和 patient.id，不读 hasSignal；对同一份输入永远同输出。
     *   游戏逻辑一行都不用它。 */
    rhythmTier: rhythmTier,
  };

})();

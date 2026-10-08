/* ============================================================================
 * js/lab/roc.js —— 实验室面板「ROC 曲线」（M10）
 *   window.LabRoc = { render: function (el) {...} }        ← 契约 5.6
 *
 * 【这一屏要证明什么 · 也是它和老师那版最大的区别】
 *   老师那版 ROC 上只有一个工作点在滑。这里除了当前工作点，还把**玩家自己三轮
 *   的工作点**画上去（从 Store.rounds 读）——
 *   三个点大致落在**同一条曲线**上，但位置各不相同。
 *   同一条曲线 = 分辨能力 d′ 没变；点上滑动的方向 = 判定标准 c 在动。
 *   这是"d′ 不变、c 在变"最直观的几何证据，也是整个实验的教学核心。
 *
 * 【坐标与公式】
 *   ROC 的参数形式（横轴 P(FA)、纵轴 P(H)）：把判定线放在 c 的尺子上，
 *   两个分布对称落在 ∓d′/2，于是
 *      P(FA) = 1 − Φ(c + d′/2)      P(H) = 1 − Φ(c − d′/2)
 *   曲线本身是让 c 从 −∞ 扫到 +∞ 画出来的，所以**当前工作点必然落在曲线上**，
 *   玩家三轮的点也应该落在曲线上（除非那一轮 d′ 真的变了）。
 *   反算关系（下面两处 tooltip 都用它）：
 *      z(PH) − z(PFA) = d′     →    z(PH) = z(PFA) + d′
 *   等方差时 ROC 在 z 坐标里就是一条**斜率 1 的直线**，与纵轴交于 d′。
 *
 *   AUC（等方差双正态） = Φ(d′/√2) —— 只跟 d′ 有关，和 c 无关，
 *   所以拖 c 时 AUC 一动不动：这就是"能力"这一维的定义。
 *
 * 【读谁的数据】三轮工作点从 `Store.rounds`（契约 5.3 / 4.3）读：
 *   rounds[i].metrics.pH / .pFA 是那一轮的真实击中率、误报率。
 *   rounds 为空（没玩过直接进实验室）就不画那三个点，改成一句提示。
 *   ★ 每次拖动滑块都会重新读一遍 Store.rounds —— 学生中途重玩一局再回到这里，
 *     面板会自动跟上，不会拿旧数据骗人。
 *
 * 【依赖】契约 5.4 的 Utils、5.5 的 Chart、5.3 的 Store。
 *   所有分布计算一律走 Utils（ncdf / zScore），本文件不自己实现 Φ 或 z。
 * ==========================================================================*/

window.LabRoc = (function () {
  'use strict';

  var DEF_D = 1.5;      // 契约 3.4 的系统 d′
  var DEF_C = 0;
  var ROUN = 200;       // ROC 曲线采样段数
  var T_MAX = 5;        // 扫 c 的范围（±5 个标准差，够把曲线画到两个角上）
  var Z_MAX = 4.5;      // z 图上直线的横坐标范围
  var HIT_TOL = 0.012;  // 判定"悬停到某个工作点上了"的 P(FA) 容差

  var ROUND_NAMES = ['第一轮', '第二轮', '第三轮'];

  /* ------------------------------------------------------------------------
   * 三轮对比的评语阈值（契约 3.8）
   *
   * ★ js/results.js 里有一份【数值必须一模一样】的副本 —— 同一批数据在结果页
   *   和这个面板上必须得到同一句评语，否则学生一眼就看出两个页面在互相打架。
   *   阈值只有这一处规则、两处实现（config.js 归别人，本任务不许改它）。
   ---------------------------------------------------------------------- */
  var LEX = {
    dPrime: { cuts: [0.35, 0.70], words: ['几乎没变', '有点起伏', '变化明显'] },
    c:      { cuts: [0.20, 0.50], words: ['几乎没动', '有点移动', '大幅移动'] }
  };

  // 摆幅 → 评语。区间按契约 3.8：小于下界 / 两界之间 / 大于上界
  function pickWord(key, spread) {
    var L = LEX[key];
    if (typeof spread !== 'number' || !isFinite(spread)) return L.words[0];
    if (spread <  L.cuts[0]) return L.words[0];
    if (spread <= L.cuts[1]) return L.words[1];
    return L.words[2];
  }

  /* -------------------------------------------------------------- 公式层 */

  function pHit(d, c) { return 1 - Utils.ncdf(c - d / 2); }
  function pFA(d, c)  { return 1 - Utils.ncdf(c + d / 2); }

  // ROC 曲线：让判定线从 +5σ 扫到 −5σ，逐点算出 (P(FA), P(H))
  function rocPoints(d) {
    var pts = [[0, 0]];
    for (var i = 0; i <= ROUN; i++) {
      var t = T_MAX - (2 * T_MAX * i / ROUN);
      pts.push([
        1 - Utils.ncdf(t + d / 2),   // P(FA)：噪音分布被切在右侧的那部分
        1 - Utils.ncdf(t - d / 2),   // P(H) ：信号分布被切在右侧的那部分
      ]);
    }
    pts.push([1, 1]);
    return pts;
  }

  // 由横轴上的 P(FA) 反算曲线上对应的 P(H)：z(PH) = z(PFA) + d′
  function pHfromFA(pf, d) {
    var p = Utils.clamp(pf, 1e-6, 1 - 1e-6);      // 防 zScore 撞到 ±Infinity
    return Utils.ncdf(Utils.zScore(p) + d);
  }

  // 带正负号显示 c（0 不写成 +0.00）
  function fmtC(c) {
    if (typeof c !== 'number') return '—';
    if (c > 0.005) return '+' + c.toFixed(2);
    if (c < -0.005) return '-' + Math.abs(c).toFixed(2);
    return '0.00';
  }

  /* ------------------------------------------------- 读玩家三轮的真实数据 */

  function readRounds() {
    var rounds = (window.Store && window.Store.rounds) ? window.Store.rounds : [];
    var out = [];
    for (var i = 0; i < rounds.length && i < ROUND_NAMES.length; i++) {
      var m = rounds[i] ? rounds[i].metrics : null;
      if (!m || typeof m.pH !== 'number' || typeof m.pFA !== 'number') continue;
      out.push({
        name: ROUND_NAMES[i],
        pH: m.pH, pFA: m.pFA,
        dPrime: (typeof m.dPrime === 'number') ? m.dPrime : null,
        c: (typeof m.c === 'number') ? m.c : null,
      });
    }
    return out;
  }

  /* ------------------------------------------------------------ HTML 片段 */

  function sliderRow(id, cls, label, min, max, step, val, hint) {
    return '<div style="display:flex;align-items:center;gap:12px;margin:14px 0 4px;">' +
             '<label for="' + id + '" style="flex:0 0 6.5em;font-size:0.9rem;color:var(--c-text-dim);">' +
               label + '</label>' +
             '<input id="' + id + '" class="' + cls + '" type="range" min="' + min + '" max="' + max +
               '" step="' + step + '" value="' + val + '"' +
               ' style="flex:1 1 auto;min-width:0;accent-color:var(--c-primary);">' +
             '<span class="' + cls + '-val"' +
               ' style="flex:0 0 3.6em;text-align:right;font-family:var(--font-mono);font-size:1rem;">' +
               Number(val).toFixed(2) + '</span>' +
           '</div>' +
           (hint ? '<p style="margin:0;padding-left:calc(6.5em + 12px);font-size:0.78rem;' +
                   'color:var(--c-text-dim);">' + hint + '</p>' : '');
  }

  var DIM = 'color:var(--c-text-dim);font-size:0.82rem;line-height:1.65;';

  /* -------------------------------------------------------------- render */

  function render(el) {
    var state = { d: DEF_D, c: DEF_C };
    var instMain = null, instZ = null;   // ★ 两张图都在 render 里建（契约 5.6）

    el.innerHTML = [
      /* — 控件 — */
      '<div class="card">',
      '  <div class="card-head">拖动滑块 · ROC 曲线上的工作点</div>',
      sliderRow('lab-roc-d', 'lab-roc-sld-d', '敏感性 d′', 0, 4, 0.25, DEF_D,
                'd′ 决定曲线离对角线多远 —— 这是"能力"。'),
      sliderRow('lab-roc-c', 'lab-roc-sld-c', '判定标准 c', -2, 2, 0.05, DEF_C,
                'c 决定点在曲线上滑到哪儿 —— 这是"态度"。'),
      '</div>',

      /* — 主图 — */
      '<div class="card">',
      '  <div class="card-head">ROC 曲线 · 横轴 P(FA) / 纵轴 P(H)</div>',
      '  <div class="chart lab-roc-chart"></div>',
      '  <p style="margin:10px 0 4px;font-family:var(--font-mono);font-size:1.05rem;">',
      '    AUC = <span class="lab-roc-auc">—</span>',
      '  </p>',
      '  <p style="margin:0;' + DIM + '">',
      '    0.5 = 随机，1.0 = 完美。AUC 只取决于 d′ —— 拖动 c 时它一动不动。',
      '  </p>',
      '  <p class="lab-roc-note" style="margin:8px 0 0;' + DIM + '">—</p>',
      '</div>',

      /* — 结论卡（三套文案：没数据 / d′ 摆幅小 / d′ 摆幅大，数字与评语都动态） — */
      '<div class="card lab-roc-conclusion"></div>',

      /* — z 变换后的 ROC — */
      '<div class="card">',
      '  <div class="card-head">z 变换后的 ROC</div>',
      '  <div class="chart-sm lab-roc-zchart"></div>',
      '  <p style="margin:10px 0 4px;' + DIM + '">',
      '    坐标轴转成 z 分数后，ROC 变成直线。等方差时斜率 = 1。',
      '  </p>',
      '  <p class="lab-roc-zline" style="margin:0;font-family:var(--font-mono);font-size:0.85rem;',
      'color:var(--c-text-dim);">—</p>',
      '</div>',
    ].join('\n');

    var dSld = el.querySelector('.lab-roc-sld-d');
    var cSld = el.querySelector('.lab-roc-sld-c');

    /* ------------------------------------------------------- 两张图的配置 */

    function buildMain(d, c, rounds) {
      var C = Chart.color();
      // Chart.make 把 Chart.base() 的主题和我们这份 option 做【深】合并
      // （chart.js 第 2 节）：只写自己要改的键，主题的提示框底色 / 轴字体自动留着。

      var ROUND_COLORS = [C.normal, C.watch, C.danger];
      // 三个点的位置常常很接近（三轮的 c 本来就在同一条曲线上小幅移动），
      // 标签统一放正上方会叠成一团。三个点各用不同的方位，挤在一起也还认得出。
      var ROUND_LABEL_POS = ['top', 'bottom', 'right'];
      var curPF = pFA(d, c), curPH = pHit(d, c);
      var roundData = [];

      for (var i = 0; i < rounds.length; i++) {
        roundData.push({
          value: [rounds[i].pFA, rounds[i].pH],
          name: rounds[i].name,
          itemStyle: { color: ROUND_COLORS[i] },
          label: { show: true, formatter: rounds[i].name,
                   position: ROUND_LABEL_POS[i] || 'top',
                   color: ROUND_COLORS[i], fontSize: 11 },
        });
      }

      return {
        grid: { left: 56, right: 26, top: 42, bottom: 48 },
        // 主题只给了 legend.textStyle、没给位置；不管位置 ECharts 会把图例摆到图的
        // 【下缘】，正好压住 x 轴刻度，所以这里必须给一个 top。
        legend: { data: ['ROC 曲线', '对角线（纯瞎猜）', '当前工作点'], top: 0 },
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'cross' },
          formatter: function (params) {
            if (!params || !params.length) return '';
            var v = params[0].axisValue;
            if (typeof v !== 'number') return '';
            var pf = Utils.clamp(v, 0, 1);
            var out = ['P(FA) = ' + pf.toFixed(3),
                       'P(H)  = ' + pHfromFA(pf, d).toFixed(3)];
            var i;
            for (i = 0; i < rounds.length; i++) {
              if (Math.abs(rounds[i].pFA - pf) < HIT_TOL) {
                out.push('<span style="opacity:.75;">' + rounds[i].name + '的工作点：d′ = ' +
                         (rounds[i].dPrime === null ? '—' : rounds[i].dPrime.toFixed(2)) +
                         '，c = ' + fmtC(rounds[i].c) + '</span>');
              }
            }
            if (Math.abs(curPF - pf) < HIT_TOL) {
              out.push('<span style="opacity:.75;">当前工作点：c = ' + fmtC(c) + '</span>');
            }
            return out.join('<br>');
          },
        },
        xAxis: {
          type: 'value', min: 0, max: 1,
          name: 'P(FA) 误报率', nameLocation: 'middle', nameGap: 28,
          axisLabel: { formatter: function (v) { return Number(v).toFixed(1); } },
        },
        yAxis: {
          type: 'value', min: 0, max: 1,
          // nameLocation 显式写 'middle'：默认的 'end' 把轴名摆到顶端，会和顶部的图例抢地方
          name: 'P(H) 击中率', nameLocation: 'middle', nameGap: 40,
          axisLabel: { formatter: function (v) { return Number(v).toFixed(1); } },
        },
        series: [
          { // 纯瞎猜的基准线
            id: 'diag', name: '对角线（纯瞎猜）', type: 'line', data: [[0, 0], [1, 1]],
            symbol: 'none', silent: true, z: 1,
            lineStyle: { color: C.dim, width: 1.5, type: 'dashed' },
          },
          { // ROC 曲线：c 从 +5σ 扫到 −5σ 画出来的一条
            id: 'roc', name: 'ROC 曲线', type: 'line', data: rocPoints(d),
            symbol: 'none', z: 2, lineStyle: { color: C.primary, width: 2.5 },
          },
          { // 当前滑块位置 —— 一个必然落在曲线上的大圆点
            id: 'cur', name: '当前工作点', type: 'scatter', z: 6,
            data: [[curPF, curPH]],
            symbolSize: 16,
            itemStyle: { color: C.primary, borderColor: C.text, borderWidth: 2 },
          },
          { // ★ 玩家自己的三轮工作点：颜色和三轮呼应
            id: 'rounds', name: '你的三轮', type: 'scatter', z: 5,
            data: roundData, symbolSize: 13,
            itemStyle: { borderColor: C.text, borderWidth: 1.5 },
          },
        ],
      };
    }

    function buildZ(d, c) {
      var C = Chart.color();

      // 等方差时 z 图上的 ROC 就是 z(PH) = z(PFA) + d′ 这条直线，两个端点足够
      var zPF = Utils.zScore(Utils.clamp(pFA(d, c), 1e-6, 1 - 1e-6));
      var zPH = Utils.zScore(Utils.clamp(pHit(d, c), 1e-6, 1 - 1e-6));

      return {
        grid: { left: 56, right: 26, top: 30, bottom: 46 },
        // 这张图不画图例，但主题里带着 legend 键 —— ECharts 见到 legend 就会
        // 拿系列名自动生成一个，摆在图的【下缘】压住 x 轴。所以必须显式关掉。
        legend: { show: false },
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'cross' },
          formatter: function (params) {
            if (!params || !params.length) return '';
            var v = params[0].axisValue;
            if (typeof v !== 'number') return '';
            return 'z(P(FA)) = ' + v.toFixed(2) + '<br>' +
                   'z(P(H))  = ' + (v + d).toFixed(2) + '<br>' +
                   '<span style="opacity:.75;">等于 P(FA) = ' + Utils.ncdf(v).toFixed(3) +
                   '，P(H) = ' + Utils.ncdf(v + d).toFixed(3) + '</span>';
          },
        },
        xAxis: {
          type: 'value', name: 'z(P(FA))', nameLocation: 'middle', nameGap: 26,
        },
        yAxis: {
          type: 'value', name: 'z(P(H))', nameLocation: 'middle', nameGap: 40,
        },
        series: [
          { id: 'zline', type: 'line', data: [[-Z_MAX, -Z_MAX + d], [Z_MAX, Z_MAX + d]],
            symbol: 'none', z: 2, lineStyle: { color: C.primary, width: 2.5 } },
          { id: 'zcur', type: 'scatter', data: [[zPF, zPH]], symbolSize: 14, z: 4,
            itemStyle: { color: C.primary, borderColor: C.text, borderWidth: 2 } },
        ],
      };
    }

    /* ------------------------------------------------- 卡片文案（数字动态填） */

    function noteHtml(rounds) {
      if (!rounds.length) {
        return '玩完三轮再回来看，这里会标出你自己的三个工作点。';
      }
      return '三个小圆点是你自己的三轮工作点：' +
             '<span style="color:var(--c-normal);">■ 第一轮</span> · ' +
             '<span style="color:var(--c-watch);">■ 第二轮</span> · ' +
             '<span style="color:var(--c-danger);">■ 第三轮</span>；' +
             '大青点是当前滑块的位置。';
    }

    function conclusionHtml(rounds) {
      if (!rounds.length) {
        return '<div class="card-head">这一屏想让你看到什么</div>' +
               '<p style="margin:0;' + DIM + '">' +
               '还没有实验数据。玩完三轮再回到这里 —— 面板会把你自己三轮的工作点画到同一条 ROC 曲线上，' +
               '让你看到"能力没变、标准在动"。</p>';
      }

      var ds = [], cs = [], i;
      for (i = 0; i < rounds.length; i++) {
        ds.push(rounds[i].dPrime === null ? '—' : rounds[i].dPrime.toFixed(2));
        cs.push(fmtC(rounds[i].c));
      }
      var dVals = [], cVals = [];
      for (i = 0; i < rounds.length; i++) {
        if (rounds[i].dPrime !== null) dVals.push(rounds[i].dPrime);
        if (rounds[i].c !== null) cVals.push(rounds[i].c);
      }
      var spanNum = function (a) {
        if (a.length < 2) return null;
        return Math.max.apply(null, a) - Math.min.apply(null, a);
      };
      var span = function (a) {
        var v = spanNum(a);
        return v === null ? '—' : v.toFixed(2);
      };

      var spreadD = spanNum(dVals), spreadC = spanNum(cVals);
      var wordD = pickWord('dPrime', spreadD), wordC = pickWord('c', spreadC);

      /* ★ d′ 摆幅大到 0.70 以上，就不能再说"没怎么变"了 ——
         那正是结果页犯过的毛病，两个页面必须同时改掉。
         c 的那段在两个分支里都保留：它是另一个维度，不随 d′ 一起失效。 */
      var bigD = (spreadD !== null) && (spreadD > LEX.dPrime.cuts[1]);

      var head = bigD
        ? '你的三轮 · 这一局的 d′ 也在动'
        : '你的三轮 · 同一条曲线上滑了三下';

      // c 的走法（三轮时"从 A 走到 B 再掉到 C"，和结果页一个句式）
      var cPath = '你的 c 从 ' + cs[0] +
                  (cs.length > 1 ? ' 走到 ' + cs[1] : '') +
                  (cs.length > 2 ? ' 再掉到 ' + cs[2] : '');

      var tail = bigD
        ? '<p style="margin:0 0 8px;"><strong>你的 d′ 从 ' + (dVals.length ? dVals[0].toFixed(2) : '—') +
            ' 涨到 ' + (dVals.length ? dVals[dVals.length - 1].toFixed(2) : '—') +
            ' —— 这不是"代价改变了能力"。</strong></p>' +
          '<p style="margin:0 0 8px;"><strong>最可能的原因是练习效应：前几轮你还在摸索怎么读生命体征，' +
            '后面已经熟练了 —— 纵向实验里很常见，所以正式实验都会先做一轮练习再开始计分。</strong></p>' +
          '<p style="margin:0 0 8px;"><strong>不过 c 的变化仍然说明问题：' + cPath +
            '，摆幅 ' + span(cVals) + '（' + wordC + '）—— 那是你的标准在动。</strong></p>' +
          '<p style="margin:0;"><strong>三个点也因此没落在同一条曲线上：这一局里，练习和代价混在一起了。</strong></p>'
        : '<p style="margin:0 0 8px;"><strong>三轮里你的 d′ ' + wordD +
            '，所以三个点大致落在同一条曲线上。</strong></p>' +
          '<p style="margin:0 0 8px;"><strong>但它们的位置不同 —— 那是你的标准 c 在移动。</strong></p>' +
          '<p style="margin:0;"><strong>同一条曲线 = 同样的能力；曲线上不同的点 = 不同的态度。</strong></p>';

      return '<div class="card-head">' + head + '</div>' +
        '<p style="margin:0 0 4px;font-family:var(--font-mono);font-size:0.85rem;color:var(--c-text-dim);">' +
          'd′ = ' + ds.join(' / ') + '<br>c = ' + cs.join(' / ') + '</p>' +
        '<p style="margin:0 0 12px;font-family:var(--font-mono);font-size:0.85rem;' +
          'color:var(--c-text-dim);">摆幅：d′ ' + span(dVals) + '（' + wordD + '）· c ' +
          span(cVals) + '（' + wordC + '）</p>' +
        tail;
    }

    /* ------------------------------------------------------------ 刷新 */

    function sync() {
      var d = state.d, c = state.c;
      var rounds = readRounds();          // ★ 每次都重新读，重玩一局也能跟上

      el.querySelector('.lab-roc-sld-d-val').textContent = d.toFixed(2);
      el.querySelector('.lab-roc-sld-c-val').textContent = c.toFixed(2);
      el.querySelector('.lab-roc-auc').textContent = Utils.ncdf(d / Math.SQRT2).toFixed(3);
      el.querySelector('.lab-roc-note').innerHTML = noteHtml(rounds);
      el.querySelector('.lab-roc-conclusion').innerHTML = conclusionHtml(rounds);

      var slopeNote = (d < 1e-9)
        ? '当前 d′ = 0：直线与对角线重合，画不出斜率 —— 没有分辨能力时，ROC 就是瞎猜。'
        : '当前这条线：斜率 1（等方差），与纵轴的交点 = d′ = ' + d.toFixed(2) + '。';
      el.querySelector('.lab-roc-zline').textContent = slopeNote;

      if (instMain) instMain.setOption(buildMain(d, c, rounds));
      if (instZ)    instZ.setOption(buildZ(d, c));
    }

    /* --------------------------------------------------------- 事件绑定 */

    function onSlide() {
      state.d = Utils.clamp(parseFloat(dSld.value), 0, 4);
      state.c = Utils.clamp(parseFloat(cSld.value), -2, 2);
      sync();
    }

    dSld.addEventListener('input', onSlide);
    cSld.addEventListener('input', onSlide);

    // ★ 建图：容器此刻已经可见（契约 5.6：render 由 showLab 在第一次显示时调用）
    var rounds0 = readRounds();
    instMain = Chart.make(el.querySelector('.lab-roc-chart'),  buildMain(DEF_D, DEF_C, rounds0));
    instZ    = Chart.make(el.querySelector('.lab-roc-zchart'), buildZ(DEF_D, DEF_C));
    sync();
  }

  return { render: render };

})();

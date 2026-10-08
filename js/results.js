/* ============================================================================
 * js/results.js —— 结果页（模块 M8）
 *
 * 【这一屏要干的事】
 *   玩家刚玩完三轮（同一批难度、三种代价），这一屏要让他【自己看出来】：
 *     我的分辨能力 d′ 三轮几乎没变，变的只是我的标准 c。
 *   —— 但这句话只有在数据里 d′ 真的没怎么变时才许说：
 *      摆幅一大就换成按方向挑的解释（练习效应 / 疲劳 / 不稳定，见第 4 节）。
 *   所以整页的重心是一张表 + 表下面那三条注释，不是大段解释文字。
 *   文字只负责把玩家眼睛已经看到的东西命名一次（"这就是信号检测论"）。
 *
 * 【数据从哪来】
 *   只读一个地方：Store.rounds（契约 5.3），里面是三份 RoundResult（契约 4.3）。
 *   姓名读 Store.student.name（游客模式为 null → 显示"游客"）。
 *   轮次名读 window.ROUNDS[n-1].name（config.js 是唯一真源，★ 这里不许写死）。
 *
 * 【★ 一个数都不许自己算】
 *   d′、c、β、准确率全部已经在 round.metrics 里了（M6-a 的 Scoring 算好的）。
 *   本文件只做三件事：格式化、排版、把 c 的摆幅算出来（纯展示用的减法，
 *   不是 SDT 计算 —— 公式仍然只在 js/scoring.js 里出现一次）。
 *   千万别在这里写 zScore / 对数线性修正，否则同一套公式就有了两份实现。
 *
 * 【为什么全是行内样式】
 *   M8 的集成边界只允许改这一个文件，styles/main.css 整份只读。
 *   所以本屏自己的版式只能用行内 style 写，色值一律 var(--c-*)、字体一律
 *   var(--font-sans) / var(--font-mono)（契约 2.2 / 2.3）。
 *   窄屏适配也因此在结构上做：表格套 overflow-x:auto 的壳（横向滚动），
 *   三个混淆矩阵用 flex-wrap（放不下就自己堆成一列），不依赖 media query。
 *
 * 【为什么 render() 每次进屏都整个重建】
 *   index.html 的 showScreen() 里写着：进结果页就调一次 Results.render()。
 *   每局的 Store.rounds 都不一样，重建比"局部更新"少一整类不同步的 bug。
 * ==========================================================================*/

window.Results = (function () {
  'use strict';

  /* --------------------------------------------------------------------------
   * 0. 常量
   * ------------------------------------------------------------------------ */

  /* 三条注释的词不再写死 —— 按三轮的【实际摆幅】挑（契约 3.8）。
     原来是"数字动态、评语写死"：d′ 摆幅 1.25 也照样说"几乎没变"，
     把相反的证据和固定的结论摆在同一屏上，等于当着玩家的面说假话。
     ★ 这套阈值在 js/lab/roc.js 里有一份【数值必须一模一样】的副本
       （同一个规则要在两个面板上给同一个答案，但 config.js 归别人，
       只好各存一份 —— 改这里就必须同步改那边）。 */
  var LEX = {
    dPrime: { cuts: [0.35, 0.70], words: ['几乎没变', '有点起伏', '变化明显'] },
    c:      { cuts: [0.20, 0.50], words: ['几乎没动', '有点移动', '大幅移动'] },
    acc:    { cuts: [8, 15],      words: ['差不多', '有点差别', '差别不小'] }
  };

  // 摆幅 → 评语。区间按契约 3.8：小于下界 / 两界之间 / 大于上界
  function pickWord(key, spread) {
    var L = LEX[key];
    if (!isNum(spread)) return L.words[0];
    if (spread <  L.cuts[0]) return L.words[0];
    if (spread <= L.cuts[1]) return L.words[1];
    return L.words[2];
  }

  // d′ 摆幅大到"肉眼可见"了吗？大到这个程度，结论块整段换（契约 3.8）
  function isBigD(spread) {
    return isNum(spread) && spread > LEX.dPrime.cuts[1];
  }

  // 配色：d′ 那列用 --c-text-dim（不起眼），c 那列用 --c-accent（醒目）
  // —— 任务书 M8 第 3 节。整列连同表头、注释一起上色，
  //    眼睛扫过去就该看到"有一列在动、有一列没动"。
  var CLR_DIM    = 'var(--c-text-dim)';
  var CLR_ACCENT = 'var(--c-accent)';
  var MONO       = 'var(--font-mono)';
  var SANS       = 'var(--font-sans)';

  var NUM_CSS = 'font-size:1.02rem;';   // 对比表的数字稍大一号：这一屏的主角

  // 贴「更保守 / 更宽松」标签的门槛（c 与第一轮之差）。
  // 比这个小就当成没动 —— 宁可不说，也不能把 0.02 的抖动说成"更保守"。
  var C_MOVE_MIN = 0.10;

  // 轮次序号 → 中文数字（结果页上"第一轮/第二轮/第三轮"比"第1轮"好看）
  var CN_NUM = ['一', '二', '三', '四', '五'];

  /* --------------------------------------------------------------------------
   * 1. DOM 与格式化小工具
   * ------------------------------------------------------------------------ */

  // E(标签, class, 行内样式, 文本)。文本一律走 textContent ——
  // 玩家姓名是用户输入，绝不许拼进 HTML 字符串里。
  function E(tag, cls, css, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (css) n.setAttribute('style', css);
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  // 数字（含负号）：负号用 U+2212（−）而不是连字符，跟契约 3.6 样表里的字符一致。
  // d′ 理论上永远为正，但玩家真跑出负值（分不清信号和噪音）也得显示得像样。
  function fmt2(v) {
    if (!isNum(v)) return '—';
    return (Math.round(v * 100) / 100).toFixed(2).replace(/^-/, '−');
  }

  // c 要带正负号：0.00 / +0.62 / −0.54（契约 3.6 的样表写法）
  // 减号用 U+2212（−）而不是连字符，跟契约表格里的字符一致，也更好读
  function fmtC(v) {
    if (!isNum(v)) return '—';
    var r = Math.round(v * 100) / 100;
    if (r > 0) return '+' + r.toFixed(2);
    if (r < 0) return '−' + Math.abs(r).toFixed(2);
    return '0.00';                     // 恰好为 0 时不写符号，也不写 -0.00
  }

  function pctInt(a) {
    return isNum(a) ? Math.round(a * 100) : null;
  }

  function fmtPct(a) {
    var p = pctInt(a);
    return (p === null) ? '—' : (p + '%');
  }

  function cn(n) {
    var i = (typeof n === 'number') ? n - 1 : -1;
    return CN_NUM[i] || String(n);
  }

  // ★ 轮次名只在 config.js 里出现一次，这里读回来（任务书 M8 第 2 节要求）
  function roundName(r) {
    var spec = (window.ROUNDS && window.ROUNDS[r.round - 1]) || null;
    return (spec && spec.name) || r.roundName || ('第 ' + r.round + ' 轮');
  }

  function roundLabel(r) {
    return '第' + cn(r.round) + '轮 ' + roundName(r);
  }

  function metricsOf(r) {
    return (r && r.metrics) || {};
  }

  // 一组数的极差（最大 − 最小）；不够两个数就返回 null。
  // ★ 注意：这是"把已经算好的值相减"，不是算 d′/c —— 公式不在这里。
  function spreadOf(list) {
    var v = list.filter(isNum);
    if (v.length < 2) return null;
    return Math.max.apply(null, v) - Math.min.apply(null, v);
  }

  // 「摆幅超过 1.1」这句里的数（契约 3.6 的样例：c 摆幅 1.16 → 写"超过 1.1"）。
  // 向下取一位小数，并且先减 0.01，保证"超过"这个词永远为真
  // （c 的值都是两位小数，正好差 1.00 这种情况是存在的）。
  function spreadPhrase(v) {
    if (!isNum(v)) return '摆幅 —';
    var lo = Math.floor((v - 0.01) * 10) / 10;
    if (lo < 0.1) return '摆幅很小';
    return '摆幅超过 ' + lo.toFixed(1);
  }

  function mono(text) {
    return E('span', null, 'font-family:' + MONO + ';', text);
  }

  // 用 DOM 片段拼一段话：字符串当文字节点，元素原样插入
  function para(parts, css) {
    var p = E('p', null, 'font-weight:600;line-height:1.9;color:var(--c-text);' +
                        'margin-bottom:6px;' + (css || ''), null);
    for (var i = 0; i < parts.length; i++) {
      if (typeof parts[i] === 'string') p.appendChild(document.createTextNode(parts[i]));
      else p.appendChild(parts[i]);
    }
    return p;
  }

  // 段落里的重点词。整段本来就是 600，这里再重一档，
  // 让"不是""练习效应"这种词能被眼睛停一下 —— 它决定这段话怎么理解。
  function strong(text) {
    return E('strong', null, 'font-weight:800;', text);
  }

  function minOf(list) { return Math.min.apply(null, list); }
  function maxOf(list) { return Math.max.apply(null, list); }

  /* --------------------------------------------------------------------------
   * 2. 标题
   *
   *   检测成绩
   *   张三 · 标准版 · 三轮共 90 次判断
   *
   *   游客模式（Store.student 为 null、或 name 为 null）显示"游客"。
   *   总试次数是三轮 totalTrials 相加 —— 不读 TRIAL_MODES 里的 90，
   *   这样即使只跑了一两轮，副标题也不会撒谎。
   * ------------------------------------------------------------------------ */

  function subtitle(rounds) {
    var name = (window.Store && Store.student && Store.student.name)
                 ? Store.student.name : '游客';

    var cfg = (window.Store && typeof Store.currentMode === 'function')
                ? Store.currentMode() : null;
    var modeLabel = cfg ? cfg.label : '未知模式';

    var total = 0;
    for (var i = 0; i < rounds.length; i++) total += (rounds[i].totalTrials || 0);

    var roundsTxt = (rounds.length === 3) ? '三轮' : (rounds.length + ' 轮');
    return name + ' · ' + modeLabel + ' · ' + roundsTxt + '共 ' + total + ' 次判断';
  }

  function buildTitle(rounds) {
    var box = document.createDocumentFragment();

    box.appendChild(E('h2', null, null, '检测成绩'));

    if (rounds.length) {
      box.appendChild(E('p', null,
        'font-size:0.88rem;color:' + CLR_DIM + ';margin-bottom:18px;',
        subtitle(rounds)));
    }
    return box;
  }

  /* --------------------------------------------------------------------------
   * 3. ★★★ 三轮对比表（全页最重要的一块）
   *
   *     轮次              P(H)   P(FA)   d′      c      准确率
   *   第一轮 常规值班      0.78   0.22   1.55    0.00    80%
   *   第二轮 爆满警报      0.53   0.09   1.40   +0.62    73%   ← 更保守
   *   第三轮 复盘之后      0.91   0.41   1.56   −0.54    77%   ← 更宽松
   *                          ↑ 几乎没变  ↑ 大幅移动  ↑ 差不多
   *
   *   最后那一行↑三个词是【按上面这几列的实际摆幅挑的】（契约 3.8），
   *   不是固定文案 —— 上面这组数据恰好是小摆幅，才显示成"几乎没变 / 差不多"。
   *   同一组数据换了别的摆幅，词就跟着换。
   *
   *   列严格按契约 3.6，一列不多一列不少。
   *   最后那一列不装数字，只装「更保守 / 更宽松」这个标签——
   *   它是【按玩家自己的 c 算出来的】，不是写死的：
   *   谁偏离第一轮超过 0.10 谁才配这个标签，没动就没标签。
   * ------------------------------------------------------------------------ */

  // 每轮 c 相对第一轮的偏移方向 → 标签
  function cTag(r, baseC) {
    if (r.round === 1) return '';
    var c = metricsOf(r).c;
    if (!isNum(c) || !isNum(baseC)) return '';
    var d = c - baseC;
    if (Math.abs(d) < C_MOVE_MIN) return '';
    return d > 0 ? '← 更保守' : '← 更宽松';
  }

  // 表下面那三条注释里的一格：↑ 词，下面一行摆幅
  function annoCell(word, color, sub) {
    var td = E('td', null, 'vertical-align:top;', null);
    td.appendChild(E('div', null,
      'font-family:' + SANS + ';font-size:0.78rem;font-weight:600;' +
      'white-space:nowrap;color:' + color + ';', '↑ ' + word));
    td.appendChild(E('div', null,
      'font-size:0.7rem;white-space:nowrap;color:' + CLR_DIM + ';', sub));
    return td;
  }

  function buildCompare(rounds) {
    var card = E('div', 'card', null, null);
    card.appendChild(E('div', 'card-head', null, '三轮对比'));

    var m = rounds.map(metricsOf);
    var baseC = m[0].c;

    // 三条注释要的摆幅。d′ / c 直接用 metrics 里已经算好的值相减；
    // 准确率按"显示的整数百分比"相减，跟表里看到的数字对得上
    var spreadD   = spreadOf(m.map(function (x) { return x.dPrime; }));
    var spreadC   = spreadOf(m.map(function (x) { return x.c; }));
    var spreadAcc = spreadOf(m.map(function (x) { return pctInt(x.accuracy); }));

    var scroller = E('div', null,
      'overflow-x:auto;-webkit-overflow-scrolling:touch;', null);

    var table = E('table', 'cm-table', 'margin-bottom:0;', null);

    /* ---- 表头（第一格和最后一格故意留空，与契约 3.6 的样表一致） ---- */
    var thead = E('thead', null, null, null);
    var hrow  = E('tr', null, null, null);
    hrow.appendChild(E('th', null, null, ''));
    hrow.appendChild(E('th', null, 'white-space:nowrap;', 'P(H)'));
    hrow.appendChild(E('th', null, 'white-space:nowrap;', 'P(FA)'));
    hrow.appendChild(E('th', null, 'white-space:nowrap;color:' + CLR_DIM + ';', 'd′'));
    hrow.appendChild(E('th', null, 'white-space:nowrap;color:' + CLR_ACCENT + ';', 'c'));
    hrow.appendChild(E('th', null, 'white-space:nowrap;', '准确率'));
    hrow.appendChild(E('th', null, null, ''));
    thead.appendChild(hrow);
    table.appendChild(thead);

    /* ---- 三轮 ---- */
    var tbody = E('tbody', null, null, null);

    rounds.forEach(function (r) {
      var mm = metricsOf(r);
      var tr = E('tr', null, null, null);

      tr.appendChild(E('td', null,
        'font-family:' + SANS + ';color:var(--c-text);white-space:nowrap;',
        roundLabel(r)));

      tr.appendChild(E('td', null, NUM_CSS, fmt2(mm.pH)));
      tr.appendChild(E('td', null, NUM_CSS, fmt2(mm.pFA)));
      tr.appendChild(E('td', null, NUM_CSS + 'color:' + CLR_DIM + ';', fmt2(mm.dPrime)));
      tr.appendChild(E('td', null, NUM_CSS + 'color:' + CLR_ACCENT + ';font-weight:600;', fmtC(mm.c)));
      tr.appendChild(E('td', null, NUM_CSS, fmtPct(mm.accuracy)));

      tr.appendChild(E('td', null,
        'font-family:' + SANS + ';font-size:0.78rem;color:' + CLR_DIM + ';' +
        'white-space:nowrap;', cTag(r, baseC)));

      tbody.appendChild(tr);
    });

    /* ---- 三条注释（★ 任务书 M8 第 3 节：这是让人"看出来"的关键，务必做）
     *      放在同一个 <table> 里当最后一行，这样它们永远对齐在 d′ / c / 准确率
     *      三列正下方；窄屏横向滚动时也不会和数字脱节。
     *      三个词按摆幅挑（契约 3.8）—— 摆幅大小就在正上方的数字里，
     *      词和数字必须是同一句话。                                ---- */
    if (rounds.length >= 3) {
      var anno = E('tr', 'res-anno', null, null);
      anno.appendChild(E('td', null, null, ''));        // 轮次列
      anno.appendChild(E('td', null, null, ''));        // P(H) 列
      anno.appendChild(E('td', null, null, ''));        // P(FA) 列
      anno.appendChild(annoCell(pickWord('dPrime', spreadD), CLR_DIM,   // ← d′ 列
        '摆幅 ' + fmt2(spreadD)));
      anno.appendChild(annoCell(pickWord('c', spreadC), CLR_ACCENT,     // ← c 列
        '摆幅 ' + fmt2(spreadC)));
      anno.appendChild(annoCell(pickWord('acc', spreadAcc), CLR_DIM,    // ← 准确率列
        (isNum(spreadAcc) ? '摆幅 ' + spreadAcc + '%' : '摆幅 —')));
      anno.appendChild(E('td', null, null, ''));
      tbody.appendChild(anno);
    }

    table.appendChild(tbody);
    scroller.appendChild(table);
    card.appendChild(scroller);

    return card;
  }

  /* --------------------------------------------------------------------------
   * 4. 结论块
   *
   *   两套话，按 d′ 的实际摆幅选（契约 3.8）：
   *     · d′ 摆幅 ≤ 0.70 —— d′ 真的没怎么变，照旧说"没变"
   *     · d′ 摆幅 >  0.70 —— 一个字都不许再说"没变"，整段换成下面这套解释，
   *                          而且解释还要按 d′ 的【方向】再分三种：
   *                            单调上升 → 练习效应
   *                            单调下降 → 疲劳 / 标准被推到极端
   *                            有涨有掉 → 判断本身不稳定（抽样波动）
   *                          ★ 说死"越来越熟练"，碰上 d′ 一路掉下去的玩家
   *                            就是当面说假话 —— 这是同一个毛病第三次犯。
   *   ★ 两套里都有 c 的那段和收尾两句 —— 它们和数据大小没关系，
   *     任何分支都不许丢（tailParas 就是为这个抽出来的）。
   *   每句话各自成行，都加粗 —— 它是这一屏的落点，不是补充说明。
   * ------------------------------------------------------------------------ */

  function buildConclusion(rounds) {
    var m = rounds.map(metricsOf);

    var dList = m.map(function (x) { return fmt2(x.dPrime); });     // 1.55、1.40、1.56
    var cList = m.map(function (x) { return fmtC(x.c); });          // 0.00、+0.62、−0.54
    var cNums = m.map(function (x) { return x.c; });                // 上面那行的原值（判断走向用）
    var aList = m.map(function (x) { return fmtPct(x.accuracy); }); // 80%、73%、77%

    var spreadD   = spreadOf(m.map(function (x) { return x.dPrime; }));
    var spreadC   = spreadOf(m.map(function (x) { return x.c; }));
    var spreadAcc = spreadOf(m.map(function (x) { return pctInt(x.accuracy); }));
    var spreadTxt = spreadPhrase(spreadC);

    var card = E('div', 'card', null, null);
    card.appendChild(E('div', 'card-head', null, '结论'));

    // c 的那段：两套话都要用它，所以只写一次、只换前面的引导词
    function cPara(lead) {
      return para([
        lead, '你的 c 从 ', mono(cList[0]), ' 走到 ', mono(cList[1]),
        // ★ 第三个词的走向也得跟着数据：原来说死"再掉到"，
        //   c 若在第三轮反而更高（0.4 → +0.60），那句话就是假的
        cStep(), mono(cList[2]), '，', spreadTxt,
        '——你的标准被"代价"推着走了。',
      ]);
    }

    // 第三轮的 c 相对第二轮是掉、是升、还是没动（缺数就说中性的"再走到"）
    function cStep() {
      if (!isNum(cNums[1]) || !isNum(cNums[2])) return ' 再走到 ';
      if (cNums[2] < cNums[1]) return ' 再掉到 ';
      if (cNums[2] > cNums[1]) return ' 再升到 ';
      return ' 再回到 ';
    }

    /* 收尾的两句：准确率 + 信号检测论那句。
     *
     * ★ 这两句和数据大小【没有关系】，两套结论里都得有 —— 所以抽成一个函数，
     *   两个分支共用，免得以后又只改一边（上一次改成两套话术时，
     *   大摆幅分支就是在这里把这两句整段弄丢了）。 */
    function tailParas() {
      card.appendChild(para([
        '再注意准确率：', mono(aList.join('、')), '，三轮' + pickWord('acc', spreadAcc) + '。',
      ]));

      card.appendChild(para([
        '这就是信号检测论的贡献——把"能不能分清楚"和"敢不敢说有"拆开了。',
      ], 'margin-bottom:0;'));
    }

    if (isBigD(spreadD)) {
      /* ★ 摆幅到了这里，"d′ 没变"已经是一句假话 —— 整段换掉。
         起止两轮而不是最小/最大：不然数据若是 0.5 / 1.8 / 0.9，
         会写出"从 0.5 涨到 1.8"，可玩家最后一轮明明是 0.9 —— 那又成了假话。
         （两轮数据相同这种极端情况才退回最小/最大，保证说的是数轴上的两端；
           能走到这里的一定是 d′ 摆幅 > 0.70，所以 min ≠ max。） */
      var dNum  = m.map(function (x) { return x.dPrime; }).filter(isNum);
      var dFrom = dNum[0];
      var dTo   = dNum[dNum.length - 1];
      if (dFrom === dTo) { dFrom = minOf(dNum); dTo = maxOf(dNum); }

      /* d′ 是怎么动的 —— 决定下面那段解释说什么。
         ★ 原来说死"练习效应 / 后面已经熟练了"：d′ 从 1.59 掉到 0.00 的玩家
           会读到"你越来越熟练"，和屏幕上的数字当场打架。
         单调的定义：三个数依次递增，或依次递减（不是简单比较首末两个数）。 */
      var dUp = true, dDown = true;
      for (var q = 1; q < dNum.length; q++) {
        if (!(dNum[q] > dNum[q - 1])) dUp = false;
        if (!(dNum[q] < dNum[q - 1])) dDown = false;
      }
      var shape = (dUp && dTo > dFrom) ? 'up'
                : (dDown && dTo < dFrom) ? 'down'
                : 'mixed';

      // 首句：一路上升/下降的说"从 A 到 B"；忽高忽低的两头都不是终点，
      // 报"三轮是 A、B、C"比挑两个端点诚实（挑端点又变成一句有方向的话了）
      card.appendChild(para(shape === 'mixed'
        ? ['你的 d′ 三轮是 ', mono(dList.join('、')), ' —— 摆幅 ',
           mono(fmt2(spreadD)), '，这', strong('不是'), '"代价改变了能力"。']
        : ['你的 d′ 从 ', mono(fmt2(dFrom)),
           (dTo >= dFrom ? ' 涨到 ' : ' 掉到 '), mono(fmt2(dTo)),
           ' —— 这', strong('不是'), '"代价改变了能力"。']));

      if (shape === 'up') {
        card.appendChild(para([
          '最可能的原因是', strong('练习效应'),
          '：前几轮你还在摸索怎么读生命体征，后面已经熟练了。' +
          '纵向实验里很常见，所以正式实验都会先做一轮练习再开始计分。',
        ]));
      } else if (shape === 'down') {
        card.appendChild(para([
          '最可能的原因是', strong('疲劳或注意力下降'),
          ' —— 这种实验越到后面越容易判断得草率。也可能是', strong('标准被推到了极端'),
          '：打中和误报一起变得很高时，两者的差距反而会缩小，d′ 就测不准了。',
        ]));
      } else {
        card.appendChild(para([
          '三轮之间你的 d′ ', strong('忽高忽低'),
          ' —— 这更像判断本身', strong('不稳定'), '，而不是"能力变了"。' +
          '每轮只有 15 个信号 + 15 个噪音，抽样波动本来就不小。',
        ]));
      }

      card.appendChild(cPara('不过 c 的变化仍然说明问题：'));

      tailParas();
      return card;
    }

    card.appendChild(para([
      '三轮里你的 d′ ' + pickWord('dPrime', spreadD) + '——', mono(dList.join('、')),
      '，你分辨危重患者的能力一直是那样。',
    ]));

    card.appendChild(cPara('但'));

    tailParas();

    return card;
  }

  /* --------------------------------------------------------------------------
   * 5. 每轮的混淆矩阵（三个小表并排，窄屏自动堆叠）
   *
   *       真的危重   其实不需
   *   说要急诊  12 H      3 FA
   *   可以等待   3 M     12 CR
   *
   *   用 main.css 里已有的 .cm-table（任务书 M8 第 5 节点名）。
   *   并排/堆叠靠 flex-wrap：一个 item 至少 200px，放不下就换行，
   *   不需要 media query（本文件改不了 main.css）。
   * ------------------------------------------------------------------------ */

  // 一格：数字 + 一个小小的结果代号（H / M / FA / CR）
  function countCell(letter, n) {
    var td = E('td', null, null, null);
    td.appendChild(document.createTextNode((isNum(n) ? n : '—') + ' '));
    td.appendChild(E('span', null, 'color:' + CLR_DIM + ';font-size:0.78em;', letter));
    return td;
  }

  function matrixRow(label, leftLetter, leftN, rightLetter, rightN) {
    var tr = E('tr', null, null, null);
    tr.appendChild(E('td', null,
      'font-family:' + SANS + ';color:' + CLR_DIM + ';white-space:nowrap;', label));
    tr.appendChild(countCell(leftLetter, leftN));
    tr.appendChild(countCell(rightLetter, rightN));
    return tr;
  }

  function buildMatrix(r) {
    var c = r.counts || {};

    var t = E('table', 'cm-table', 'margin-bottom:0;', null);

    var cap = E('caption', null, null, roundLabel(r));
    t.appendChild(cap);

    var thead = E('thead', null, null, null);
    var hrow  = E('tr', null, null, null);
    hrow.appendChild(E('th', null, null, ''));
    hrow.appendChild(E('th', null, 'white-space:nowrap;', '真的危重'));
    hrow.appendChild(E('th', null, 'white-space:nowrap;', '其实不需'));
    thead.appendChild(hrow);
    t.appendChild(thead);

    var tbody = E('tbody', null, null, null);
    tbody.appendChild(matrixRow('说要急诊', 'H',  c.H,  'FA', c.FA));
    tbody.appendChild(matrixRow('可以等待', 'M',  c.M,  'CR', c.CR));
    t.appendChild(tbody);

    return t;
  }

  function buildMatrices(rounds) {
    var card = E('div', 'card', null, null);
    card.appendChild(E('div', 'card-head', null, '每轮的判断明细'));

    var row = E('div', null, 'display:flex;flex-wrap:wrap;gap:16px;', null);

    rounds.forEach(function (r) {
      var box = E('div', null, 'flex:1 1 200px;min-width:0;', null);
      box.appendChild(buildMatrix(r));
      row.appendChild(box);
    });

    card.appendChild(row);
    return card;
  }

  /* --------------------------------------------------------------------------
   * 6. 出口按钮
   *
   *   [ 再玩一次 ]         → clearRounds() + 说明页
   *   [ 导出成绩单 ]       → summarizeSession() + Submit.exportCsv()
   *   [ 进入概念实验室 → ]  → 实验室
   *   [ 回到登录 ]         → reset() + 登录页
   *
   *   ★「再玩一次」必须用 Store.clearRounds() 而不是 reset()（契约 5.3）：
   *     玩家刚填的学号姓名和试次模式要留着，只把上一局的 rounds 清掉。
   *     reset() 会把 student / mode 一起清空，玩家得重新登录一遍。
   *
   *   ★「导出成绩单」是【风险对冲】（契约 6.1 那一节 / 任务书）：后端要是
   *     部署失败（免费额度休眠、环境变量配错），学生点一下就能下载一个 CSV
   *     交给老师 —— 这是不依赖运维的退路。所以：
   *       · Submit 没加载时【整个按钮不出现】（不是点了没反应）
   *       · 只要 Submit 在，它就一直可用，哪怕后端一次也没通
   * ------------------------------------------------------------------------ */

  // 结果页这份 Session 和引擎提交的那份必须是同一套参数拼出来的，
  // 否则"交上去的"和"下载下来的"会对不上（startedAt 也一样要从引擎取）
  function currentSession() {
    var startedAt = (window.Engine && typeof Engine.sessionStartedAt === 'function')
                    ? Engine.sessionStartedAt() : null;

    return Scoring.summarizeSession(Store.student, Store.mode, Store.rounds, startedAt);
  }

  function buildButtons() {
    var row = E('div', 'btn-row', 'margin-top:4px;', null);

    var again    = E('button', 'btn btn-ghost',   null, '再玩一次');
    var labBtn   = E('button', 'btn btn-primary', null, '进入概念实验室 →');
    var loginBtn = E('button', 'btn btn-ghost',   null, '回到登录');

    again.addEventListener('click', function () {
      Store.clearRounds();      // ★ 只清 rounds
      showScreen('brief');
    });

    labBtn.addEventListener('click', function () {
      showScreen('lab');
    });

    loginBtn.addEventListener('click', function () {
      Store.reset();            // 三个字段全清：回登录页就是重新开始
      showScreen('login');
    });

    /* 按钮顺序按任务书：[ 再玩一次 ] [ 导出成绩单 ] [ 进入概念实验室 → ] [ 回到登录 ]
     *
     * ★ Submit 不在就不放这个按钮（任务书要求"隐藏"而不是"点了没反应"）：
     *   一个点了什么都不发生的按钮，比没有这个按钮更糟 —— 学生会以为交成功了。
     *   这里用 typeof 而不是 window.Submit，理由和 engine.js 里那处一样。 */
    if (typeof Submit !== 'undefined') {
      var exp = E('button', 'btn btn-ghost', null, '导出成绩单');
      exp.addEventListener('click', function () {
        Submit.exportCsv(currentSession());
      });
      row.appendChild(again);
      row.appendChild(exp);
    } else {
      row.appendChild(again);
    }

    row.appendChild(labBtn);
    row.appendChild(loginBtn);

    return row;
  }

  /* --------------------------------------------------------------------------
   * 7. 两种"还没跑完"的情况
   *
   *   开发导航条可以直接跳到结果页（控制台里也常这么测），
   *   所以 Store.rounds 为空是很正常的一步，不能白屏、更不能算出一堆 NaN。
   * ------------------------------------------------------------------------ */

  function buildEmpty() {
    var card = E('div', 'card', null, null);
    card.appendChild(E('div', 'card-head', null, '还没有成绩'));

    card.appendChild(E('p', 'placeholder', 'margin-bottom:16px;',
      '这一页要等你把三轮实验都做完，才会填上你自己的数字。'));

    var row = E('div', 'btn-row', null, null);
    var btn = E('button', 'btn btn-primary', null, '去实验说明 →');
    btn.addEventListener('click', function () { showScreen('brief'); });
    row.appendChild(btn);
    card.appendChild(row);

    return card;
  }

  function buildPartial(n) {
    var card = E('div', 'card', null, null);
    card.appendChild(E('div', 'card-head', null, '还没走完三轮'));
    card.appendChild(E('p', 'placeholder', 'margin-bottom:0;',
      '你已经跑完 ' + n + ' 轮（全程 3 轮）。上面先按已完成的轮次列出来 —— ' +
      'd′ 和 c 的对比要三轮齐了才看得出来。'));
    return card;
  }

  /* --------------------------------------------------------------------------
   * 8. render(el) —— 契约 5.2 的接口，index.html 每次进结果页都会调
   * ------------------------------------------------------------------------ */

  function render(el) {
    if (!el) return;

    var rounds = (window.Store && window.Store.rounds) ? window.Store.rounds.slice() : [];

    el.innerHTML = '';                       // 每局数据都不一样，整个重建

    el.appendChild(buildTitle(rounds));

    if (rounds.length === 0) {
      el.appendChild(buildEmpty());
      return;
    }

    el.appendChild(buildCompare(rounds));

    if (rounds.length >= 3) {
      el.appendChild(buildConclusion(rounds));
    } else {
      el.appendChild(buildPartial(rounds.length));
    }

    el.appendChild(buildMatrices(rounds));
    el.appendChild(buildButtons());
  }

  /* ------------------------------------------------------------------------ */

  return {
    render: render,
  };

})();

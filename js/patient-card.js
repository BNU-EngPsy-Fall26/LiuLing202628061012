/* ============================================================================
 * js/patient-card.js —— 患者卡片渲染（M5）
 *
 * 【这个文件只做一件事】把传进来的 Patient 画成一张卡片，它不产生数据。
 *   患者数据怎么生成是 M4（js/patient.js）的事，
 *   两边只通过契约 4.1 的 Patient 对象通信（契约 5.1）。
 *
 * 【★ 第一铁律：判断之前不许泄露真实情况】
 *   如果危重患者的卡片长得和普通患者不一样（边框发红、字体加粗、多个小图标……），
 *   玩家就不用判断了 —— 一眼扫过去就能作弊。整个实验当场作废。
 *
 *   所以本文件：
 *     ✅ 只根据 vitals 里的【数值大小】决定颜色（阈值见下面的 VITAL_RANGES）
 *     ✅ 判断态（reveal:false）完全不碰契约 4.1 里那两个"仅调试可见"的字段
 *     ❌ 没有任何按"真实答案"走的分支 / 颜色 / 字号 / 排序 / 布局
 *     ❌ 不把任何内部字段写进 DOM 属性、id、class，也不打印到控制台
 *
 *   自查的判断标准：本文件里的每一个 if，在"不知道这位患者真实答案"的前提下
 *   也完全成立，那就是对的。
 *
 * 【唯一的例外】reveal:true 是反馈态 —— 判断已经做完了，这时候必须把真相
 *   告诉玩家（告诉他漏了还是收对了）。全文件只在 renderFeedback() 里
 *   明文读了一次那个字段，而且只用来决定反馈条那句话怎么措辞，
 *   不参与任何布局、配色、排序。
 *
 *   ★ 那个字段名在本文件里【明文出现、且只出现一次】。不要把它藏起来
 *     （拼接、换成变量名、塞进字符串都算藏）—— 藏了之后 grep 是 0 命中，
 *     但那个 0 只说明"用了藏的手法"，不说明"没读"，反而让审计失效。
 *     审计方式和"正好 1 行"的判据见下面第 0 节。
 * ==========================================================================*/

window.PatientCard = (function () {
  'use strict';

  /* --------------------------------------------------------------------------
   * 0. 这份文件的审计方式（复查先看这里）
   *
   * 【第一铁律】契约第 8 节第 2、3 条：判断之前不许泄露真实情况。
   *   契约 4.1 的患者对象最后有两个字段是"仅调试可见"的 ——
   *   一个底层决策变量、一个真实情况。玩家点按钮之前，它们一个字都不能露出来。
   *
   * 【一条命令查完】在仓库根目录敲：
   *
   *     grep -nE "has[S]ignal|severit[y]" js/patient-card.js
   *
   *   （命令里那对方括号是 grep 的常见写法：让这条命令不会匹配到它自己这一行。
   *    等价地敲这两个名字的原样 grep 也一样 —— 本注释里不写它们的原样写法，
   *    写了就多一行命中。这两个名字就是契约 4.1 里排在最后的那两个字段。）
   *
   *   判据：应当**正好命中 1 行** —— 唯一那一行在第 8 节 renderFeedback() 里，
   *        是那次读取本身。因为读取和说明写在同一行上，grep 的结果自带上下文，
   *        不看文件也知道这一行是干什么的。
   *
   *     · 命中 0 行   → 有人把字段名藏起来了。这种"干净"是假的，必须明文写一次。
   *     · 命中 1 行   → 合规。再看一眼那一行是不是确实在 renderFeedback 里。
   *     · 命中 ≥2 行  → 有人把它写到了别处，重点查是不是进了判断分支。
   * ------------------------------------------------------------------------ */

  /* --------------------------------------------------------------------------
   * 1. 生命体征分档阈值 ★ 要调参就调这里
   *
   * 【分档只看数值偏离程度】见 CONTRACT.md 2.4：
   *   正常患者也可能有几项偏黄，危重患者也可能各项都正常 ——
   *   这正是 SDT 里"信号与噪音分布重叠"的可视化。
   *   所以这套阈值与"这位患者到底要不要急诊"没有任何关系。
   *
   * 【格式】normal 是正常区间，watch 是需观察区间（可以有好几段），
   *   两个都不落在里面 → 危急。
   *   判断顺序是 normal → watch → danger，所以压在边界上的值算正常。
   * ------------------------------------------------------------------------ */

  var VITAL_RANGES = {

    temp: {
      label: '体温',
      unit: '°C',
      digits: 1,
      // 正常 36.0~37.5 ／ 需观察 35.5~36.0 或 37.5~38.5 ／ 其余危急
      normal: [36.0, 37.5],
      watch: [[35.5, 36.0], [37.5, 38.5]],
    },

    hr: {
      label: '心率',
      unit: '',
      digits: 0,
      // 正常 60~100 ／ 需观察 50~60 或 100~120 ／ 其余危急
      normal: [60, 100],
      watch: [[50, 60], [100, 120]],
    },

    sbp: {
      // 卡片上显示成"收缩压/舒张压"（96/62），但分档只看收缩压 ——
      // 阈值表只给了收缩压这一列，舒张压没有独立的分档标准。
      label: '血压',
      unit: '',
      digits: 0,
      // 正常 90~140 ／ 需观察 85~90 或 140~160 ／ 其余危急
      normal: [90, 140],
      watch: [[85, 90], [140, 160]],
    },

    spo2: {
      label: '血氧',
      unit: '%',
      digits: 0,
      // 表里写的是"≥ 95"，上界不设限
      normal: [95, Infinity],
      watch: [[90, 94]],
    },

    consciousness: {
      // 意识不是数字，按词表查。
      // 词表里没有的写法一律按"需观察"处理 —— 不用红或绿去猜，
      // 猜错（尤其猜成绿）会让玩家以为一切正常。
      label: '意识',
      unit: '',
      levels: {
        '清醒': 'normal',
        '嗜睡': 'watch',
        '昏睡': 'danger',
        '昏迷': 'danger',
      },
    },

  };

  // 生命体征一整行的显示顺序
  var VITAL_ORDER = ['temp', 'hr', 'sbp', 'spo2', 'consciousness'];

  // 分档 → main.css 里已有的类（契约 2.4）
  var BAND_CLASS = {
    normal: 'vital-normal',
    watch:  'vital-watch',
    danger: 'vital-danger',
  };

  // 分档 → 颜色变量。反馈条也用这套（PatientData.feedbackTone 的取值和这里一样）
  var BAND_COLOR = {
    normal: 'var(--c-normal)',
    watch:  'var(--c-watch)',
    danger: 'var(--c-danger)',
  };

  /* --------------------------------------------------------------------------
   * 2. 数值 → 分档
   * ------------------------------------------------------------------------ */

  function num(v) {
    return (typeof v === 'number' && isFinite(v)) ? v : null;
  }

  function inRange(v, range) {
    return v >= range[0] && v <= range[1];
  }

  // 返回 'normal' / 'watch' / 'danger'；数值缺失返回 null（显示成占位符）
  function bandOf(key, vitals) {
    var spec = VITAL_RANGES[key];

    if (spec.levels) {
      var word = vitals[key];
      if (!word) return null;
      return spec.levels[word] || 'watch';
    }

    var v = num(vitals[key]);
    if (v === null) return null;

    if (inRange(v, spec.normal)) return 'normal';
    for (var i = 0; i < spec.watch.length; i++) {
      if (inRange(v, spec.watch[i])) return 'watch';
    }
    return 'danger';
  }

  /* --------------------------------------------------------------------------
   * 3. 数值 → 显示文本
   * ------------------------------------------------------------------------ */

  function fmtNum(v, digits) {
    var n = num(v);
    if (n === null) return null;
    return digits > 0 ? n.toFixed(digits) : String(Math.round(n));
  }

  // 血压显示成 "96/62"（收缩压/舒张压）
  function fmtBloodPressure(vitals) {
    var s = fmtNum(vitals.sbp, 0);
    if (s === null) return null;
    var d = fmtNum(vitals.dbp, 0);
    return d === null ? s : s + '/' + d;
  }

  /* --------------------------------------------------------------------------
   * 4. DOM 小工具
   *    全部走 createElement + textContent，patient 里的文字不会被当成 HTML
   * ------------------------------------------------------------------------ */

  function makeEl(tag, css, text) {
    var node = document.createElement(tag);
    if (css) node.style.cssText = css;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  /* --------------------------------------------------------------------------
   * 5. 第一行：编号 · 姓名 · 年龄 · 性别
   * ------------------------------------------------------------------------ */

  function renderIdentity(patient) {
    var row = makeEl('div',
      'display:flex;flex-wrap:wrap;align-items:baseline;gap:10px;' +
      'padding-bottom:10px;margin-bottom:14px;' +
      'border-bottom:1px solid var(--c-border);' +
      'font-size:0.82rem;color:var(--c-text-dim);');
    row.className = 'patient-identity';

    var parts = [];
    if (patient.id)   parts.push({ text: patient.id, mono: true });
    if (patient.name) parts.push({ text: patient.name });
    if (num(patient.age) !== null) parts.push({ text: Math.round(patient.age) + ' 岁' });
    if (patient.sex)  parts.push({ text: patient.sex });

    for (var i = 0; i < parts.length; i++) {
      var span = makeEl('span', parts[i].mono ? 'font-family:var(--font-mono);' : '',
                        parts[i].text);
      row.appendChild(span);
    }
    return row;
  }

  /* --------------------------------------------------------------------------
   * 6. 主诉 + 来院方式（契约 3.3.1）
   *
   * 固定最小高度（主诉约 3 行 + 来院方式固定 1 行）—— 这两行都有长有短，
   * 不固定的话每换一位患者，下面的生命体征就会上下跳，读起来很累，
   * 也容易看串行。两行合起来算一个整体，所以要一起保证。
   *   主诉     → min-height 3 行；超过 3 行的长主诉仍然会把它撑高（改动前就是这样）
   *   来院方式 → 强制单行（nowrap）：一个块永远是整整一行高，不随文字长短变
   *
   * 【来院方式为什么不上色】契约 2.4 的分档是"数值偏离正常程度"，
   *   来院方式是一句话，没有"数值"，也就没有分档这回事。
   *   整行统一用 --c-text-dim：它是辅助线索，不许和主诉抢注意力。
   *   也正因为它不分档，判断态和反馈态长得一模一样 ——
   *   它不参与"真实情况"的揭示，两种状态下都由这里画，没有第二条路径。
   * ------------------------------------------------------------------------ */

  function renderComplaint(patient) {
    var wrap = makeEl('div', 'padding-bottom:14px;margin-bottom:14px;' +
                             'border-bottom:1px solid var(--c-border);');
    wrap.className = 'patient-complaint';

    var label = makeEl('div',
      'font-size:0.72rem;color:var(--c-text-dim);' +
      'letter-spacing:0.14em;margin-bottom:6px;', '主诉');
    wrap.appendChild(label);

    var body = makeEl('div',
      'font-size:1.05rem;line-height:1.65;color:var(--c-text);' +
      'min-height:calc(1.65em * 3);word-break:break-word;',
      patient.chiefComplaint || '');
    body.className = 'patient-complaint-text';
    wrap.appendChild(body);

    // —— 来院方式：字号比主诉小一号（clamp 让它跟着窗口缩，窄屏也不会折行），
    //    行高固定，nowrap + ellipsis 是"永远只占一行"的硬保证：
    //    万一真的装不下，尾字被省略号裁掉，也不会把下面的体征顶下去
    if (patient.arrival) {
      var arrival = makeEl('div',
        'margin-top:6px;' +
        'font-size:clamp(0.78rem, 3.2vw, 0.92rem);' +
        'line-height:1.6;color:var(--c-text-dim);' +
        'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
        patient.arrival);
      arrival.className = 'patient-arrival';
      wrap.appendChild(arrival);
    }

    return wrap;
  }

  /* --------------------------------------------------------------------------
   * 7. 生命体征一行
   *    每项：上面名称（小字、暗色），下面数值（等宽、按分档上色）
   * ------------------------------------------------------------------------ */

  function renderVitalCell(key, vitals) {
    var spec = VITAL_RANGES[key];

    var cell = makeEl('div', 'flex:1 1 0;min-width:0;');
    cell.className = 'vital-cell';

    cell.appendChild(makeEl('div',
      'font-size:0.72rem;color:var(--c-text-dim);' +
      'letter-spacing:0.08em;margin-bottom:6px;white-space:nowrap;',
      spec.label));

    var band = bandOf(key, vitals);

    // 数值一律等宽 + tabular-nums：不然数字宽窄不一，每换一位患者整行都会左右跳
    // 字号跟着窗口缩（clamp）：五项必须始终排在一行，窄屏上靠缩小字号来让位，
    // 而不是折行 —— 折了行，五项就不在一条水平线上了，读数会变慢
    var value = makeEl('div',
      'font-family:var(--font-mono);font-variant-numeric:tabular-nums;' +
      'font-size:clamp(0.8rem, 3.6vw, 1.05rem);font-weight:600;' +
      'line-height:1.3;white-space:nowrap;');

    var text = key === 'sbp' ? fmtBloodPressure(vitals) : null;
    if (key !== 'sbp') {
      if (spec.levels) {
        text = vitals[key] || null;
      } else {
        text = fmtNum(vitals[key], spec.digits);
      }
    }

    if (band) {
      value.className = 'vital-value ' + BAND_CLASS[band];
    } else {
      // 数值缺失：中性灰，不用红/绿去暗示什么
      value.className = 'vital-value';
      value.style.color = 'var(--c-text-dim)';
    }

    if (text === null) {
      value.textContent = '—';
    } else {
      value.textContent = text;
      if (spec.unit) {
        value.appendChild(makeEl('span', 'font-size:0.72em;opacity:0.75;', spec.unit));
      }
    }

    cell.appendChild(value);
    return cell;
  }

  function renderVitals(patient) {
    var vitals = patient.vitals || {};

    var row = makeEl('div', 'display:flex;flex-wrap:nowrap;gap:10px;');
    row.className = 'vitals-row';

    for (var i = 0; i < VITAL_ORDER.length; i++) {
      row.appendChild(renderVitalCell(VITAL_ORDER[i], vitals));
    }
    return row;
  }

  /* --------------------------------------------------------------------------
   * 8. 反馈条（只在 reveal:true 时出现）
   *
   * 两行：
   *   第一行 —— PatientData.feedback[outcome] 里随机抽一句，{name} 换成患者姓名
   *   第二行 —— 真实情况一句话。★ 全文件唯一读真实答案的地方。
   *
   * 配色取 PatientData.feedbackTone[outcome]：
   *   normal 绿（H / CR，判对了）／ watch 黄（FA，浪费了资源）／
   *   danger 红（M，漏了危重患者）
   *
   * 【关于随机】抽句子走 Utils.pick(pool, rng)。rng 由 opts.rng 传进来，
   *   不传时 Utils.pick 内部用 Math.random 兜底（utils.js 里已经这么实现）。
   *   传了固定 rng，整张卡片就是完全确定的，测试可以直接比 innerHTML 字符串。
   * ------------------------------------------------------------------------ */

  function renderFeedback(patient, outcome, rng) {
    var data = window.PatientData;

    var tone = (data && data.feedbackTone[outcome]) || 'normal';
    var color = BAND_COLOR[tone] || BAND_COLOR.normal;

    var bar = makeEl('div',
      'margin-top:10px;padding:12px 14px;' +
      'background:var(--c-surface-2);' +
      'border-left:3px solid ' + color + ';' +
      'border-radius:var(--radius-sm);');
    bar.className = 'feedback-bar';

    // —— 第一行：这次判断的结果文案
    var pool = data && data.feedback[outcome];
    if (pool && pool.length) {
      var name = patient.name || '这位患者';
      var line = String(Utils.pick(pool, rng))
        .replace(/\{name\}/g, function () { return name; });
      bar.appendChild(makeEl('div',
        'font-size:0.95rem;line-height:1.6;color:' + color + ';', line));
    }

    // —— 第二行：真实情况（判断已经做完，这时候告诉玩家真相是必须的）
    //
    // ★★★ 全文件唯一允许读"真实情况"的地方（契约 4.1 的最后一个字段）★★★
    //   判断路径 renderIdentity / renderComplaint / renderVitals
    //   及其调用的所有函数，绝对不许读这个字段。
    //   这里读只是为了让反馈条说清"真实情况是什么"——判断已经做完了。
    //   审计判据见文件开头第 0 节：全文 grep 应当正好命中下面这一行。
    var truth = patient.hasSignal;   // ← 铁律的唯一例外：判断已做完，必须告诉玩家真相
    if (typeof truth === 'boolean') {
      var sentence = makeEl('div',
        'font-size:0.9rem;line-height:1.6;color:var(--c-text);margin-top:6px;');
      sentence.className = 'feedback-truth';

      function emphasis(word) {
        return makeEl('span', 'font-weight:600;color:' + color + ';', word);
      }

      if (truth) {
        // 这位患者确实需要紧急处理
        sentence.appendChild(makeEl('span', null, '这位患者'));
        sentence.appendChild(emphasis('确实'));
        sentence.appendChild(makeEl('span', null, '需要紧急处理'));
      } else {
        // 这位患者其实不需要紧急处理
        sentence.appendChild(makeEl('span', null, '这位患者其实'));
        sentence.appendChild(emphasis('不需要'));
        sentence.appendChild(makeEl('span', null, '紧急处理'));
      }

      bar.appendChild(sentence);
    }

    return bar;
  }

  /* --------------------------------------------------------------------------
   * 9. 出口（契约 5.1）
   *
   *   render(el, patient, { reveal, outcome, rng })
   *
   *   el            容器元素（一个 div），每次渲染先清空
   *   patient       契约 4.1 的 Patient
   *   opts.reveal   false = 判断前（不显示真实情况）
   *                 true  = 反馈态（显示判断结果和真实情况）
   *   opts.outcome  'H' | 'M' | 'FA' | 'CR'，仅 reveal:true 时需要
   *   opts.rng      可选。只有一个用途：反馈文案抽哪一句。
   *                 不传就退化成 Math.random（Utils.pick 的兜底行为）；
   *                 传了固定 rng，整张卡片的输出就是完全确定的。
   * ------------------------------------------------------------------------ */

  function render(el, patient, opts) {
    if (!el) return;

    opts = opts || {};
    var reveal = !!opts.reveal;

    // 每次渲染都先清空：同一场游戏会反复渲染同一个容器
    el.innerHTML = '';
    if (!patient) return;

    var card = makeEl('div',
      'background:var(--c-surface);border:1px solid var(--c-border);' +
      'border-radius:var(--radius);padding:20px;' +
      'font-family:var(--font-sans);');
    card.className = 'patient-card';

    card.appendChild(renderIdentity(patient));
    card.appendChild(renderComplaint(patient));
    card.appendChild(renderVitals(patient));
    el.appendChild(card);

    if (reveal) el.appendChild(renderFeedback(patient, opts.outcome, opts.rng));
  }

  return {
    render: render,
  };

})();

/* ============================================================================
 * 【自查说明 · 怎么保证没有泄露真实情况】
 *
 * 1. 判断路径（renderIdentity / renderComplaint / renderVitals）
 *    从头到尾没有读过那个字段，也没有任何 if 依赖它。
 *    生命周期里唯一的输入是 patient.vitals 和 patient 的展示字段
 *    （id / name / age / sex / chiefComplaint / arrival），这些东西信号患者和噪音患者
 *    完全一样地处理 —— 配色只看数值离正常的距离（VITAL_RANGES）。
 *    arrival 整行固定用 --c-text-dim，不查表、不上色、不分档。
 *
 * 2. 全文只有 renderFeedback() 里读过一次真实答案，而且：
 *    - 只在 reveal:true（判断已经做完）时才走到；
 *    - 只用来决定反馈条第二句的措辞；
 *    - 不参与布局、不参与配色、不参与排序。
 *
 * 3. ★ 那个字段名在本文件里明文出现，全文只出现一次（就是第 8 节的读取行），
 *    而且读取行自己带了一句"这是唯一例外"的行尾注释 ——
 *    所以 grep 命中的那一行，本身就说清了它为什么存在。
 *    审计命令与判据见文件开头第 0 节。**不要**把它改成拼接、变量或字符串拼装：
 *    藏起来之后 grep 是 0 命中，但那个 0 只说明"藏了"，不说明"没读"，
 *    审计就变成走过场了。
 *
 * 4. 没有任何 console.log，也没有把这些字段写进 data-* / id / class / title。
 *
 * 5. 验收做法：
 *    a) 把测试患者的那两个字段改掉重渲染，判断态的 DOM 必须一字不差；
 *    b) 传一个固定 rng 进 opts，反馈态的 DOM 也应当一字不差
 *       （不传 rng 时反馈文案会随机抽，字符串比较就不成立）。
 *    两项都已实测，见交付说明。
 * ==========================================================================*/

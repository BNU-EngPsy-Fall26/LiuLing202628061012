// ===== 结果页：个人数据 + 项目匿名汇总 =====
(function () {
  'use strict';

  const API = 'https://attention-lab-production.up.railway.app';
  const PROJECT = '9JRP59';

  const $ = (id) => document.getElementById(id);

  // ---------- 工具 ----------
  function mean(arr) {
    if (!arr.length) return null;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }
  function sd(arr) {
    if (arr.length < 2) return 0;
    const m = mean(arr);
    return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1));
  }
  function median(arr) {
    if (!arr.length) return null;
    const s = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }
  function fmt(v, digits = 0) {
    return v === null || v === undefined || Number.isNaN(v) ? '—' : v.toFixed(digits);
  }
  function barRow(label, value, max, unit = '') {
    const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
    return `<div class="bar-row">
      <div class="bar-label">${label}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      <div class="bar-val">${fmt(value, unit === '%' ? 1 : 0)}${unit}</div>
    </div>`;
  }
  function table(headers, rows) {
    return `<table class="rt"><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }

  // ---------- 读取本机个人数据 ----------
  const own1 = JSON.parse(localStorage.getItem('exp1_results') || '[]');
  const own2 = JSON.parse(localStorage.getItem('exp2_results') || '[]');
  const participant = localStorage.getItem('participant_id') || '';

  // ---------- 实验一统计 ----------
  function searchStats(trials) {
    const cells = {}; // key: type|env|size -> {rts:[], n, correct}
    trials.forEach(t => {
      const key = `${t.searchType}|${t.environment}|${t.setSize}`;
      if (!cells[key]) cells[key] = { rts: [], n: 0, correct: 0 };
      cells[key].n++;
      if (t.correct) cells[key].correct++;
      if (t.correct && t.rt >= 150 && t.rt <= 4000) cells[key].rts.push(t.rt);
    });

    const slope = {}; // `${type}|${env}` -> ms/item
    ['feature', 'conjunction'].forEach(type => {
      ['fog', 'clear'].forEach(env => {
        const a = cells[`${type}|${env}|8`];
        const b = cells[`${type}|${env}|24`];
        if (a && b && a.rts.length && b.rts.length) {
          slope[`${type}|${env}`] = (mean(b.rts) - mean(a.rts)) / 16;
        }
      });
    });

    const accuracy = trials.length
      ? trials.filter(t => t.correct).length / trials.length
      : null;

    return { cells, slope, accuracy };
  }

  function renderOwnExp1(trials) {
    if (!trials.length) {
      $('exp1-own').innerHTML = '<p class="muted">本机没有实验一的正式数据。完成实验后再回来查看。</p>';
      return;
    }
    const st = searchStats(trials);

    const rows = [];
    ['feature', 'conjunction'].forEach(type => {
      ['fog', 'clear'].forEach(env => {
        const r8 = mean((st.cells[`${type}|${env}|8`] || {}).rts || []);
        const r24 = mean((st.cells[`${type}|${env}|24`] || {}).rts || []);
        const s = st.slope[`${type}|${env}`];
        rows.push([
          type === 'feature' ? '特征搜索' : '联合搜索',
          env === 'clear' ? '高对比度' : '低对比度',
          fmt(r8), fmt(r24), fmt(s, 1)
        ]);
      });
    });

    $('exp1-own').innerHTML = `
      <p class="muted">被试编号：<b>${participant || '未记录'}</b>　正式试次：<b>${trials.length}</b>　总正确率：<b>${fmt(st.accuracy * 100, 1)}%</b></p>
      <h3>各条件平均正确反应时</h3>
      ${table(['搜索类型', '对比度', '集合 8 (ms)', '集合 24 (ms)', '斜率 (ms/项)'], rows)}
    `;

    // 斜率条形图
    const maxSlope = Math.max(1, ...Object.values(st.slope).map(v => Math.abs(v)));
    const labels = {
      'feature|fog': '特征 · 低对比度',
      'feature|clear': '特征 · 高对比度',
      'conjunction|fog': '联合 · 低对比度',
      'conjunction|clear': '联合 · 高对比度',
    };
    $('exp1-slopes').innerHTML = Object.keys(labels)
      .map(k => barRow(labels[k], st.slope[k] || 0, maxSlope, ''))
      .join('');

    // 检验
    const s = st.slope;
    const conjBenefit = (s['conjunction|fog'] ?? null) !== null && (s['conjunction|clear'] ?? null) !== null
      ? s['conjunction|fog'] - s['conjunction|clear'] : null;
    const featBenefit = (s['feature|fog'] ?? null) !== null && (s['feature|clear'] ?? null) !== null
      ? s['feature|fog'] - s['feature|clear'] : null;
    const interaction = (conjBenefit !== null && featBenefit !== null) ? conjBenefit - featBenefit : null;

    const h1 = (s['conjunction|fog'] != null && s['feature|fog'] != null)
      ? s['conjunction|fog'] > s['feature|fog'] : null;

    $('exp1-verdicts').innerHTML = `
      <div class="verdict ${h1 === true ? 'yes' : 'no'}">
        <b>H1 联合搜索成本：</b>
        ${h1 === null ? '数据不足。' : h1
          ? '联合搜索斜率大于特征搜索，符合特征整合理论。'
          : '未观察到联合搜索斜率更大，可能受小样本或刺激难度影响。'}
      </div>
      <div class="verdict">
        <b>H3 交互（关键）：</b>
        ${interaction === null ? '数据不足。'
          : `高对比度带来的斜率收益，联合搜索比特征搜索多 <b>${fmt(interaction, 1)} ms/项</b>。`
            + (interaction > 0 ? '方向与预测一致。' : '方向与预测相反。')}
      </div>
      <p class="muted">
        斜率收益 = 低对比度斜率 − 高对比度斜率；正值表示高对比度使搜索更省时。
        若高对比度只降低截距而不降低斜率，更可能反映整体可见度变化，而非搜索效率改变。
      </p>
    `;
  }

  // ---------- 实验二统计 ----------
  function changeStats(trials) {
    const cells = {}; // mode|loc -> {n, hit, times:[]}
    trials.forEach(t => {
      const key = `${t.displayMode}|${t.changeLocation}`;
      if (!cells[key]) cells[key] = { n: 0, hit: 0, times: [], errors: [] };
      cells[key].n++;
      if (t.clickCorrect) {
        cells[key].hit++;
        if (t.detectionTime != null) cells[key].times.push(t.detectionTime);
        if (t.clickError != null) cells[key].errors.push(t.clickError);
      }
    });
    const rate = {};
    Object.keys(cells).forEach(k => {
      rate[k] = cells[k].n ? cells[k].hit / cells[k].n : null;
    });
    return { cells, rate };
  }

  function renderOwnExp2(trials) {
    if (!trials.length) {
      $('exp2-own').innerHTML = '<p class="muted">本机没有实验二的正式数据。</p>';
      return;
    }
    const st = changeStats(trials);

    const rows = [];
    [['reference', '稳定参照'], ['uniform', '均匀遮蔽']].forEach(([mode, modeName]) => {
      [['edge', '边缘'], ['center', '中央']].forEach(([loc, locName]) => {
        const c = st.cells[`${mode}|${loc}`];
        rows.push([
          modeName, locName,
          c ? `${c.hit}/${c.n}` : '—',
          c ? fmt(st.rate[`${mode}|${loc}`] * 100, 1) + '%' : '—',
          c ? fmt(median(c.times)) : '—',
          c && c.errors.length ? fmt(mean(c.errors), 1) : '—'
        ]);
      });
    });

    $('exp2-own').innerHTML = `
      <p class="muted">被试编号：<b>${participant || '未记录'}</b>　正式试次：<b>${trials.length}</b></p>
      ${table(['显示模式', '变化位置', '命中/总数', '发现率（描述）', '中位发现时间 (ms) ⭐', '平均定位误差 (px)'], rows)}
    `;

    const rates = st.rate;
    $('exp2-rates').innerHTML = Object.keys(rates).length
      ? [
          ['reference|edge', '稳定参照 · 边缘'],
          ['reference|center', '稳定参照 · 中央'],
          ['uniform|edge', '均匀遮蔽 · 边缘'],
          ['uniform|center', '均匀遮蔽 · 中央'],
        ].map(([k, label]) => barRow(label, (rates[k] || 0) * 100, 100, '%')).join('')
      : '<p class="muted">数据不足。</p>';

    // 主指标：中位发现时间；次指标：平均定位误差；发现率仅作描述
    const tGet = (m, l) => {
      const c = st.cells[`${m}|${l}`];
      return c && c.times.length ? median(c.times) : null;
    };
    const eGet = (m, l) => {
      const c = st.cells[`${m}|${l}`];
      return c && c.errors.length ? mean(c.errors) : null;
    };
    const avg2 = (a, b) => (a != null && b != null) ? (a + b) / 2 : null;

    const tRef = avg2(tGet('reference', 'edge'), tGet('reference', 'center'));
    const tUni = avg2(tGet('uniform', 'edge'), tGet('uniform', 'center'));
    const eRef = avg2(eGet('reference', 'edge'), eGet('reference', 'center'));
    const eUni = avg2(eGet('uniform', 'edge'), eGet('uniform', 'center'));

    const timeEffect = (tRef != null && tUni != null) ? tUni - tRef : null;      // >0 参照更快
    const errorEffect = (eRef != null && eUni != null) ? eUni - eRef : null;     // >0 参照更准

    const dEdge = (tGet('uniform', 'edge') != null && tGet('reference', 'edge') != null)
      ? tGet('uniform', 'edge') - tGet('reference', 'edge') : null;
    const dCenter = (tGet('uniform', 'center') != null && tGet('reference', 'center') != null)
      ? tGet('uniform', 'center') - tGet('reference', 'center') : null;
    const timeInteraction = (dEdge != null && dCenter != null) ? dEdge - dCenter : null;

    $('exp2-verdicts').innerHTML = `
      <div class="verdict ${timeEffect === null ? '' : (timeEffect > 0 ? 'yes' : 'no')}">
        <b>主指标 · 空间参照效应（发现时间）：</b>
        ${timeEffect === null ? '数据不足。'
          : `稳定参照比均匀遮蔽快 <b>${fmt(timeEffect, 0)} ms</b>（两位置均值）。`
            + (timeEffect > 0 ? '方向与预测一致。' : '未观察到参照带来的速度优势。')}
      </div>
      <div class="verdict ${errorEffect === null ? '' : (errorEffect > 0 ? 'yes' : 'no')}">
        <b>次指标 · 定位误差：</b>
        ${errorEffect === null ? '数据不足。'
          : `稳定参照的点击误差小 <b>${fmt(errorEffect, 1)} px</b>。`
            + (errorEffect > 0 ? '方向与预测一致。' : '未观察到精度优势。')}
      </div>
      <div class="verdict ${timeInteraction === null ? '' : (timeInteraction > 0 ? 'yes' : 'no')}">
        <b>H3 位置交互（发现时间）：</b>
        ${timeInteraction === null ? '数据不足。'
          : `边缘位置的时间收益比中央多 <b>${fmt(timeInteraction, 0)} ms</b>。`}
      </div>
      <p class="muted">
        主指标为中位发现时间，次指标为定位误差；发现率与超时率仅作描述，用于确认任务难度与变化盲是否存在。
        两条件都不闪黑、亮度接近，唯一差别是空白期是否保留海图骨架。
      </p>
    `;
  }

  // ---------- 项目汇总 ----------
  async function loadGroup() {
    const [s1, s2] = await Promise.all([
      fetch(`${API}/api/hw2/data?project=${PROJECT}&experiment=search`).then(r => r.json()).catch(() => null),
      fetch(`${API}/api/hw2/data?project=${PROJECT}&experiment=route_change`).then(r => r.json()).catch(() => null),
    ]);

    const rec1 = (s1 && s1.records) || [];
    const rec2 = (s2 && s2.records) || [];

    // 实验一：每名被试的 4 条斜率
    const perP = {};
    rec1.forEach(rec => {
      const st = searchStats(rec.trials || []);
      Object.entries(st.slope).forEach(([k, v]) => {
        (perP[rec.participant] = perP[rec.participant] || {})[k] = v;
      });
    });
    const keys = ['feature|fog', 'feature|clear', 'conjunction|fog', 'conjunction|clear'];
    const groupSlopes = {};
    keys.forEach(k => {
      const vals = Object.values(perP).map(p => p[k]).filter(v => v != null);
      groupSlopes[k] = { m: mean(vals), s: sd(vals), n: vals.length };
    });

    const group1Rows = [
      ['特征 · 低对比度', 'feature|fog'],
      ['特征 · 高对比度', 'feature|clear'],
      ['联合 · 低对比度', 'conjunction|fog'],
      ['联合 · 高对比度', 'conjunction|clear'],
    ].map(([label, k]) => [
      label,
      groupSlopes[k].n ? fmt(groupSlopes[k].m, 1) : '—',
      groupSlopes[k].n > 1 ? fmt(groupSlopes[k].s, 1) : '—',
      groupSlopes[k].n
    ]);

    $('exp1-group').innerHTML = rec1.length
      ? `<p class="muted">参与人数（实验一）：<b>${Object.keys(perP).length}</b></p>
         ${table(['条件', '组平均斜率 (ms/项)', '标准差', 'n'], group1Rows)}`
      : '<p class="muted">暂无其他参与者的实验一数据。</p>';

    // 实验二：每名被试各条件发现率
    const perP2 = {};
    rec2.forEach(rec => {
      const st = changeStats(rec.trials || []);
      Object.entries(st.rate).forEach(([k, v]) => {
        (perP2[rec.participant] = perP2[rec.participant] || {})[k] = v;
      });
    });
    const keys2 = ['reference|edge', 'reference|center', 'uniform|edge', 'uniform|center'];
    const group2Rows = [
      ['稳定参照 · 边缘', 'reference|edge'],
      ['稳定参照 · 中央', 'reference|center'],
      ['均匀遮蔽 · 边缘', 'uniform|edge'],
      ['均匀遮蔽 · 中央', 'uniform|center'],
    ].map(([label, k]) => {
      const vals = Object.values(perP2).map(p => p[k]).filter(v => v != null);
      return [label, vals.length ? fmt(mean(vals) * 100, 1) + '%' : '—', fmt(sd(vals) * 100, 1), vals.length];
    });

    $('exp2-group').innerHTML = rec2.length
      ? `<p class="muted">参与人数（实验二）：<b>${Object.keys(perP2).length}</b></p>
         ${table(['条件', '组平均发现率（描述）', '标准差 (%)', 'n'], group2Rows)}`
      : '<p class="muted">暂无其他参与者的实验二数据。</p>';
  }

  // ---------- 启动 ----------
  (async function init() {
    let hasOwn = false;
    if (own1.length) { $('exp1-card').style.display = 'block'; renderOwnExp1(own1); hasOwn = true; }
    if (own2.length) { $('exp2-card').style.display = 'block'; renderOwnExp2(own2); hasOwn = true; }

    $('status').textContent = hasOwn
      ? '以下是本机记录的个人结果；汇总数据加载中…'
      : '本机没有实验数据，仅显示项目汇总。';

    try {
      await loadGroup();
      $('status').textContent = hasOwn
        ? '以下是本机记录的个人结果与项目匿名汇总。'
        : '本机没有实验数据；以下是项目匿名汇总。';
    } catch (e) {
      $('status').textContent = '汇总数据读取失败，请检查网络后刷新。';
      console.error(e);
    }
  })();
})();

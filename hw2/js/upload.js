// ===== 数据上传：注意实验室统一收数接口 =====
// 文档：POST /api/hw2/submit  { project, experiment, participant, condition, trials, meta }

const LAB_API = 'https://attention-lab-production.up.railway.app/api/hw2/submit';
const PROJECT_CODE = '9JRP59';

// ===== 测试模式 =====
// 在网址后加 ?test=1 进入测试模式：本次会话内所有上传记为 test_*，不污染正式数据
function isTestMode() {
  if (new URLSearchParams(location.search).get('test') === '1') {
    sessionStorage.setItem('test_mode', '1');
  }
  return sessionStorage.getItem('test_mode') === '1';
}

// 把实验名映射为正式名或测试名
function resolveExperiment(name) {
  return isTestMode() ? 'test_' + name : name;
}

// 页面顶部显示测试模式提示
function mountTestBadge() {
  if (!isTestMode()) return;
  const el = document.createElement('div');
  el.textContent = '测试模式 · 点击退出';
  el.title = '点击退出测试模式（之后上传将记为正式实验）';
  el.style.cssText = [
    'position:fixed', 'top:12px', 'left:12px', 'z-index:9999',
    'background:#4a3a12', 'color:#ffd76a', 'border:2px solid #ffd76a',
    'padding:8px 14px', 'font-family:"Pixelify Sans","FusionPixel",monospace',
    'font-size:11px', 'letter-spacing:1px', 'cursor:pointer'
  ].join(';');
  el.addEventListener('click', () => {
    sessionStorage.removeItem('test_mode');
    el.remove();
  });
  document.body.appendChild(el);
}

window.addEventListener('load', mountTestBadge);

/**
 * 上传一次实验数据
 * @param {string} experiment - 'search' | 'route_change'
 * @param {string} participant - 匿名编号
 * @param {Array} trials - 正式试次数组
 * @param {Object} extraMeta - 额外元数据
 * @returns {Promise<Object>}
 */
async function uploadExperiment(experiment, participant, trials, extraMeta = {}) {
  const meta = {
    task_order: localStorage.getItem('task_order') || '',
    screen_w: window.screen.width,
    screen_h: window.screen.height,
    viewport_w: window.innerWidth,
    viewport_h: window.innerHeight,
    device_pixel_ratio: window.devicePixelRatio || 1,
    user_agent: navigator.userAgent.slice(0, 120),
    ...extraMeta,
  };

  const payload = {
    project: PROJECT_CODE,
    experiment: resolveExperiment(experiment),
    participant: participant,
    condition: '',
    trials: trials,
    meta: meta,
  };

  const res = await fetch(LAB_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json();

  if (!res.ok || data.ok === false) {
    throw new Error(data.msg || data.error || ('HTTP ' + res.status));
  }
  return data; // { ok:true, record_id, warnings? }
}

/**
 * 绑定上传按钮：上传成功后禁用按钮并显示结果
 * @param {string} buttonId
 * @param {string} statusId
 * @param {Function} getPayload - 返回 { experiment, participant, trials, meta }
 */
function bindUpload(buttonId, statusId, getPayload) {
  const btn = document.getElementById(buttonId);
  const status = document.getElementById(statusId);
  if (!btn || !status) return;

  btn.addEventListener('click', async () => {
    const { experiment, participant, trials, meta } = getPayload();

    if (!trials || trials.length === 0) {
      status.textContent = '没有可上传的正式试次。';
      return;
    }

    btn.disabled = true;
    status.textContent = '正在上传…';

    try {
      const result = await uploadExperiment(experiment, participant, trials, meta);

      let msg = `上传成功：${trials.length} 条记录`;
      if (result.record_id) msg += `（记录号 ${result.record_id}）`;
      if (isTestMode()) msg += '\n当前为测试模式，数据记为 test_ 前缀，不会进入正式汇总。';

      if (result.warnings && result.warnings.length) {
        msg += '\n注意：后台报告了字段警告，请检查数据格式：\n' + result.warnings.join('\n');
        console.warn('上传警告：', result.warnings, result.warning_details);
      }

      status.textContent = msg;
      status.style.color = '#6ad48a';
    } catch (err) {
      console.error(err);
      status.textContent = `上传失败：${err.message}\n请检查网络后重试，或先下载 JSON 备份。`;
      status.style.color = '#ef7b7b';
      btn.disabled = false;
    }
  });
}

/* 页面流程控制：开屏 → 同意 → 编号 → 实验 → 结果 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const screens = {
    welcome: $('screen-welcome'),
    consent: $('screen-consent'),
    participant: $('screen-participant'),
    experiment: $('screen-experiment'),
    result: $('screen-result')
  };

  let current = 'welcome';
  const participantId = { value: '' };

  function show(name) {
    Object.keys(screens).forEach((k) => screens[k].classList.remove('active'));
    screens[name].classList.add('active');
    current = name;
  }

  // 开屏
  $('btn-to-consent').addEventListener('click', () => show('consent'));

  // 同意
  const consentCheck = $('consent-check');
  const consentOk = $('btn-consent-ok');
  consentCheck.addEventListener('change', () => {
    consentOk.disabled = !consentCheck.checked;
  });
  consentOk.addEventListener('click', () => {
    if (!consentCheck.checked) return;
    show('participant');
    $('participant-id').focus();
  });
  $('btn-consent-back').addEventListener('click', () => show('welcome'));

  // 编号
  const pidInput = $('participant-id');
  const pidErr = $('participant-error');
  function validatePid() {
    const v = pidInput.value.trim();
    if (!v) {
      pidErr.classList.remove('hidden');
      return false;
    }
    pidErr.classList.add('hidden');
    participantId.value = v;
    return true;
  }
  pidInput.addEventListener('input', () => pidErr.classList.add('hidden'));
  $('btn-participant-ok').addEventListener('click', () => {
    if (!validatePid()) return;
    // 保存匿名编号，供两个实验共用
    localStorage.setItem('participant_id', participantId.value);
    // 清除上一轮的实验数据，避免混淆
    localStorage.removeItem('exp1_results');
    localStorage.removeItem('exp1_practice');
    localStorage.removeItem('exp1_done');
    localStorage.removeItem('exp2_done');
    // 进入实验顺序选择页
    window.location.href = 'select.html';
  });
  pidInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('btn-participant-ok').click();
  });
  $('btn-participant-back').addEventListener('click', () => show('consent'));

  // 结果
  $('btn-result-again').addEventListener('click', () => {
    consentCheck.checked = false;
    consentOk.disabled = true;
    pidInput.value = '';
    show('welcome');
  });

  // 暴露接口供实验模块调用
  window.EXP = {
    show,
    get current() { return current; },
    get participantId() { return participantId.value; },
    goResult: function (summaryText) {
      $('result-text').textContent = '感谢您的参与！本次数据已记录。';
      $('result-summary').innerHTML = summaryText || '';
      show('result');
    },
    CONFIG: typeof CONFIG !== 'undefined' ? CONFIG : null
  };
})();

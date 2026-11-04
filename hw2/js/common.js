/**
 * 守灯者：风暴夜班 - 公共模块
 * 提供计时、数据上传、随机化和工具函数
 */

// ============================================================================
// 配置常量
// ============================================================================
const CONFIG = {
  PROJECT_CODE: '9JRP59',
  API_ENDPOINT: 'https://attention-lab-production.up.railway.app',
  RETRY_TIMES: 3,
  RETRY_DELAY: 1000, // 毫秒
};

// ============================================================================
// 1. 计时系统
// ============================================================================

/**
 * 开始计时
 * @returns {number} 起始时间戳（毫秒）
 */
function startTiming() {
  return performance.now();
}

/**
 * 结束计时
 * @param {number} startTime - 起始时间戳
 * @returns {number} 经过的毫秒数
 */
function endTiming(startTime) {
  return performance.now() - startTime;
}

// ============================================================================
// 2. 数据上传系统
// ============================================================================

/**
 * 上传实验数据到注意实验室
 * @param {string} experiment - 实验名称 ('search' 或 'route_change')
 * @param {string} participant - 被试编号 (如 'P01')
 * @param {Array} trials - 试次数据数组
 * @param {Object} meta - 元数据对象
 * @returns {Promise<Object>} 上传结果
 */
async function submitData(experiment, participant, trials, meta) {
  const data = {
    project: CONFIG.PROJECT_CODE,
    experiment: experiment,
    participant: participant,
    trials: trials,
    meta: meta
  };

  // 尝试上传，包含重试机制
  for (let attempt = 1; attempt <= CONFIG.RETRY_TIMES; attempt++) {
    try {
      const response = await fetch(`${CONFIG.API_ENDPOINT}/api/data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data)
      });

      const result = await response.json();

      // 检查响应状态
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('PROJECT_NOT_FOUND');
        } else {
          throw new Error(`HTTP ${response.status}: ${result.error || '未知错误'}`);
        }
      }

      // 检查 warnings
      if (result.warnings && result.warnings.length > 0) {
        console.warn('数据上传成功，但有以下警告：');
        result.warnings.forEach((warning, index) => {
          console.warn(`  ${index + 1}. ${warning}`);
        });
        showWarningMessage(result.warnings);
      }

      console.log('数据上传成功！', result);
      return result;

    } catch (error) {
      console.error(`上传尝试 ${attempt}/${CONFIG.RETRY_TIMES} 失败:`, error);

      // 如果是最后一次尝试，显示错误界面
      if (attempt === CONFIG.RETRY_TIMES) {
        showUploadError(error, data);
        throw error;
      }

      // 等待后重试
      await sleep(CONFIG.RETRY_DELAY * attempt);
    }
  }
}

/**
 * 显示上传错误界面
 * @param {Error} error - 错误对象
 * @param {Object} data - 要上传的数据
 */
function showUploadError(error, data) {
  let errorMessage = '';

  if (error.message === 'PROJECT_NOT_FOUND') {
    errorMessage = '项目码不存在，请联系作者';
  } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
    errorMessage = '网络连接失败，请检查网络后重试';
  } else {
    errorMessage = `上传失败：${error.message}`;
  }

  // 创建错误提示界面
  const errorDiv = document.createElement('div');
  errorDiv.id = 'upload-error';
  errorDiv.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: white;
    padding: 30px;
    border-radius: 10px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    z-index: 10000;
    max-width: 500px;
    text-align: center;
  `;

  errorDiv.innerHTML = `
    <h2 style="color: #e74c3c; margin-bottom: 20px;">❌ 数据上传失败</h2>
    <p style="margin-bottom: 30px; font-size: 16px;">${errorMessage}</p>
    <div style="display: flex; gap: 15px; justify-content: center;">
      <button id="retry-upload" style="
        padding: 12px 24px;
        font-size: 16px;
        background: #3498db;
        color: white;
        border: none;
        border-radius: 5px;
        cursor: pointer;
      ">🔄 重试上传</button>
      <button id="download-backup" style="
        padding: 12px 24px;
        font-size: 16px;
        background: #27ae60;
        color: white;
        border: none;
        border-radius: 5px;
        cursor: pointer;
      ">💾 下载备份JSON</button>
    </div>
  `;

  document.body.appendChild(errorDiv);

  // 绑定按钮事件
  document.getElementById('retry-upload').addEventListener('click', () => {
    document.body.removeChild(errorDiv);
    submitData(data.experiment, data.participant, data.trials, data.meta);
  });

  document.getElementById('download-backup').addEventListener('click', () => {
    const filename = `${data.experiment}_${data.participant}_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    downloadJSON(data, filename);
  });
}

/**
 * 显示警告信息
 * @param {Array<string>} warnings - 警告信息数组
 */
function showWarningMessage(warnings) {
  const warningDiv = document.createElement('div');
  warningDiv.id = 'upload-warning';
  warningDiv.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #fff3cd;
    border: 2px solid #ffc107;
    padding: 20px;
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    z-index: 10000;
    max-width: 400px;
  `;

  warningDiv.innerHTML = `
    <h3 style="color: #856404; margin: 0 0 10px 0;">⚠️ 数据已上传，但有警告</h3>
    <ul style="margin: 0; padding-left: 20px; color: #856404;">
      ${warnings.map(w => `<li>${w}</li>`).join('')}
    </ul>
    <button id="close-warning" style="
      margin-top: 15px;
      padding: 8px 16px;
      background: #ffc107;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    ">关闭</button>
  `;

  document.body.appendChild(warningDiv);

  document.getElementById('close-warning').addEventListener('click', () => {
    document.body.removeChild(warningDiv);
  });

  // 10秒后自动关闭
  setTimeout(() => {
    if (document.getElementById('upload-warning')) {
      document.body.removeChild(warningDiv);
    }
  }, 10000);
}

/**
 * 下载数据为JSON文件
 * @param {Object} data - 要下载的数据
 * @param {string} filename - 文件名
 */
function downloadJSON(data, filename) {
  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  console.log(`备份已下载: ${filename}`);
}

/**
 * 延迟函数
 * @param {number} ms - 毫秒数
 * @returns {Promise}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// 3. 随机化工具
// ============================================================================

/**
 * Fisher-Yates 洗牌算法
 * @param {Array} array - 要洗牌的数组（会被修改）
 * @returns {Array} 洗牌后的数组
 */
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * 生成无重叠的随机位置
 * @param {number} count - 需要生成的位置数量
 * @param {number} width - 区域宽度
 * @param {number} height - 区域高度
 * @param {number} minDistance - 最小间距
 * @returns {Array<{x: number, y: number}>} 位置数组
 */
function generateLayout(count, width, height, minDistance) {
  const positions = [];
  const maxAttempts = 1000;

  for (let i = 0; i < count; i++) {
    let attempts = 0;
    let validPosition = false;
    let x, y;

    while (!validPosition && attempts < maxAttempts) {
      x = Math.random() * width;
      y = Math.random() * height;

      // 检查与已有位置的距离
      validPosition = positions.every(pos => {
        return distance(x, y, pos.x, pos.y) >= minDistance;
      });

      attempts++;
    }

    if (validPosition) {
      positions.push({ x, y });
    } else {
      console.warn(`无法为第 ${i + 1} 个位置找到合适的坐标（最小间距: ${minDistance}）`);
    }
  }

  return positions;
}

/**
 * 根据被试编号返回区块顺序
 * @param {string} participantId - 被试编号 (如 'P01')
 * @returns {string} 区块顺序 ('search_first' 或 'route_first')
 */
function getBlockOrder(participantId) {
  // 提取编号数字部分
  const match = participantId.match(/\d+/);
  if (!match) {
    console.warn(`无效的被试编号: ${participantId}，使用默认顺序`);
    return 'search_first';
  }

  const num = parseInt(match[0], 10);

  // 奇数被试: search_first, 偶数被试: route_first
  return num % 2 === 1 ? 'search_first' : 'route_first';
}

// ============================================================================
// 4. 工具函数
// ============================================================================

/**
 * 计算两点之间的欧几里得距离
 * @param {number} x1 - 第一个点的x坐标
 * @param {number} y1 - 第一个点的y坐标
 * @param {number} x2 - 第二个点的x坐标
 * @param {number} y2 - 第二个点的y坐标
 * @returns {number} 距离
 */
function distance(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 判断点是否在矩形内
 * @param {number} x - 点的x坐标
 * @param {number} y - 点的y坐标
 * @param {number} rectX - 矩形左上角x坐标
 * @param {number} rectY - 矩形左上角y坐标
 * @param {number} rectW - 矩形宽度
 * @param {number} rectH - 矩形高度
 * @returns {boolean} 是否在矩形内
 */
function isInRect(x, y, rectX, rectY, rectW, rectH) {
  return x >= rectX && x <= rectX + rectW &&
         y >= rectY && y <= rectY + rectH;
}

/**
 * 等待下一帧
 * @returns {Promise} 在下一帧resolve的Promise
 */
function waitForFrame() {
  return new Promise(resolve => {
    requestAnimationFrame(resolve);
  });
}

/**
 * 获取设备信息
 * @returns {Object} 设备元数据
 */
function getDeviceMeta() {
  return {
    screen_w: window.screen.width,
    screen_h: window.screen.height,
    viewport_w: window.innerWidth,
    viewport_h: window.innerHeight,
    device_pixel_ratio: window.devicePixelRatio || 1,
    user_agent: getUserAgentShort()
  };
}

/**
 * 获取简化的用户代理字符串
 * @returns {string} 简化的user agent
 */
function getUserAgentShort() {
  const ua = navigator.userAgent;

  // 提取浏览器和版本信息
  let browser = 'Unknown';
  let version = '';

  if (ua.includes('Chrome') && !ua.includes('Edg')) {
    browser = 'Chrome';
    version = ua.match(/Chrome\/(\d+)/)?.[1] || '';
  } else if (ua.includes('Safari') && !ua.includes('Chrome')) {
    browser = 'Safari';
    version = ua.match(/Version\/(\d+)/)?.[1] || '';
  } else if (ua.includes('Firefox')) {
    browser = 'Firefox';
    version = ua.match(/Firefox\/(\d+)/)?.[1] || '';
  } else if (ua.includes('Edg')) {
    browser = 'Edge';
    version = ua.match(/Edg\/(\d+)/)?.[1] || '';
  }

  // 提取操作系统
  let os = 'Unknown';
  if (ua.includes('Win')) os = 'Windows';
  else if (ua.includes('Mac')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iOS') || ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

  return `${browser}/${version} (${os})`;
}

// ============================================================================
// 导出（用于模块化环境，浏览器环境下函数已在全局作用域）
// ============================================================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    startTiming,
    endTiming,
    submitData,
    downloadJSON,
    shuffle,
    generateLayout,
    getBlockOrder,
    distance,
    isInRect,
    waitForFrame,
    getDeviceMeta
  };
}

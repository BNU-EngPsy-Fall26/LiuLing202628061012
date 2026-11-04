/**
 * 守灯者：风暴夜班 - 配置文件
 * 工程心理学作业二 - 注意实验
 */

// ==================== 项目配置 ====================
const CONFIG = {
  // 项目码（公开，写入网页）
  PROJECT_CODE: '9JRP59',

  // 注意实验室后台地址
  LAB_URL: 'https://attention-lab-production.up.railway.app',

  // 实验名称（用于区分两个实验）
  EXPERIMENTS: {
    SEARCH: 'search',           // 视觉搜索实验
    CHANGE: 'route_change'      // 变化检测实验
  },

  // ==================== 视觉搜索实验配置 ====================
  SEARCH: {
    // 试次数量
    PRACTICE_TRIALS: 8,         // 练习试次
    TRIALS_PER_BLOCK: 20,       // 每个区块的正式试次
    BLOCKS: 4,                   // 区块数量
    TOTAL_TRIALS: 80,            // 总正式试次 (8 条件 × 10)

    // 时间参数（毫秒）
    FIXATION_DURATION: 500,      // 注视点持续时间
    MAX_RESPONSE_TIME: 4000,     // 最长反应时间
    ITI_DURATION: 600,           // 试次间隔（Inter-Trial Interval）

    // 刺激参数
    SET_SIZES: [8, 24],          // 集合大小
    TARGET_SIZE: 30,             // 信号灯大小（像素）
    MIN_DISTANCE: 60,            // 信号灯最小间距（像素）

    // 舞台尺寸
    STAGE_WIDTH: 1600,
    STAGE_HEIGHT: 900,

    // 颜色对比度 - 低对比度
    LOW_CONTRAST: {
      ORANGE: 'hsl(30, 60%, 55%)',   // 中等饱和度橙色
      BLUE: 'hsl(210, 60%, 55%)',    // 中等饱和度蓝色
      FOG_OPACITY: 0.15               // 可选雾层透明度
    },

    // 颜色对比度 - 高对比度
    HIGH_CONTRAST: {
      ORANGE: 'hsl(30, 85%, 60%)',   // 高饱和度橙色
      BLUE: 'hsl(210, 85%, 60%)',    // 高饱和度蓝色
      FOG_OPACITY: 0.05               // 可选雾层透明度（基本不可见）
    },

    // 按键配置
    KEYS: {
      TARGET_PRESENT: 'f',     // 有目标
      TARGET_ABSENT: 'j'       // 无目标
    },

    // 区块顺序（拉丁方，根据被试编号选择）
    BLOCK_ORDERS: [
      [1, 2, 3, 4],  // 顺序1: 特征低 → 特征高 → 联合低 → 联合高
      [2, 3, 4, 1],  // 顺序2
      [3, 4, 1, 2],  // 顺序3
      [4, 1, 2, 3]   // 顺序4
    ]
  },

  // ==================== 变化检测实验配置 ====================
  CHANGE: {
    // 试次数量
    PRACTICE_TRIALS: 6,          // 练习试次
    TRIALS_PER_BLOCK: 24,        // 每个区块的正式试次
    BLOCKS: 2,                    // 区块数量
    TOTAL_TRIALS: 48,             // 总正式试次 (2 × 24)
    CHANGE_TRIALS: 40,            // 有变化试次
    NO_CHANGE_TRIALS: 8,          // 无变化试次

    // 时间参数（毫秒）
    INITIAL_DISPLAY: 500,         // 初始基准帧持续时间
    BLANK_DURATION: 120,          // 空白持续时间
    MAX_RESPONSE_TIME: 12000,     // 最长反应时间

    // 舞台尺寸
    STAGE_WIDTH: 1600,
    STAGE_HEIGHT: 900,

    // 海图参数
    ROUTE_COUNT: 6,               // 航线数量
    VESSEL_COUNT: 12,             // 船只标记数量
    HAZARD_COUNT: 6,              // 危险标记数量

    // 变化幅度（像素）
    ROUTE_CHANGE_MIN: 20,         // 航路点最小移动距离
    ROUTE_CHANGE_MAX: 30,         // 航路点最大移动距离
    VESSEL_CHANGE_MIN: 24,        // 船只最小移动距离
    VESSEL_CHANGE_MAX: 32,        // 船只最大移动距离

    // 变化位置定义（距舞台中心的距离，像素）
    CENTRAL_MAX_DISTANCE: 150,    // 中央位置：距中心不超过150像素
    PERIPHERAL_MIN_DISTANCE: 280, // 边缘位置：距中心280-600像素
    PERIPHERAL_MAX_DISTANCE: 600,

    // 命中判定半径（像素）
    HIT_RADIUS: {
      ROUTE: 30,      // 航线变化
      VESSEL: 35,     // 船位变化
      HAZARD: 35      // 危险标记变化
    },

    // 按键配置
    KEYS: {
      NO_CHANGE: 'n'  // 无变化
    },

    // 色彩方案
    COLORS: {
      SEA: '#2B5F7F',           // 青蓝海水
      LAND: '#D4BC8E',          // 暖米黄陆地
      COAST: '#1A3A52',         // 深蓝灰海岸线
      ROUTE: '#4A7BA7',         // 航线颜色
      VESSEL: '#C8A44A',        // 船只颜色
      HAZARD_SAFE: '#4A9B6F',   // 安全标记（绿）
      HAZARD_DANGER: '#B34A4A', // 危险标记（红）
      GRID: 'rgba(200, 164, 74, 0.3)'  // 方位网格（低透明度琥珀色）
    }
  },

  // ==================== 通用配置 ====================
  GENERAL: {
    // 任务顺序（两种，根据被试编号选择）
    TASK_ORDERS: [
      'search_first',        // 先搜索，后变化检测
      'change_first'         // 先变化检测，后搜索
    ],

    // 数据上传配置
    UPLOAD: {
      RETRY_TIMES: 3,        // 失败重试次数
      RETRY_DELAY: 2000      // 重试延迟（毫秒）
    }
  }
};

// 导出配置（用于其他JS文件引用）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}

/* ============================================================================
 * js/store.js —— 全局会话状态（唯一真源，实现 CONTRACT.md 第 5.3 节）
 *
 * 【为什么 student / mode / rounds 三样必须集中放这里】
 *   它们是"跨模块"的数据，不是某一个模块的私事：
 *     student → M2 写、M3 读、M6 写进 Session、M8 显示
 *     mode    → M3 写、M6 读（决定每轮几个试次）、M8 读（算 SDT 要 nSignal/nNoise）
 *     rounds  → M6 写、M8 读、M10（ROC 曲线）读
 *   五个模块共享同一批数据。如果各模块自己开个全局变量存一份，
 *   早晚会对不上，而且这种 bug 最难查——程序不报错，只是默默用错值，
 *   等你看出来时，"三轮 d′ 相同"这个教学点已经塌了。
 *
 *   判断标准：两个以上模块要读它 → 放 Store；
 *             只有一个模块自己用 → 放那个模块自己的局部变量，别污染 Store。
 * ==========================================================================*/

window.Store = (function () {
  'use strict';

  return {

    /* ------------------------------------------------------------------------
     * 字段（契约规定就这三个，不多不少）
     * ---------------------------------------------------------------------- */

    student: null,   // { id, name } | null；游客模式下 name 为 null
    mode: null,      // 'standard' | 'quick'
    rounds: [],      // RoundResult[]（见契约 4.3），一场实验最多 3 个

    /* ------------------------------------------------------------------------
     * 学生
     * ---------------------------------------------------------------------- */

    // name 传 null / 空串 / 纯空格 → 游客模式（student.name 记 null）
    setStudent: function (id, name) {
      var isGuestName = (name === null || name === undefined ||
                         String(name).trim() === '');

      if (isGuestName) {
        this.student = {
          id: (id === null || id === undefined || String(id).trim() === '')
                ? null : String(id).trim(),
          name: null,
        };
        return;
      }

      this.student = {
        id: String(id).trim(),
        name: String(name).trim(),
      };
    },

    // 没登录过、或登录时走了游客入口 → 都是游客
    isGuest: function () {
      return !this.student || this.student.name === null;
    },

    /* ------------------------------------------------------------------------
     * 试次模式
     *
     * ⚠️ 这里宁可抛错也不"默默接受"：
     *   模式是 TRIAL_MODES 的 key，拼错了（比如 'Standard'、'fast'）
     *   会让 currentMode() 返回 undefined，接着 nSignal/nNoise 全变 undefined，
     *   最后 d′ 算出 NaN——一路不报错，直到结果页显示一片 NaN 才发现。
     *   当场抛错，出错位置一眼就能看到。
     * ---------------------------------------------------------------------- */

    setMode: function (modeKey) {
      var known = Object.prototype.hasOwnProperty.call(window.TRIAL_MODES, modeKey);

      if (!known) {
        throw new Error('未知的试次模式：' + modeKey +
                        '（只允许 ' + Object.keys(window.TRIAL_MODES).join(' / ') + '）');
      }

      this.mode = modeKey;
    },

    // → TRIAL_MODES[mode]；还没选过就返回 null（调用方自己决定兜底成哪个）
    currentMode: function () {
      if (this.mode === null || this.mode === undefined) return null;
      return window.TRIAL_MODES[this.mode];
    },

    /* ------------------------------------------------------------------------
     * 轮次结果
     *
     * 一场实验恒为三轮（契约第 1、6 节）。满了还往里塞，
     * 说明游戏状态机多跑了一轮——这是结构性错误，早抛早发现。
     * ---------------------------------------------------------------------- */

    pushRound: function (roundResult) {
      if (this.rounds.length >= 3) {
        throw new Error('一场实验只有三轮，不能再追加第 ' +
                        (this.rounds.length + 1) + ' 轮');
      }
      this.rounds.push(roundResult);
    },

    /* ------------------------------------------------------------------------
     * 只清 rounds，保留 student / mode（契约 5.3）
     *
     * 【和 reset() 的分工，很容易搞混】
     *   reset()       三个字段全清 —— 玩完一局回登录页时用
     *   clearRounds() 只清 rounds  —— 一局刚开始时用。
     *                 这时 student 和 mode 刚在登录页/说明页填好，
     *                 绝不能跟着一起清掉；但上一局的 rounds 必须清空，
     *                 否则第二轮实验会带着第一轮的数据，pushRound 还会
     *                 在第 4 个上抛错。
     *
     * 走方法而不是让调用方直接写 Store.rounds = []，是为了以后要加校验
     * （比如"正在跑一轮时不许清"）时有地方放。
     * ---------------------------------------------------------------------- */

    clearRounds: function () {
      this.rounds = [];
    },

    /* ------------------------------------------------------------------------
     * 重置：三个字段回到初始值（"重新开始"时调用）
     * rounds 换一个新数组，避免外部残留的旧引用跟着一起被清空
     * ---------------------------------------------------------------------- */

    reset: function () {
      this.student = null;
      this.mode = null;
      this.rounds = [];
    },

  };

})();

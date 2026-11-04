// 灯塔场景背景 - 参考低多边形风格，适用于所有前置页面
(function() {
  // 获取所有需要背景的Canvas
  const canvases = ['welcome-canvas', 'consent-canvas', 'participant-canvas', 'result-canvas', 'bgCanvas'];
  const contexts = [];

  canvases.forEach(id => {
    const canvas = document.getElementById(id);
    if (canvas) {
      contexts.push({
        canvas,
        ctx: canvas.getContext('2d'),
        width: 0,
        height: 0
      });
    }
  });

  if (contexts.length === 0) return;

  let beamAngle = 0;
  let time = 0;
  let stars = [];
  let seaSparkles = [];

  function resize() {
    contexts.forEach(c => {
      c.width = window.innerWidth;
      c.height = window.innerHeight;
      c.canvas.width = c.width;
      c.canvas.height = c.height;
    });

    // 初始化星星
    if (stars.length === 0) {
      const starCount = 60; // 更多星星
      for (let i = 0; i < starCount; i++) {
        stars.push({
          x: Math.random() * window.innerWidth,
          y: Math.random() * (window.innerHeight * 0.5), // 只在天空上半部分
          size: 2 + Math.random() * 3, // 更大的星星（2-5px）
          brightness: Math.random(),
          speed: 0.001 + Math.random() * 0.002 // 闪烁速度
        });
      }
    }

    // 初始化海面反光点（只有被灯塔扫到时才亮）
    seaSparkles = [];
    const w = window.innerWidth;
    const h = window.innerHeight;
    const horizon = h * 0.65;
    const count = 260;
    for (let i = 0; i < count; i++) {
      // 越靠近地平线越密（透视感）
      const t = Math.pow(Math.random(), 0.65);
      seaSparkles.push({
        x: Math.random() * w,
        y: horizon + 12 + t * (h - horizon - 12),
        len: (Math.random() < 0.25 ? 8 : 4),
        phase: Math.random() * Math.PI * 2,
        strength: 0.55 + Math.random() * 0.45
      });
    }
  }

  // ===== 灯塔扫过的海面反光点 =====
  function drawBeamSparkles(ctx, width, height, horizonY, angle) {
    const lightX = width * 0.18;
    const lightY = horizonY - height * 0.22;

    const halfSpread = Math.PI / 6;        // 光束 60° 扇形
    const maxDist = Math.hypot(width, height);

    ctx.save();
    seaSparkles.forEach(s => {
      const dx = s.x - lightX;
      const dy = s.y - lightY;

      // 与光束方向的夹角差，归一化到 [-π, π]
      let diff = Math.atan2(dy, dx) - angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;

      if (Math.abs(diff) > halfSpread) return; // 不在光束内不亮

      // 越靠近光束中心越亮
      const edge = 1 - Math.abs(diff) / halfSpread;
      const core = edge * edge;

      // 距离衰减
      const dist = Math.hypot(dx, dy);
      const atten = Math.max(0.2, 1 - dist / maxDist);

      // 轻微闪烁
      const flick = 0.75 + 0.25 * Math.sin(time * 2 + s.phase);

      const alpha = core * atten * flick * s.strength * 0.85;
      if (alpha < 0.02) return;

      ctx.fillStyle = `rgba(150, 205, 240, ${alpha.toFixed(3)})`;
      ctx.fillRect(Math.round(s.x / 4) * 4, Math.round(s.y / 4) * 4, s.len, 4);

      // 光束中心附近再加一个更亮的像素点
      if (core > 0.55) {
        ctx.fillStyle = `rgba(205, 238, 255, ${(alpha * 0.9).toFixed(3)})`;
        ctx.fillRect(Math.round(s.x / 4) * 4, Math.round(s.y / 4) * 4, 4, 4);
      }
    });
    ctx.restore();
  }

  // ===== 像素化网格纹理函数 =====
  function drawPixelGrid(ctx, width, height, offsetX = 0, offsetY = 0) {
    // 绘制像素化网格纹理（模拟Beamward的像素感）- 棋盘格
    ctx.save();
    ctx.globalAlpha = 0.20; // 透明度20%，明显可见
    ctx.fillStyle = '#000';

    const gridSize = 8; // 8px网格块
    for (let x = 0; x < width; x += gridSize) {
      for (let y = 0; y < height; y += gridSize) {
        // 棋盘格模式
        if ((Math.floor(x / gridSize) + Math.floor(y / gridSize)) % 2 === 0) {
          ctx.fillRect(offsetX + x, offsetY + y, gridSize, gridSize);
        }
      }
    }
    ctx.restore();
  }

  function drawScene(ctx, width, height) {
    // 1. 天空层（黄昏/夜晚渐变）
    const skyGradient = ctx.createLinearGradient(0, 0, width, height * 0.5);
    skyGradient.addColorStop(0, '#1a1f2e');  // 深蓝
    skyGradient.addColorStop(0.3, '#222836'); // 中蓝
    skyGradient.addColorStop(0.6, '#2a3242'); // 暖灰
    skyGradient.addColorStop(1, '#3a4556');   // 暖黄
    ctx.fillStyle = skyGradient;
    ctx.fillRect(0, 0, width, height * 0.65);

    // 添加像素化网格纹理
    drawPixelGrid(ctx, width, height * 0.65);

    // 1.5 绘制闪烁的星星
    drawStars(ctx);

    // 2. 远处岛屿群剪影（从左到右断断续续）
    drawDistantIslands(ctx, width, height);

    // 3. 太阳/月亮（缩小，位置更高）
    const sunX = width * 0.88;
    const sunY = height * 0.2;
    const sunRadius = Math.min(width, height) * 0.04;

    // 光晕（减弱）
    const glowGradient = ctx.createRadialGradient(sunX, sunY, sunRadius * 0.2, sunX, sunY, sunRadius * 2.5);
    glowGradient.addColorStop(0, 'rgba(200, 200, 220, 0.3)');
    glowGradient.addColorStop(0.5, 'rgba(180, 180, 200, 0.1)');
    glowGradient.addColorStop(1, 'rgba(160, 160, 180, 0)');
    ctx.fillStyle = glowGradient;
    ctx.fillRect(sunX - sunRadius * 2.5, sunY - sunRadius * 2.5, sunRadius * 5, sunRadius * 5);

    // 太阳本体
    ctx.fillStyle = '#c8c8d4';
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunRadius, 0, Math.PI * 2);
    ctx.fill();

    // 4. 海面（渐变）
    const horizonY = height * 0.65;
    const seaGradient = ctx.createLinearGradient(0, horizonY, 0, height);
    seaGradient.addColorStop(0, '#1a2028');
    seaGradient.addColorStop(0.5, '#0f1820');
    seaGradient.addColorStop(1, '#0a1218');
    ctx.fillStyle = seaGradient;
    ctx.fillRect(0, horizonY, width, height - horizonY);

    // 添加海面像素化纹理
    drawPixelGrid(ctx, width, height - horizonY, 0, horizonY);

    // 灯塔扫过的海面反光点（在岛屿与船只之前绘制）
    drawBeamSparkles(ctx, width, height, horizonY, beamAngle);

    // 5. 左侧悬崖/岛屿（删除岛上的三角形树木）
    drawCliffIsland(ctx, width, height, horizonY);

    // 6. 灯塔（左侧岛屿顶部）
    drawLighthouse(ctx, width, height, horizonY);

    // 7. 灯塔光束（旋转）
    drawLightBeam(ctx, width * 0.18, horizonY - height * 0.22, beamAngle);

    // 8. 海面元素：大量船只+礁石
    drawSeaElements(ctx, width, height, horizonY);

    // 更新动画参数
    beamAngle += 0.008;
    time += 0.01;
  }

  function drawDistantIslands(ctx, width, height) {
    // 从左到右断断续续的远处岛屿群剪影
    const horizonY = height * 0.65;
    const islandBaseY = horizonY - height * 0.05; // 更低的基准线

    ctx.fillStyle = 'rgba(42, 52, 62, 0.8)'; // 半透明深蓝

    // 左侧岛屿组（中等高度）
    ctx.beginPath();
    ctx.moveTo(width * 0.35, horizonY);
    ctx.lineTo(width * 0.36, islandBaseY - 5);
    ctx.lineTo(width * 0.38, islandBaseY - 12);
    ctx.lineTo(width * 0.42, islandBaseY - 8);
    ctx.lineTo(width * 0.45, islandBaseY - 3);
    ctx.lineTo(width * 0.46, horizonY);
    ctx.closePath();
    ctx.fill();

    // 中间岛屿组1（较矮）
    ctx.beginPath();
    ctx.moveTo(width * 0.52, horizonY);
    ctx.lineTo(width * 0.53, islandBaseY + 2);
    ctx.lineTo(width * 0.56, islandBaseY - 5);
    ctx.lineTo(width * 0.58, islandBaseY - 3);
    ctx.lineTo(width * 0.60, horizonY);
    ctx.closePath();
    ctx.fill();

    // 中间岛屿组2（较高）
    ctx.beginPath();
    ctx.moveTo(width * 0.64, horizonY);
    ctx.lineTo(width * 0.65, islandBaseY - 8);
    ctx.lineTo(width * 0.68, islandBaseY - 18);
    ctx.lineTo(width * 0.72, islandBaseY - 12);
    ctx.lineTo(width * 0.74, horizonY);
    ctx.closePath();
    ctx.fill();

    // 右侧岛屿组（中等高度）
    ctx.beginPath();
    ctx.moveTo(width * 0.80, horizonY);
    ctx.lineTo(width * 0.81, islandBaseY - 2);
    ctx.lineTo(width * 0.84, islandBaseY - 10);
    ctx.lineTo(width * 0.88, islandBaseY - 7);
    ctx.lineTo(width * 0.92, islandBaseY - 1);
    ctx.lineTo(width * 0.93, horizonY);
    ctx.closePath();
    ctx.fill();

    // 远岛屿组（最矮）
    ctx.fillStyle = 'rgba(38, 48, 58, 0.6)';
    ctx.beginPath();
    ctx.moveTo(width * 0.95, horizonY);
    ctx.lineTo(width * 0.96, islandBaseY + 5);
    ctx.lineTo(width * 0.98, islandBaseY + 3);
    ctx.lineTo(width, islandBaseY + 6);
    ctx.lineTo(width, horizonY);
    ctx.closePath();
    ctx.fill();

    // 删除所有树林剪影
  }

  function drawStars(ctx) {
    // 绘制大而闪烁的星星
    const now = Date.now();
    stars.forEach(star => {
      // 计算闪烁亮度（正弦波动画）
      star.brightness = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(now * star.speed));

      ctx.fillStyle = `rgba(255, 255, 255, ${star.brightness})`;

      // 绘制星星主体（方形）
      ctx.fillRect(star.x, star.y, star.size, star.size);

      // 如果亮度高，绘制十字光芒
      if (star.brightness > 0.6) {
        const glowSize = star.size * 1.5;
        // 水平光芒
        ctx.fillRect(star.x - glowSize, star.y + star.size / 2 - 1, glowSize * 3, 2);
        // 垂直光芒
        ctx.fillRect(star.x + star.size / 2 - 1, star.y - glowSize, 2, glowSize * 3);
      }
    });
  }

  function drawSeaElements(ctx, width, height, horizonY) {
    // 大量船只和礁石，从远到近，从左到右

    // === 远景层（最远，小且半透明）===
    ctx.save();
    ctx.globalAlpha = 0.3;
    drawBoat(ctx, width * 0.38, horizonY + height * 0.02, 0.25);
    drawBoat(ctx, width * 0.58, horizonY + height * 0.025, 0.28);
    drawBoat(ctx, width * 0.78, horizonY + height * 0.018, 0.22);
    drawBoat(ctx, width * 0.88, horizonY + height * 0.022, 0.26);
    ctx.restore();

    // === 中远景层 ===
    ctx.save();
    ctx.globalAlpha = 0.5;
    drawBoat(ctx, width * 0.32, horizonY + height * 0.04, 0.35);
    drawBoat(ctx, width * 0.48, horizonY + height * 0.05, 0.4);
    drawBoat(ctx, width * 0.65, horizonY + height * 0.045, 0.38);
    drawBoat(ctx, width * 0.82, horizonY + height * 0.038, 0.36);
    drawRocks(ctx, width * 0.55, horizonY + height * 0.03, 0.51);
    drawRocks(ctx, width * 0.72, horizonY + height * 0.025, 0.44);
    ctx.restore();

    // === 中景层 ===
    ctx.save();
    ctx.globalAlpha = 0.7;
    drawBoat(ctx, width * 0.25, horizonY + height * 0.08, 0.5);
    drawBoat(ctx, width * 0.42, horizonY + height * 0.09, 0.55);
    drawBoat(ctx, width * 0.60, horizonY + height * 0.085, 0.52);
    drawBoat(ctx, width * 0.75, horizonY + height * 0.075, 0.48);
    drawRocks(ctx, width * 0.35, horizonY + height * 0.07, 0.77);
    drawRocks(ctx, width * 0.68, horizonY + height * 0.06, 0.68);
    ctx.restore();

    // === 前景层（最近，完全不透明）===
    drawBoat(ctx, width * 0.12, horizonY + height * 0.15);
    drawBoat(ctx, width * 0.22, horizonY + height * 0.18, 0.85);
    drawBoat(ctx, width * 0.45, horizonY + height * 0.16, 0.9);
    drawBoat(ctx, width * 0.62, horizonY + height * 0.14, 0.8);
    drawBoat(ctx, width * 0.80, horizonY + height * 0.17, 0.88);
    drawRocks(ctx, width * 0.18, horizonY + height * 0.13, 2.4);
    drawRocks(ctx, width * 0.38, horizonY + height * 0.12, 2.16);
    drawRocks(ctx, width * 0.70, horizonY + height * 0.11, 1.99);
    drawRocks(ctx, width * 0.52, horizonY + height * 0.10, 1.74);
  }

  function drawWaterReflection(ctx, width, height, horizonY, t) {
    // 太阳在水面的反光（波纹状）
    ctx.fillStyle = 'rgba(255, 200, 100, 0.15)';
    const reflectX = width * 0.85;
    const reflectStartY = horizonY + 20;
    for (let i = 0; i < 10; i++) {
      const y = reflectStartY + i * 25;
      const waveOffset = Math.sin(t + i * 0.5) * 15;
      const waveWidth = 60 - i * 3;
      ctx.fillRect(reflectX + waveOffset - waveWidth / 2, y, waveWidth, 8);
    }
  }

  function drawCliffIsland(ctx, width, height, horizonY) {
    // 左侧悬崖岛屿（多边形块状）
    const islandX = width * 0.05;
    const islandTop = horizonY - height * 0.25;

    ctx.fillStyle = '#242b35';
    ctx.beginPath();
    ctx.moveTo(islandX, horizonY);
    ctx.lineTo(islandX + 50, islandTop + 80);
    ctx.lineTo(islandX + 80, islandTop + 40);
    ctx.lineTo(islandX + 120, islandTop + 20);
    ctx.lineTo(islandX + 180, islandTop + 60);
    ctx.lineTo(islandX + 220, islandTop + 100);
    ctx.lineTo(islandX + 250, horizonY);
    ctx.lineTo(islandX, horizonY);
    ctx.closePath();
    ctx.fill();

    // 岛屿暗面（增强立体感）
    ctx.fillStyle = '#1a2028';
    ctx.beginPath();
    ctx.moveTo(islandX + 120, islandTop + 20);
    ctx.lineTo(islandX + 120, horizonY);
    ctx.lineTo(islandX, horizonY);
    ctx.lineTo(islandX + 50, islandTop + 80);
    ctx.closePath();
    ctx.fill();
  }

  function drawLighthouse(ctx, width, height, horizonY) {
    // 灯塔位置：左侧岛屿顶部
    const lightX = width * 0.18;
    const lightY = horizonY - height * 0.22;
    const towerWidth = 28;
    const towerHeight = 100;

    // 塔身底座（深灰）
    ctx.fillStyle = '#5a6268';
    ctx.fillRect(lightX - towerWidth / 2 - 5, lightY + towerHeight - 15, towerWidth + 10, 15);

    // 塔身主体（白色+红色条纹）
    ctx.fillStyle = '#d8d8d8';
    ctx.fillRect(lightX - towerWidth / 2, lightY, towerWidth, towerHeight);

    // 红色条纹
    ctx.fillStyle = '#c84a4a';
    ctx.fillRect(lightX - towerWidth / 2, lightY + 18, towerWidth, 16);
    ctx.fillRect(lightX - towerWidth / 2, lightY + 50, towerWidth, 16);
    ctx.fillRect(lightX - towerWidth / 2, lightY + 82, towerWidth, 16);

    // 顶部灯室平台（深灰）
    ctx.fillStyle = '#4a5258';
    ctx.fillRect(lightX - towerWidth / 2 - 3, lightY - 8, towerWidth + 6, 8);

    // 灯室主体（琥珀色发光）
    const lampGradient = ctx.createRadialGradient(lightX, lightY - 18, 5, lightX, lightY - 18, 20);
    lampGradient.addColorStop(0, '#fffacd');
    lampGradient.addColorStop(0.6, '#f4d084');
    lampGradient.addColorStop(1, '#C8A44A');
    ctx.fillStyle = lampGradient;
    ctx.fillRect(lightX - towerWidth / 2 - 2, lightY - 28, towerWidth + 4, 20);

    // 灯室顶部（深色）
    ctx.fillStyle = '#242b35';
    ctx.beginPath();
    ctx.moveTo(lightX, lightY - 38);
    ctx.lineTo(lightX - towerWidth / 2 - 3, lightY - 28);
    ctx.lineTo(lightX + towerWidth / 2 + 3, lightY - 28);
    ctx.closePath();
    ctx.fill();

    // 强烈光晕（大范围发光）
    const outerGlow = ctx.createRadialGradient(lightX, lightY - 18, 10, lightX, lightY - 18, 80);
    outerGlow.addColorStop(0, 'rgba(255, 250, 200, 0.6)');
    outerGlow.addColorStop(0.3, 'rgba(255, 235, 150, 0.3)');
    outerGlow.addColorStop(1, 'rgba(255, 220, 100, 0)');
    ctx.fillStyle = outerGlow;
    ctx.fillRect(lightX - 80, lightY - 98, 160, 160);
  }

  function drawLightBeam(ctx, x, y, angle) {
    // 旋转的扇形光束
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    const beamLength = Math.max(window.innerWidth, window.innerHeight) * 0.8;
    const beamSpread = Math.PI / 6; // 60度扇形

    const beamGradient = ctx.createLinearGradient(0, 0, beamLength, 0);
    beamGradient.addColorStop(0, 'rgba(255, 250, 200, 0.4)');
    beamGradient.addColorStop(0.3, 'rgba(255, 235, 150, 0.2)');
    beamGradient.addColorStop(1, 'rgba(255, 220, 100, 0)');

    ctx.fillStyle = beamGradient;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, beamLength, -beamSpread / 2, beamSpread / 2);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawBoat(ctx, x, y, scale = 1) {
    // 与实验一相同的船形轮廓：宽船体 + 船舱 + 桅杆 + 顶端灯
    // 但用平滑路径绘制，不使用像素方块，避免背景过度像素化
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);

    // 船体（对称弧形底）
    const hull = ctx.createLinearGradient(0, -16, 0, 2);
    hull.addColorStop(0, '#5a4230');
    hull.addColorStop(0.55, '#463125');
    hull.addColorStop(1, '#2b1d15');
    ctx.fillStyle = hull;
    ctx.beginPath();
    ctx.moveTo(-30, 0);
    ctx.quadraticCurveTo(-29, -13, -13, -16);
    ctx.lineTo(13, -16);
    ctx.quadraticCurveTo(29, -13, 30, 0);
    ctx.closePath();
    ctx.fill();

    // 船沿高光
    ctx.strokeStyle = 'rgba(150, 120, 90, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-29, -2);
    ctx.quadraticCurveTo(-27, -12, -12, -15);
    ctx.lineTo(12, -15);
    ctx.quadraticCurveTo(27, -12, 29, -2);
    ctx.stroke();

    // 船舱
    ctx.fillStyle = '#7a6147';
    ctx.fillRect(-11, -27, 22, 11);
    ctx.fillStyle = '#9a7f5e';
    ctx.fillRect(-9, -25, 8, 6);

    // 桅杆
    ctx.fillStyle = '#6a5642';
    ctx.fillRect(-2, -46, 4, 20);

    // 小旗（与船体同色系）
    ctx.fillStyle = '#8a6f52';
    ctx.beginPath();
    ctx.moveTo(2, -46);
    ctx.lineTo(12, -43);
    ctx.lineTo(2, -40);
    ctx.closePath();
    ctx.fill();

    // 灯（暖黄，带柔和光晕）
    const glow = ctx.createRadialGradient(0, -50, 1, 0, -50, 14);
    glow.addColorStop(0, 'rgba(255, 240, 180, 0.95)');
    glow.addColorStop(0.35, 'rgba(255, 215, 120, 0.35)');
    glow.addColorStop(1, 'rgba(255, 200, 90, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, -50, 14, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffe9a8';
    ctx.beginPath();
    ctx.arc(0, -50, 3.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawRocks(ctx, x, y, scale = 1) {
    // 礁石（简单的不规则多边形）
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);

    ctx.fillStyle = '#1a2028';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-15, -8);
    ctx.lineTo(-10, -18);
    ctx.lineTo(5, -15);
    ctx.lineTo(18, -10);
    ctx.lineTo(20, 0);
    ctx.closePath();
    ctx.fill();

    // 第二块礁石
    ctx.beginPath();
    ctx.moveTo(25, 0);
    ctx.lineTo(30, -6);
    ctx.lineTo(40, -5);
    ctx.lineTo(42, 0);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function animate() {
    contexts.forEach(c => {
      if (c.canvas.offsetParent !== null) { // 只绘制可见的Canvas
        drawScene(c.ctx, c.width, c.height);
      }
    });
    requestAnimationFrame(animate);
  }

  resize();
  window.addEventListener('resize', resize);
  animate();
})();

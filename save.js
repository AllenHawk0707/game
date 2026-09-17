/* 星榆中学 · 存档系统（共享模块）
 * 统一负责：地图页的「存档 / 返回标题」浮动按钮、存档弹窗、
 * 以及主界面「存档点」的存档列表展示与读档。
 * 设计目标：不改动各页面原有逻辑，仅以最小侵入方式挂接。
 */
(function () {
  'use strict';

  // 触屏判定（与各地图内联控件脚本保持一致）
  var IS_TOUCH = (('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || /Mobi|Android|iPhone|iPad|iPod|Windows Phone/i.test(navigator.userAgent)) && !(window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches);

  var KEY = 'xyzh_saves';
  var ACH_KEY = 'xyzh_achievements';   // 已通往结局的成就

  // ── 存档读写 ──
  var ACTIVE_KEY = 'xyzh_active_slot';   // 当前游戏会话关联的存档槽 id

  function getSaves() {
    try {
      var a = JSON.parse(localStorage.getItem(KEY));
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }
  function setSaves(a) {
    try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) {}
  }

  // 当前游戏会话关联的存档槽
  function getActiveId() {
    try { var v = sessionStorage.getItem(ACTIVE_KEY); return v ? Number(v) : null; } catch (e) { return null; }
  }
  function setActiveId(id) {
    try { sessionStorage.setItem(ACTIVE_KEY, String(id)); } catch (e) {}
  }

  // 收集“整个程序的进程”
  function collectState() {
    var path = location.pathname.split('/').pop();
    var p = window.__xyzh_player;
    // 若当前页面有状态保存函数，先触发一次以保证快照最新
    try { if (window.saveIndexState) window.saveIndexState(); } catch (e) {}
    try { if (window.saveLogsState) window.saveLogsState(); } catch (e) {}

    var st = {
      map: path,
      player: p ? { x: p.x, y: p.y } : null,
      indexState: null,
      logsState: null,
      mapReturn: null
    };
    try { st.indexState = localStorage.getItem('xyzh_index_state'); } catch (e) {}
    try { st.logsState = localStorage.getItem('xyzh_logs_state'); } catch (e) {}
    try { st.mapReturn = sessionStorage.getItem('mapReturn'); } catch (e) {}
    return st;
  }

  // 存档槽上限
  var MAX_SLOTS = 3;

  // 超出上限时，回收最早的存档槽（id 最小者），保证总数不超过上限
  function enforceMax(saves) {
    if (saves.length > MAX_SLOTS) {
      saves.sort(function (a, b) { return a.id - b.id; });
      saves = saves.slice(saves.length - MAX_SLOTS);
    }
    return saves;
  }

  // 新游戏：创建一个全新的存档槽
  // 仅通过「点新游戏」才会增加新存档槽，其他方式（手动存档 / 自动存档 / 退回标题）都只覆盖不新增
  // 存档数已达上限（MAX_SLOTS=3）时返回 -1，由调用方提示用户先删除存档
  // 参数 name：玩家为新存档起的名字（自定义），为空时使用默认「存档N」
  function createSlot(name) {
    var saves = getSaves();
    if (saves.length >= MAX_SLOTS) {
      // 已达上限：不创建新槽、不覆盖现有存档，返回 -1 让上层引导用户先删除
      return -1;
    }
    var slot = {
      id: Date.now(),
      time: Date.now(),
      name: (name && String(name).trim()) ? String(name).trim().slice(0, 16) : null,
      state: { map: 'map.html', player: null, indexState: null, logsState: null, mapReturn: null }
    };
    saves.push(slot);
    setSaves(saves);
    setActiveId(slot.id);   // 该新游戏会话后续存档均覆盖此槽
    return slot.id;
  }

  // 在当前游戏会话的存档槽中存档（覆盖，而非新建）
  // 同一新游戏下任何存档方式（手动 / 自动 / 检查点）都不新增槽，
  // 仅 createSlot（点「新游戏」）才新建。活跃槽失效时回退到最新已有槽。
  function saveCurrent() {
    var id = getActiveId();
    var saves = getSaves();
    if (id != null) {
      for (var i = 0; i < saves.length; i++) {
        if (saves[i].id === id) {
          saves[i].time = Date.now();
          saves[i].state = collectState();
          setSaves(saves);
          return;
        }
      }
    }
    // 活跃槽无效：不新建槽，改为覆盖最新的已有槽
    if (saves.length > 0) {
      var newest = saves[0];
      for (var j = 1; j < saves.length; j++) {
        if (saves[j].time > newest.time) newest = saves[j];
      }
      newest.time = Date.now();
      newest.state = collectState();
      setActiveId(newest.id);
      setSaves(saves);
    }
    // 无任何存档槽时静默跳过（不新建）
  }

  // ── 检查点存档（追逐战前自动存档，死亡后可回到此点）──
  // 与 saveCurrent 一样覆盖当前槽，但额外标记 isCheckpoint=true
  // 并快照 checkpointState：后续手动存档（saveCurrent）只更新 state，
  // 不会覆盖 checkpointState，确保 loadCheckpoint 总能回到检查点时的状态
  function saveCheckpoint() {
    saveCurrent();
    var id = getActiveId();
    if (id == null) return;
    var saves = getSaves();
    for (var i = 0; i < saves.length; i++) {
      if (saves[i].id === id) {
        saves[i].isCheckpoint = true;
        saves[i].checkpointState = saves[i].state;   // 快照检查点状态
        setSaves(saves);
        return;
      }
    }
  }

  // 是否有可用的检查点存档（决定死亡画面是否显示「回档」按钮）
  // 先查当前活跃槽，找不到则搜索所有槽（防止活跃槽 ID 失效）
  function hasCheckpoint() {
    var id = getActiveId();
    if (id != null) {
      var slot = findSlot(id);
      if (slot && (slot.isCheckpoint || slot.checkpointState)) return true;
    }
    var saves = getSaves();
    for (var i = 0; i < saves.length; i++) {
      if (saves[i].isCheckpoint || saves[i].checkpointState) return true;
    }
    return false;
  }

  // 加载检查点（死亡画面点击「回档」按钮时调用）
  // 优先读取 checkpointState 快照（不受后续手动存档影响）
  // 先查当前活跃槽，找不到则搜索所有槽
  function loadCheckpoint() {
    var id = getActiveId();
    if (id != null) {
      var slot = findSlot(id);
      if (slot && (slot.isCheckpoint || slot.checkpointState)) {
        var st = slot.checkpointState || slot.state;
        loadSlot(id, st);
        return true;
      }
    }
    // 活跃槽无检查点 → 搜索所有槽
    var saves = getSaves();
    for (var i = saves.length - 1; i >= 0; i--) {
      if (saves[i].isCheckpoint || saves[i].checkpointState) {
        var st = saves[i].checkpointState || saves[i].state;
        loadSlot(saves[i].id, st);
        return true;
      }
    }
    return false;
  }

  function findSlot(id) {
    var saves = getSaves();
    for (var i = 0; i < saves.length; i++) if (saves[i].id === id) return saves[i];
    return null;
  }
  function removeSlot(id) {
    setSaves(getSaves().filter(function (s) { return s.id !== id; }));
  }

  // 成就（已通往的结局）
  function getAchievements() {
    try { var a = JSON.parse(localStorage.getItem(ACH_KEY)); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function setAchievements(a) {
    try { localStorage.setItem(ACH_KEY, JSON.stringify(a)); } catch (e) {}
  }
  // 是否已通往某结局（用于解锁隐藏内容，如 mp5 隐秘小门）
  function hasEnding(name) {
    var ach = getAchievements();
    for (var i = 0; i < ach.length; i++) {
      if (ach[i].ending === name) return true;
    }
    return false;
  }

  // 记录已通往的结局，并删除"进入结局的存档"
  // keepSlot=true 时保留存档（死亡结局可回档重试，不删除存档槽）
  function recordEnding(endingName, keepSlot) {
    var id = getActiveId();
    if (id == null) return;
    var saves = getSaves();
    var idx = -1, slot = null;
    for (var i = 0; i < saves.length; i++) {
      if (saves[i].id === id) { idx = i; slot = saves[i]; break; }
    }
    if (!slot) return;
    var name = '存档' + (idx + 1);
    var ach = getAchievements();
    ach.push({ ending: endingName, name: name, time: Date.now() });
    setAchievements(ach);
    if (!keepSlot) removeSlot(id);   // 删除进入结局的存档
  }

  function loadSlot(id, customState) {
    var slot = findSlot(id);
    if (!slot) return;
    setActiveId(id);   // 读取后，该游戏会话后续存档覆盖同一个槽
    var st = customState || slot.state || {};
    try {
      if (st.indexState != null) localStorage.setItem('xyzh_index_state', st.indexState);
      else localStorage.removeItem('xyzh_index_state');
    } catch (e) {}
    try {
      if (st.logsState != null) localStorage.setItem('xyzh_logs_state', st.logsState);
      else localStorage.removeItem('xyzh_logs_state');
    } catch (e) {}
    // 位置由 xyzh_resume 精确恢复，避免与地图自身 mapReturn 逻辑冲突
    try { sessionStorage.removeItem('mapReturn'); } catch (e) {}
    var map = st.map || 'map.html';
    if (st.player) {
      try {
        sessionStorage.setItem('xyzh_resume', JSON.stringify({ map: map, x: st.player.x, y: st.player.y }));
      } catch (e) {}
    } else {
      try { sessionStorage.removeItem('xyzh_resume'); } catch (e) {}
    }
    window.location.href = map;
  }

  // ── UI ──
  function injectCSS() {
    if (document.getElementById('xyzh-save-style')) return;
    var css = document.createElement('style');
    css.id = 'xyzh-save-style';
    css.textContent = [
      '@keyframes xyzh-toast-in{0%{opacity:0;transform:translate(-50%,-50%) scale(.7);}60%{opacity:1;transform:translate(-50%,-50%) scale(1.08);}100%{opacity:1;transform:translate(-50%,-50%) scale(1);}}',
      '@keyframes xyzh-box-in{from{opacity:0;transform:translateY(18px) scale(.96);}to{opacity:1;transform:translateY(0) scale(1);}}',
      '@keyframes xyzh-slot-in{from{opacity:0;transform:translateX(-16px);}to{opacity:1;transform:translateX(0);}}',
      '@keyframes xyzh-pulse{0%{transform:scale(1);}50%{transform:scale(.9);box-shadow:0 0 16px rgba(160,106,58,0.5);}100%{transform:scale(1);}}',
      '.xyzh-fab{position:fixed;z-index:60;font-family:"宋体",SimSun,serif;font-size:15px;letter-spacing:4px;color:#9a8a6a;background:rgba(10,10,10,0.72);border:1px solid #4a4030;padding:9px 16px;cursor:pointer;text-align:center;transition:color .25s ease,border-color .25s ease,box-shadow .25s ease;-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);user-select:none;}',
      '.xyzh-fab:hover{color:#d8c89a;border-color:#8a7a5a;box-shadow:0 0 12px rgba(138,122,90,0.25) inset,0 0 8px rgba(138,122,90,0.15);}',
      '.xyzh-fab:active{color:#eee;border-color:#a06a3a;}',
      '.xyzh-fab.flash{animation:xyzh-pulse .3s ease;}',
      '#xyzh-fab-save{bottom:18px;right:18px;}',
      '#xyzh-fab-title{bottom:18px;left:18px;}',
      '#xyzh-ask-overlay{position:fixed;top:0;left:0;width:100%;height:100%;z-index:400;background:rgba(0,0,0,0.82);display:flex;align-items:center;justify-content:center;font-family:"宋体",SimSun,serif;opacity:0;transition:opacity .25s ease;pointer-events:none;}',
      '#xyzh-ask-overlay.show{opacity:1;pointer-events:auto;}',
      '#xyzh-ask-box{width:380px;max-width:90vw;background:#0c0c0c;border:1px solid #6a5a3a;padding:24px 26px;box-shadow:0 0 40px rgba(0,0,0,0.8);color:#d8c89a;animation:xyzh-box-in .35s ease;}',
      '#xyzh-ask-title{font-size:18px;letter-spacing:6px;text-align:center;margin-bottom:14px;color:#8a7a5a;}',
      '#xyzh-ask-msg{font-size:14px;letter-spacing:2px;line-height:1.9;text-align:center;margin-bottom:20px;color:#9a8a6a;}',
      '#xyzh-ask-btns{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;}',
      '.xyzh-ask-btn{flex:1;min-width:90px;padding:11px 0;background:rgba(20,20,20,0.6);border:1px solid #4a4030;color:#9a8a6a;font-family:"宋体",SimSun,serif;font-size:15px;letter-spacing:4px;cursor:pointer;transition:color .2s ease,border-color .2s ease,background .2s ease;}',
      '.xyzh-ask-btn:hover{color:#eee;border-color:#a06a3a;background:rgba(40,20,10,0.5);}',
      '.xyzh-ask-btn.primary{border-color:#8a7a5a;color:#d8c89a;}',
      '.xyzh-ask-btn.primary:hover{color:#fff;border-color:#d8c89a;background:rgba(80,60,20,0.4);}',
      '.xyzh-ask-btn.danger:hover{color:#f88;border-color:#a55;}',
      '#xyzh-popup{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:200;background:rgba(8,8,8,0.92);border:1px solid #6a5a3a;color:#d8c89a;font-family:"宋体",SimSun,serif;font-size:18px;letter-spacing:3px;padding:18px 34px;opacity:0;pointer-events:none;box-shadow:0 0 24px rgba(138,122,90,0.2);}',
      '#xyzh-popup.show{animation:xyzh-toast-in .42s cubic-bezier(.2,.9,.3,1.2) forwards;}',
      '#xyzh-list-overlay{position:fixed;top:0;left:0;width:100%;height:100%;z-index:100000;background:rgba(0,0,0,0.8);display:none;align-items:center;justify-content:center;font-family:"宋体",SimSun,serif;opacity:0;transition:opacity .25s ease;}',
      '#xyzh-list-overlay.show{display:flex;opacity:1;}',
      '#xyzh-list-box{width:420px;max-width:90vw;max-height:80vh;overflow:auto;background:#0c0c0c;border:1px solid #444;padding:26px 28px;box-shadow:0 0 40px rgba(0,0,0,0.8);animation:xyzh-box-in .35s ease;}',
      '#xyzh-list-title{color:#8a7a5a;font-size:22px;letter-spacing:8px;text-align:center;margin-bottom:18px;text-shadow:0 0 8px rgba(138,122,90,0.3);}',
      '.xyzh-slot{display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid #333;padding:12px 16px;margin-bottom:12px;cursor:pointer;color:#bbb;transition:color .2s ease,border-color .2s ease,background .2s ease;opacity:0;animation:xyzh-slot-in .4s ease forwards;}',
      '.xyzh-slot:nth-child(1){animation-delay:.04s;}',
      '.xyzh-slot:nth-child(2){animation-delay:.10s;}',
      '.xyzh-slot:nth-child(3){animation-delay:.16s;}',
      '.xyzh-slot:nth-child(4){animation-delay:.22s;}',
      '.xyzh-slot:nth-child(5){animation-delay:.28s;}',
      '.xyzh-slot:hover{border-color:#6a5a3a;color:#e0d2a8;background:rgba(138,122,90,0.06);}',
      '.xyzh-slot .name{font-size:17px;letter-spacing:3px;}',
      '.xyzh-slot .time{font-size:12px;color:#666;letter-spacing:1px;margin-top:3px;}',
      '.xyzh-slot .del{color:#a55;font-size:13px;padding:3px 10px;border:1px solid #533;cursor:pointer;flex:0 0 auto;transition:color .2s ease,border-color .2s ease;}',
      '.xyzh-slot .del:hover{color:#f88;border-color:#a55;}',
      '#xyzh-list-empty{color:#555;text-align:center;font-size:15px;letter-spacing:3px;padding:20px 0;}',
      '#xyzh-list-close{display:block;width:100%;margin-top:6px;padding:12px 0;background:transparent;border:1px solid #444;color:#999;font-family:"宋体",SimSun,serif;font-size:16px;letter-spacing:6px;cursor:pointer;transition:color .2s ease,border-color .2s ease;}',
      '#xyzh-list-close:hover{color:#c0b090;border-color:#6a5a3a;}',
      /* ── 独立成就弹窗 ── */
      '#xyzh-ach-overlay{position:fixed;top:0;left:0;width:100%;height:100%;z-index:300;background:rgba(0,0,0,0.82);display:none;align-items:center;justify-content:center;font-family:"宋体",SimSun,serif;opacity:0;transition:opacity .25s ease;}',
      '#xyzh-ach-overlay.show{display:flex;opacity:1;}',
      '#xyzh-ach-box{width:470px;max-width:92vw;max-height:82vh;overflow:auto;background:#0c0c0c;border:1px solid #4a2a2a;padding:26px 28px;box-shadow:0 0 40px rgba(80,0,0,0.4);animation:xyzh-box-in .35s ease;}',
      '#xyzh-ach-title{color:#a85a5a;font-size:22px;letter-spacing:8px;text-align:center;margin-bottom:8px;text-shadow:0 0 10px rgba(160,40,40,0.4);}',
      '#xyzh-ach-count{color:#b88a6a;font-size:14px;letter-spacing:4px;text-align:center;margin-bottom:20px;font-family:"宋体",SimSun,serif;}',
      '#xyzh-ach-count.full{color:#e6c45a;text-shadow:0 0 8px rgba(210,165,40,0.5);}',
      '.xyzh-ach{position:relative;border:1px solid #3a2a2a;padding:14px 16px;margin-bottom:14px;color:#c0a0a0;background:rgba(40,10,10,0.12);}',
      '.xyzh-ach.got{border-color:#6a3030;box-shadow:0 0 14px rgba(120,0,0,0.28) inset;background:rgba(60,12,12,0.22);}',
      '.xyzh-ach .e{font-size:18px;letter-spacing:4px;color:#9a5a5a;}',
      '.xyzh-ach.got .e{color:#e07070;text-shadow:0 0 8px rgba(160,0,0,0.5);}',
      '.xyzh-ach .d{font-size:13px;color:#9a8a8a;letter-spacing:1px;margin-top:6px;line-height:1.6;}',
      '.xyzh-ach .n{font-size:12px;color:#7a6a6a;letter-spacing:1px;margin-top:8px;}',
      '.xyzh-ach .badge{position:absolute;top:14px;right:16px;font-size:13px;letter-spacing:3px;color:#d06060;}',
      '.xyzh-ach .badge.no{color:#555;}',
      /* ── 好结局成就：金色（区别于其余红色结局）── */
      '.xyzh-ach.gold{border-color:#6a5a1a;box-shadow:0 0 14px rgba(190,150,40,0.30) inset;background:rgba(52,42,12,0.24);}',
      '.xyzh-ach.gold .e{color:#e6c45a;text-shadow:0 0 8px rgba(210,165,40,0.55);}',
      '.xyzh-ach.gold .d{color:#b8a878;}',
      '.xyzh-ach.gold .n{color:#8a7a4a;}',
      '.xyzh-ach.gold .badge{color:#d8b24a;}',
      /* ── 彩蛋结局成就：炫彩（粉紫蓝，呼应 egg_ending.html 渐变）── */
      '.xyzh-ach.egg{border-color:#8a4a8a;box-shadow:0 0 14px rgba(180,80,180,0.30) inset, 0 0 18px rgba(95,184,212,0.18) inset;background:linear-gradient(135deg, rgba(80,30,90,0.30), rgba(30,60,90,0.30));}',
      '.xyzh-ach.egg .e{color:#f0c0e8;text-shadow:0 0 8px rgba(255,150,220,0.55), 0 0 14px rgba(95,184,212,0.45);}',
      '.xyzh-ach.egg .d{color:#c0b8d8;}',
      '.xyzh-ach.egg .n{color:#8a78a8;}',
      '.xyzh-ach.egg .badge{color:#e8a0d8;}',
      '#xyzh-ach-close{display:block;width:100%;margin-top:6px;padding:12px 0;background:transparent;border:1px solid #444;color:#999;font-family:"宋体",SimSun,serif;font-size:16px;letter-spacing:6px;cursor:pointer;transition:color .2s ease,border-color .2s ease;}',
      '#xyzh-ach-close:hover{color:#c0b090;border-color:#6a5a3a;}',
      '#xyzh-ach-clear{display:block;width:100%;margin-top:10px;padding:12px 0;background:rgba(40,10,10,0.4);border:1px solid #6a3030;color:#c88;font-family:"宋体",SimSun,serif;font-size:16px;letter-spacing:6px;cursor:pointer;transition:color .2s ease,border-color .2s ease,background .2s ease;}',
      '#xyzh-ach-clear:hover{color:#f88;border-color:#a55;background:rgba(60,12,12,0.55);}',
      '.xyzh-ach-empty{color:#e8c890;font-size:16px;letter-spacing:6px;text-align:center;padding:22px 0 8px;text-shadow:0 0 8px rgba(232,200,144,0.25);}'
    ].join('\n');
    document.head.appendChild(css);
  }

  function toast(msg) {
    injectCSS();
    var el = document.getElementById('xyzh-popup');
    if (!el) { el = document.createElement('div'); el.id = 'xyzh-popup'; document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.remove('show');
    void el.offsetWidth;            // 强制重排，确保动画每次重新播放
    el.classList.add('show');
    clearTimeout(el.__t);
    el.__t = setTimeout(function () { el.classList.remove('show'); }, 1600);
  }

  function buildFab(id, label, handler) {
    var b = document.createElement('div');
    b.className = 'xyzh-fab';
    b.id = id;
    b.textContent = label;
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      b.classList.remove('flash');
      void b.offsetWidth;           // 强制重排，重播点击脉冲动画
      b.classList.add('flash');
      handler();
    });
    document.body.appendChild(b);
    return b;
  }

  // 地图页：挂接浮动按钮
  function ensureMapUI() {
    if (!window.__xyzh_player) return; // 非地图页不挂载
    injectCSS();
    if (document.getElementById('xyzh-fab-save')) return;
    buildFab('xyzh-fab-save', '存 档', function () {
      saveCurrent();
      toast('已 存 档 完 成');
    });
    buildFab('xyzh-fab-title', '返 回 标 题', function () {
      // 不自动存档；弹自定义模态询问：存档 / 不存档 / 取消（留在原页）
      askReturnToTitle();
    });
    // 触屏端：把存档 / 返回标题挪到左上角堆叠，避免与右下角的
    // 互动 / 关闭 / 确认 / 取消 移动按钮簇重叠（电脑端保持原右下/左下布局）
    if (IS_TOUCH) {
      var fs = document.getElementById('xyzh-fab-save');
      if (fs) { fs.style.right = 'auto'; fs.style.bottom = 'auto'; fs.style.top = '14px'; fs.style.left = '14px'; }
      var ft = document.getElementById('xyzh-fab-title');
      if (ft) { ft.style.right = 'auto'; ft.style.bottom = 'auto'; ft.style.top = '60px'; ft.style.left = '14px'; }
    }
  }

  // 「返 回 标 题」前的存档询问对话框（三选一：存档并返回 / 不存档并返回 / 取消留在原页）
  function askReturnToTitle() {
    injectCSS();
    var overlay = document.getElementById('xyzh-ask-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'xyzh-ask-overlay';
      overlay.innerHTML =
        '<div id="xyzh-ask-box">' +
          '<div id="xyzh-ask-title">返 回 标 题</div>' +
          '<div id="xyzh-ask-msg">是否在返回标题前保存当前进度？</div>' +
          '<div id="xyzh-ask-btns">' +
            '<button class="xyzh-ask-btn primary" id="xyzh-ask-save">存 档 并 返 回</button>' +
            '<button class="xyzh-ask-btn danger" id="xyzh-ask-nosave">不 存 档 返 回</button>' +
            '<button class="xyzh-ask-btn" id="xyzh-ask-cancel">取 消</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
    }
    function close() { overlay.classList.remove('show'); }
    function go(doSave) {
      close();
      if (doSave) {
        saveCurrent();
        toast('已 存 档 完 成');
        setTimeout(function () { window.location.href = 'start.html'; }, 700);
      } else {
        toast('未 保 存 · 已 返 回 标 题');
        setTimeout(function () { window.location.href = 'start.html'; }, 500);
      }
    }
    // 每次重新绑定，避免上次的 listener 残留
    var bSave = overlay.querySelector('#xyzh-ask-save');
    var bNo = overlay.querySelector('#xyzh-ask-nosave');
    var bCancel = overlay.querySelector('#xyzh-ask-cancel');
    bSave.onclick = function () { go(true); };
    bNo.onclick = function () { go(false); };
    bCancel.onclick = close;
    overlay.classList.add('show');
  }

  // HTML 字符转义（防止 XSS）
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // 主界面：存档点列表
  function openList() {
    injectCSS();
    var overlay = document.getElementById('xyzh-list-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'xyzh-list-overlay';
        overlay.innerHTML = '<div id="xyzh-list-box"><div id="xyzh-list-title">存 档 点</div>' +
        '<div id="xyzh-list-items"></div>' +
        '<button id="xyzh-list-close">返 回</button></div>';
      document.body.appendChild(overlay);
      overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.classList.remove('show'); });
      overlay.querySelector('#xyzh-list-close').addEventListener('click', function () { overlay.classList.remove('show'); });
    }
    var items = overlay.querySelector('#xyzh-list-items');
    var saves = getSaves();
    items.innerHTML = '';
    if (saves.length === 0) {
      items.innerHTML = '<div id="xyzh-list-empty">尚 无 存 档</div>';
    } else {
      saves.forEach(function (s, idx) {
        var d = document.createElement('div');
        d.className = 'xyzh-slot';
        var t = new Date(s.time);
        var tt = (t.getMonth() + 1) + '/' + t.getDate() + ' ' +
          ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2);
        d.innerHTML = '<div><div class="name">' + (s.name ? escapeHtml(s.name) : '存档' + (idx + 1)) + '</div><div class="time">' + tt + '</div></div>';
        var del = document.createElement('span');
        del.className = 'del';
        del.textContent = '删 除';
        del.addEventListener('click', function (e) {
          e.stopPropagation();
          removeSlot(s.id);
          openList(); // 刷新列表
        });
        d.appendChild(del);
        d.addEventListener('click', function () { overlay.classList.remove('show'); loadSlot(s.id); });
        items.appendChild(d);
      });
    }
    overlay.classList.add('show');
  }

  // ── 独立成就弹窗：列出全部结局，标明已达成/未达成 ──
  var KNOWN_ENDINGS = [
    { key: '逃避结局', desc: '你选择了逃避。真相被掩盖，三楼的回响从未停止。' },
    { key: '死亡结局', desc: '你被黑影吞噬。星榆中学的名单上又添了一个名字。' },
    { key: '好结局', desc: '你拉下总闸、按下红色按钮，也停止了这个不为人知的阴谋。星榆中学的灯，第一次为你而亮。' },
    { key: '彩蛋结局', desc: '你带陈宇找到了那扇门。走廊尽头的火光熄灭，再没有人能打开它。' }
  ];

  // 清除全部已达成成就（带二次确认，防止误触）
  function clearAchievements() {
    if (!window.confirm('确定要清除全部已达成成就吗？此操作不可撤销。')) return;
    setAchievements([]);
    toast('成 就 已 全 部 清 除');
    openAchievements();   // 重新渲染列表
  }

  function openAchievements() {
    injectCSS();
    var overlay = document.getElementById('xyzh-ach-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'xyzh-ach-overlay';
      overlay.innerHTML = '<div id="xyzh-ach-box">' +
        '<div id="xyzh-ach-title">成 就 · 已 通 往 结 局</div>' +
        '<div id="xyzh-ach-count">0 / ' + KNOWN_ENDINGS.length + '</div>' +
        '<div id="xyzh-ach-items"></div>' +
        '<button id="xyzh-ach-clear">清 除 全 部 成 就</button>' +
        '<button id="xyzh-ach-close">返 回</button></div>';
      document.body.appendChild(overlay);
      overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.classList.remove('show'); });
      overlay.querySelector('#xyzh-ach-clear').addEventListener('click', clearAchievements);
      overlay.querySelector('#xyzh-ach-close').addEventListener('click', function () { overlay.classList.remove('show'); });
    }
    var items = overlay.querySelector('#xyzh-ach-items');
    var countEl = overlay.querySelector('#xyzh-ach-count');
    var achieved = getAchievements();
    items.innerHTML = '';
    // 只显示已达成的结局（按达成时间倒序、同名去重）
    if (achieved.length === 0) {
      items.innerHTML = '<div class="xyzh-ach-empty">尚 无 结 局 达 成</div>';
    } else {
      var descMap = {};
      KNOWN_ENDINGS.forEach(function (k) { descMap[k.key] = k.desc; });
      var shown = {};
      for (var i = achieved.length - 1; i >= 0; i--) {
        var a = achieved[i];
        if (shown[a.ending]) continue;
        shown[a.ending] = true;
        var t = new Date(a.time);
        var tt = (t.getMonth() + 1) + '/' + t.getDate() + ' ' +
          ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2);
        var row = document.createElement('div');
        row.className = 'xyzh-ach got' + (a.ending === '好结局' ? ' gold' : (a.ending === '彩蛋结局' ? ' egg' : ''));
        row.innerHTML =
          '<div class="e">' + a.ending + '</div>' +
          '<div class="d">' + (descMap[a.ending] || '') + '</div>' +
          '<div class="n">来自' + a.name + ' · ' + tt + '</div>' +
          '<div class="badge">已 达 成</div>';
        items.appendChild(row);
      }
    }
    // 进度计数：已达成 / 全部（同名去重，仅算 unique ending）
    var uniqueGot = 0;
    var seen = {};
    for (var j = 0; j < achieved.length; j++) {
      if (seen[achieved[j].ending]) continue;
      seen[achieved[j].ending] = true;
      uniqueGot++;
    }
    if (countEl){
      countEl.textContent = uniqueGot + ' / ' + KNOWN_ENDINGS.length;
      if (uniqueGot >= KNOWN_ENDINGS.length) countEl.classList.add('full');
      else countEl.classList.remove('full');
    }
    overlay.classList.add('show');
  }

  // 对外暴露
  window.SaveSystem = {
    createSlot: createSlot,   // 新游戏：新建一个存档槽（已满返回 -1）
    saveCurrent: saveCurrent,
    saveCheckpoint: saveCheckpoint,
    hasCheckpoint: hasCheckpoint,
    loadCheckpoint: loadCheckpoint,
    openList: openList,
    load: loadSlot,
    remove: removeSlot,
    recordEnding: recordEnding,
    openAchievements: openAchievements,
    hasEnding: hasEnding,     // 是否已通往某结局（好结局解锁用）
    getSaves: getSaves,       // 暴露存档列表
    getSavesCount: function () { return getSaves().length; },
    MAX_SLOTS: MAX_SLOTS,
    toast: toast
  };

  // ── 死亡画面：「回档」按钮 ──
  // 全局 HTML overlay，各地图 triggerChaserDeath / 按钮死亡调用 showDeathCheckpointBtn()
  // 有检查点 → 点击直接读取检查点（一键回档）
  // 无检查点但有存档 → 点击打开存档列表选择
  // 无存档 → 不显示按钮，由各地图自行跳转 start.html
  window.showDeathCheckpointBtn = function () {
    if (typeof SaveSystem === 'undefined') return;
    var hasCP = !!(SaveSystem.hasCheckpoint && SaveSystem.hasCheckpoint());
    var hasSaves = !!(SaveSystem.getSaves && SaveSystem.getSaves().length > 0);
    if (!hasCP && !hasSaves) return;

    if (document.getElementById('__xyzh_death_btn')) return;
    var btn = document.createElement('div');
    btn.id = '__xyzh_death_btn';
    btn.style.cssText = 'position:fixed;left:50%;bottom:70px;transform:translateX(-50%);z-index:99999;padding:12px 36px;background:rgba(15,15,15,0.88);border:1px solid #8a6a3a;color:#d8c89a;font-family:"宋体",SimSun,serif;font-size:16px;letter-spacing:6px;cursor:pointer;user-select:none;transition:color .2s ease,border-color .2s ease,background .2s ease;box-shadow:0 0 20px rgba(0,0,0,0.6);';
    btn.textContent = '回 档';
    btn.onmouseenter = function () { btn.style.borderColor = '#d8c89a'; btn.style.color = '#fff'; btn.style.background = 'rgba(40,30,15,0.92)'; };
    btn.onmouseleave = function () { btn.style.borderColor = '#8a6a3a'; btn.style.color = '#d8c89a'; btn.style.background = 'rgba(15,15,15,0.88)'; };
    btn.onclick = function () {
      try {
        // 先尝试直接读取检查点，成功则跳转
        if (SaveSystem.loadCheckpoint && SaveSystem.loadCheckpoint()) {
          return;
        }
        // 无检查点时打开存档列表
        if (SaveSystem.openList) {
          SaveSystem.openList();
        }
      } catch (e) {}
    };
    document.body.appendChild(btn);
  };
  window.hideDeathCheckpointBtn = function () {
    var btn = document.getElementById('__xyzh_death_btn');
    if (btn) btn.remove();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureMapUI);
  } else {
    ensureMapUI();
  }
})();

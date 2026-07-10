6/* ============================================================
   时间系统 · 星期 + 时刻
   跨页面通过 sessionStorage 共享，新游戏从「周一 22:00」开始，
   每 5 真实分钟推进 2 游戏小时，日期正常递增。
   ============================================================ */
var GameTime = (function(){
  var WEEK = ['周日','周一','周二','周三','周四','周五','周六'];
  var KEY  = 'xyzh_time';
  var TS_KEY = 'xyzh_time_ts';
  // 默认：周一 22:00
  var state = { day:1, hour:22, minute:0 };
  var loaded = false;

  function load(){
    if(loaded) return;
    loaded = true;
    try{
      var s = sessionStorage.getItem(KEY);
      if(s){
        var p = JSON.parse(s);
        if(p && typeof p.day==='number' && typeof p.hour==='number' && typeof p.minute==='number'){
          state = p;
        }
      }
    }catch(e){}
  }
  function save(){
    try{ sessionStorage.setItem(KEY, JSON.stringify(state)); }catch(e){}
  }

  // 推进分钟数（自动进位 小时/星期）
  function advance(min){
    load();
    state.minute += min;
    while(state.minute >= 60){ state.minute -= 60; state.hour++; }
    while(state.hour >= 24){ state.hour -= 24; state.day = (state.day + 1) % 7; }
    save();
  }

  // 新游戏重置
  function reset(){
    state = { day:1, hour:22, minute:0 };
    loaded = true;
    save();
    try{ sessionStorage.removeItem(TS_KEY); }catch(e){}
  }

  // 由床交互等场景直接设定日期/时刻
  function set(day, hour, minute){
    load();
    state.day    = ((day    % 7)  + 7) % 7;
    state.hour   = ((hour   % 24) + 24) % 24;
    state.minute = minute || 0;
    save();
  }

  // 文本标签，如 "周一 21:00"
  function label(){
    load();
    var w = WEEK[state.day] || '周一';
    var h = (state.hour < 10 ? '0' : '') + state.hour;
    var m = (state.minute < 10 ? '0' : '') + state.minute;
    return w + ' ' + h + ':' + m;
  }

  // 取得原始数据
  function get(){
    load();
    return { day: state.day, hour: state.hour, minute: state.minute, week: WEEK[state.day] };
  }

  // 每帧调用，根据真实时间流逝推进游戏时间
  // 5 真实分钟 = 2 游戏小时（120 游戏分钟）→ 1 真实秒 = 0.4 游戏分钟
  function tick(){
    load();
    var now = Date.now();
    var lastTs = 0;
    try{ lastTs = parseInt(sessionStorage.getItem(TS_KEY)) || 0; }catch(e){}
    if(lastTs === 0){
      try{ sessionStorage.setItem(TS_KEY, now); }catch(e){}
      return;
    }
    var elapsedMs = now - lastTs;
    var gameMin = Math.floor((elapsedMs / 300000) * 120);
    if(gameMin >= 1){
      // 上限 24 小时防止挂机跳太多
      gameMin = Math.min(gameMin, 24 * 60);
      advance(gameMin);
      try{ sessionStorage.setItem(TS_KEY, now); }catch(e){}
    }
  }

  return { load:load, save:save, advance:advance, reset:reset, set:set, label:label, get:get, tick:tick };
})();

// 任何页面加载时先读取一次共享状态
GameTime.load();

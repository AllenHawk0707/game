// 模拟 map7 中央阻带 + 玩家 BFS 验证
// 参数: 玩家 12x18, HALL_TOP=150, HALL_BOT=380, HALL_LEFT=60, HALL_RIGHT=4260
const HALL_TOP=150, HALL_BOT=380, HALL_LEFT=60, HALL_RIGHT=4260;
const PW=12, PH=18;

function makeMidBlocks(fn){
  const list=[];
  // 模拟当前二态
  if(fn==='current'){
    let t=0;
    for(let x=HALL_RIGHT-180; x>HALL_LEFT+150; x-=110){
      if(t%2===0) list.push({x,y:200,w:60,h:60});
      else        list.push({x,y:280,w:60,h:60});
      t++;
    }
  }
  return list;
}

function collides(px,py,walls){
  if(px<HALL_LEFT||px+PW>HALL_RIGHT||py<HALL_TOP||py+PH>HALL_BOT) return true;
  for(const o of walls){
    if(px<o.x+o.w && px+PW>o.x && py<o.y+o.h && py+PH>o.y) return true;
  }
  return false;
}

function bfs(walls, sx, sy){
  const seen=new Set();
  const q=[[sx,sy]];
  seen.add(sx+','+sy);
  let farX=sx;
  while(q.length){
    const [x,y]=q.shift();
    if(x<farX) farX=x;
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx=x+dx, ny=y+dy;
      const k=nx+','+ny;
      if(seen.has(k)) continue;
      if(collides(nx,ny,walls)) continue;
      seen.add(k);
      q.push([nx,ny]);
    }
  }
  return {reach:seen.size, farX};
}

const walls=makeMidBlocks('current');
console.log('障碍物数:', walls.length);

// 1. 顶缝直走测试 y=180
const r180=bfs(walls, HALL_RIGHT-80, 180);
console.log('y=180 起点 (HALL_RIGHT-80) → 到达', r180.reach, '格, 最远 x=', r180.farX);
// 2. 底缝直走测试 y=300
const r300=bfs(walls, HALL_RIGHT-80, 300);
console.log('y=300 起点 (HALL_RIGHT-80) → 到达', r300.reach, '格, 最远 x=', r300.farX);
// 3. 中央净空 y=265
const r265=bfs(walls, HALL_RIGHT-80, 265);
console.log('y=265 起点 (HALL_RIGHT-80) → 到达', r265.reach, '格, 最远 x=', r265.farX);

// 看 y=180 列上每个 x 有无障碍
console.log('\n=== y=180 (顶缝) 走到底检查 ===');
let lastColBlock=0;
for(let x=HALL_RIGHT-80; x>=HALL_LEFT+200; x-=10){
  if(collides(x,180,walls)){ lastColBlock=x; console.log('  x='+x+' y=180 撞墙'); }
}
console.log('  y=180 一直能走到 x='+lastColBlock);

// 验证 DICE_TARGET 把"哪个面"转到 +Z（朝前/可见）
// 面局部位置来自 CSS：front +Z, back -Z, right +X, left -X, top -Y, bottom +Y
function rx(a){a=a*Math.PI/180;const c=Math.cos(a),s=Math.sin(a);return [[1,0,0],[0,c,-s],[0,s,c]];}
function ry(a){a=a*Math.PI/180;const c=Math.cos(a),s=Math.sin(a);return [[c,0,s],[0,1,0],[-s,0,c]];}
function mul(A,B){const R=[[0,0,0],[0,0,0],[0,0,0]];for(let i=0;i<3;i++)for(let j=0;j<3;j++)for(let k=0;k<3;k++)R[i][j]+=A[i][k]*B[k][j];return R;}
function apply(M,p){return [M[0][0]*p[0]+M[0][1]*p[1]+M[0][2]*p[2], M[1][0]*p[0]+M[1][1]*p[1]+M[1][2]*p[2], M[2][0]*p[0]+M[2][1]*p[1]+M[2][2]*p[2]];}

const faces={1:[0,0,44],6:[0,0,-44],3:[44,0,0],4:[-44,0,0],2:[0,-44,0],5:[0,44,0]};

// 当前映射（未改）：2→rx90, 5→rx-90
const CUR={1:null,2:'rx90',3:'ry-90',4:'ry90',5:'rx-90',6:'ry180'};
// 修复后映射：2→rx-90, 5→rx90
const FIX={1:null,2:'rx-90',3:'ry-90',4:'ry90',5:'rx90',6:'ry180'};

function run(label,map){
  console.log(`\n=== ${label} ===`);
  let allOk=true;
  for(const k of [1,2,3,4,5,6]){
    let R=rx(-15); R=mul(R,ry(-25));
    const t=map[k];
    if(t==='rx90')R=mul(R,rx(90));
    else if(t==='rx-90')R=mul(R,rx(-90));
    else if(t==='ry90')R=mul(R,ry(90));
    else if(t==='ry-90')R=mul(R,ry(-90));
    else if(t==='ry180')R=mul(R,ry(180));
    let best=-1e9,bf=null;
    for(const f in faces){const z=apply(R,faces[f])[2]; if(z>best){best=z;bf=f;}}
    const ok=(String(k)===bf); if(!ok)allOk=false;
    console.log(`掷出 ${k} → 显示面 ${bf}  ${ok?'OK':'❌ 错(应为'+k+')'}`);
  }
  console.log(allOk?`${label} 全部正确 ✅`:`${label} 仍有错误 ❌`);
}
run('当前映射(未改)',CUR);
run('修复后映射(2/5互换)',FIX);

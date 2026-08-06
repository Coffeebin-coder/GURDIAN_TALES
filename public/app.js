'use strict';
const ASSET_VERSION = 16;
const $ = (s) => document.querySelector(s);
const scoreEl=$('#score'),idleImage=$('#idleImage'),motionImage=$('#motionImage'),buttonEl=$('#characterButton'),authBtn=$('#authBtn');
const authDialog=$('#authDialog'),motionDialog=$('#motionDialog'),authError=$('#authError'),motionError=$('#motionError');
const podiumRows=$('#podiumRows'),motionNameEl=$('#motionName'),toastEl=$('#unlockToast'),floatLayer=$('#floatLayer');
const motionSelect=$('#motionSelect'),motionHint=$('#motionSettingHint');
const loadingScreen=$('#loadingScreen'),loadingBar=$('#loadingBar'),loadingText=$('#loadingText'),loadingCount=$('#loadingCount'),gameEl=$('.game');
const MOTIONS=[
{threshold:0,name:'기본 콕',image:'/assets/pressed.png'},
{threshold:1000,name:'반짝 콕',image:'/assets/motions/1000.png'},
{threshold:10000,name:'꽃송이 콕',image:'/assets/motions/10000.png'},
{threshold:100000,name:'무지개 점프',image:'/assets/motions/100000.png'},
{threshold:1000000,name:'황금 공주광',image:'/assets/motions/1000000.png'},
{threshold:10000000,name:'별빛 회오리',image:'/assets/motions/10000000.png'},
{threshold:100000000,name:'보석 꽃축제',image:'/assets/motions/100000000.png'},
{threshold:1000000000,name:'꼬마공주 소환',image:'/assets/motions/1000000000.png'},
{threshold:10000000000,name:'응애공주 대축제',image:'/assets/motions/10000000000.png'}];
let token=localStorage.getItem('eungae_token')||'',user=null,localScore=0,pending=0,flushTimer,lastRandom=-1;
let settleTimer=null,lastTapAt=0,rapidFrame=0;
let motionMode=localStorage.getItem('eungae_motion_mode')||'random';
let selectedMotion=Number(localStorage.getItem('eungae_selected_motion')||0),previousMotion=0;
let gameReady=false;
const readyAssetPaths = new Set();
const processedImageMap = new Map();
const processingImageMap = new Map();
const objectUrls = new Set();
const decodedImageCache = new Map();
const format=n=>new Intl.NumberFormat('ko-KR').format(Number(n)||0);
const assetUrl = (path) => `${path}?v=${ASSET_VERSION}`;

function motionIndex(score){let i=0;MOTIONS.forEach((m,n)=>{if(score>=m.threshold)i=n});return i}
function unlocked(){return MOTIONS.map((m,index)=>({...m,index})).filter(m=>localScore>=m.threshold)}
function normalize(){const max=motionIndex(localScore);if(!['random','single'].includes(motionMode))motionMode='random';if(!Number.isInteger(selectedMotion)||selectedMotion<0||selectedMotion>max)selectedMotion=max}
function storePrefs(){localStorage.setItem('eungae_motion_mode',motionMode);localStorage.setItem('eungae_selected_motion',String(selectedMotion))}
function renderScore(){normalize();scoreEl.textContent=format(localScore);motionNameEl.textContent=motionMode==='random'?`랜덤 · ${unlocked().length}개 해금`:`고정 · ${MOTIONS[selectedMotion].name}`}
function escapeHtml(v){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function renderLeaderboard(items=[]){const medals=['🥇','🥈','🥉'];podiumRows.innerHTML='';for(let i=0;i<3;i++){const x=items[i]||{username:'빈자리',clicks:0};const row=document.createElement('div');row.className='rank-row';row.dataset.username=x.username==='빈자리'?'':x.username;row.dataset.clicks=String(x.clicks||0);row.innerHTML=`<span class="rank-medal">${medals[i]}</span><span class="rank-name">${escapeHtml(x.username)}</span><span class="rank-score">${format(x.clicks)}</span>`;podiumRows.appendChild(row)}}
async function api(path,options={}){const headers={'Content-Type':'application/json',...(options.headers||{})};if(token)headers.Authorization=`Bearer ${token}`;const r=await fetch(path,{...options,headers});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'요청에 실패했습니다.');return d}
function updateAuth(){authBtn.textContent=user?`${user.username} · 로그아웃`:'로그인'}
function applyUser(u){if(!u)return;motionMode=u.motionMode||motionMode;selectedMotion=Number.isInteger(u.selectedMotion)?u.selectedMotion:selectedMotion;normalize();storePrefs()}
async function restore(){if(!token){renderScore();return}try{const d=await api('/api/me');user=d.user;localScore=user.clicks;applyUser(user);previousMotion=motionIndex(localScore);if(previousMotion>0&&selectedMotion===0){selectedMotion=previousMotion;motionMode='single';storePrefs()}}catch{token='';localStorage.removeItem('eungae_token')}updateAuth();renderScore()}
async function auth(mode){authError.textContent='';try{const d=await api(`/api/auth/${mode}`,{method:'POST',body:JSON.stringify({username:$('#username').value.trim(),password:$('#password').value})});token=d.token;user=d.user;localScore=user.clicks;applyUser(user);previousMotion=motionIndex(localScore);if(previousMotion>0&&selectedMotion===0){selectedMotion=previousMotion;motionMode='single';storePrefs()};localStorage.setItem('eungae_token',token);updateAuth();renderScore();authDialog.close()}catch(e){authError.textContent=e.message}}
function chooseMotion(){const list=unlocked();if(motionMode==='single')return MOTIONS[selectedMotion]||list.at(-1)||MOTIONS[0];if(list.length===1)return list[0];let i=Math.floor(Math.random()*list.length);if(i===lastRandom)i=(i+1)%list.length;lastRandom=i;return list[i]}
function setFrame(showMotion){idleImage.classList.toggle('is-visible',!showMotion);motionImage.classList.toggle('is-visible',showMotion);buttonEl.classList.toggle('is-pressed',showMotion)}
function getProcessedSrc(path){return processedImageMap.get(path)||assetUrl(path)}
async function ensureProcessed(path){
  if(processedImageMap.has(path))return processedImageMap.get(path);
  const src=assetUrl(path);
  await loadImage(src);
  processedImageMap.set(path,src);
  return src;
}
function showPressed(){
  const m=chooseMotion();
  const nextSrc=getProcessedSrc(m.image);
  motionImage.alt=`응애공주 ${m.name}`;

  // bootGame에서 모든 이미지를 이미 로딩·디코딩했으므로
  // 클릭 시 onload를 다시 기다리지 않고 즉시 화면을 교체한다.
  if(motionImage.getAttribute('src')!==nextSrc){
    motionImage.setAttribute('src',nextSrc);
  }
  setFrame(true);
}
function showIdle(){const nextSrc=getProcessedSrc('/assets/idle.png');if(idleImage.getAttribute('src')!==nextSrc)idleImage.setAttribute('src',nextSrc);setFrame(false)}
function stopClickAnimation(){if(settleTimer){clearTimeout(settleTimer);settleTimer=null;}rapidFrame=0;showIdle()}
function playClickFrame(){const now=performance.now();const isRapid=now-lastTapAt<210;lastTapAt=now;if(!isRapid)rapidFrame=0;const showMotion=rapidFrame%2===0;rapidFrame++;if(showMotion)showPressed();else showIdle();if(settleTimer)clearTimeout(settleTimer);settleTimer=setTimeout(()=>{rapidFrame=0;showIdle();settleTimer=null;},190)}
function showFloat(e){const r=buttonEl.getBoundingClientRect(),el=document.createElement('span');el.className='float-score';el.textContent='+1';el.style.left=`${e?.clientX??r.width/2}px`;el.style.top=`${e?.clientY??r.height/2}px`;floatLayer.appendChild(el);setTimeout(()=>el.remove(),800)}
function checkUnlock(){const now=motionIndex(localScore);if(now>previousMotion){selectedMotion=now;motionMode='single';storePrefs();toastEl.innerHTML=`✨ ${MOTIONS[now].name}<br><small>새 모션 해금!</small>`;toastEl.classList.add('show');setTimeout(()=>toastEl.classList.remove('show'),2200);ensureProcessed(MOTIONS[now].image)}previousMotion=now}
function optimistic(){if(!user)return;const rows=[...document.querySelectorAll('.rank-row')].map(r=>({username:r.dataset.username,clicks:Number(r.dataset.clicks)})).filter(x=>x.username);const f=rows.find(x=>x.username===user.username);if(f)f.clicks=localScore;else rows.push({username:user.username,clicks:localScore});rows.sort((a,b)=>b.clicks-a.clicks);renderLeaderboard(rows.slice(0,3))}
async function flush(){clearTimeout(flushTimer);flushTimer=null;if(!token||pending<1)return;const amount=pending;pending=0;try{const d=await api('/api/clicks',{method:'POST',body:JSON.stringify({amount})});user=d.user;localScore=Math.max(localScore,user.clicks);applyUser(user);renderScore();renderLeaderboard(d.leaderboard)}catch(e){pending+=amount;console.error(e)}}
function onClick(e){if(!gameReady)return;if(!user){authDialog.showModal();return}localScore++;pending++;playClickFrame();renderScore();checkUnlock();showFloat(e);optimistic();clearTimeout(flushTimer);flushTimer=setTimeout(flush,170)}
async function loadBoard(){try{const d=await api('/api/leaderboard');renderLeaderboard(d.leaderboard)}catch(e){console.error(e)}}
function events(){const es=new EventSource('/api/events');es.addEventListener('leaderboard',e=>{try{renderLeaderboard(JSON.parse(e.data))}catch{}});es.onerror=()=>{es.close();setTimeout(events,4000)}}
function populateSettings(){normalize();motionSelect.innerHTML='';unlocked().forEach(m=>{const o=document.createElement('option');o.value=String(m.index);o.textContent=`${m.name} · ${format(m.threshold)} 클릭`;motionSelect.appendChild(o)});motionSelect.value=String(selectedMotion);const radio=document.querySelector(`input[name="motionMode"][value="${motionMode}"]`);if(radio)radio.checked=true;updateSettingsState()}
function updateSettingsState(){const mode=document.querySelector('input[name="motionMode"]:checked')?.value||'random';motionSelect.disabled=false;motionHint.textContent=mode==='random'?`해금된 ${unlocked().length}개 모션 중 하나가 매번 랜덤으로 나옵니다. 아래 목록에서 모션을 고르면 자동으로 고정 재생으로 바뀝니다.`:'선택한 모션 하나만 계속 나옵니다.'}
async function saveSettings(){motionError.textContent='';motionMode=document.querySelector('input[name="motionMode"]:checked')?.value||'random';selectedMotion=Number(motionSelect.value||0);normalize();storePrefs();try{if(user){const d=await api('/api/preferences',{method:'PUT',body:JSON.stringify({motionMode,selectedMotion})});user=d.user;applyUser(user)}renderScore();motionDialog.close()}catch(e){motionError.textContent=e.message}}

function loadImage(url){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.decoding='async';img.src=url;});}
function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
function colorDist(r1,g1,b1,r2,g2,b2){const dr=r1-r2,dg=g1-g2,db=b1-b2;return Math.sqrt(dr*dr+dg*dg+db*db)}
function isMeadowTone(r,g,b){const max=Math.max(r,g,b),min=Math.min(r,g,b);const sat=max===0?0:(max-min)/max;const bright=max;
  const green=(g>115&&g>=r-12&&g>=b-6&&(g-r>6||g-b>6));
  const petal=(bright>192&&sat<0.18&&g>=r-18&&g>=b-10);
  const yellow=(r>190&&g>176&&b<160&&Math.abs(r-g)<55);
  return green||petal||yellow;
}
function buildEdgeSamples(data,w,h){const samples=[];const step=Math.max(4,Math.floor(Math.min(w,h)/30));
  const push=(x,y)=>{const idx=(y*w+x)*4;const r=data[idx],g=data[idx+1],b=data[idx+2],a=data[idx+3];if(a<220||!isMeadowTone(r,g,b))return;for(const s of samples){if(colorDist(r,g,b,s.r,s.g,s.b)<20)return;}samples.push({r,g,b});};
  for(let x=0;x<w;x+=step){push(x,0);push(x,h-1);}for(let y=0;y<h;y+=step){push(0,y);push(w-1,y);}return samples;
}
function backgroundLike(r,g,b,samples){
  if(!isMeadowTone(r,g,b))return false;
  for(const s of samples){if(colorDist(r,g,b,s.r,s.g,s.b)<50)return true;}
  return false;
}
async function autoCutout(path){
  const img=await loadImage(assetUrl(path));
  const canvas=document.createElement('canvas');
  canvas.width=img.naturalWidth||img.width;
  canvas.height=img.naturalHeight||img.height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(img,0,0);
  const {width:w,height:h}=canvas;
  const image=ctx.getImageData(0,0,w,h);
  const data=image.data;
  const samples=buildEdgeSamples(data,w,h);
  if(!samples.length)return assetUrl(path);
  const bg=new Uint8Array(w*h);
  const visited=new Uint8Array(w*h);
  const qx=new Int32Array(w*h);
  const qy=new Int32Array(w*h);
  let head=0,tail=0;
  const enqueue=(x,y)=>{const pos=y*w+x;if(visited[pos])return;const idx=pos*4;const r=data[idx],g=data[idx+1],b=data[idx+2],a=data[idx+3];if(a<5||!backgroundLike(r,g,b,samples))return;visited[pos]=1;bg[pos]=1;qx[tail]=x;qy[tail]=y;tail++;};
  for(let x=0;x<w;x++){enqueue(x,0);enqueue(x,h-1);}for(let y=0;y<h;y++){enqueue(0,y);enqueue(w-1,y);}
  while(head<tail){const x=qx[head],y=qy[head];head++;if(x>0)enqueue(x-1,y);if(x<w-1)enqueue(x+1,y);if(y>0)enqueue(x,y-1);if(y<h-1)enqueue(x,y+1);}

  // 배경과 바로 닿아 있는 꽃밭 찌꺼기만 한 번 더 정리한다.
  for(let y=1;y<h-1;y++){
    for(let x=1;x<w-1;x++){
      const pos=y*w+x;if(bg[pos])continue;const idx=pos*4;const r=data[idx],g=data[idx+1],b=data[idx+2],a=data[idx+3];if(a<5||!backgroundLike(r,g,b,samples))continue;
      let nearBg=0;
      for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){if(!ox&&!oy)continue;nearBg+=bg[(y+oy)*w+(x+ox)]?1:0;}
      if(nearBg>=6)bg[pos]=1;
    }
  }

  // 알파 처리 + 가장자리 부드럽게.
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const pos=y*w+x,idx=pos*4;
      if(bg[pos]){data[idx+3]=0;continue;}
      let nearBg=0;
      for(let oy=-1;oy<=1;oy++){
        for(let ox=-1;ox<=1;ox++){
          if(!ox&&!oy)continue;
          const nx=x+ox,ny=y+oy;
          if(nx<0||ny<0||nx>=w||ny>=h)continue;
          nearBg+=bg[ny*w+nx]?1:0;
        }
      }
      if(nearBg>=5)data[idx+3]=Math.min(data[idx+3],210);
      else if(nearBg>=3)data[idx+3]=Math.min(data[idx+3],235);
    }
  }
  ctx.putImageData(image,0,0);
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('PNG 변환 실패')),'image/png'));
  const url=URL.createObjectURL(blob);
  objectUrls.add(url);
  return url;
}
async function preloadOne(path){
  const url=assetUrl(path);
  return new Promise((resolve)=>{
    const img=new Image();
    let done=false;
    const finish=(ok)=>{
      if(done)return;
      done=true;
      clearTimeout(timer);
      if(ok){
        decodedImageCache.set(path,img);
        readyAssetPaths.add(path);
      }
      resolve({path,ok});
    };
    const timer=setTimeout(()=>finish(false),8000);
    img.onload=async()=>{
      try{
        if(typeof img.decode==='function')await img.decode();
        finish(true);
      }catch{
        // onload가 성공했으면 decode 오류가 있어도 브라우저가 이미지를 표시할 수 있다.
        finish(true);
      }
    };
    img.onerror=()=>finish(false);
    img.decoding='sync';
    img.src=url;
  });
}
function updateLoading(done,total,label){
  const percent=Math.round((done/total)*100);
  loadingBar.style.width=`${percent}%`;
  loadingCount.textContent=`${done} / ${total}`;
  loadingText.textContent=label||`이미지를 불러오고 있어요… ${percent}%`;
}
async function bootGame(){
  const paths=[
    '/assets/field-background.png',
    '/assets/idle.png',
    '/assets/pressed.png',
    ...MOTIONS.filter(m=>m.threshold>0).map(m=>m.image)
  ];
  let done=0,failed=0;
  updateLoading(0,paths.length,'이미지를 불러오고 있어요…');
  await Promise.all(paths.map(async(path)=>{
    const result=await preloadOne(path);
    if(!result.ok)failed++;
    done++;
    updateLoading(done,paths.length,`이미지를 준비하고 있어요… ${Math.round(done/paths.length*100)}%`);
  }));

  updateLoading(paths.length,paths.length,'캐릭터를 준비하고 있어요…');
  // 모든 캐릭터/모션 이미지를 실제로 누끼 처리한다.
  // 동시에 처리하면 모바일에서 메모리가 크게 튈 수 있어 순차 처리한다.
  for(const path of ['/assets/idle.png', ...MOTIONS.map(m=>m.image)]){
    await ensureProcessed(path);
  }
  const idleSrc=getProcessedSrc('/assets/idle.png');
  const pressedSrc=getProcessedSrc('/assets/pressed.png');
  await Promise.all([loadImage(idleSrc),loadImage(pressedSrc)]);
  idleImage.src=idleSrc;
  motionImage.src=pressedSrc;
  showIdle();

  gameReady=true;
  gameEl.classList.remove('is-loading');
  loadingText.textContent=failed?`일부 이미지 ${failed}개는 필요할 때 다시 불러옵니다.`:'준비 완료!';
  loadingBar.style.width='100%';
  setTimeout(()=>loadingScreen.classList.add('is-hidden'),failed?700:250);
}

authBtn.addEventListener('click',async()=>{if(user){await flush();token='';user=null;localScore=0;localStorage.removeItem('eungae_token');updateAuth();renderScore()}else authDialog.showModal()});
$('#motionSettingsBtn').addEventListener('click',()=>{populateSettings();motionDialog.showModal()});
document.querySelectorAll('input[name="motionMode"]').forEach(x=>x.addEventListener('change',updateSettingsState));
motionSelect.addEventListener('change',()=>{const single=document.querySelector('input[name="motionMode"][value="single"]');if(single)single.checked=true;updateSettingsState();});
$('#saveMotionBtn').addEventListener('click',saveSettings);$('#loginBtn').addEventListener('click',()=>auth('login'));$('#registerBtn').addEventListener('click',()=>auth('register'));
buttonEl.addEventListener('pointerdown',e=>{e.preventDefault();onClick(e)});
window.addEventListener('blur',stopClickAnimation);
window.addEventListener('keydown',e=>{if((e.code==='Space'||e.code==='Enter')&&!e.repeat&&!authDialog.open&&!motionDialog.open){e.preventDefault();onClick();}});

renderLeaderboard();renderScore();updateAuth();
Promise.allSettled([restore(),loadBoard()]).finally(()=>bootGame());
events();

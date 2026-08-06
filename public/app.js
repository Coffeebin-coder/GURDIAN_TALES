'use strict';
const ASSET_VERSION = 17;
const $ = (s) => document.querySelector(s);
const scoreEl=$('#score'),idleImage=$('#idleImage'),motionImage=$('#motionImage'),buttonEl=$('#characterButton'),authBtn=$('#authBtn');
const authDialog=$('#authDialog'),motionDialog=$('#motionDialog'),authError=$('#authError'),motionError=$('#motionError');
const podiumRows=$('#podiumRows'),motionNameEl=$('#motionName'),toastEl=$('#unlockToast'),floatLayer=$('#floatLayer');
const motionSelect=$('#motionSelect'),motionHint=$('#motionSettingHint'),soundToggle=$('#soundEnabled');
const loadingScreen=$('#loadingScreen'),loadingBar=$('#loadingBar'),loadingText=$('#loadingText'),loadingCount=$('#loadingCount'),loadingSkipBtn=$('#loadingSkipBtn'),gameEl=$('.game');
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
let soundEnabled=(localStorage.getItem('eungae_sound_enabled')||'1')!=='0';
let gameReady=false,bootReleased=false;
let bootSafetyTimer=null,loadingSkipTimer=null;
let audioCtx=null;
const processedImageMap = new Map();
const failedAssetPaths = new Set();
const loadWarnings = [];
const format=n=>new Intl.NumberFormat('ko-KR').format(Number(n)||0);
const assetUrl = (path) => `${path}?v=${ASSET_VERSION}`;

function motionIndex(score){let i=0;MOTIONS.forEach((m,n)=>{if(score>=m.threshold)i=n});return i}
function unlocked(){return MOTIONS.map((m,index)=>({...m,index})).filter(m=>localScore>=m.threshold)}
function normalize(){const max=motionIndex(localScore);if(!['random','single'].includes(motionMode))motionMode='random';if(!Number.isInteger(selectedMotion)||selectedMotion<0||selectedMotion>max)selectedMotion=max}
function storePrefs(){localStorage.setItem('eungae_motion_mode',motionMode);localStorage.setItem('eungae_selected_motion',String(selectedMotion));localStorage.setItem('eungae_sound_enabled',soundEnabled?'1':'0')}
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
function fallbackPathFor(path){if(path==='/assets/idle.png')return '/assets/pressed.png';if(path==='/assets/field-background.png')return '/assets/field-background.png';return '/assets/pressed.png';}
function getProcessedSrc(path){return processedImageMap.get(path)||assetUrl(path)}
function noteAssetFailure(path,message){failedAssetPaths.add(path);loadWarnings.push(message);console.warn(message)}
function loadImage(url){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error(`이미지 로드 실패: ${url}`));img.decoding='async';img.src=url;});}
async function ensureProcessed(path){
  if(processedImageMap.has(path))return processedImageMap.get(path);
  const primary=assetUrl(path);
  let finalSrc=primary;
  try{await loadImage(primary);}catch(err){
    const fallbackPath=fallbackPathFor(path);
    finalSrc=assetUrl(fallbackPath);
    noteAssetFailure(path,`${path} 이미지를 불러오지 못해서 ${fallbackPath}로 대체합니다.`);
    if(finalSrc!==primary){
      try{await loadImage(finalSrc);}catch(err2){noteAssetFailure(fallbackPath,`${fallbackPath} 대체 이미지도 불러오지 못했습니다.`)}
    }
  }
  processedImageMap.set(path,finalSrc);
  return finalSrc;
}
async function safeEnsureProcessed(path){try{return await ensureProcessed(path)}catch(err){console.error(err);const fallback=assetUrl(fallbackPathFor(path));processedImageMap.set(path,fallback);return fallback}}
function setImageSource(imgEl,path){
  const desired=getProcessedSrc(path)||assetUrl(path);
  const fallback=assetUrl(fallbackPathFor(path));
  imgEl.dataset.fallbackApplied='0';
  imgEl.onerror=()=>{
    if(imgEl.dataset.fallbackApplied==='1')return;
    imgEl.dataset.fallbackApplied='1';
    noteAssetFailure(path,`${path} 화면 표시 중 오류가 나서 대체 이미지를 사용합니다.`);
    if(imgEl.getAttribute('src')!==fallback)imgEl.setAttribute('src',fallback);
  };
  if(imgEl.getAttribute('src')!==desired)imgEl.setAttribute('src',desired);
}
function showPressed(){const m=chooseMotion();motionImage.alt=`응애공주 ${m.name}`;setImageSource(motionImage,m.image);setFrame(true)}
function showIdle(){setImageSource(idleImage,'/assets/idle.png');setFrame(false)}
function stopClickAnimation(){if(settleTimer){clearTimeout(settleTimer);settleTimer=null;}rapidFrame=0;showIdle()}
function playClickFrame(){const now=performance.now();const isRapid=now-lastTapAt<210;lastTapAt=now;if(!isRapid)rapidFrame=0;const showMotion=rapidFrame%2===0;rapidFrame++;if(showMotion)showPressed();else showIdle();if(settleTimer)clearTimeout(settleTimer);settleTimer=setTimeout(()=>{rapidFrame=0;showIdle();settleTimer=null;},190)}
function showFloat(e){const r=buttonEl.getBoundingClientRect(),el=document.createElement('span');el.className='float-score';el.textContent='+1';el.style.left=`${e?.clientX??r.width/2}px`;el.style.top=`${e?.clientY??r.height/2}px`;floatLayer.appendChild(el);setTimeout(()=>el.remove(),800)}
function checkUnlock(){const now=motionIndex(localScore);if(now>previousMotion){selectedMotion=now;motionMode='single';storePrefs();toastEl.innerHTML=`✨ ${MOTIONS[now].name}<br><small>새 모션 해금!</small>`;toastEl.classList.add('show');setTimeout(()=>toastEl.classList.remove('show'),2200);void safeEnsureProcessed(MOTIONS[now].image)}previousMotion=now}
function optimistic(){if(!user)return;const rows=[...document.querySelectorAll('.rank-row')].map(r=>({username:r.dataset.username,clicks:Number(r.dataset.clicks)})).filter(x=>x.username);const f=rows.find(x=>x.username===user.username);if(f)f.clicks=localScore;else rows.push({username:user.username,clicks:localScore});rows.sort((a,b)=>b.clicks-a.clicks);renderLeaderboard(rows.slice(0,3))}
async function flush(){clearTimeout(flushTimer);flushTimer=null;if(!token||pending<1)return;const amount=pending;pending=0;try{const d=await api('/api/clicks',{method:'POST',body:JSON.stringify({amount})});user=d.user;localScore=Math.max(localScore,user.clicks);applyUser(user);renderScore();renderLeaderboard(d.leaderboard)}catch(e){pending+=amount;console.error(e)}}
function getAudioContext(){const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return null;if(!audioCtx)audioCtx=new Ctx();return audioCtx}
async function playClickSound(){if(!soundEnabled)return;const ctx=getAudioContext();if(!ctx)return;try{if(ctx.state!=='running')await ctx.resume()}catch{return}const now=ctx.currentTime;const osc=ctx.createOscillator();const gain=ctx.createGain();osc.type='triangle';osc.frequency.setValueAtTime(680,now);osc.frequency.exponentialRampToValueAtTime(430,now+.075);gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(.075,now+.01);gain.gain.exponentialRampToValueAtTime(.0001,now+.14);osc.connect(gain);gain.connect(ctx.destination);osc.start(now);osc.stop(now+.15)}
function onClick(e){if(!gameReady)return;if(!user){authDialog.showModal();return}localScore++;pending++;void playClickSound();playClickFrame();renderScore();checkUnlock();showFloat(e);optimistic();clearTimeout(flushTimer);flushTimer=setTimeout(flush,170)}
async function loadBoard(){try{const d=await api('/api/leaderboard');renderLeaderboard(d.leaderboard)}catch(e){console.error(e)}}
function events(){const es=new EventSource('/api/events');es.addEventListener('leaderboard',e=>{try{renderLeaderboard(JSON.parse(e.data))}catch{}});es.onerror=()=>{es.close();setTimeout(events,4000)}}
function populateSettings(){normalize();motionSelect.innerHTML='';unlocked().forEach(m=>{const o=document.createElement('option');o.value=String(m.index);o.textContent=`${m.name} · ${format(m.threshold)} 클릭`;motionSelect.appendChild(o)});motionSelect.value=String(selectedMotion);const radio=document.querySelector(`input[name="motionMode"][value="${motionMode}"]`);if(radio)radio.checked=true;if(soundToggle)soundToggle.checked=soundEnabled;updateSettingsState()}
function updateSettingsState(){const mode=document.querySelector('input[name="motionMode"]:checked')?.value||'random';motionSelect.disabled=false;motionHint.textContent=mode==='random'?`해금된 ${unlocked().length}개 모션 중 하나가 매번 랜덤으로 나옵니다. 아래 목록에서 모션을 고르면 자동으로 고정 재생으로 바뀝니다.`:'선택한 모션 하나만 계속 나옵니다.'}
async function saveSettings(){motionError.textContent='';motionMode=document.querySelector('input[name="motionMode"]:checked')?.value||'random';selectedMotion=Number(motionSelect.value||0);soundEnabled=!!soundToggle?.checked;normalize();storePrefs();try{if(user){const d=await api('/api/preferences',{method:'PUT',body:JSON.stringify({motionMode,selectedMotion})});user=d.user;applyUser(user)}renderScore();motionDialog.close()}catch(e){motionError.textContent=e.message}}
async function prepareEssentialFrames(){await Promise.all([safeEnsureProcessed('/assets/idle.png'),safeEnsureProcessed('/assets/pressed.png')]);setImageSource(idleImage,'/assets/idle.png');setImageSource(motionImage,'/assets/pressed.png');showIdle()}
function updateLoading(done,total,label){const percent=Math.round((done/total)*100);loadingBar.style.width=`${percent}%`;loadingCount.textContent=`${done} / ${total}`;loadingText.textContent=label||`이미지를 불러오고 있어요… ${percent}%`}
function finishBoot(){
  if(bootReleased)return;
  bootReleased=true;
  clearTimeout(bootSafetyTimer);
  clearTimeout(loadingSkipTimer);
  loadingSkipBtn.classList.remove('is-visible');
  gameReady=true;
  gameEl.classList.remove('is-loading');
  const failed=failedAssetPaths.size;
  loadingBar.style.width='100%';
  loadingCount.textContent=`${MOTIONS.length+2} / ${MOTIONS.length+2}`;
  loadingText.textContent=failed?`일부 이미지 ${failed}개는 자동으로 대체해서 시작합니다.`:'준비 완료!';
  setTimeout(()=>loadingScreen.classList.add('is-hidden'),failed?650:250);
}
async function forceBootFromLoading(){if(bootReleased)return;loadingText.textContent='준비된 이미지로 먼저 시작합니다…';await prepareEssentialFrames();finishBoot()}
async function preloadOne(path){const url=assetUrl(path);return new Promise((resolve)=>{const img=new Image();let done=false;const finish=(ok)=>{if(done)return;done=true;clearTimeout(timer);resolve({path,ok})};const timer=setTimeout(()=>finish(false),8000);img.onload=async()=>{try{if(typeof img.decode==='function')await img.decode();finish(true)}catch{finish(true)}};img.onerror=()=>finish(false);img.decoding='sync';img.src=url;})}
async function bootGame(){
  const paths=[...new Set(['/assets/field-background.png','/assets/idle.png','/assets/pressed.png',...MOTIONS.filter(m=>m.threshold>0).map(m=>m.image)])];
  updateLoading(0,paths.length,'이미지를 불러오고 있어요…');
  loadingSkipTimer=setTimeout(()=>loadingSkipBtn.classList.add('is-visible'),3200);
  bootSafetyTimer=setTimeout(()=>{void forceBootFromLoading()},12000);
  try{
    let done=0;
    await Promise.all(paths.map(async(path)=>{const result=await preloadOne(path);if(!result.ok)noteAssetFailure(path,`${path} 사전 로딩에 실패했습니다.`);done++;updateLoading(done,paths.length,`이미지를 준비하고 있어요… ${Math.round(done/paths.length*100)}%`)}));
    updateLoading(paths.length,paths.length,'캐릭터를 준비하고 있어요…');
    for(const path of ['/assets/idle.png',...MOTIONS.map(m=>m.image)]){
      await safeEnsureProcessed(path);
      if(bootReleased)return;
    }
    await prepareEssentialFrames();
  }catch(e){console.error(e)}finally{finishBoot()}
}

loadingSkipBtn?.addEventListener('click',()=>{void forceBootFromLoading()});
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

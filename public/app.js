'use strict';
const $ = (s) => document.querySelector(s);
const scoreEl=$('#score'),idleImage=$('#idleImage'),motionImage=$('#motionImage'),buttonEl=$('#characterButton'),authBtn=$('#authBtn');
const authDialog=$('#authDialog'),motionDialog=$('#motionDialog'),authError=$('#authError'),motionError=$('#motionError');
const podiumRows=$('#podiumRows'),motionNameEl=$('#motionName'),toastEl=$('#unlockToast'),floatLayer=$('#floatLayer');
const motionSelect=$('#motionSelect'),motionHint=$('#motionSettingHint');
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
const format=n=>new Intl.NumberFormat('ko-KR').format(Number(n)||0);
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
async function restore(){if(!token){renderScore();return}try{const d=await api('/api/me');user=d.user;localScore=user.clicks;applyUser(user);previousMotion=motionIndex(localScore)}catch{token='';localStorage.removeItem('eungae_token')}updateAuth();renderScore()}
async function auth(mode){authError.textContent='';try{const d=await api(`/api/auth/${mode}`,{method:'POST',body:JSON.stringify({username:$('#username').value.trim(),password:$('#password').value})});token=d.token;user=d.user;localScore=user.clicks;applyUser(user);previousMotion=motionIndex(localScore);localStorage.setItem('eungae_token',token);updateAuth();renderScore();authDialog.close()}catch(e){authError.textContent=e.message}}
function chooseMotion(){const list=unlocked();if(motionMode==='single')return MOTIONS[selectedMotion]||list.at(-1)||MOTIONS[0];if(list.length===1)return list[0];let i=Math.floor(Math.random()*list.length);if(i===lastRandom)i=(i+1)%list.length;lastRandom=i;return list[i]}
function setFrame(showMotion){
  idleImage.classList.toggle('is-visible',!showMotion);
  motionImage.classList.toggle('is-visible',showMotion);
  buttonEl.classList.toggle('is-pressed',showMotion);
}
function showPressed(){
  const m=chooseMotion();
  const nextSrc=`${m.image}?v=7`;
  if(motionImage.getAttribute('src')!==nextSrc)motionImage.setAttribute('src',nextSrc);
  motionImage.alt=`응애공주 ${m.name}`;
  setFrame(true);
}
function showIdle(){
  setFrame(false);
}
function stopClickAnimation(){
  if(settleTimer){clearTimeout(settleTimer);settleTimer=null;}
  rapidFrame=0;
  showIdle();
}
function playClickFrame(){
  const now=performance.now();
  const isRapid=now-lastTapAt<210;
  lastTapAt=now;

  // 느린 클릭은 항상 눌린 모습을 먼저 보여준다.
  // 빠른 연타 중에는 클릭마다 기본/눌림을 정확히 번갈아 표시한다.
  if(!isRapid)rapidFrame=0;
  const showMotion=rapidFrame%2===0;
  rapidFrame++;
  if(showMotion)showPressed();else showIdle();

  if(settleTimer)clearTimeout(settleTimer);
  settleTimer=setTimeout(()=>{
    rapidFrame=0;
    showIdle();
    settleTimer=null;
  },150);
}
function preloadMotionImages(){
  ['/assets/idle.png',...MOTIONS.map(m=>m.image)].forEach(src=>{
    const img=new Image();
    img.decoding='async';
    img.src=`${src}?v=7`;
  });
}
function showFloat(e){const r=buttonEl.getBoundingClientRect(),el=document.createElement('span');el.className='float-score';el.textContent='+1';el.style.left=`${e?.clientX??r.width/2}px`;el.style.top=`${e?.clientY??r.height/2}px`;floatLayer.appendChild(el);setTimeout(()=>el.remove(),800)}
function checkUnlock(){const now=motionIndex(localScore);if(now>previousMotion){selectedMotion=now;storePrefs();toastEl.innerHTML=`✨ ${MOTIONS[now].name}<br><small>새 모션 해금!</small>`;toastEl.classList.add('show');setTimeout(()=>toastEl.classList.remove('show'),2200)}previousMotion=now}
function optimistic(){if(!user)return;const rows=[...document.querySelectorAll('.rank-row')].map(r=>({username:r.dataset.username,clicks:Number(r.dataset.clicks)})).filter(x=>x.username);const f=rows.find(x=>x.username===user.username);if(f)f.clicks=localScore;else rows.push({username:user.username,clicks:localScore});rows.sort((a,b)=>b.clicks-a.clicks);renderLeaderboard(rows.slice(0,3))}
async function flush(){clearTimeout(flushTimer);flushTimer=null;if(!token||pending<1)return;const amount=pending;pending=0;try{const d=await api('/api/clicks',{method:'POST',body:JSON.stringify({amount})});user=d.user;localScore=Math.max(localScore,user.clicks);applyUser(user);renderScore();renderLeaderboard(d.leaderboard)}catch(e){pending+=amount;console.error(e)}}
function onClick(e){if(!user){authDialog.showModal();return}localScore++;pending++;playClickFrame();renderScore();checkUnlock();showFloat(e);optimistic();clearTimeout(flushTimer);flushTimer=setTimeout(flush,170)}
async function loadBoard(){try{const d=await api('/api/leaderboard');renderLeaderboard(d.leaderboard)}catch(e){console.error(e)}}
function events(){const es=new EventSource('/api/events');es.addEventListener('leaderboard',e=>{try{renderLeaderboard(JSON.parse(e.data))}catch{}});es.onerror=()=>{es.close();setTimeout(events,4000)}}
function populateSettings(){normalize();motionSelect.innerHTML='';unlocked().forEach(m=>{const o=document.createElement('option');o.value=String(m.index);o.textContent=`${m.name} · ${format(m.threshold)} 클릭`;motionSelect.appendChild(o)});motionSelect.value=String(selectedMotion);const radio=document.querySelector(`input[name="motionMode"][value="${motionMode}"]`);if(radio)radio.checked=true;updateSettingsState()}
function updateSettingsState(){const mode=document.querySelector('input[name="motionMode"]:checked')?.value||'random';motionSelect.disabled=mode!=='single';motionHint.textContent=mode==='random'?`해금된 ${unlocked().length}개 모션 중 하나가 매번 랜덤으로 나옵니다.`:'선택한 모션 하나만 계속 나옵니다.'}
async function saveSettings(){motionError.textContent='';motionMode=document.querySelector('input[name="motionMode"]:checked')?.value||'random';selectedMotion=Number(motionSelect.value||0);normalize();storePrefs();try{if(user){const d=await api('/api/preferences',{method:'PUT',body:JSON.stringify({motionMode,selectedMotion})});user=d.user;applyUser(user)}renderScore();motionDialog.close()}catch(e){motionError.textContent=e.message}}
authBtn.addEventListener('click',async()=>{if(user){await flush();token='';user=null;localScore=0;localStorage.removeItem('eungae_token');updateAuth();renderScore()}else authDialog.showModal()});
$('#motionSettingsBtn').addEventListener('click',()=>{populateSettings();motionDialog.showModal()});
document.querySelectorAll('input[name="motionMode"]').forEach(x=>x.addEventListener('change',updateSettingsState));
$('#saveMotionBtn').addEventListener('click',saveSettings);$('#loginBtn').addEventListener('click',()=>auth('login'));$('#registerBtn').addEventListener('click',()=>auth('register'));
buttonEl.addEventListener('pointerdown',e=>{e.preventDefault();onClick(e)});
window.addEventListener('blur',stopClickAnimation);
window.addEventListener('keydown',e=>{
  if((e.code==='Space'||e.code==='Enter')&&!e.repeat&&!authDialog.open&&!motionDialog.open){
    e.preventDefault();
    onClick();
  }
});
preloadMotionImages();renderLeaderboard();renderScore();restore();loadBoard();events();

'use strict';

const GROUPS = {
  broad: {label:'Broad US equity', color:getComputedStyle(document.documentElement).getPropertyValue('--broad').trim()},
  sector:{label:'US sectors / REIT', color:getComputedStyle(document.documentElement).getPropertyValue('--sector').trim()},
  intl:  {label:'International equity', color:getComputedStyle(document.documentElement).getPropertyValue('--intl').trim()},
  fixed: {label:'Fixed income / credit', color:getComputedStyle(document.documentElement).getPropertyValue('--fixed').trim()},
  commodity:{label:'Commodities', color:getComputedStyle(document.documentElement).getPropertyValue('--commodity').trim()},
  currency:{label:'Currency', color:getComputedStyle(document.documentElement).getPropertyValue('--currency').trim()}
};
const GROUP_KEY = Object.fromEntries(Object.entries(GROUPS).map(([key,value])=>[value.label,key]));
const REGIME_COLORS={Normal:'#e7eee3',Rally:'#cfe4d3',Caution:'#f6e7bf',Crisis:'#efd2cd',Euphoria:'#f1d6c6',Unavailable:'#f5f0e8'};
const REGIME_TEXT={
  Normal:'No broad ORCA risk override. Let security selection, valuation, and catalyst quality drive the book.',
  Rally:'Rally conditions are unusually constructive while crash risk remains contained.',
  Caution:'The market may still rise, but diversification is weakening and marginal risk should be reduced.',
  Crisis:'The crash threshold is crossed. Capital preservation dominates adding broad equity beta.',
  Euphoria:'Rally confidence is extreme. The paper treats this as overextension rather than a stronger buy signal.'
};

let DATA=null;
let ASSETS=[];
let MARKET_HISTORY=[];
let controlsBound=false;
const state={
  estimator:'composite', threshold:.50, edgeMode:'absolute', outcomeYears:5,
  outcomeDisplay:'level', outcomeIndex:'spy', outcomeMode:'research', selected:null,
  assetSelected:'SPY', sort:'links', query:''
};

const $=id=>document.getElementById(id);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const finite=x=>x!=null&&Number.isFinite(Number(x));
const fmt=(x,d=1)=>finite(x)?Number(x).toFixed(d):'—';
const signedNum=(v,d=2,suffix='')=>finite(v)?`${Number(v)>=0?'+':''}${Number(v).toFixed(d)}${suffix}`:'—';
const fmtPctPoints=(x,d=1)=>finite(x)?`${Number(x)>=0?'+':''}${Number(x).toFixed(d)}%`:'—';
const pct=(x,d=1,signed=false)=>finite(x)?`${signed&&Number(x)>=0?'+':''}${(Number(x)*100).toFixed(d)}%`:'—';
const median=arr=>{const x=arr.filter(finite).map(Number).sort((a,b)=>a-b);if(!x.length)return null;const m=Math.floor(x.length/2);return x.length%2?x[m]:(x[m-1]+x[m])/2};
const relationshipLevel=v=>v>=.50?['High','high']:v>=.32?['Medium','medium']:['Low','low'];
const riskLabel=v=>v>=85?'Extreme':v>=70?'High':v>=50?'Elevated':v>=30?'Normal':'Low';
const stressColor=v=>v>=80?'var(--red)':v>=65?'var(--orange)':v>=45?'var(--amber)':'var(--green)';

function estimatorTag(){
  return state.estimator==='composite'?'Composite · all estimators':state.estimator==='ewm'?'EWM · 30D half-life':state.estimator==='60d'?'Rolling · 60D':'Rolling · 120D';
}
function currentEstimator(){return DATA.estimators[state.estimator]||DATA.estimators.composite;}
function buildMatrix(){return currentEstimator().matrix;}
function graphStats(matrix){
  const n=matrix.length,avg=[],central=[],strongest=[];
  for(let i=0;i<n;i++){
    let sum=0,count=0,best={j:-1,v:0};
    for(let j=0;j<n;j++)if(i!==j){
      const raw=Number(matrix[i][j]),abs=Math.abs(raw);sum+=abs;
      const qualifies=state.edgeMode==='positive'?raw>=state.threshold:abs>=state.threshold;
      if(qualifies)count++;
      if(abs>Math.abs(best.v))best={j,v:raw};
    }
    avg[i]=sum/(n-1);central[i]=count/(n-1);strongest[i]=best;
  }
  const maxC=Math.max(...central,1e-6);
  return {avg,central:central.map(v=>v/maxC),strongest,counts:central.map(v=>Math.round(v*(n-1)))};
}
function recentChange(key,days=10){
  if(MARKET_HISTORY.length<=days)return null;
  const a=MARKET_HISTORY.at(-1)[key],b=MARKET_HISTORY.at(-1-days)[key];
  return finite(a)&&finite(b)?Number(a)-Number(b):null;
}

async function loadData(){
  try{
    const res=await fetch(`data/dashboard.json?v=${Date.now()}`,{cache:'no-store'});
    if(!res.ok)throw new Error(`HTTP ${res.status}`);
    DATA=await res.json();
    ASSETS=DATA.universe.map(a=>({t:a.ticker,n:a.name,g:GROUP_KEY[a.group]||'broad',role:a.role,group:a.group}));
    MARKET_HISTORY=DATA.history.map(h=>({
      d:new Date(`${h.date}T00:00:00Z`),
      spy:h.SPY,qqq:h.QQQ,iwm:h.IWM,
      spyRolling:h.SPY_rolling_1y,qqqRolling:h.QQQ_rolling_1y,iwmRolling:h.IWM_rolling_1y,
      rally:h.rally_rank,crash:h.crash_rank,rallyScore:h.rally_score,crashScore:h.crash_score,
      regime:h.regime||'Unavailable',exposure:h.exposure,effectiveRank:h.effective_rank,
      density:finite(h.edge_density_05)?Number(h.edge_density_05)*100:null,
      ar1:finite(h.ar1)?Number(h.ar1)*100:null,
      drawdown20:h.drawdown_20d,drawdown60:h.drawdown_60d,realizedVol20:h.realized_vol_20d,breadth20:h.breadth_20d
    }));
    renderHeader();
    renderLegend();
    wire();
    renderAll();
  }catch(err){
    console.error(err);
    $('engineStatusBadge').textContent='Data load failed';
    $('engineStatusBadge').className='status-badge data-error';
    $('dataModeBadge').textContent='Error';
    $('dataModeBadge').className='mock-badge data-error';
    $('dataNotice').innerHTML=`<strong>Data error:</strong> ${esc(err.message)}. The dashboard was not rendered because the data bundle could not be loaded.`;
    $('navStatus').textContent='● data unavailable';
    $('navStatus').style.color='var(--red)';
  }
}

function renderHeader(){
  const live=DATA.meta.data_mode==='live',latest=DATA.meta.latest_market_date;
  $('engineStatusBadge').textContent=live?'Live engine healthy':'Demo engine healthy';
  $('engineStatusBadge').className=`status-badge ${live?'data-live':'data-demo'}`;
  $('dataModeBadge').textContent=live?'Live EODHD-derived data':'Deterministic demo data';
  $('dataModeBadge').className=`mock-badge ${live?'data-live':'data-demo'}`;
  $('dataNotice').innerHTML=live
    ? `<strong>Live status:</strong> all displayed values are derived from EODHD data through <strong>${esc(latest)}</strong>. Percentile ranks are relative risk context—not literal event probabilities or a standalone trading instruction. Hover over, or click, any <strong>ⓘ</strong> icon for a plain-language explanation.`
    : `<strong>Demo status:</strong> the page is using deterministic sample data, not a live signal. Percentile ranks are relative risk context—not literal event probabilities. Hover over, or click, any <strong>ⓘ</strong> icon for a plain-language explanation.`;
  $('asOfText').textContent=`Market data through ${latest} · generated ${new Date(DATA.meta.generated_at_utc).toLocaleString('en-GB',{timeZone:'Asia/Jakarta',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})} WIB`;
  $('navStatus').textContent=`● ${live?'live':'demo'} engine healthy`;
  $('navStatus').style.color='var(--green)';
  $('estimatorSelect').value=state.estimator;
}

function renderKpis(){
  const c=DATA.current,m=currentEstimator().metrics;
  const crashChg=recentChange('crash',10),rallyChg=recentChange('rally',10);
  const items=[
    ['Market regime',c.regime,`${c.confirmation.count} of ${c.confirmation.total} estimators confirm deterioration`,c.summary.headline,c.regime==='Crisis'?'up-bad':c.regime==='Caution'?'watch':'down-good'],
    ['Crash-risk rank',`${fmt(c.crash_rank,0)}th pct`,`ORCA-Lite score: ${fmt(c.crash_score,1)}`,`${signedNum(crashChg,0)} pts / 10D`,c.crash_rank>=60?'up-bad':c.crash_rank>=40?'watch':'down-good'],
    ['Rally rank',`${fmt(c.rally_rank,0)}th pct`,`ORCA-Lite score: ${fmt(c.rally_score,1)}`,`${signedNum(rallyChg,0)} pts / 10D`,c.rally_rank>=90?'up-bad':c.rally_rank>=78?'down-good':'watch'],
    ['Equity risk budget',`${fmt(c.suggested_equity_exposure,1)}×`,'Paper-style exposure map','Illustrative portfolio overlay','neutral'],
    ['Effective rank',`${fmt(m.effective_rank.value,1)} / 24`,'Estimated independent bets',`${signedNum(m.effective_rank.change_20d,1)} / 20D`,Number(m.effective_rank.change_20d)<0?'up-bad':'down-good'],
    ['Dominant factor',pct(m.ar1.value,1),'Variance absorbed by factor #1',`${signedNum(Number(m.ar1.change_20d)*100,1)} pp / 20D`,Number(m.ar1.change_20d)>0?'up-bad':'down-good']
  ];
  $('kpiGrid').innerHTML=items.map(x=>`<div class="kpi"><div class="kpi-label">${esc(x[0])}</div><div class="kpi-value">${esc(x[1])}</div><div class="kpi-meta">${esc(x[2])}</div><span class="delta ${x[4]}">${esc(x[3])}</span></div>`).join('');
}

function renderDecision(){
  const c=DATA.current,svg=$('regimeMap'),W=560,H=360,p={l:62,r:24,t:22,b:48},w=W-p.l-p.r,h=H-p.t-p.b;
  const x=v=>p.l+w*v/100,y=v=>p.t+h*(1-v/100);
  const rect=(x0,y0,x1,y1,fill,op=.85)=>`<rect x="${x(x0)}" y="${y(y1)}" width="${x(x1)-x(x0)}" height="${y(y0)-y(y1)}" fill="${fill}" opacity="${op}"/>`;
  let out=`<rect x="${p.l}" y="${p.t}" width="${w}" height="${h}" rx="9" fill="#f7f1e7" stroke="#d9cbb8"/>`;
  out+=rect(0,60,100,100,'#efd7d2',.95)+rect(0,40,100,60,'#f7e9c7',.95)+rect(90,0,100,60,'#f2d8c8',.95)+rect(78,0,90,40,'#dcebdc',.98)+rect(0,0,78,40,'#edf1e7',.8);
  for(let v=0;v<=100;v+=20){out+=`<line x1="${x(v)}" y1="${p.t}" x2="${x(v)}" y2="${p.t+h}" stroke="#dfd4c5"/><line x1="${p.l}" y1="${y(v)}" x2="${p.l+w}" y2="${y(v)}" stroke="#dfd4c5"/><text x="${x(v)}" y="${p.t+h+19}" text-anchor="middle" font-size="9" fill="#786b5b">${v}</text><text x="${p.l-12}" y="${y(v)+3}" text-anchor="end" font-size="9" fill="#786b5b">${v}</text>`}
  out+=`<line x1="${x(90)}" y1="${p.t}" x2="${x(90)}" y2="${p.t+h}" stroke="#b85e31" stroke-dasharray="5 4"/><line x1="${p.l}" y1="${y(60)}" x2="${p.l+w}" y2="${y(60)}" stroke="#a84234" stroke-dasharray="5 4"/><line x1="${x(78)}" y1="${y(40)}" x2="${x(90)}" y2="${y(40)}" stroke="#4f7f59" stroke-dasharray="4 4"/>`;
  out+=`<text x="${x(50)}" y="${y(82)}" text-anchor="middle" font-size="15" font-family="Georgia" font-weight="700" fill="#8a3d32">CRISIS / DANGER EXIT</text><text x="${x(47)}" y="${y(49)}" text-anchor="middle" font-size="14" font-family="Georgia" font-weight="700" fill="#86601d">CAUTION</text><text x="${x(95)}" y="${y(29)}" text-anchor="middle" font-size="12" font-family="Georgia" font-weight="700" fill="#994f2e" transform="rotate(-90 ${x(95)} ${y(29)})">EUPHORIA EXIT</text><text x="${x(84)}" y="${y(19)}" text-anchor="middle" font-size="12" font-family="Georgia" font-weight="700" fill="#477353">RALLY SWEET SPOT</text><text x="${x(37)}" y="${y(19)}" text-anchor="middle" font-size="13" font-family="Georgia" font-weight="700" fill="#66755d">NORMAL / BUILDING</text>`;
  const rr=Number(c.rally_rank),cr=Number(c.crash_rank);
  out+=`<line x1="${x(rr)}" y1="${p.t}" x2="${x(rr)}" y2="${p.t+h}" stroke="#4f3d2a" stroke-opacity=".35" stroke-dasharray="3 5"/><line x1="${p.l}" y1="${y(cr)}" x2="${p.l+w}" y2="${y(cr)}" stroke="#4f3d2a" stroke-opacity=".35" stroke-dasharray="3 5"/><circle cx="${x(rr)}" cy="${y(cr)}" r="13" fill="#fff8ed" stroke="#4a3726" stroke-width="3"/><circle cx="${x(rr)}" cy="${y(cr)}" r="5" fill="#a84234"/><text x="${x(rr)+18}" y="${y(cr)-13}" font-size="10" font-weight="850" fill="#4f3b2a">Rally ${fmt(rr,0)} · Crash ${fmt(cr,0)}</text>`;
  out+=`<text x="${p.l+w/2}" y="${H-10}" text-anchor="middle" font-size="10" font-weight="800" fill="#665848">Rally rank →</text><text x="14" y="${p.t+h/2}" text-anchor="middle" font-size="10" font-weight="800" fill="#665848" transform="rotate(-90 14 ${p.t+h/2})">Crash rank →</text>`;
  svg.innerHTML=out;

  $('pmRegime').textContent=c.regime;
  $('pmSummary').textContent=c.summary.interpretation;
  $('exposureNumber').textContent=`${fmt(c.suggested_equity_exposure,1)}×`;
  const exposure=Number(c.suggested_equity_exposure),equity=Math.min(1,Math.max(0,exposure)),freed=Math.max(0,1-equity),def=c.defensive_allocation_of_freed_capital||{GLD:.5,IEF:.3,UUP:.2};
  const alloc=[
    ['Equity',equity,'#665a8d'],['GLD',freed*Number(def.GLD||0),'#9b7c28'],['IEF',freed*Number(def.IEF||0),'#51718a'],['UUP',freed*Number(def.UUP||0),'#8b5550']
  ].filter(x=>x[1]>.001);
  $('allocBar').innerHTML=alloc.map(x=>`<div class="alloc-seg" style="width:${x[1]*100}%;background:${x[2]}">${x[1]>=.08?`${x[0]} ${(x[1]*100).toFixed(0)}%`:''}</div>`).join('');
  $('allocLegend').innerHTML=alloc.map(x=>`<div class="alloc-item"><i class="swatch" style="background:${x[2]}"></i>${x[0]} ${(x[1]*100).toFixed(0)}%</div>`).join('');
  const actions=[
    ['↘',c.summary.headline,c.summary.action],
    ['◇','Interpret the signal, not just the number',c.summary.interpretation],
    ['✓','Wait for a clear invalidation',c.summary.invalidation],
    ['!',`${c.confirmation.count} of ${c.confirmation.total} structural estimators deteriorating`,c.confirmation.message]
  ];
  $('actionList').innerHTML=actions.map(a=>`<div class="action-item"><div class="action-icon">${a[0]}</div><div><div class="action-title">${esc(a[1])}</div><div class="action-copy">${esc(a[2])}</div></div></div>`).join('');
  document.querySelector('.trigger-box').innerHTML=`<strong>Next decision trigger:</strong> ${esc(c.summary.invalidation)} The crash danger threshold remains the 60th percentile; rally euphoria begins above the 90th percentile.`;
}

function indexLabel(){return state.outcomeIndex==='qqq'?'QQQ · Nasdaq 100':state.outcomeIndex==='iwm'?'IWM · Russell 2000':'SPY · S&P 500'}
function indexKey(){return state.outcomeIndex;}
function rollingDrawdown(arr,i,key,lookback=20){const lo=Math.max(0,i-lookback+1),vals=arr.slice(lo,i+1).map(x=>x[key]).filter(finite).map(Number);if(!vals.length||!finite(arr[i][key]))return null;return Number(arr[i][key])/Math.max(...vals)-1}
function forwardReturn(arr,i,key,n=10){return i+n<arr.length&&finite(arr[i][key])&&finite(arr[i+n][key])?Number(arr[i+n][key])/Number(arr[i][key])-1:null}
function forwardMaxDrawdown(arr,i,key,n=10){if(i+n>=arr.length||!finite(arr[i][key]))return null;const start=Number(arr[i][key]),vals=arr.slice(i+1,i+n+1).map(x=>finite(x[key])?Number(x[key])/start-1:null).filter(finite);return vals.length?Math.min(0,...vals):null}
function rollingYearReturn(arr,i,key){return i>=252&&finite(arr[i][key])&&finite(arr[i-252][key])?Number(arr[i][key])/Number(arr[i-252][key])-1:null}
function regimeSegments(data){const seg=[];let start=0;if(!data.length)return seg;for(let i=1;i<=data.length;i++){if(i===data.length||data[i].regime!==data[start].regime){seg.push({start,end:i-1,regime:data[start].regime});start=i}}return seg}
function stepPath(data,x,y,key){if(!data.length)return '';let p=`M ${x(0)} ${y(Number(data[0][key]||0))}`;for(let i=1;i<data.length;i++)p+=` L ${x(i)} ${y(Number(data[i-1][key]||0))} L ${x(i)} ${y(Number(data[i][key]||0))}`;return p}

function showOutcomeSnapshot(d,globalIndex){
  const key=indexKey(),dd=rollingDrawdown(MARKET_HISTORY,globalIndex,key,20),yoy=rollingYearReturn(MARKET_HISTORY,globalIndex,key),f10=forwardReturn(MARKET_HISTORY,globalIndex,key,10),mdd=forwardMaxDrawdown(MARKET_HISTORY,globalIndex,key,10),research=state.outcomeMode==='research';
  $('outcomeSnapshot').innerHTML=`<div><div class="eyebrow">Selected date</div><h3>${esc(d.regime)}</h3><div class="outcome-date">${d.d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'})} · ${indexLabel()}</div></div><div class="outcome-readout">${esc(REGIME_TEXT[d.regime]||'Regime unavailable.')}</div><div class="outcome-stat-grid"><div class="outcome-stat"><span>Index level</span><strong>${fmt(d[key],2)}</strong></div><div class="outcome-stat"><span>Rolling 1Y return</span><strong style="color:${yoy==null?'var(--muted)':yoy<0?'var(--red)':'var(--green)'}">${yoy==null?'—':signedNum(yoy*100,1,'%')}</strong></div><div class="outcome-stat"><span>20D drawdown</span><strong style="color:${dd<0?'var(--red)':'var(--green)'}">${dd==null?'—':signedNum(dd*100,1,'%')}</strong></div><div class="outcome-stat"><span>Rally rank</span><strong>${fmt(d.rally,0)}th</strong></div><div class="outcome-stat"><span>Crash rank</span><strong>${fmt(d.crash,0)}th</strong></div><div class="outcome-stat"><span>Effective bets</span><strong>${fmt(d.effectiveRank,1)}</strong></div><div class="outcome-stat"><span>Equity exposure</span><strong>${fmt(d.exposure,1)}×</strong></div></div><div class="outcome-research">${research?(f10==null?'Research outcome is unavailable near the end of the sample. Move the cursor to an earlier date.':`<strong>Research-only future outcome</strong><br>Next 10D return: <span class="${f10>=0?'pos':'neg'}">${signedNum(f10*100,1,'%')}</span><br>Next 10D maximum drawdown: <span class="neg">${signedNum(mdd*100,1,'%')}</span>`):'<strong>Live view:</strong> future return and drawdown are intentionally hidden because they were not known on this date.'}</div>`;
}

function renderOutcomeMonitor(){
  const svg=$('marketOutcomeChart'),shell=$('outcomeChartShell'),key=indexKey(),n=Math.min(MARKET_HISTORY.length,state.outcomeYears*252),offset=MARKET_HISTORY.length-n,data=MARKET_HISTORY.slice(-n),W=Math.max(760,shell.clientWidth-16||980),H=525;
  if(data.length<3){svg.innerHTML='<text x="50" y="80">Insufficient history.</text>';return;}
  const p={l:54,r:62,t:25,b:25},plotW=W-p.l-p.r,priceTop=25,priceH=245,signalTop=302,signalH=120,expTop=454,expH=42,x=i=>p.l+plotW*i/(data.length-1);
  const base=Number(data.find(d=>finite(d[key]))?.[key]||1),levelSeries=data.map(d=>finite(d[key])?Number(d[key])/base*100:null),yoySeries=data.map((d,i)=>{const g=offset+i;const y=rollingYearReturn(MARKET_HISTORY,g,key);return y==null?null:y*100}),topSeries=state.outcomeDisplay==='yoy'?yoySeries:levelSeries,valid=topSeries.filter(finite).map(Number);
  let minP=Math.min(...valid),maxP=Math.max(...valid),yPrice;
  if(state.outcomeDisplay==='yoy'){minP=Math.min(Math.floor((minP-4)/10)*10,-10);maxP=Math.max(Math.ceil((maxP+4)/10)*10,10);yPrice=v=>priceTop+priceH*(1-(v-minP)/(maxP-minP));}
  else{const pad=(maxP-minP)*.10||2;minP-=pad;maxP+=pad;yPrice=v=>priceTop+priceH*(1-(v-minP)/(maxP-minP));}
  const ySig=v=>signalTop+signalH*(1-v/100),yExp=v=>expTop+expH*(1-v/1.5),pathFrom=(vals,yFn)=>{let pth='',open=false;vals.forEach((v,i)=>{if(!finite(v)){open=false;return}pth+=`${open?' L':' M'} ${x(i).toFixed(1)} ${yFn(Number(v)).toFixed(1)}`;open=true});return pth};
  let html=`<rect x="${p.l}" y="${priceTop}" width="${plotW}" height="${expTop+expH-priceTop}" fill="#fffdf8"/>`;
  regimeSegments(data).forEach(s=>{const x0=x(s.start),x1=x(Math.min(data.length-1,s.end+1));html+=`<rect x="${x0}" y="${priceTop}" width="${Math.max(1,x1-x0)}" height="${expTop+expH-priceTop}" fill="${REGIME_COLORS[s.regime]||REGIME_COLORS.Unavailable}" opacity=".55"/>`;});
  for(let k=0;k<=4;k++){const v=minP+(maxP-minP)*k/4,yy=yPrice(v);html+=`<line x1="${p.l}" y1="${yy}" x2="${p.l+plotW}" y2="${yy}" stroke="#e1d7c9"/><text x="${p.l-7}" y="${yy+3}" text-anchor="end" font-size="8" fill="#817362">${state.outcomeDisplay==='yoy'?v.toFixed(0)+'%':v.toFixed(0)}</text>`;}
  if(state.outcomeDisplay==='yoy'&&minP<0&&maxP>0)html+=`<line x1="${p.l}" y1="${yPrice(0)}" x2="${p.l+plotW}" y2="${yPrice(0)}" stroke="#625342" stroke-width="1.25" stroke-dasharray="4 4"/><text x="${p.l+plotW-3}" y="${yPrice(0)-4}" text-anchor="end" font-size="7.5" fill="#625342">0%</text>`;
  [0,20,40,60,80,100].forEach(v=>{const yy=ySig(v);html+=`<line x1="${p.l}" y1="${yy}" x2="${p.l+plotW}" y2="${yy}" stroke="#e4dace"/><text x="${p.l-7}" y="${yy+3}" text-anchor="end" font-size="8" fill="#817362">${v}</text>`;});
  [0,.5,1,1.5].forEach(v=>{const yy=yExp(v);html+=`<text x="${p.l+plotW+7}" y="${yy+3}" font-size="8" fill="#817362">${v.toFixed(1)}×</text>`;});
  html+=`<rect x="${p.l}" y="${priceTop}" width="${plotW}" height="${priceH}" fill="none" stroke="#cfc1ae"/><rect x="${p.l}" y="${signalTop}" width="${plotW}" height="${signalH}" fill="none" stroke="#cfc1ae"/><rect x="${p.l}" y="${expTop}" width="${plotW}" height="${expH}" fill="none" stroke="#cfc1ae"/>`;
  const rallyPath=data.map((d,i)=>`${i?'L':'M'} ${x(i).toFixed(1)} ${ySig(Number(d.rally)).toFixed(1)}`).join(' '),crashPath=data.map((d,i)=>`${i?'L':'M'} ${x(i).toFixed(1)} ${ySig(Number(d.crash)).toFixed(1)}`).join(' ');
  html+=`<path d="${pathFrom(topSeries,yPrice)}" fill="none" stroke="#47372a" stroke-width="2.35" stroke-linecap="round" stroke-linejoin="round"/><path d="${rallyPath}" fill="none" stroke="#48795b" stroke-width="1.75"/><path d="${crashPath}" fill="none" stroke="#a84234" stroke-width="1.75"/><line x1="${p.l}" y1="${ySig(60)}" x2="${p.l+plotW}" y2="${ySig(60)}" stroke="#a84234" stroke-dasharray="5 4"/><line x1="${p.l}" y1="${ySig(90)}" x2="${p.l+plotW}" y2="${ySig(90)}" stroke="#b57c1f" stroke-dasharray="5 4"/><path d="${stepPath(data,x,yExp,'exposure')}" fill="none" stroke="#79678f" stroke-width="2.2"/>`;
  const topTitle=state.outcomeDisplay==='yoy'?`${indexLabel()} · rolling 252-trading-day return`:`${indexLabel()} · rebased to 100 at range start`;
  html+=`<text x="${p.l}" y="15" font-size="9" font-weight="850" fill="#625342">${topTitle}</text><text x="${p.l}" y="${signalTop-9}" font-size="8" font-weight="850" fill="#625342">Rally rank (green) · Crash rank (red)</text><text x="${p.l}" y="${expTop-8}" font-size="8" font-weight="850" fill="#625342">Recommended equity exposure</text>`;
  const ticks=state.outcomeYears>=10?10:state.outcomeYears>=5?8:6;for(let k=0;k<=ticks;k++){const i=Math.round((data.length-1)*k/ticks),d=data[i].d;html+=`<text x="${x(i)}" y="${H-7}" text-anchor="middle" font-size="8" fill="#817362">${d.toLocaleDateString('en-US',{month:state.outcomeYears<=3?'short':undefined,year:'2-digit',timeZone:'UTC'})}</text>`;}
  html+=`<line id="outcomeCross" x1="0" x2="0" y1="${priceTop}" y2="${expTop+expH}" stroke="#6d5a45" stroke-dasharray="3 4" opacity="0"/><g id="outcomeDots"></g><rect class="outcome-hit" x="${p.l}" y="${priceTop}" width="${plotW}" height="${expTop+expH-priceTop}" fill="transparent"/>`;
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);svg.innerHTML=html;
  $('outcomeIndexLegend').innerHTML=`<i class="line-sample" style="background:#4a3929"></i>${state.outcomeDisplay==='yoy'?'Selected index · rolling 1Y return':'Selected index · rebased to 100'}`;
  $('outcomeMetricNote').innerHTML=state.outcomeDisplay==='yoy'?'<strong>Rolling 1Y return:</strong> a 252-trading-day return. It improves long-window comparability but can be distorted by base effects after a crash or rebound.':'<strong>Index level:</strong> rebased to 100 at the beginning of the selected window, making cumulative wealth and drawdowns easy to see.';
  const hit=svg.querySelector('.outcome-hit'),cross=svg.querySelector('#outcomeCross'),dots=svg.querySelector('#outcomeDots'),tip=$('marketOutcomeTooltip');
  function update(i,ev){const d=data[i],globalIndex=offset+i,topVal=topSeries[i],yoy=rollingYearReturn(MARKET_HISTORY,globalIndex,key);cross.setAttribute('x1',x(i));cross.setAttribute('x2',x(i));cross.setAttribute('opacity','1');dots.innerHTML=`${finite(topVal)?`<circle cx="${x(i)}" cy="${yPrice(Number(topVal))}" r="3.8" fill="#47372a" stroke="#fff" stroke-width="1.5"/>`:''}<circle cx="${x(i)}" cy="${ySig(Number(d.rally))}" r="3.3" fill="#48795b" stroke="#fff"/><circle cx="${x(i)}" cy="${ySig(Number(d.crash))}" r="3.3" fill="#a84234" stroke="#fff"/>`;showOutcomeSnapshot(d,globalIndex);if(ev){const topLine=state.outcomeDisplay==='yoy'?`Rolling 1Y: ${yoy==null?'—':signedNum(yoy*100,1,'%')}`:`Rebased index: ${fmt(topVal,1)}`;tip.innerHTML=`<strong>${d.d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'})}</strong><br>${esc(d.regime)}<br>${indexLabel()}: ${fmt(d[key],2)}<br>${topLine}<br>Rally / Crash: ${fmt(d.rally,0)} / ${fmt(d.crash,0)}<br>Exposure: ${fmt(d.exposure,1)}×`;tip.style.display='block';const r=shell.getBoundingClientRect();tip.style.left=`${Math.min(shell.clientWidth-230,Math.max(8,ev.clientX-r.left+14))}px`;tip.style.top=`${Math.min(shell.clientHeight-130,Math.max(8,ev.clientY-r.top+14))}px`;}}
  hit.onmousemove=ev=>{const r=svg.getBoundingClientRect(),mx=(ev.clientX-r.left)*W/r.width,i=clamp(Math.round((mx-p.l)/plotW*(data.length-1)),0,data.length-1);update(i,ev)};
  hit.onmouseleave=()=>{cross.setAttribute('opacity','0');dots.innerHTML='';tip.style.display='none';showOutcomeSnapshot(data.at(-1),MARKET_HISTORY.length-1)};
  showOutcomeSnapshot(data.at(-1),MARKET_HISTORY.length-1);renderRegimeStats();
}

function renderRegimeStats(){
  const body=$('regimeStatsBody');if(state.outcomeMode==='live'){body.innerHTML='<tr><td colspan="6" style="text-align:center;padding:18px;color:var(--muted)"><strong>Live view hides forward outcomes.</strong><br>Switch to Research view to evaluate what happened after historical regime entries.</td></tr>';return;}
  const key=indexKey(),n=Math.min(MARKET_HISTORY.length,state.outcomeYears*252),startAt=MARKET_HISTORY.length-n,episodes=[];
  for(let i=startAt;i<MARKET_HISTORY.length;i++)if(i===startAt||MARKET_HISTORY[i].regime!==MARKET_HISTORY[i-1].regime){const f=forwardReturn(MARKET_HISTORY,i,key,10),dd=forwardMaxDrawdown(MARKET_HISTORY,i,key,10);if(f!=null)episodes.push({regime:MARKET_HISTORY[i].regime,f,dd,d:MARKET_HISTORY[i].d});}
  body.innerHTML=['Normal','Rally','Caution','Crisis','Euphoria'].map(reg=>{const x=episodes.filter(e=>e.regime===reg),rets=x.map(e=>e.f),dds=x.map(e=>e.dd),med=median(rets),medDD=median(dds),hit=x.length?rets.filter(v=>v>0).length/x.length:null,worst=x.length?Math.min(...rets):null;return `<tr><td><span class="regime-name-chip"><i style="background:${REGIME_COLORS[reg]}"></i>${reg}</span></td><td>${x.length}</td><td class="${med>=0?'pos':'neg'}">${med==null?'—':signedNum(med*100,1,'%')}</td><td>${hit==null?'—':(hit*100).toFixed(0)+'%'}</td><td class="neg">${medDD==null?'—':signedNum(medDD*100,1,'%')}</td><td class="neg">${worst==null?'—':signedNum(worst*100,1,'%')}</td></tr>`;}).join('');
}

function edgeMetricKey(){return state.threshold<=.3?'edge_density_03':state.threshold>=.7?'edge_density_07':'edge_density_05'}
function structuralSnapshot(){
  const m=currentEstimator().metrics,matrix=buildMatrix(),total=ASSETS.length*(ASSETS.length-1)/2;let strong=0;for(let i=0;i<ASSETS.length;i++)for(let j=i+1;j<ASSETS.length;j++)if(Math.abs(Number(matrix[i][j]))>=state.threshold)strong++;
  const edge=m[edgeMetricKey()]||m.edge_density_05;
  return {m,strong,total,density:strong/total*100,ar1:Number(m.ar1.value)*100,ar1Change:Number(m.ar1.change_20d)*100,er:Number(m.effective_rank.value),erChange:Number(m.effective_rank.change_20d),trend:Number(edge.change_20d)*100,ar3:Number(m.ar3.value)*100,gap:Number(m.spectral_gap.value),cluster:Number(m.clustering.value)*100,cond:Number(m.condition_number.value),mp:Number(m.mp_excess.value)};
}

const INFO_DEFS={
  'structure-overview':()=>({title:'Structural health',technical:'Cross-asset dependence and diversification diagnostics',measure:'Whether the 24 instruments are still behaving like genuinely different investments, or are being controlled by the same macro force.',current:`The current ${estimatorTag()} view is summarised by four plain-language cards.`,history:`${DATA.current.confirmation.count} of ${DATA.current.confirmation.total} estimators currently confirm deterioration.`,effect:'Raises or lowers the fragility warning, but does not by itself forecast a market decline.',portfolio:'Treat the book as more concentrated than the ticker count suggests when several measures deteriorate together.',example:'Owning SPY, QQQ, XLK, XLY, EFA, and HYG can look like six positions but behave like one broad risk-on trade.'}),
  'struct-ar1':()=>{const s=structuralSnapshot();return{title:'One factor controls the market',technical:'Absorption ratio AR1 / first eigenvalue share',measure:'The share of all cross-asset movement explained by the single largest common factor.',current:`${s.ar1.toFixed(1)}% of total movement is explained by one factor.`,history:`${signedNum(s.ar1Change,1,' percentage points')} over 20 trading days.`,effect:'A rising reading increases fragility because more assets answer to the same market “conductor.”',portfolio:'Expect diversification to work less well if a shock hits the dominant factor.',example:'During a liquidity shock, technology, banks, small caps, high yield, and overseas equities may all become the same trade.'}},
  'struct-erank':()=>{const s=structuralSnapshot();return{title:'24 assets behave like fewer bets',technical:'Effective rank',measure:'An estimate of how many independent sources of risk remain in the 24-asset universe.',current:`Effective rank is ${s.er.toFixed(1)} out of 24.`,history:`${signedNum(s.erChange,1)} independent bets over 20 trading days.`,effect:'A falling effective rank raises structural risk.',portfolio:'Position count may overstate diversification. Size the book as if it contained roughly this number of independent bets.',example:'SPY, QQQ, XLK, and XLY may all belong to one US growth cluster rather than four separate ideas.'}},
  'struct-links':()=>{const s=structuralSnapshot();return{title:'Strongly connected asset pairs',technical:`Edge density at |correlation| ≥ ${state.threshold.toFixed(2)}`,measure:'How many of the 276 unique asset pairs have a correlation strong enough to pass the selected threshold.',current:`${s.strong} of ${s.total} pairs are currently classified as strong links.`,history:`That equals ${s.density.toFixed(0)}% of all possible pairs.`,effect:'More links mean a shock can travel through more parts of the portfolio.',portfolio:'Look for duplicate exposures and avoid assuming that different tickers imply different risk.',example:'If SPY–QQQ, QQQ–XLK, and SPY–XLK are all strong links, the three form one crowded cluster.'}},
  'struct-speed':()=>{const s=structuralSnapshot();return{title:'Speed of deterioration',technical:'20-day change in edge density',measure:'How quickly the share of strong cross-asset relationships is changing.',current:`Strong-link density changed ${signedNum(s.trend,1,' percentage points')} in 20 trading days.`,history:'The speed of change can be more informative than a permanently high but stable level.',effect:'Rapid deterioration strengthens the warning because the market structure is changing now.',portfolio:'Raise monitoring frequency and reduce marginal risk before the headline index necessarily breaks.',example:'A market can remain near its high while correlations underneath the surface rise sharply.'}},
  'advanced-ar3':()=>{const s=structuralSnapshot();return{title:'Top three factors share',technical:'Absorption ratio AR3',measure:'The percentage of total cross-asset movement explained by the three largest common factors.',current:`The top three factors explain ${s.ar3.toFixed(1)}% of movement.`,history:`Stress percentile ${fmt(currentEstimator().metrics.ar3.stress_percentile,0)}.`,effect:'Raises structural concentration when it climbs.',portfolio:'A portfolio may be exposed mainly to three macro drivers such as risk appetite, rates, and the US dollar.',example:'Twenty-four assets can still be mostly controlled by only three broad forces.'}},
  'advanced-gap':()=>{const s=structuralSnapshot();return{title:'Dominant factor ratio',technical:'Spectral gap: first eigenvalue divided by second eigenvalue',measure:'How much stronger the largest common factor is than the second-largest factor.',current:`The first factor is approximately ${s.gap.toFixed(1)}× as strong as the second.`,history:`Stress percentile ${fmt(currentEstimator().metrics.spectral_gap.stress_percentile,0)}.`,effect:'Supports a herding or one-factor-market warning.',portfolio:'If the dominant factor reverses, many apparently unrelated positions can move together.',example:'A single “rates higher” trade can dominate utilities, REITs, technology, bonds, and the dollar.'}},
  'advanced-cluster':()=>{const s=structuralSnapshot();return{title:'Cluster tightness',technical:'Clustering coefficient',measure:'How often strongly linked assets form closed groups in which each member is connected to the others.',current:`Cluster tightness is ${s.cluster.toFixed(0)}%.`,history:`Stress percentile ${fmt(currentEstimator().metrics.clustering.stress_percentile,0)}.`,effect:'Can raise crash risk when crowded groups become tightly synchronized.',portfolio:'A cluster can amplify contagion because weakness in one member is confirmed by the others.',example:'SPY, QQQ, and XLK all strongly linked to one another form a closed triangle.'}},
  'advanced-condition':()=>{const s=structuralSnapshot();return{title:'Matrix instability',technical:'Condition number of the correlation matrix',measure:'How unbalanced the correlation matrix is between its strongest and weakest risk directions.',current:`Condition number is ${s.cond.toFixed(1)}×.`,history:`Stress percentile ${fmt(currentEstimator().metrics.condition_number.stress_percentile,0)}.`,effect:'Raises concern about fragile covariance estimates rather than directly forecasting price direction.',portfolio:'Do not trust precise optimizer weights when the matrix is unstable; use constraints and robustness checks.',example:'Like a table carrying most of its weight on one leg, a small disturbance can change the balance.'}},
  'advanced-mp':()=>{const s=structuralSnapshot();return{title:'Common factor above random noise',technical:'Marchenko–Pastur excess',measure:'Whether the dominant eigenvalue is larger than what random statistical noise could plausibly generate.',current:`The excess is ${s.mp.toFixed(1)} above the random-noise boundary.`,history:`Stress percentile ${fmt(currentEstimator().metrics.mp_excess.stress_percentile,0)}.`,effect:'Confirms whether the common market structure is likely real rather than accidental correlation.',portfolio:'Treat the dominant factor as economically meaningful while still testing stability out of sample.',example:'It asks whether the “one market conductor” is real or just a pattern created by chance.'}},
  'asset-avg-relationship':()=>({title:'Average relationship',technical:'Average absolute pairwise correlation',measure:'The average strength of one asset’s relationship with the other 23 assets. Positive and negative signs are both counted as strong dependence.',current:'The table shows the raw value and a Low / Medium / High label.',history:'A rising average means the asset is becoming less independent.',effect:'This is a dependence measure, not a buy or sell signal.',portfolio:'High average relationship means the asset may duplicate risks already present elsewhere in the book.',example:'An average of 0.56 means the asset is fairly connected to the broader universe.'}),
  'asset-strong-links':()=>({title:'Strong links',technical:'Network degree at the selected threshold',measure:`The number of other assets whose correlation passes ${state.threshold.toFixed(2)} under the current edge setting.`,current:'The table reports a count out of 23 possible relationships.',history:'A rising count means the asset is moving toward the centre of the market network.',effect:'High connectivity can confirm broad contagion or duplicate beta.',portfolio:'Owning multiple highly connected hubs may not add diversification.',example:'18 / 23 means the asset has strong relationships with eighteen other instruments.'}),
  'asset-strongest-link':()=>({title:'Strongest relationship',technical:'Largest absolute pairwise correlation',measure:'The single asset with the strongest current relationship to the selected ticker.',current:'The sign is retained: positive means they move together; negative means they tend to move opposite.',history:'Relationships can change across macro regimes.',effect:'Useful for identifying duplicate exposure or a possible offset.',portfolio:'Validate whether the relationship is stable before treating it as a hedge.',example:'QQQ +0.85 with XLK suggests the two positions may duplicate US growth risk.'}),
  'asset-vs-spy':()=>({title:'Relationship to SPY',technical:'Signed correlation with SPY',measure:'How closely the asset currently moves with the broad US equity market.',current:'Positive values imply equity-like co-movement; negative values may indicate an offset.',history:'The sign and magnitude can change between growth, inflation, and liquidity shocks.',effect:'Helps classify the asset’s current portfolio role.',portfolio:'A low or negative SPY correlation can diversify equity beta, but only if it persists when stress rises.',example:'TLT may offset SPY in a growth shock but fail during an inflation shock.'}),
  'asset-corr-change':()=>({title:'20-day change in relationship',technical:'Change in average absolute correlation',measure:'Whether the asset is becoming more or less connected to the rest of the universe.',current:'Positive values mean dependence has increased during the last 20 sessions.',history:'A rapid increase is often more informative than a stable high level.',effect:'Supports or weakens the current fragility warning.',portfolio:'A previously independent hedge becoming highly correlated can leave the portfolio unexpectedly exposed.',example:'Gold can stop diversifying if dollar or real-yield stress starts controlling both gold and equities.'}),
  'driver-overview':()=>({title:'Model driver contributions',technical:'Transparent ORCA-Lite explanation layer',measure:'Which variables are currently pushing the rally or crash score higher or lower.',current:'Red positive values increase that score; green negative values reduce it.',history:'The numbers are relative contributions on the ORCA-Lite scale, not probabilities.',effect:'Explains the current ranking but does not prove the variable caused the market move.',portfolio:'Use the driver mix to distinguish structural risk from an oversold or volatility-driven signal.',example:'A crash warning driven by rising network density is different from one driven only by a one-day volatility spike.'}),
  'driver-spectral-share':()=>({title:'Spectral / graph share',technical:'Share of absolute model contribution from correlation-network features',measure:'How much of the score explanation comes from eigenvalue, correlation, and graph-topology features rather than price indicators.',current:`Crash structural share is ${fmt(DATA.drivers.crash_spectral_share,0)}%.`,history:'The ORCA paper emphasises structural features for crash detection.',effect:'A high share means the warning is mainly about market structure.',portfolio:'Structural warnings may appear before headline volatility fully reacts.',example:'The crash score rises because diversification is collapsing even while the index remains near its high.'}),
  'outcome-performance':()=>({title:'Performance by regime',technical:'Event-based forward return and drawdown analysis',measure:'What the selected index did after the first day of each historical regime episode.',current:'The table summarises 10-day outcomes for the selected index and time window.',history:'Episodes—not every daily observation—are counted to reduce repeated labels from the same event.',effect:'This is a validation tool, not an input to the current signal.',portfolio:'A useful regime should show economically different forward outcomes after costs and without look-ahead leakage.',example:'If Crisis episodes do not have worse forward drawdowns than Normal episodes, the regime map has little practical value.'})
};
function getInfo(key){const x=INFO_DEFS[key];return typeof x==='function'?x():x}
function infoHtml(def){return `<div class="help-eyebrow">Plain-language explanation</div><h4 id="infoModalTitle">${esc(def.title)}</h4><div class="help-tech">${esc(def.technical||'')}</div><div class="help-section"><strong>What it measures</strong>${esc(def.measure||'')}</div><div class="help-section"><strong>Current reading</strong>${esc(def.current||'')}</div><div class="help-section"><strong>Compared with history</strong>${esc(def.history||'')}</div><div class="help-section"><strong>Current effect</strong>${esc(def.effect||'')}</div><div class="help-section"><strong>Portfolio meaning</strong>${esc(def.portfolio||'')}</div><div class="help-section"><strong>Simple example</strong>${esc(def.example||'')}</div>`}
function positionInfoPopover(ev){const pop=$('helpPopover');if(!pop.classList.contains('show'))return;const pad=12,w=pop.offsetWidth||350,h=pop.offsetHeight||300;let left=ev.clientX+15,top=ev.clientY+15;if(left+w>innerWidth-pad)left=ev.clientX-w-15;if(top+h>innerHeight-pad)top=ev.clientY-h-15;pop.style.left=`${Math.max(pad,left)}px`;pop.style.top=`${Math.max(pad,top)}px`}
function showInfoPopover(ev,key){const def=getInfo(key),pop=$('helpPopover');if(!def)return;pop.innerHTML=infoHtml(def);pop.classList.add('show');positionInfoPopover(ev)}
function hideInfoPopover(){$('helpPopover').classList.remove('show')}
function openInfoModal(key){const def=getInfo(key);if(!def)return;$('infoModalContent').innerHTML=infoHtml(def);$('infoModal').classList.add('open');$('infoModal').setAttribute('aria-hidden','false');hideInfoPopover()}
function closeInfoModal(){$('infoModal').classList.remove('open');$('infoModal').setAttribute('aria-hidden','true')}
function bindInfoTriggers(){
  document.querySelectorAll('[data-info]').forEach(el=>{
    if(el.dataset.bound)return;el.dataset.bound='1';const key=el.dataset.info;
    el.addEventListener('mouseenter',ev=>showInfoPopover(ev,key));el.addEventListener('mousemove',positionInfoPopover);el.addEventListener('mouseleave',hideInfoPopover);el.addEventListener('focus',ev=>showInfoPopover(ev,key));el.addEventListener('blur',hideInfoPopover);el.addEventListener('click',ev=>{ev.preventDefault();ev.stopPropagation();openInfoModal(key)});
  });
}

function renderMetrics(){
  const s=structuralSnapshot(),worsening=[s.ar1Change>0,s.erChange<0,s.trend>0,DATA.current.confirmation.count>=2].filter(Boolean).length;
  $('structureSummary').innerHTML=`<strong>Current reading: ${worsening} of 4 measures are worsening.</strong><span>${esc(DATA.current.confirmation.message)} This is a warning that a shock could spread more broadly—not proof that a crash must happen.</span>`;
  $('fragilityPill').textContent=worsening>=3?'Fragility rising':worsening===2?'Mixed / watch':worsening===1?'Early warning':'Structure stable';
  $('fragilityPill').className=`pill ${worsening>=3?'bad':worsening>=1?'watch':'good'}`;
  const cards=[
    {key:'struct-ar1',label:'One common factor',value:`controls ${s.ar1.toFixed(1)}%`,plain:'More assets are responding to the same market force.',example:'Higher AR1 = weaker diversification.',trend:`${signedNum(s.ar1Change,1,' pp')} / 20D`,tone:s.ar1Change>0?'bad':'good'},
    {key:'struct-erank',label:'True diversification',value:`24 assets ≈ ${s.er.toFixed(1)} bets`,plain:'The ticker count may overstate how diversified the system is.',example:'Lower effective rank = more hidden concentration.',trend:`${signedNum(s.erChange,1)} independent bets / 20D`,tone:s.erChange<0?'bad':'good'},
    {key:'struct-links',label:'Strong relationships',value:`${s.strong} of ${s.total} pairs`,plain:`${s.density.toFixed(0)}% of all asset pairs are strongly connected.`,example:`Threshold: |correlation| ≥ ${state.threshold.toFixed(2)}.`,trend:s.density>=45?'▲ Broad contagion channel':'● Moderate connectivity',tone:s.density>=45?'bad':'watch'},
    {key:'struct-speed',label:'Speed of deterioration',value:`${signedNum(s.trend,1,' pp')} / 20D`,plain:s.trend>0?'Strong relationships are appearing quickly.':'Strong relationships are receding.',example:'Fast change matters more than a stable high level.',trend:s.trend>0?'▲ Monitoring frequency should rise':'▼ Structural pressure is easing',tone:s.trend>0?'bad':'good'}
  ];
  $('simpleHealthGrid').innerHTML=cards.map(c=>`<article class="simple-health-card"><div class="simple-health-top"><div class="simple-health-label">${c.label}</div><button class="info-trigger" data-info="${c.key}" aria-label="Explain ${c.label}">i</button></div><div class="simple-health-value">${c.value}</div><div class="simple-health-plain">${c.plain}</div><div class="simple-health-example">${c.example}</div><div class="simple-health-trend ${c.tone}">${c.trend}</div></article>`).join('');
  bindInfoTriggers();
}
function renderAdvancedMetrics(){
  const s=structuralSnapshot(),m=s.m,items=[
    ['advanced-ar3','Top three factors',`control ${s.ar3.toFixed(1)}%`,'Most movement is explained by only three macro forces.',`${riskLabel(m.ar3.stress_percentile)} · ${fmt(m.ar3.stress_percentile,0)}th pct`],
    ['advanced-gap','Dominant factor ratio',`${s.gap.toFixed(1)}×`,'Factor #1 is stronger than factor #2.',`${riskLabel(m.spectral_gap.stress_percentile)} · ${fmt(m.spectral_gap.stress_percentile,0)}th pct`],
    ['advanced-cluster','Cluster tightness',`${s.cluster.toFixed(0)}%`,'Strong links form closed and crowded groups.',`${riskLabel(m.clustering.stress_percentile)} · ${fmt(m.clustering.stress_percentile,0)}th pct`],
    ['advanced-condition','Matrix instability',`${s.cond.toFixed(1)}×`,'Small data changes may create unstable optimizer weights.',`${riskLabel(m.condition_number.stress_percentile)} · ${fmt(m.condition_number.stress_percentile,0)}th pct`],
    ['advanced-mp','Common factor vs noise',`${s.mp.toFixed(1)}`,'The dominant factor is compared with a random-noise boundary.',`${riskLabel(m.mp_excess.stress_percentile)} · ${fmt(m.mp_excess.stress_percentile,0)}th pct`]
  ];
  $('advancedMetricGrid').innerHTML=items.map(x=>`<article class="advanced-card"><div class="advanced-name">${x[1]} <button class="info-trigger" data-info="${x[0]}" aria-label="Explain ${x[1]}">i</button></div><div class="advanced-tech">Technical diagnostic</div><div class="advanced-value">${x[2]}</div><div class="advanced-plain">${x[3]}</div><div class="advanced-meta">${x[4]}</div></article>`).join('');
  bindInfoTriggers();
}

function groupCenters(W,H){return{broad:[W*.47,H*.39],sector:[W*.45,H*.48],intl:[W*.22,H*.44],fixed:[W*.77,H*.45],commodity:[W*.56,H*.78],currency:[W*.83,H*.18]}}
function seeded(seed){return function(){seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296}}
function renderNetwork(){
  const matrix=buildMatrix(),stats=graphStats(matrix),svg=$('networkSvg'),wrap=$('networkWrap'),W=Math.max(720,wrap.clientWidth||900),H=520,centers=groupCenters(W,H),rng=seeded(823),positions=ASSETS.map(a=>({x:centers[a.g][0]+(rng()-.5)*150,y:centers[a.g][1]+(rng()-.5)*130,vx:0,vy:0})),edges=[];
  for(let i=0;i<ASSETS.length;i++)for(let j=i+1;j<ASSETS.length;j++){const v=Number(matrix[i][j]),ok=state.edgeMode==='positive'?v>=state.threshold:Math.abs(v)>=state.threshold;if(ok)edges.push({i,j,v});}
  for(let step=0;step<120;step++){
    for(let i=0;i<positions.length;i++)for(let j=i+1;j<positions.length;j++){let dx=positions[j].x-positions[i].x,dy=positions[j].y-positions[i].y,d2=dx*dx+dy*dy+20,d=Math.sqrt(d2),f=1000/d2;positions[i].vx-=f*dx/d;positions[i].vy-=f*dy/d;positions[j].vx+=f*dx/d;positions[j].vy+=f*dy/d;}
    edges.forEach(e=>{const a=positions[e.i],b=positions[e.j],dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)+.01,target=65+55*(1-Math.abs(e.v)),f=(d-target)*.0028*Math.abs(e.v);a.vx+=f*dx/d;a.vy+=f*dy/d;b.vx-=f*dx/d;b.vy-=f*dy/d;});
    positions.forEach((p,i)=>{const c=centers[ASSETS[i].g];p.vx+=(c[0]-p.x)*.0009;p.vy+=(c[1]-p.y)*.0009;p.vx*=.82;p.vy*=.82;p.x=clamp(p.x+p.vx,38,W-38);p.y=clamp(p.y+p.vy,35,H-35);});
  }
  let out='<defs><filter id="nodeShadow"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity=".18"/></filter></defs>';
  edges.forEach(e=>{const a=positions[e.i],b=positions[e.j],abs=Math.abs(e.v),selected=state.selected==null||state.selected===e.i||state.selected===e.j,opacity=selected?(.12+.48*(abs-state.threshold)/(1-state.threshold)):.025;out+=`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${e.v>=0?'#a55e3d':'#557b8b'}" stroke-width="${(.7+3.3*(abs-state.threshold)/(1-state.threshold)).toFixed(2)}" stroke-opacity="${clamp(opacity,.02,.72)}"/>`;});
  positions.forEach((p,i)=>{const a=ASSETS[i],r=7+11*stats.central[i],selected=state.selected==null||state.selected===i,opacity=selected?1:.28;out+=`<g class="net-node" data-i="${i}" transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})" style="cursor:pointer;opacity:${opacity}"><circle r="${(r+3).toFixed(1)}" fill="#fffaf1" stroke="${GROUPS[a.g].color}" stroke-opacity=".34"/><circle r="${r.toFixed(1)}" fill="${GROUPS[a.g].color}" stroke="#fffaf1" stroke-width="2" filter="url(#nodeShadow)"/><text y="${(r+12).toFixed(1)}" text-anchor="middle" font-size="${r>14?10:9}" font-weight="900" fill="#47392d" stroke="#fffaf2" stroke-width="3" paint-order="stroke">${a.t}</text></g>`;});
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);svg.innerHTML=out;$('edgeCountPill').textContent=`${edges.length} edges · ${estimatorTag()}`;
  const tip=$('networkTooltip');svg.querySelectorAll('.net-node').forEach(el=>{el.addEventListener('mouseenter',()=>{const i=+el.dataset.i,a=ASSETS[i],s=stats.strongest[i];tip.innerHTML=`<strong>${a.t} · ${esc(a.n)}</strong><br>${GROUPS[a.g].label}<br>Avg |corr|: ${stats.avg[i].toFixed(2)}<br>Strong links: ${stats.counts[i]} / 23<br>Strongest link: ${ASSETS[s.j].t} (${signedNum(s.v,2)})`;tip.style.display='block';});el.addEventListener('mousemove',ev=>{const r=wrap.getBoundingClientRect();tip.style.left=`${ev.clientX-r.left+13}px`;tip.style.top=`${ev.clientY-r.top+13}px`;});el.addEventListener('mouseleave',()=>tip.style.display='none');el.addEventListener('click',ev=>{ev.stopPropagation();state.selected=state.selected===+el.dataset.i?null:+el.dataset.i;renderNetwork();});});
  svg.onclick=()=>{if(state.selected!==null){state.selected=null;renderNetwork();}};
}
function renderLegend(){$('groupLegend').innerHTML=Object.values(GROUPS).map(g=>`<span><i class="legend-dot" style="background:${g.color}"></i>${g.label}</span>`).join('')+`<span><i class="line-sample" style="height:2px;background:#a55e3d"></i>Positive correlation</span><span><i class="line-sample" style="height:2px;background:#557b8b"></i>Negative correlation</span>`}
function mix(a,b,t){return Math.round(a+(b-a)*t)}
function corrColor(v){const neg=[73,111,130],zero=[249,244,235],pos=[159,63,49],t=Math.min(1,Math.abs(v)),c=v<0?neg:pos;return `rgb(${mix(zero[0],c[0],t)},${mix(zero[1],c[1],t)},${mix(zero[2],c[2],t)})`}
function renderHeatmap(){
  const canvas=$('heatmapCanvas'),shell=$('heatmapShell'),tip=$('heatmapTooltip'),matrix=buildMatrix(),cell=28,left=92,top=92,size=left+cell*ASSETS.length+18,dpr=Math.max(1,window.devicePixelRatio||1);
  canvas.width=size*dpr;canvas.height=size*dpr;canvas.style.width=`${size}px`;canvas.style.height=`${size}px`;const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,size,size);ctx.fillStyle='#fffdf8';ctx.fillRect(0,0,size,size);ctx.font='800 9px Inter, Arial';ctx.textAlign='right';ctx.textBaseline='middle';ASSETS.forEach((a,i)=>{ctx.fillStyle='#574b3f';ctx.fillText(a.t,left-9,top+i*cell+cell/2)});ctx.textAlign='left';ASSETS.forEach((a,i)=>{ctx.save();ctx.translate(left+i*cell+cell/2,top-9);ctx.rotate(-Math.PI/2);ctx.fillStyle='#574b3f';ctx.fillText(a.t,0,0);ctx.restore();});
  for(let i=0;i<ASSETS.length;i++)for(let j=0;j<ASSETS.length;j++){const v=Number(matrix[i][j]);ctx.fillStyle=corrColor(v);ctx.fillRect(left+j*cell,top+i*cell,cell-1,cell-1);if(i===j){ctx.strokeStyle='#6e5b43';ctx.lineWidth=1;ctx.strokeRect(left+j*cell+.5,top+i*cell+.5,cell-2,cell-2);}}
  let lastG=ASSETS[0].g;for(let i=1;i<ASSETS.length;i++)if(ASSETS[i].g!==lastG){ctx.strokeStyle='#8b7861';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(left,top+i*cell);ctx.lineTo(left+cell*ASSETS.length,top+i*cell);ctx.moveTo(left+i*cell,top);ctx.lineTo(left+i*cell,top+cell*ASSETS.length);ctx.stroke();lastG=ASSETS[i].g;}ctx.strokeStyle='#c8b8a2';ctx.lineWidth=1;ctx.strokeRect(left,top,cell*ASSETS.length,cell*ASSETS.length);
  const labelTooltip=(a,axis)=>`<strong>${a.t} — ${esc(a.n)}</strong><br>${GROUPS[a.g].label}<br><span style="color:#d4c4ae">${axis} label in the correlation heatmap</span>`;
  canvas.onmousemove=ev=>{const r=canvas.getBoundingClientRect(),x=(ev.clientX-r.left)*size/r.width,y=(ev.clientY-r.top)*size/r.height,j=Math.floor((x-left)/cell),i=Math.floor((y-top)/cell);let html='',cursor='default';if(i>=0&&j>=0&&i<ASSETS.length&&j<ASSETS.length){html=`<strong>${ASSETS[i].t} × ${ASSETS[j].t}</strong><br>${esc(ASSETS[i].n)}<br>${esc(ASSETS[j].n)}<br>Signed correlation: ${fmt(matrix[i][j],3)}`;cursor='crosshair';}else if(y>=top&&y<top+cell*ASSETS.length&&x>=8&&x<left-6){const row=Math.floor((y-top)/cell);if(row>=0&&row<ASSETS.length){html=labelTooltip(ASSETS[row],'Row');cursor='help';}}else if(x>=left&&x<left+cell*ASSETS.length&&y>=8&&y<top-6){const col=Math.floor((x-left)/cell);if(col>=0&&col<ASSETS.length){html=labelTooltip(ASSETS[col],'Column');cursor='help';}}canvas.style.cursor=cursor;if(html){tip.innerHTML=html;tip.style.display='block';const sr=shell.getBoundingClientRect();tip.style.left=`${ev.clientX-sr.left+14+shell.scrollLeft}px`;tip.style.top=`${ev.clientY-sr.top+14+shell.scrollTop}px`;}else tip.style.display='none';};canvas.onmouseleave=()=>{tip.style.display='none';canvas.style.cursor='default';};
  const pairs=[];for(let i=0;i<ASSETS.length;i++)for(let j=i+1;j<ASSETS.length;j++)pairs.push({i,j,v:Number(matrix[i][j])});const pos=[...pairs].sort((a,b)=>b.v-a.v).slice(0,3),neg=[...pairs].sort((a,b)=>a.v-b.v).slice(0,3),div=[...pairs].sort((a,b)=>Math.abs(a.v)-Math.abs(b.v)).slice(0,3),box=(title,arr,kind)=>`<div class="pair-box"><div class="pair-label">${title}</div>${arr.map(p=>`<div class="pair-value">${ASSETS[p.i].t} / ${ASSETS[p.j].t} <span style="color:${p.v>=0?'var(--red)':'var(--blue)'}">${signedNum(p.v,2)}</span></div><div class="pair-meta">${kind}</div>`).join('')}</div>`;$('pairGrid').innerHTML=box('Strongest positive links',pos,'Potential concentration / contagion')+box('Strongest negative links',neg,'Potential offset—validate stability')+box('Most independent pairs',div,'Low current co-movement');
}

function assetRows(){
  const matrix=buildMatrix(),n=ASSETS.length,spyIdx=ASSETS.findIndex(a=>a.t==='SPY');
  return ASSETS.map((a,i)=>{const raw=DATA.assets.find(x=>x.ticker===a.t)||{},sum=matrix[i].reduce((s,v,j)=>s+(i===j?0:Math.abs(Number(v))),0),avg=sum/(n-1);let count=0,best={j:-1,v:0};for(let j=0;j<n;j++)if(i!==j){const v=Number(matrix[i][j]),abs=Math.abs(v),qualifies=state.edgeMode==='positive'?v>=state.threshold:abs>=state.threshold;if(qualifies)count++;if(abs>Math.abs(best.v))best={j,v};}const spyCorr=Number(matrix[i][spyIdx]),level=relationshipLevel(avg);return {...a,r1:Number(raw.return_1d||0)*100,r5:Number(raw.return_5d||0)*100,avg,count,best,spyCorr,delta:Number(raw.avg_abs_corr_change_20d||0),role:raw.network_role||'Cluster member',meaning:raw.portfolio_meaning||a.role,level};});
}
function renderAssetDetail(row){if(!row)return;const relation=row.best.v>=0?'moves together with':'moves opposite to';$('assetDetailPanel').innerHTML=`<div><div class="asset-detail-title">${row.t} · ${esc(row.n)}</div><div class="asset-detail-meta">${GROUPS[row.g].label} · ${esc(row.role)}</div></div><div class="asset-detail-copy"><strong>Plain reading:</strong> ${esc(row.meaning)}<br><strong>Network evidence:</strong> ${row.count} of 23 strong links, average relationship ${row.avg.toFixed(2)}, and it ${relation} ${ASSETS[row.best.j].t} most strongly (${signedNum(row.best.v,2)}).</div><div class="asset-detail-action">Portfolio check: compare this position with your other holdings before treating it as a separate source of diversification.</div>`;}
function renderAssets(){
  let rows=assetRows().filter(x=>(x.t+' '+x.n+' '+GROUPS[x.g].label+' '+x.role+' '+x.meaning).toLowerCase().includes(state.query.toLowerCase()));rows.sort((a,b)=>state.sort==='ticker'?a.t.localeCompare(b.t):state.sort==='ret5'?b.r5-a.r5:state.sort==='avgcorr'?b.avg-a.avg:state.sort==='change'?b.delta-a.delta:b.count-a.count);
  $('assetBody').innerHTML=rows.map(x=>{const relation=x.best.v>=0?'moves together':'moves opposite';return `<tr class="asset-row ${state.assetSelected===x.t?'selected':''}" data-ticker="${x.t}"><td class="ticker">${x.t}</td><td>${esc(x.n)}</td><td><span class="group-chip"><i style="background:${GROUPS[x.g].color}"></i>${GROUPS[x.g].label}</span></td><td class="${x.r1>0?'pos':x.r1<0?'neg':'flat'}">${fmtPctPoints(x.r1)}</td><td class="${x.r5>0?'pos':x.r5<0?'neg':'flat'}">${fmtPctPoints(x.r5)}</td><td>${x.avg.toFixed(2)} <span class="relationship-label ${x.level[1]}">${x.level[0]}</span></td><td><div class="links-cell"><div class="mini-bar"><span style="width:${x.count/23*100}%"></span></div><strong>${x.count} / 23</strong></div></td><td>${ASSETS[x.best.j].t} <strong class="${x.best.v>=0?'pos':'neg'}">${signedNum(x.best.v,2)}</strong><span class="link-phrase">${relation}</span></td><td class="${x.spyCorr>=0?'pos':'neg'}">${signedNum(x.spyCorr,2)}</td><td class="${x.delta>=0?'neg':'pos'}">${signedNum(x.delta,2)}</td><td><span class="role-chip">${esc(x.role)}</span><div class="portfolio-meaning">${esc(x.meaning)}</div></td></tr>`;}).join('');
  document.querySelectorAll('.asset-row').forEach(tr=>tr.onclick=()=>{state.assetSelected=tr.dataset.ticker;renderAssets();});renderAssetDetail(assetRows().find(x=>x.t===state.assetSelected)||rows[0]);bindInfoTriggers();
}

function driverTag(key){return ['ar1','ar3','effective_rank','edge_density_05','clustering','spectral_gap','condition_number','mp_excess'].includes(key)?'Structure':['breadth_20d','cross_asset_dispersion'].includes(key)?'Cross-asset':'Price'}
function rallySpectralShare(){const structural=new Set(['ar1','ar3','effective_rank','edge_density_05','clustering','spectral_gap','condition_number','mp_excess']),all=DATA.drivers.rally.reduce((s,x)=>s+Math.abs(Number(x.contribution)),0),spec=DATA.drivers.rally.filter(x=>structural.has(x.key)).reduce((s,x)=>s+Math.abs(Number(x.contribution)),0);return all?spec/all*100:0}
function registerDriverInfo(prefix,items){items.forEach((x,i)=>{INFO_DEFS[`${prefix}-${i}`]=()=>({title:x.explanation?.title||x.label,technical:x.label,measure:x.explanation?.measure||'Transparent ORCA-Lite driver.',current:`${fmt(x.percentile,1)}th percentile; contribution ${signedNum(x.contribution,3)}.`,history:`The feature ranks at the ${fmt(x.percentile,1)}th percentile in its comparison history.`,effect:`It currently ${x.direction||(Number(x.contribution)>=0?'raises':'reduces')} the ${prefix==='crash'?'crash':'rally'} score by ${signedNum(x.contribution,3)} on the ORCA-Lite scale.`,portfolio:x.explanation?.portfolio||'Use this as context, not as a standalone signal.',example:x.explanation?.simple||'The effect depends on the broader market regime.'})})}
function renderDrivers(){
  registerDriverInfo('crash',DATA.drivers.crash);registerDriverInfo('rally',DATA.drivers.rally);
  const panel=(title,score,arr,share,prefix)=>{const max=Math.max(...arr.map(x=>Math.abs(Number(x.contribution))),.001);return `<div class="driver-head"><div><div class="driver-title">${title}</div><div class="driver-sub">Positive contribution pushes the score higher.</div></div><span class="pill ${title.includes('Crash')?'bad':'good'} driver-score-pill">Current score ${fmt(score,1)}</span></div>${arr.map((d,i)=>{const v=Number(d.contribution),width=clamp(Math.abs(v)/max*100,4,100),key=`${prefix}-${i}`;return `<div class="driver-row"><div class="driver-name-wrap"><button class="driver-name-button" data-info="${key}">${esc(d.label)}</button><span class="driver-tag">${driverTag(d.key)}</span><button class="info-trigger" data-info="${key}" aria-label="Explain ${esc(d.label)}">i</button></div><div class="driver-track"><div class="driver-fill ${v>=0?'up':'down'}" style="width:${width}%"></div></div><div class="driver-val" style="color:${v>=0?'var(--red)':'var(--green)'}">${signedNum(v,3)}</div></div>`;}).join('')}<div class="feature-share"><button class="driver-name-button" data-info="driver-spectral-share">Spectral / graph share</button><div class="track"><div class="fill" style="width:${clamp(share,0,100)}%"></div></div><strong>${fmt(share,0)}%</strong></div>`;};
  $('crashDrivers').innerHTML=panel('Crash signal',DATA.current.crash_score,DATA.drivers.crash,DATA.drivers.crash_spectral_share,'crash');
  $('rallyDrivers').innerHTML=panel('Rally signal',DATA.current.rally_score,DATA.drivers.rally,rallySpectralShare(),'rally');bindInfoTriggers();
}

function renderAudit(){
  const q=DATA.quality,a=DATA.audit,live=DATA.meta.data_mode==='live';
  $('auditCoverage').textContent=`${DATA.meta.universe_count} / 24`;$('auditCoverageMeta').textContent='Exact paper universe';
  $('auditLatestDate').textContent=DATA.meta.latest_market_date;$('auditLatestMeta').textContent=`${q.latest_age_calendar_days} calendar day${q.latest_age_calendar_days===1?'':'s'} old`;
  $('auditRows').textContent=Number(q.common_rows).toLocaleString();$('auditRowsMeta').textContent=`${q.common_start} to ${q.common_end}`;
  $('auditModel').textContent=live?'Live':'Demo';$('auditModelMeta').textContent=DATA.meta.model_version;
  $('auditPill').textContent=`${a.paper_ambiguities.length} paper questions unresolved`;
  $('auditFlagList').innerHTML=a.paper_ambiguities.map((text,i)=>`<div class="flag"><div class="flag-icon">${i+1}</div><div><div class="flag-title">Research governance item ${i+1}</div><div class="flag-copy">${esc(text)}</div></div></div>`).join('');
}

function renderAll(){renderHeader();renderKpis();renderDecision();renderOutcomeMonitor();renderMetrics();renderAdvancedMetrics();renderNetwork();renderHeatmap();renderAssets();renderDrivers();renderAudit();bindInfoTriggers()}
function wire(){if(controlsBound)return;controlsBound=true;
  $('estimatorSelect').onchange=e=>{state.estimator=e.target.value;renderAll();};
  document.querySelectorAll('#thresholdSegment .seg-btn').forEach(b=>b.onclick=()=>{state.threshold=+b.dataset.v;document.querySelectorAll('#thresholdSegment .seg-btn').forEach(x=>x.classList.toggle('active',x===b));renderMetrics();renderAdvancedMetrics();renderNetwork();renderHeatmap();renderAssets();});
  document.querySelectorAll('#edgeMode .seg-btn').forEach(b=>b.onclick=()=>{state.edgeMode=b.dataset.v;document.querySelectorAll('#edgeMode .seg-btn').forEach(x=>x.classList.toggle('active',x===b));renderNetwork();renderAssets();});
  document.querySelectorAll('#outcomeRange .seg-btn').forEach(b=>b.onclick=()=>{state.outcomeYears=+b.dataset.v;document.querySelectorAll('#outcomeRange .seg-btn').forEach(x=>x.classList.toggle('active',x===b));renderOutcomeMonitor();});
  document.querySelectorAll('#outcomeDisplay .seg-btn').forEach(b=>b.onclick=()=>{state.outcomeDisplay=b.dataset.v;document.querySelectorAll('#outcomeDisplay .seg-btn').forEach(x=>x.classList.toggle('active',x===b));renderOutcomeMonitor();});
  document.querySelectorAll('#outcomeMode .seg-btn').forEach(b=>b.onclick=()=>{state.outcomeMode=b.dataset.v;document.querySelectorAll('#outcomeMode .seg-btn').forEach(x=>x.classList.toggle('active',x===b));renderOutcomeMonitor();});
  $('outcomeIndex').onchange=e=>{state.outcomeIndex=e.target.value;renderOutcomeMonitor();};$('assetSearch').oninput=e=>{state.query=e.target.value;renderAssets();};$('assetSort').onchange=e=>{state.sort=e.target.value;renderAssets();};$('printBtn').onclick=()=>window.print();$('infoClose').onclick=closeInfoModal;$('infoModal').onclick=e=>{if(e.target.id==='infoModal')closeInfoModal();};document.addEventListener('keydown',e=>{if(e.key==='Escape')closeInfoModal();});let timer;window.addEventListener('resize',()=>{clearTimeout(timer);timer=setTimeout(()=>{renderNetwork();renderHeatmap();renderOutcomeMonitor();},180);});bindInfoTriggers();
}

document.addEventListener('DOMContentLoaded',loadData);

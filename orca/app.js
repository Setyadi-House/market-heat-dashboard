'use strict';

const COLORS = {
  ink:'#4b3827', muted:'#7f7162', line:'#ddcfbc', paper:'#fffdf8', amber:'#a97122',
  green:'#4d7b5a', red:'#a64032', orange:'#b66130', blue:'#4f7288', purple:'#77658c',
  Normal:'#e7eee3', Rally:'#cfe4d3', Caution:'#f6e7bf', Crisis:'#efd2cd', Euphoria:'#f1d6c6', Unavailable:'#f5f0e8'
};
const GROUP_COLORS = {
  'Broad US equity':'#75628f','US sectors / REIT':'#b27a35','International equity':'#4e8a7b',
  'Fixed income / credit':'#56809a','Commodities':'#b29736','Currency':'#9a6357'
};
const state = {data:null, estimator:'composite', threshold:.50, edgeMode:'absolute', years:5, index:'SPY', display:'level', mode:'live', search:'', sort:'links'};
const $ = id => document.getElementById(id);
const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
const fmt = (x,d=1) => x == null || !Number.isFinite(Number(x)) ? '—' : Number(x).toFixed(d);
const pct = (x,d=1, signed=false) => x == null || !Number.isFinite(Number(x)) ? '—' : `${signed && Number(x)>=0?'+':''}${(Number(x)*100).toFixed(d)}%`;
const signed = (x,d=2) => x == null || !Number.isFinite(Number(x)) ? '—' : `${Number(x)>=0?'+':''}${Number(x).toFixed(d)}`;
const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

async function loadData(){
  try{
    const res = await fetch(`data/dashboard.json?v=${Date.now()}`, {cache:'no-store'});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
    renderAll(); bindControls();
  }catch(err){
    $('dataBanner').textContent = `ORCA data failed to load: ${err.message}`;
    $('dataBanner').className = 'prototype-banner error';
    console.error(err);
  }
}

function renderAll(){
  const d=state.data, live=d.meta.data_mode==='live';
  $('dataBanner').textContent = live
    ? `LIVE EODHD-DERIVED DATA · ${d.meta.latest_market_date} · ${d.meta.warning}`
    : `DEMO DATA · NOT A LIVE SIGNAL · ${d.meta.warning}`;
  $('dataBanner').className = `prototype-banner ${live?'live':''}`;
  $('asOfDate').textContent = `Market data through ${d.meta.latest_market_date}`;
  $('modelVersion').textContent = `${d.meta.model_version}`;
  $('dataSource').textContent = d.meta.source;
  renderKpis(); renderDecision(); renderOutcome(); renderStructure(); renderNetwork(); renderHeatmap(); renderAssets(); renderDrivers(); renderAudit();
}

function deltaClass(v, inverse=false){
  if(v==null) return '';
  const bad=inverse?Number(v)<0:Number(v)>0;
  return bad?'bad':'good';
}

function renderKpis(){
  const d=state.data,c=d.current,m=d.estimators[state.estimator].metrics;
  const items=[
    ['Market regime',c.regime,`${c.confirmation.count} of 3 estimators confirm deterioration`,c.regime==='Crisis'||c.regime==='Caution'?'Risk elevated':'No broad danger exit',c.regime==='Crisis'||c.regime==='Caution'?'bad':'good'],
    ['Crash-risk rank',`${fmt(c.crash_rank,0)}th pct`,`ORCA-Lite score: ${fmt(c.crash_score,1)}`,'60th pct is paper-style exit threshold',c.crash_rank>=60?'bad':c.crash_rank>=40?'':'good'],
    ['Rally rank',`${fmt(c.rally_rank,0)}th pct`,`ORCA-Lite score: ${fmt(c.rally_score,1)}`,'78–90 is the paper-style sweet spot',c.rally_rank>=78&&c.rally_rank<90?'good':c.rally_rank>=90?'bad':''],
    ['Equity risk band',`${fmt(c.suggested_equity_exposure,1)}×`,'Illustrative exposure policy','Not a standalone allocation instruction',c.suggested_equity_exposure<1?'bad':c.suggested_equity_exposure>1?'good':''],
    ['Effective bets',`${fmt(m.effective_rank.value,1)} / 24`,`${signed(m.effective_rank.change_20d,1)} over 20D`,'Lower means less real diversification',deltaClass(m.effective_rank.change_20d,true)],
    ['One-factor share',pct(m.ar1.value,1),`${signed(m.ar1.change_20d*100,1)} pp over 20D`,'Higher means one factor dominates',deltaClass(m.ar1.change_20d)]
  ];
  $('kpiGrid').innerHTML=items.map(x=>`<article class="kpi"><div class="kpi-label">${x[0]}</div><div class="kpi-value">${x[1]}</div><div class="kpi-meta">${x[2]}</div><span class="kpi-delta ${x[4]}">${x[3]}</span></article>`).join('');
}

function renderDecision(){
  const c=state.data.current,svg=$('decisionMap'),W=720,H=500,p={l:76,r:34,t:28,b:62},w=W-p.l-p.r,h=H-p.t-p.b;
  const x=v=>p.l+w*v/100,y=v=>p.t+h*(1-v/100);
  const rect=(x0,y0,x1,y1,color,op=.85)=>`<rect x="${x(x0)}" y="${y(y1)}" width="${x(x1)-x(x0)}" height="${y(y0)-y(y1)}" fill="${color}" opacity="${op}"/>`;
  let out=`<rect x="${p.l}" y="${p.t}" width="${w}" height="${h}" rx="10" fill="#faf5ec" stroke="${COLORS.line}"/>`;
  out+=rect(0,60,100,100,COLORS.Crisis,.98)+rect(0,40,100,60,COLORS.Caution,.98)+rect(90,0,100,60,COLORS.Euphoria,.98)+rect(78,0,90,40,COLORS.Rally,.98)+rect(0,0,78,40,COLORS.Normal,.9);
  for(let v=0;v<=100;v+=20){out+=`<line x1="${x(v)}" y1="${p.t}" x2="${x(v)}" y2="${p.t+h}" stroke="#e1d7c8"/><line x1="${p.l}" y1="${y(v)}" x2="${p.l+w}" y2="${y(v)}" stroke="#e1d7c8"/><text x="${x(v)}" y="${p.t+h+24}" text-anchor="middle" fill="${COLORS.muted}" font-size="11">${v}</text><text x="${p.l-14}" y="${y(v)+4}" text-anchor="end" fill="${COLORS.muted}" font-size="11">${v}</text>`}
  out+=`<line x1="${p.l}" y1="${y(60)}" x2="${p.l+w}" y2="${y(60)}" stroke="${COLORS.red}" stroke-dasharray="7 6" stroke-width="1.6"/><line x1="${x(90)}" y1="${p.t}" x2="${x(90)}" y2="${p.t+h}" stroke="${COLORS.orange}" stroke-dasharray="7 6" stroke-width="1.6"/><line x1="${x(78)}" y1="${y(40)}" x2="${x(90)}" y2="${y(40)}" stroke="${COLORS.green}" stroke-dasharray="5 5"/>`;
  out+=`<text x="${x(50)}" y="${y(82)}" text-anchor="middle" fill="#8f382d" font-size="23" font-family="Georgia" font-weight="700">CRISIS / DANGER EXIT</text><text x="${x(47)}" y="${y(50)}" text-anchor="middle" fill="#94610f" font-size="20" font-family="Georgia" font-weight="700">CAUTION</text><text x="${x(38)}" y="${y(20)}" text-anchor="middle" fill="#57705a" font-size="18" font-family="Georgia" font-weight="700">NORMAL / BUILDING</text><text x="${x(84)}" y="${y(20)}" text-anchor="middle" fill="${COLORS.green}" font-size="18" font-family="Georgia" font-weight="700">RALLY SWEET SPOT</text><text transform="translate(${x(95)} ${y(28)}) rotate(-90)" text-anchor="middle" fill="#a6532a" font-size="17" font-family="Georgia" font-weight="700">EUPHORIA EXIT</text>`;
  const cx=x(c.rally_rank),cy=y(c.crash_rank);
  out+=`<line x1="${cx}" y1="${p.t+h}" x2="${cx}" y2="${cy}" stroke="#7f6e5b" stroke-dasharray="4 6" opacity=".55"/><line x1="${p.l}" y1="${cy}" x2="${cx}" y2="${cy}" stroke="#7f6e5b" stroke-dasharray="4 6" opacity=".55"/><circle cx="${cx}" cy="${cy}" r="20" fill="#fffaf0" stroke="#513924" stroke-width="5"/><circle cx="${cx}" cy="${cy}" r="8" fill="${COLORS.red}"/><text x="${cx+26}" y="${cy-14}" fill="${COLORS.ink}" font-size="15" font-weight="800">Rally ${fmt(c.rally_rank,0)} · Crash ${fmt(c.crash_rank,0)}</text>`;
  out+=`<text x="${p.l+w/2}" y="${H-12}" text-anchor="middle" fill="${COLORS.ink}" font-size="14" font-weight="800">Rally percentile rank →</text><text transform="translate(22 ${p.t+h/2}) rotate(-90)" text-anchor="middle" fill="${COLORS.ink}" font-size="14" font-weight="800">Crash percentile rank →</text>`;
  svg.innerHTML=out;
  const s=c.summary;$('actionHeadline').textContent=s.headline;$('actionInterpretation').textContent=s.interpretation;$('actionExposure').textContent=`${fmt(c.suggested_equity_exposure,1)}×`;$('actionConfirmation').textContent=`${c.confirmation.count} of 3`;$('actionRecommendation').textContent=s.action;$('actionInvalidation').textContent=s.invalidation;
}

function filteredHistory(){
  const all=state.data.history.filter(x=>x[state.index]!=null),last=new Date(all.at(-1).date),start=new Date(last);start.setFullYear(start.getFullYear()-state.years);return all.filter(x=>new Date(x.date)>=start);
}
function linePath(points,x,y,key){let started=false,p='';points.forEach((d,i)=>{const v=d[key];if(v==null||!Number.isFinite(Number(v))){started=false;return;}p+=`${started?'L':'M'}${x(i).toFixed(1)},${y(Number(v)).toFixed(1)} `;started=true;});return p;}
function contiguousRegimes(data){const out=[];let start=0,current=data[0]?.regime||'Unavailable';for(let i=1;i<data.length;i++){const next=data[i].regime||'Unavailable';if(next!==current){out.push({start,end:i-1,regime:current});start=i;current=next;}}if(data.length)out.push({start,end:data.length-1,regime:current});return out;}

function renderOutcome(){
  const data=filteredHistory(),svg=$('outcomeChart'),W=1280,H=760,p={l:76,r:42,t:35,b:42},gap=34,topH=340,midH=210,botH=95;
  if(data.length<3){svg.innerHTML='<text x="50" y="80">Insufficient history.</text>';return;}
  const x=i=>p.l+(W-p.l-p.r)*i/(data.length-1),indexKey=state.display==='level'?state.index:`${state.index}_rolling_1y`;
  let vals=data.map(d=>d[indexKey]).filter(v=>v!=null).map(Number);let transformed=data.map(d=>({...d,_index:d[indexKey]}));
  if(state.display==='level'){
    const base=Number(data.find(d=>d[state.index]!=null)[state.index]);transformed=data.map(d=>({...d,_index:d[state.index]!=null?Number(d[state.index])/base*100:null}));vals=transformed.map(d=>d._index).filter(v=>v!=null);
  }else{transformed=data.map(d=>({...d,_index:d[indexKey]!=null?Number(d[indexKey])*100:null}));vals=transformed.map(d=>d._index).filter(v=>v!=null);}
  let min=Math.min(...vals),max=Math.max(...vals);if(state.display==='level'){const pad=(max-min)*.08||5;min-=pad;max+=pad}else{const pad=Math.max(5,(max-min)*.1);min-=pad;max+=pad;min=Math.min(min,0);max=Math.max(max,0)}
  const topY=v=>p.t+topH*(1-(v-min)/(max-min));const midTop=p.t+topH+gap,midY=v=>midTop+midH*(1-v/100);const botTop=midTop+midH+gap,botY=v=>botTop+botH*(1-v/1.5);
  let out=`<rect x="${p.l}" y="${p.t}" width="${W-p.l-p.r}" height="${topH}" fill="#fffdf8"/><rect x="${p.l}" y="${midTop}" width="${W-p.l-p.r}" height="${midH}" fill="#fffdf8"/><rect x="${p.l}" y="${botTop}" width="${W-p.l-p.r}" height="${botH}" fill="#fffdf8"/>`;
  contiguousRegimes(transformed).forEach(seg=>{const xx=x(seg.start),ww=Math.max(1,x(seg.end)-xx+(W-p.l-p.r)/(data.length-1));out+=`<rect x="${xx}" y="${p.t}" width="${ww}" height="${botTop+botH-p.t}" fill="${COLORS[seg.regime]||COLORS.Unavailable}" opacity=".55"/>`;});
  for(let k=0;k<=4;k++){const v=min+(max-min)*k/4,yy=topY(v);out+=`<line x1="${p.l}" y1="${yy}" x2="${W-p.r}" y2="${yy}" stroke="#ded4c5"/><text x="${p.l-12}" y="${yy+4}" text-anchor="end" fill="${COLORS.muted}" font-size="10">${state.display==='level'?fmt(v,0):`${fmt(v,0)}%`}</text>`;}
  [0,20,40,60,80,100].forEach(v=>{out+=`<line x1="${p.l}" y1="${midY(v)}" x2="${W-p.r}" y2="${midY(v)}" stroke="#ded4c5"/><text x="${p.l-12}" y="${midY(v)+4}" text-anchor="end" fill="${COLORS.muted}" font-size="10">${v}</text>`;});
  [0,.5,1,1.5].forEach(v=>{out+=`<line x1="${p.l}" y1="${botY(v)}" x2="${W-p.r}" y2="${botY(v)}" stroke="#ded4c5"/><text x="${W-p.r+10}" y="${botY(v)+4}" fill="${COLORS.muted}" font-size="10">${v.toFixed(1)}×</text>`;});
  out+=`<line x1="${p.l}" y1="${midY(60)}" x2="${W-p.r}" y2="${midY(60)}" stroke="${COLORS.red}" stroke-dasharray="7 6"/><line x1="${p.l}" y1="${midY(90)}" x2="${W-p.r}" y2="${midY(90)}" stroke="${COLORS.amber}" stroke-dasharray="7 6"/>`;
  out+=`<path d="${linePath(transformed,x,topY,'_index')}" fill="none" stroke="#493727" stroke-width="3.4" stroke-linejoin="round" stroke-linecap="round"/><path d="${linePath(transformed,x,midY,'rally_rank')}" fill="none" stroke="${COLORS.green}" stroke-width="2.5"/><path d="${linePath(transformed,x,midY,'crash_rank')}" fill="none" stroke="${COLORS.red}" stroke-width="2.5"/>`;
  let exp='';let started=false;transformed.forEach((d,i)=>{if(d.exposure==null){started=false;return;}const xx=x(i),yy=botY(Number(d.exposure));if(!started){exp+=`M${xx},${yy} `;started=true}else{const prev=transformed[i-1]?.exposure;exp+=`L${xx},${botY(Number(prev??d.exposure))} L${xx},${yy} `;}});out+=`<path d="${exp}" fill="none" stroke="${COLORS.purple}" stroke-width="3"/>`;
  const ticks=Math.min(6,Math.max(3,state.years+1));for(let k=0;k<ticks;k++){const i=Math.round((data.length-1)*k/(ticks-1)),dt=new Date(data[i].date);out+=`<text x="${x(i)}" y="${H-12}" text-anchor="middle" fill="${COLORS.muted}" font-size="10">${dt.toLocaleDateString('en-US',{month:'short',year:'2-digit'})}</text>`;}
  const label=state.display==='level'?`${state.index} · rebased to 100 at range start`:`${state.index} · rolling 1-year return`;out+=`<text x="${p.l}" y="${p.t-12}" fill="${COLORS.ink}" font-size="12" font-weight="800">${label}</text><text x="${p.l}" y="${midTop-12}" fill="${COLORS.ink}" font-size="12" font-weight="800">Rally rank (green) · Crash rank (red)</text><text x="${p.l}" y="${botTop-12}" fill="${COLORS.ink}" font-size="12" font-weight="800">Recommended equity exposure</text><rect x="${p.l}" y="${p.t}" width="${W-p.l-p.r}" height="${botTop+botH-p.t}" fill="transparent" class="outcome-hit"/>`;
  svg.innerHTML=out;
  $('outcomeLegend').innerHTML=['Normal','Rally','Caution','Crisis','Euphoria'].map(r=>`<span class="legend-item"><i class="legend-swatch" style="background:${COLORS[r]}"></i>${r}</span>`).join('')+`<span class="legend-item"><i class="legend-swatch" style="background:#493727;height:3px"></i>Selected index</span><span class="legend-item"><i class="legend-swatch" style="background:${COLORS.purple};height:3px"></i>Equity exposure</span>`;
  const hit=svg.querySelector('.outcome-hit'),tip=$('outcomeTooltip');hit.addEventListener('mousemove',ev=>{const rect=svg.getBoundingClientRect(),mx=(ev.clientX-rect.left)*W/rect.width,i=clamp(Math.round((mx-p.l)/(W-p.l-p.r)*(data.length-1)),0,data.length-1),d=transformed[i];tip.innerHTML=`<strong>${new Date(d.date).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}</strong><br>${state.index}: ${state.display==='level'?fmt(d._index,1):`${fmt(d._index,1)}%`}<br>Regime: ${d.regime||'Unavailable'}<br>Rally rank: ${fmt(d.rally_rank,1)}<br>Crash rank: ${fmt(d.crash_rank,1)}<br>Exposure: ${d.exposure==null?'—':`${fmt(d.exposure,1)}×`}<br>Effective bets: ${fmt(d.effective_rank,1)}`;tip.style.display='block';const panel=svg.parentElement.getBoundingClientRect();tip.style.left=`${ev.clientX-panel.left+12}px`;tip.style.top=`${ev.clientY-panel.top+12}px`;});hit.addEventListener('mouseleave',()=>tip.style.display='none');
  $('researchPanel').hidden=state.mode!=='research';if(state.mode==='research')renderPerformanceTable();
}

function renderPerformanceTable(){
  $('regimePerformanceBody').innerHTML=state.data.performance_by_regime.map(r=>`<tr><td><strong>${esc(r.regime)}</strong></td><td>${r.episodes}</td><td class="${r.median_forward_10d>=0?'pos':'neg'}">${pct(r.median_forward_10d,1,true)}</td><td>${pct(r.positive_hit_rate_10d,0)}</td><td class="neg">${pct(r.median_max_drawdown_10d,1,true)}</td><td class="neg">${pct(r.worst_forward_10d,1,true)}</td></tr>`).join('');
}

function helpIcon(explanation){if(!explanation||!explanation.title)return '';return `<span class="help-icon" tabindex="0" data-help='${esc(JSON.stringify(explanation))}'>i</span>`;}
function metricPlain(key,m){const v=m.value;if(key==='ar1')return `One factor controls ${pct(v,1)} of cross-asset movement.`;if(key==='effective_rank')return `24 assets currently behave like roughly ${fmt(v,1)} independent bets.`;if(key==='edge_density_05')return `${Math.round(v*276)} of 276 unique asset pairs have |correlation| above 0.50.`;if(key==='clustering')return `${pct(v,0)} of potential strong-link triangles are currently closed.`;return '';}
function stressLabel(p){return p>=85?'Extreme':p>=70?'High':p>=50?'Elevated':p>=30?'Normal':'Low';}

function renderStructure(){
  const e=state.data.estimators[state.estimator],m=e.metrics,c=state.data.current.confirmation;
  $('confirmationChip').textContent=`${c.count} of 3 deteriorating · ${c.message}`;
  const cards=[
    ['ar1','How much is one factor controlling the market?'],['effective_rank','How many independent bets remain?'],['edge_density_05','How many asset pairs are strongly linked?'],['clustering','How tightly are assets forming crowded groups?']
  ];
  $('structuralGrid').innerHTML=cards.map(([key,q])=>{const x=m[key],chg=key==='ar1'||key==='edge_density_05'||key==='clustering'?`${signed(x.change_20d*100,1)} pp / 20D`:`${signed(x.change_20d,1)} / 20D`;const val=key==='ar1'||key==='edge_density_05'||key==='clustering'?pct(x.value,1):`${fmt(x.value,1)} / 24`;return `<article class="panel structural-card" data-help='${esc(JSON.stringify(x.explanation))}'><div class="question">${q}${helpIcon(x.explanation)}</div><div class="big-number">${val}</div><div class="plain-language">${metricPlain(key,x)}</div><div class="stress-track"><span style="width:${clamp(x.stress_percentile,2,100)}%"></span></div><div class="stress-footer"><span>${chg}</span><strong>${stressLabel(x.stress_percentile)} · ${fmt(x.stress_percentile,0)}th pct</strong></div></article>`;}).join('');
  const advanced=[['ar3','Top-three factor share',v=>pct(v,1)],['spectral_gap','Dominant-factor ratio',v=>`${fmt(v,2)}×`],['condition_number','Matrix instability',v=>`${fmt(v,1)}×`],['mp_excess','Factor above random noise',v=>fmt(v,2)],['mean_abs_corr','Mean absolute correlation',v=>fmt(v,2)],['edge_density_03','Connections above |0.30|',v=>pct(v,1)],['edge_density_07','Connections above |0.70|',v=>pct(v,1)],['mean_degree_05','Average strong links per asset',v=>fmt(v,1)]];
  $('advancedMetrics').innerHTML=advanced.map(([key,label,formatter])=>{const x=m[key];return `<article class="advanced-metric" data-help='${esc(JSON.stringify(x.explanation||{}))}'><strong>${label}${helpIcon(x.explanation)}</strong><div class="metric-number">${formatter(x.value)}</div><small>${signed(x.change_20d,3)} over 20D · ${fmt(x.stress_percentile,0)}th stress pct</small></article>`;}).join('');
  bindHelp();
}

function nodePositions(){
  const assets=state.data.universe,groups={};assets.forEach(a=>(groups[a.group]??=[]).push(a));
  const cfg={
    'Broad US equity':{cx:210,cy:175,rx:90,ry:70,start:-1.4},'US sectors / REIT':{cx:505,cy:295,rx:190,ry:150,start:-1.45},
    'International equity':{cx:895,cy:180,rx:110,ry:85,start:-1.3},'Fixed income / credit':{cx:270,cy:575,rx:135,ry:70,start:-1.2},
    'Commodities':{cx:760,cy:575,rx:105,ry:55,start:-1.1},'Currency':{cx:1050,cy:500,rx:1,ry:1,start:0}
  },pos={};Object.entries(groups).forEach(([g,list])=>{const c=cfg[g];list.forEach((a,i)=>{if(list.length===1)pos[a.ticker]={x:c.cx,y:c.cy};else{const angle=c.start+i*Math.PI*2/list.length;pos[a.ticker]={x:c.cx+Math.cos(angle)*c.rx,y:c.cy+Math.sin(angle)*c.ry};}});});return pos;
}
function currentMatrix(){return state.data.estimators[state.estimator].matrix;}
function renderNetwork(){
  const canvas=$('networkCanvas'),ctx=canvas.getContext('2d'),W=1280,H=720,m=currentMatrix(),assets=state.data.universe,pos=nodePositions(),tip=$('networkTooltip');ctx.clearRect(0,0,W,H);ctx.fillStyle='#fffdf8';ctx.fillRect(0,0,W,H);
  const degrees=assets.map((_,i)=>m[i].filter((v,j)=>i!==j&&Math.abs(v)>state.threshold&&(state.edgeMode==='absolute'||v>0)).length),maxD=Math.max(...degrees,1);
  for(let i=0;i<assets.length;i++)for(let j=i+1;j<assets.length;j++){const v=m[i][j],show=Math.abs(v)>state.threshold&&(state.edgeMode==='absolute'||v>0);if(!show)continue;const a=pos[assets[i].ticker],b=pos[assets[j].ticker];ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.strokeStyle=v>=0?'rgba(166,64,50,.50)':'rgba(79,114,136,.55)';ctx.lineWidth=.7+Math.abs(v)*3;ctx.stroke();}
  assets.forEach((a,i)=>{const p=pos[a.ticker],r=12+degrees[i]/maxD*9;ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fillStyle=GROUP_COLORS[a.group]||'#777';ctx.fill();ctx.lineWidth=2.5;ctx.strokeStyle='#fffaf1';ctx.stroke();ctx.fillStyle=COLORS.ink;ctx.font='800 12px Inter,Arial';ctx.textAlign='center';ctx.fillText(a.ticker,p.x,p.y+r+18);p.r=r;p.degree=degrees[i];});
  ctx.fillStyle=COLORS.muted;ctx.font='11px Inter,Arial';ctx.textAlign='left';ctx.fillText(`${state.data.estimators[state.estimator].label} · threshold |ρ| > ${state.threshold.toFixed(2)} · ${state.edgeMode==='absolute'?'positive and negative links':'positive links only'}`,22,H-20);
  canvas.onmousemove=ev=>{const rect=canvas.getBoundingClientRect(),x=(ev.clientX-rect.left)*W/rect.width,y=(ev.clientY-rect.top)*H/rect.height;let hit=null;assets.forEach(a=>{const p=pos[a.ticker];if(Math.hypot(x-p.x,y-p.y)<=p.r+6)hit=a;});if(hit){const row=state.data.assets.find(a=>a.ticker===hit.ticker),p=pos[hit.ticker];tip.innerHTML=`<strong>${hit.ticker} — ${hit.name}</strong><br>${hit.group}<br>Strong links: ${p.degree} of 23<br>Average |corr|: ${fmt(row?.avg_abs_corr,2)}<br>Role: ${row?.network_role||'—'}`;tip.style.display='block';const box=canvas.parentElement.getBoundingClientRect();tip.style.left=`${ev.clientX-box.left+12}px`;tip.style.top=`${ev.clientY-box.top+12}px`;canvas.style.cursor='help';}else{tip.style.display='none';canvas.style.cursor='default';}};canvas.onmouseleave=()=>{tip.style.display='none';canvas.style.cursor='default';};
}

function mix(a,b,t){return Math.round(a+(b-a)*t)}
function corrColor(v){const neg=[73,111,130],zero=[249,244,235],pos=[159,63,49],c=v<0?neg:pos,t=Math.min(1,Math.abs(v));return `rgb(${mix(zero[0],c[0],t)},${mix(zero[1],c[1],t)},${mix(zero[2],c[2],t)})`;}
function renderHeatmap(){
  const canvas=$('heatmapCanvas'),shell=$('heatmapScroll'),tip=$('heatmapTooltip'),ctx=canvas.getContext('2d'),assets=state.data.universe,m=currentMatrix(),cell=34,left=145,top=145,size=left+cell*assets.length+24,dpr=Math.max(1,window.devicePixelRatio||1);canvas.width=size*dpr;canvas.height=size*dpr;canvas.style.width=`${size}px`;canvas.style.height=`${size}px`;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,size,size);ctx.fillStyle='#fffdf8';ctx.fillRect(0,0,size,size);ctx.font='800 10px Inter,Arial';ctx.textAlign='right';ctx.textBaseline='middle';assets.forEach((a,i)=>{ctx.fillStyle='#574b3f';ctx.fillText(a.ticker,left-10,top+i*cell+cell/2)});ctx.textAlign='left';assets.forEach((a,i)=>{ctx.save();ctx.translate(left+i*cell+cell/2,top-10);ctx.rotate(-Math.PI/2);ctx.fillStyle='#574b3f';ctx.fillText(a.ticker,0,0);ctx.restore();});
  for(let i=0;i<assets.length;i++)for(let j=0;j<assets.length;j++){ctx.fillStyle=corrColor(m[i][j]);ctx.fillRect(left+j*cell,top+i*cell,cell-1,cell-1);if(i===j){ctx.strokeStyle='#6e5b43';ctx.strokeRect(left+j*cell+.5,top+i*cell+.5,cell-2,cell-2)}}
  let last=assets[0].group;for(let i=1;i<assets.length;i++)if(assets[i].group!==last){ctx.strokeStyle='#8b7861';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(left,top+i*cell);ctx.lineTo(left+cell*assets.length,top+i*cell);ctx.moveTo(left+i*cell,top);ctx.lineTo(left+i*cell,top+cell*assets.length);ctx.stroke();last=assets[i].group;}ctx.strokeStyle='#c8b8a2';ctx.lineWidth=1;ctx.strokeRect(left,top,cell*assets.length,cell*assets.length);
  canvas.onmousemove=ev=>{const r=canvas.getBoundingClientRect(),x=(ev.clientX-r.left)*size/r.width,y=(ev.clientY-r.top)*size/r.height,j=Math.floor((x-left)/cell),i=Math.floor((y-top)/cell);let html='',cursor='default';if(i>=0&&j>=0&&i<assets.length&&j<assets.length){html=`<strong>${assets[i].ticker} × ${assets[j].ticker}</strong><br>${assets[i].name}<br>${assets[j].name}<br>Signed correlation: ${fmt(m[i][j],3)}`;cursor='crosshair';}else if(y>=top&&y<top+cell*assets.length&&x>8&&x<left-5){const k=Math.floor((y-top)/cell);if(k>=0&&k<assets.length){const a=assets[k];html=`<strong>${a.ticker} — ${a.name}</strong><br>${a.group}<br>${a.role}`;cursor='help';}}else if(x>=left&&x<left+cell*assets.length&&y>8&&y<top-5){const k=Math.floor((x-left)/cell);if(k>=0&&k<assets.length){const a=assets[k];html=`<strong>${a.ticker} — ${a.name}</strong><br>${a.group}<br>${a.role}`;cursor='help';}}canvas.style.cursor=cursor;if(html){tip.innerHTML=html;tip.style.display='block';const box=shell.getBoundingClientRect();tip.style.left=`${ev.clientX-box.left+shell.scrollLeft+12}px`;tip.style.top=`${ev.clientY-box.top+shell.scrollTop+12}px`;}else tip.style.display='none';};canvas.onmouseleave=()=>{tip.style.display='none';canvas.style.cursor='default';};
  const pairs=[];for(let i=0;i<assets.length;i++)for(let j=i+1;j<assets.length;j++)pairs.push({i,j,v:m[i][j]});const pos=[...pairs].sort((a,b)=>b.v-a.v).slice(0,3),neg=[...pairs].sort((a,b)=>a.v-b.v).slice(0,3),div=[...pairs].sort((a,b)=>Math.abs(a.v)-Math.abs(b.v)).slice(0,3);const box=(title,arr,desc)=>`<div class="pair-box"><h4>${title}</h4>${arr.map(p=>`<div class="pair-row"><span>${assets[p.i].ticker} / ${assets[p.j].ticker}</span><strong style="color:${p.v>=0?COLORS.red:COLORS.blue}">${signed(p.v,2)}</strong></div>`).join('')}<small>${desc}</small></div>`;$('pairGrid').innerHTML=box('Strongest positive links',pos,'Potential duplicate exposure or contagion.')+box('Strongest negative links',neg,'Potential offset; stability must be validated.')+box('Most independent pairs',div,'Lowest current co-movement.');
}

function renderAssets(){
  let rows=[...state.data.assets].filter(a=>`${a.ticker} ${a.name} ${a.group} ${a.network_role} ${a.portfolio_meaning}`.toLowerCase().includes(state.search.toLowerCase()));
  rows.sort((a,b)=>state.sort==='ticker'?a.ticker.localeCompare(b.ticker):state.sort==='return5'?b.return_5d-a.return_5d:state.sort==='avg'?b.avg_abs_corr-a.avg_abs_corr:b.strong_links-a.strong_links);
  $('assetBody').innerHTML=rows.map(a=>`<tr data-ticker="${a.ticker}"><td class="ticker">${a.ticker}</td><td>${esc(a.name)}</td><td><span class="group-chip"><i class="group-dot" style="background:${GROUP_COLORS[a.group]}"></i>${esc(a.group)}</span></td><td class="${a.return_1d>=0?'pos':'neg'}">${pct(a.return_1d,1,true)}</td><td class="${a.return_5d>=0?'pos':'neg'}">${pct(a.return_5d,1,true)}</td><td>${fmt(a.avg_abs_corr,2)}</td><td><strong>${a.strong_links}</strong> / 23</td><td>${a.strongest_link.ticker} <span class="${a.strongest_link.correlation>=0?'pos':'neg'}">${signed(a.strongest_link.correlation,2)}</span></td><td class="${a.spy_correlation>=0?'pos':'neg'}">${signed(a.spy_correlation,2)}</td><td class="${a.avg_abs_corr_change_20d>=0?'neg':'pos'}">${signed(a.avg_abs_corr_change_20d,2)}</td><td>${esc(a.network_role)}</td></tr>`).join('');
  $('assetBody').querySelectorAll('tr').forEach(tr=>tr.addEventListener('click',()=>{const a=state.data.assets.find(x=>x.ticker===tr.dataset.ticker);$('assetDetail').innerHTML=`<strong>${a.ticker} — ${esc(a.name)} · ${esc(a.network_role)}</strong><br>${esc(a.portfolio_meaning)}<br><span class="muted">Strongest relationship: ${a.strongest_link.ticker} ${signed(a.strongest_link.correlation,2)} · SPY relationship: ${signed(a.spy_correlation,2)} · average relationship changed ${signed(a.avg_abs_corr_change_20d,2)} over 20 trading days.</span>`;}));
}

function renderDrivers(){
  const make=(title,score,items,isRally=false)=>`<div class="driver-header"><div><h3>${title}</h3><p>Positive contribution pushes the score higher.</p></div><span class="driver-output ${isRally?'rally':''}">Current score ${fmt(score,1)}</span></div>${items.map(x=>{const width=clamp(Math.abs(x.contribution)*270,4,100);return `<div class="driver-row"><div class="driver-label" data-help='${esc(JSON.stringify(x.explanation||{}))}'>${esc(x.label)}${helpIcon(x.explanation)}</div><div class="driver-track"><div class="driver-fill ${x.contribution<0?'negative':''}" style="width:${width}%"></div></div><div class="driver-value" style="color:${x.contribution>=0?COLORS.red:COLORS.green}">${signed(x.contribution,3)}</div></div>`;}).join('')}`;
  $('crashDrivers').innerHTML=make('Crash signal',state.data.current.crash_score,state.data.drivers.crash)+`<div class="feature-share"><span>Spectral / graph share</span><div class="driver-track"><div class="driver-fill" style="width:${state.data.drivers.crash_spectral_share}%"></div></div><strong>${fmt(state.data.drivers.crash_spectral_share,0)}%</strong></div>`;
  $('rallyDrivers').innerHTML=make('Rally signal',state.data.current.rally_score,state.data.drivers.rally,true);bindHelp();
}

function renderAudit(){
  const d=state.data,q=d.quality,a=d.audit,age=q.latest_age_calendar_days;const items=[
    ['Data mode',d.meta.data_mode.toUpperCase(),d.meta.source,d.meta.data_mode==='live'?'status-good':'status-watch'],
    ['Latest market date',d.meta.latest_market_date,`${age} calendar day${age===1?'':'s'} old`,age<=4?'status-good':'status-watch'],
    ['Common aligned panel',`${q.common_rows.toLocaleString()} rows`,`${q.common_start} through ${q.common_end}`,'status-good'],
    ['Missing-data policy','No forward fill',q.alignment_policy,'status-good'],
    ['XLRE history','No backfill',q.xlre_policy,'status-good'],
    ['Estimator matrices','4 views','Composite, EWM, 60D, and 120D','status-good'],
    ['Current regime',d.current.regime,`${d.current.confirmation.count} of 3 estimators deteriorating`,d.current.regime==='Crisis'?'status-bad':'status-watch'],
    ['Validation','Passed',Object.entries(a.validation).map(([k,v])=>`${k}: ${v}`).join(' · '),'status-good']
  ];
  $('auditGrid').innerHTML=items.map(x=>`<article class="panel audit-card"><span>${x[0]}</span><strong class="${x[3]}">${x[1]}</strong><p>${esc(x[2])}</p></article>`).join('');$('methodStatus').textContent=d.meta.model_status;$('ambiguityList').innerHTML=a.paper_ambiguities.map(x=>`<li>${esc(x)}</li>`).join('');
}

function bindHelp(){
  const pop=$('helpPopover');document.querySelectorAll('[data-help]').forEach(el=>{if(el.dataset.helpBound)return;el.dataset.helpBound='1';const show=ev=>{let info={};try{info=JSON.parse(el.dataset.help||'{}')}catch{}if(!info.title)return;pop.innerHTML=`<strong>${esc(info.title)}</strong><p class="help-section">What it measures</p><p>${esc(info.measure||'')}</p><p class="help-section">Simple example</p><p>${esc(info.simple||'')}</p><p class="help-section">Portfolio meaning</p><p>${esc(info.portfolio||'')}</p>`;pop.style.display='block';const r=el.getBoundingClientRect();pop.style.left=`${clamp(r.left,10,window.innerWidth-380)}px`;pop.style.top=`${clamp(r.bottom+8,10,window.innerHeight-260)}px`;};el.addEventListener('mouseenter',show);el.addEventListener('focus',show);el.addEventListener('click',ev=>{ev.stopPropagation();show(ev);});el.addEventListener('mouseleave',()=>setTimeout(()=>{if(!pop.matches(':hover'))pop.style.display='none'},80));el.addEventListener('blur',()=>pop.style.display='none');});pop.addEventListener('mouseleave',()=>pop.style.display='none');document.addEventListener('click',ev=>{if(!ev.target.closest('[data-help]')&&!ev.target.closest('#helpPopover'))pop.style.display='none';},{once:false});
}

let controlsBound=false;
function bindControls(){if(controlsBound)return;controlsBound=true;
  $('estimatorSelect').addEventListener('change',e=>{state.estimator=e.target.value;renderKpis();renderStructure();renderNetwork();renderHeatmap();});
  $('outcomeIndex').addEventListener('change',e=>{state.index=e.target.value;renderOutcome();});
  $('periodButtons').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{state.years=Number(b.dataset.years);$('periodButtons').querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));renderOutcome();}));
  $('displayButtons').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{state.display=b.dataset.display;$('displayButtons').querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));renderOutcome();}));
  $('modeButtons').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{state.mode=b.dataset.mode;$('modeButtons').querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));renderOutcome();}));
  $('thresholdButtons').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{state.threshold=Number(b.dataset.threshold);$('thresholdButtons').querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));renderNetwork();}));
  $('edgeButtons').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{state.edgeMode=b.dataset.edge;$('edgeButtons').querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));renderNetwork();}));
  $('assetSearch').addEventListener('input',e=>{state.search=e.target.value;renderAssets();});$('assetSort').addEventListener('change',e=>{state.sort=e.target.value;renderAssets();});
  window.addEventListener('resize',()=>{renderNetwork();});
}

document.addEventListener('DOMContentLoaded',loadData);

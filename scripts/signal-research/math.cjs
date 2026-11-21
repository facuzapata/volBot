const {createHash}=require('crypto');
const MINUTE=60000;
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const quantile=(a,p)=>{if(!a.length)return null;const s=[...a].sort((a,b)=>a-b),i=(s.length-1)*p,k=Math.floor(i);return s[k]+(s[Math.min(k+1,s.length-1)]-s[k])*(i-k)};
function rng(seed){let a=seed>>>0;return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const seedOf=s=>createHash('sha256').update(String(s)).digest().readUInt32LE(0);
function sample(pool,n,seed){const rand=rng(seed),a=pool.slice();for(let i=0;i<Math.min(n,a.length);i++){const j=i+Math.floor(rand()*(a.length-i));[a[i],a[j]]=[a[j],a[i]]}return a.slice(0,n)}
function forward(bars,index,entryTime,h){
 const i=index.get(entryTime);if(i===undefined)return {complete:false,reason:'missing entry minute'};
 if(i+h>bars.length)return {complete:false,reason:'right-censored'};
 const entry=bars[i].open;let hi=entry,lo=entry,hiBar=bars[i],loBar=bars[i];
 for(let j=0;j<h;j++){const c=bars[i+j];if(c.openTime!==entryTime+j*MINUTE)return{complete:false,reason:'gap'};if(c.high>hi){hi=c.high;hiBar=c}if(c.low<lo){lo=c.low;loBar=c}}
 return {complete:true,entry,close:bars[i+h-1].close,endTime:bars[i+h-1].closeTime,returnPct:(bars[i+h-1].close/entry-1)*100,mfePct:(hi/entry-1)*100,maePct:(1-lo/entry)*100,mfeTimeMin:(hiBar.openTime-entryTime)/MINUTE,mfeTimeMax:(hiBar.closeTime-entryTime)/MINUTE,maeTimeMin:(loBar.openTime-entryTime)/MINUTE,maeTimeMax:(loBar.closeTime-entryTime)/MINUTE};
}
function matchKey(f,level){const parts=[f.period,f.atrBucket,f.primaryTrend];if(level<2)parts.push(f.day);if(level===0||level===2)parts.push(f.hour4);return parts.join('|')}
function matchControls(cases,pool,group,plan){
 if(group==='A-random')return cases.map(c=>({caseId:c.id,level:'unmatched-random',controls:sample(pool.filter(p=>p.id!==c.id),plan.matching.controlsPerSignal,seedOf(`${plan.seed}:${group}:${c.id}`))}));
 const maps=[0,1,2,3].map(l=>{const m=new Map;for(const p of pool){const k=matchKey(p,l);if(!m.has(k))m.set(k,[]);m.get(k).push(p)}return m});
 return cases.map(c=>{for(let l=0;l<4;l++){const eligible=(maps[l].get(matchKey(c,l))||[]).filter(p=>p.id!==c.id);if(eligible.length)return{caseId:c.id,level:l,controls:sample(eligible,plan.matching.controlsPerSignal,seedOf(`${plan.seed}:${group}:${c.id}`))}}return{caseId:c.id,level:null,controls:[]}});
}
function describe(a){const m=mean(a);return {n:a.length,mean:m,median:quantile(a,.5),sd:a.length>1?Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/(a.length-1)):null,p10:quantile(a,.1),p90:quantile(a,.9)}}
function blockBootstrap(obs,{seed=1,reps=2000,daysPerBlock=1}={}){
 const valid=obs.filter(o=>Number.isFinite(o.value));if(!valid.length)return{n:0,days:0,mean:null,low:null,high:null,p:null};
 const periods=new Map;for(const o of valid){if(!periods.has(o.period))periods.set(o.period,new Map);const day=Math.floor(Date.parse(o.day+'T00:00:00Z')/86400000/daysPerBlock);const b=periods.get(o.period);if(!b.has(day))b.set(day,{sum:0,n:0});b.get(day).sum+=o.value;b.get(day).n++}
 const strata=[...periods.values()].map(m=>[...m.values()]);const rand=rng(seed),est=mean(valid.map(o=>o.value)),draws=[];
 for(let b=0;b<reps;b++){let sum=0,n=0;for(const blocks of strata)for(let k=0;k<blocks.length;k++){const v=blocks[Math.floor(rand()*blocks.length)];sum+=v.sum;n+=v.n}draws.push(sum/n)}
 return {n:valid.length,days:new Set(valid.map(o=>`${o.period}:${o.day}`)).size,blocks:strata.reduce((s,a)=>s+a.length,0),mean:est,low:quantile(draws,.025),high:quantile(draws,.975),p:(1+draws.filter(v=>Math.abs(v-est)>=Math.abs(est)).length)/(reps+1)};
}
function holm(ps){const sorted=ps.map((p,i)=>({p,i})).sort((a,b)=>a.p-b.p),out=Array(ps.length);let last=0;sorted.forEach((r,k)=>{last=Math.max(last,Math.min(1,r.p*(ps.length-k)));out[r.i]=last});return out}
function csv(rows){if(!rows.length)return'';const keys=[...new Set(rows.flatMap(Object.keys))];const cell=v=>'"'+String(v==null?'':typeof v==='object'?JSON.stringify(v):v).replaceAll('"','""')+'"';return[keys.map(cell).join(','),...rows.map(r=>keys.map(k=>cell(r[k])).join(','))].join('\n')+'\n'}
function pairedOutcomes(cases,matches,byId,outcomes,h){
 const matched=new Map(matches.map(m=>[m.caseId,m]));const rows=[];
 for(const c of cases){const a=outcomes[c.id]?.[h],m=matched.get(c.id);if(!a?.complete||!m)continue;
  const controls=m.controls.map(id=>({f:byId.get(typeof id==='string'?id:id.id),o:outcomes[typeof id==='string'?id:id.id]?.[h]})).filter(p=>p.o?.complete);
  if(!controls.length)continue;const net=mean(controls.map(p=>p.o.netReturnPct)),gross=mean(controls.map(p=>p.o.returnPct));
  rows.push({period:c.period,day:c.day,case:c,controls,level:m.level,controlNet:net,controlGross:gross,caseNet:a.netReturnPct,caseGross:a.returnPct,deltaNet:a.netReturnPct-net,deltaGross:a.returnPct-gross});
 }return rows;
}
function adverseBeforeTarget(bars,target,stop,entry,expectedStart=bars[0]?.openTime){
 const i=bars.findIndex(c=>c.high>=target);if(i<0)return null;
 const knownLow=Math.min(entry,bars[i].open,...bars.slice(0,i).map(c=>c.low));
 const worstLow=bars[i].open>=target?knownLow:Math.min(knownLow,bars[i].low);
 const complete=bars.slice(0,i+1).every((c,j)=>c.openTime===expectedStart+j*MINUTE);
 return{extraAdverseBeforeTpLowerPct:Math.max(0,(stop-knownLow)/entry*100),extraAdverseBeforeTpUpperPct:complete?Math.max(0,(stop-worstLow)/entry*100):null,maeBeforeTpLowerPct:(1-knownLow/entry)*100,maeBeforeTpUpperPct:complete?(1-worstLow/entry)*100:null,pathToTpComplete:complete};
}
module.exports={MINUTE,mean,quantile,rng,seedOf,sample,forward,matchKey,matchControls,describe,blockBootstrap,holm,csv,pairedOutcomes,adverseBeforeTarget};

/* Shared markup for the "Parts · Loading" cards and the builders' loading cards (Components · Collections).
   Markup only: every style is a class in slice-parts.css or loading-parts.css. */
(function(){
const I=(n,c)=>`<i class="fa-solid fa-${n}${c?' '+c:''}" aria-hidden="true"></i>`;
const N=(n,f)=>Array.from({length:n},(_,i)=>f(i)).join('');
/* text bars are keyed to the row's index, not its place in the viewport, so the pattern never crawls as a run scrolls */
const W=(b,i)=>Math.round(b*[1,.74,.88,.62,.94][((i%5)+5)%5]);
const bar=(w,h)=>`<span class="sk b${h||12}" style="width:${w}px"></span>`;
const chip=(w,h)=>`<span class="sk kc${h===15?' k15':''}" style="width:${w}px"></span>`;
const rect=(w,h,sm)=>`<span class="sk kr${sm?' rs':''}" style="width:${w}px;height:${h}px"></span>`;
const box=()=>'<span class="sk kb"></span>';
const enm=(w,h)=>`<span class="ke"><span class="sk kd"></span>${bar(w,h||12)}</span>`;
const lnk=(w,h)=>`<span class="kl">${chip(w,h)}<span class="ar">→</span>${chip(w,h)}</span>`;
const cnt=()=>'<span class="sk skc"></span>';
/* a failure said once where no row can hold a line (the Schematic's canvas, the Calendar's month and time grids): the Schematic card's message box, at the region's top-left; a grid with rows takes the failed line in its first row in view instead */
const fmsg=(h,x,y)=>`<span class="flt2" style="left:${x}px;top:${y}px"><span class="fail">${I('circle-exclamation')}<span class="msg">${h}</span></span><span class="bt md" role="button">Retry</span></span>`;
/* footer rail; data-s holds the line's short form, used when the space left is short */
const leg=a=>a.map(([t,s])=>`<span class="li">${s?`<span class="sw ${s}"></span>`:''}${t}</span>`).join('');
const line=(k,h,s)=>{if(k==='idle')return '<span class="ldl" role="status"></span>';const d=` data-s="${s||(k==='err'?'Couldn\'t read':/^Filtering/.test(h)?'Filtering…':'Loading…')}"`;return k==='err'?`<span class="ldl err" role="status"${d}><span class="dot neg"></span><span class="t">${h}</span><span class="sep">·</span><span class="lk" role="button">Retry</span></span>`:`<span class="ldl" role="status"${d}><span class="dot live"></span><span class="t">${h}</span></span>`;};
const foot=(lg,ln)=>`<div class="ff"><span class="lgd">${lg||''}</span>${ln||line('idle')}</div>`;
/* toolbar band */
const it=(h,c)=>`<span class="it${c?' '+c:''}">${h}</span>`;
const tb=a=>`<div class="band"><div class="tb">${a.join('')}</div></div>`;
const seg=(l,on)=>`<span class="sg" role="radiogroup" aria-label="View">${l.map((x,i)=>`<span class="o${i===on?' on':''}" role="radio" aria-checked="${i===on}">${x}</span>`).join('')}</span>`;
const nav=t=>`<span class="nv"><span class="bt ib gh" role="button" aria-label="Previous period">${I('chevron-left')}</span><span class="ch" role="button" aria-haspopup="dialog">${t}${I('chevron-down','cr')}</span><span class="bt ib gh" role="button" aria-label="Next period">${I('chevron-right')}</span></span>`;
const sum=h=>`<span class="sum">${h}</span>`;
const stt=(w,c)=>`<span class="stt"><span class="dot ${c||'neu'}"></span>${w}</span>`;
const iss=n=>`<span class="bt" role="button" aria-label="${n} issues, go to the first">${I('triangle-exclamation','wn')}<span class="n">${n}</span></span>`;
const pub=d=>`<span class="bt pri${d?' dis':''}" role="button"${d?' aria-disabled="true"':''}>Publish</span>`;
const hist=d=>`<span class="hb"><span class="bt ib gh${d?' dis':''}" role="button" aria-label="Undo">${I('arrow-rotate-left')}</span><span class="bt ib gh dis" role="button" aria-label="Redo" aria-disabled="true">${I('arrow-rotate-right')}</span><span class="bt ib${d?' dis':''}" role="button" aria-label="Discard changes">${I('trash-can')}</span><span class="bt${d?' dis':''}" role="button">Apply</span></span>`;
const flt=t=>`<span class="tg" role="button" aria-haspopup="dialog"><span class="ch${t?' br':''}">${I('filter','ic')}${t?`<span>${t}</span>`:''}</span>${I('chevron-down','cr')}</span>`;
/* held toolbar slots: status a dot and a short bar, issues and Publish rects at their buttons' footprints */
const held={stt:()=>enm(40,8),iss:()=>rect(44,24),pub:()=>rect(76,32)};
/* footer fit — 1 the legend (or the Plan's counts) stays whole and in place; 2 the Sheet's hints end at a whole hint, then "…"; 3 the line shows its full text if it fits whole; 4 else its short form if that fits whole; 5 else the dot alone, its full text kept for screen readers; 6 a failure's floor is the dot and Retry. No ellipsis on the line's text.
   Narrow, where the legend itself can't fit: the legend ends at a whole item, then "…", and the line shows its short form */
const fitFoot=ff=>{const lg=ff.querySelector('.lgd'),ln=ff.querySelector('.ldl'),t=ln&&ln.querySelector('.t'),sp=ln&&ln.querySelector('.sep');if(!lg)return;
if(lg.dataset.f==null)lg.dataset.f=lg.innerHTML;else lg.innerHTML=lg.dataset.f;
if(t){if(t.dataset.f==null)t.dataset.f=t.innerHTML;else t.innerHTML=t.dataset.f;t.classList.remove('vh');}if(sp)sp.style.display='';
const hints=!!lg.querySelector('.hn'),u=[];
[...lg.childNodes].forEach(n=>{const sep=n.textContent.trim()==='·';if(!hints||sep||!u.length)u.push([n]);else u[u.length-1].push(n);});
const keep=k=>{lg.textContent='';u.slice(0,k).forEach(g=>g.forEach(n=>lg.appendChild(n)));if(k<u.length)lg.insertAdjacentHTML('beforeend','<span>…</span>');};
const cs=getComputedStyle(ff),av=ff.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight),gp=parseFloat(cs.columnGap)||0;
const over=()=>lg.offsetWidth+(ln&&ln.childElementCount?gp+ln.scrollWidth:0)>av+1,cut=()=>!!t&&!t.classList.contains('vh')&&t.scrollWidth>t.clientWidth+1,bad=()=>over()||cut();
const short=()=>{t.classList.remove('vh');if(sp)sp.style.display='';if(ln.dataset.s)t.textContent=ln.dataset.s;},alone=()=>{t.innerHTML=t.dataset.f;t.classList.add('vh');if(sp)sp.style.display='none';};
let k=u.length;
if(!t){while(k>1&&over())keep(--k);return;}
if(hints)while(k>1&&bad())keep(--k);
if(!bad())return;
short();if(!bad())return;
alone();if(!bad())return;
short();while(k>1&&bad())keep(--k);};
/* a line's optional tail (.opt), on the footer's rule: one line, no cut word; the tail shows only when the whole line fits, else it drops whole, kept for screen readers */
const fitOpt=o=>{o.classList.remove('vh');const m=o.closest('.msg');if(m&&m.scrollWidth>m.clientWidth+1)o.classList.add('vh');};
let fq=0;const fitAll=()=>{fq=0;document.querySelectorAll('.ff').forEach(fitFoot);document.querySelectorAll('.msg .opt').forEach(fitOpt);};
const qfit=()=>{if(!fq){fq=1;const go=()=>{if(fq)fitAll();};requestAnimationFrame(go);setTimeout(go,60);}};
addEventListener('load',qfit);addEventListener('resize',qfit);
if(document.fonts){document.fonts.addEventListener('loadingdone',qfit);document.fonts.ready.then(qfit);}
if(window.ResizeObserver)new ResizeObserver(qfit).observe(document.documentElement);
const $=(id,h)=>{const e=document.getElementById(id);if(e)e.innerHTML=h;qfit();};
/* time grid: o = {cols:[{h, meta, today, wash, ev:[[from,to,title,meta]], stl}], from, to, off:[[a,b]], now, g}  (48 per hour) */
const tgrid=o=>{const g=o.g||56,P=48,H=(o.to-o.from)*P,n=o.cols.length,tc=`${g}px repeat(${n},minmax(0,1fr))`,y=t=>Math.round((t-o.from)*P);
let h=`<div class="tgh" style="grid-template-columns:${tc}"><span class="chd"></span>${o.cols.map(c=>`<span class="chd">${c.today?`<span class="nowc">${c.h}</span>`:`<span class="hk">${c.h}</span>`}${c.meta||''}</span>`).join('')}</div>`;
let gut='';for(let t=o.from;t<o.to;t++){if(o.now===t)continue;gut+=`<span class="hlab" style="top:${y(t)+2}px">${String(t).padStart(2,'0')}:00</span>`;}
const lines=N((o.to-o.from)*2-1,i=>`<i class="hl" style="top:${(i+1)*P/2}px"></i>`);
const cols=o.cols.map(c=>`<div class="col${c.stl?' stl':''}"${c.stl?' style="border-left-style:dashed;border-left-color:var(--rule-strong)"':''}>${(o.off||[]).map(([a,b])=>`<i class="oh" style="left:0;right:0;top:${y(a)}px;height:${y(b)-y(a)}px"></i>`).join('')}${c.wash?'<i class="wl wash" style="inset:0"></i>':''}${lines}${(c.ev||[]).map(e=>`<span class="ev" style="left:4px;right:4px;top:${y(e[0])+1}px;height:${y(e[1])-y(e[0])-2}px"><span class="em">${e[3]}</span><span class="et">${e[2]}</span></span>`).join('')}${c.fail||''}</div>`).join('');
const now=o.now!=null?`<i class="nowl" style="left:${g}px;right:0;top:${y(o.now)}px;height:1px"></i><span class="nowc" style="position:absolute;z-index:4;right:${'calc(100% - '+(g-4)+'px)'};top:${y(o.now)-8}px">${String(Math.floor(o.now)).padStart(2,'0')}:${String(Math.round(o.now%1*60)).padStart(2,'0')}</span>`:'';
return h+`<div class="tgd" style="grid-template-columns:${tc};height:${H}px"><div class="gut">${gut}</div>${cols}${now}</div>`;};
/* month: days [{n, out, today, wash, chips:[..], more, stl}] under weekday heads; a chip's text truncates inside its own box */
const month=(days,heads)=>`<div class="mw" style="grid-template-columns:repeat(7,minmax(0,1fr))">${(heads||['Mon','Tue','Wed','Thu','Fri','Sat','Sun']).map(d=>`<span class="mh"><span class="hk">${d}</span></span>`).join('')}${days.map(d=>`<div class="mc${d.out?' out':''}"${d.stl?' style="border-bottom-style:dashed;border-bottom-color:var(--rule-strong)"':''}><span class="dn">${d.today?`<span class="nowc">${d.n}</span>`:d.n}</span>${d.wash?'<i class="wl wash" style="left:0;right:0;top:28px;bottom:0"></i>':''}${d.chips?`<span class="chs${d.stl?' stl':''}">${d.chips.map(c=>`<span class="ch"><span>${c}</span></span>`).join('')}${d.more?`<span class="more">${d.more}</span>`:''}</span>`:''}</div>`).join('')}</div>`;
window.L={I,N,W,bar,chip,rect,box,enm,lnk,cnt,fmsg,leg,line,foot,it,tb,seg,nav,sum,stt,iss,pub,hist,flt,held,$,tgrid,month};
})();

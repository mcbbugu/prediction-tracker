const TODAY=new Date().toISOString().slice(0,10);
const STATUSES=["已兑现","部分兑现","未兑现","待定"];const app=document.getElementById('app');const cache={};
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pill=s=>`<span class="pill s-${esc(s)}">${esc(s)}</span>`;
const SITES={"spectrum.ieee.org":"IEEE Spectrum","en.wikipedia.org":"Wikipedia","arstechnica.com":"Ars Technica","reuters.com":"Reuters","x.com":"X","twitter.com":"X","youtube.com":"YouTube","youtu.be":"YouTube","theverge.com":"The Verge","cnbc.com":"CNBC","bloomberg.com":"Bloomberg","electrek.co":"Electrek","techcrunch.com":"TechCrunch","nytimes.com":"The New York Times","wsj.com":"The Wall Street Journal","cnn.com":"CNN","bbc.com":"BBC","bbc.co.uk":"BBC","theguardian.com":"The Guardian","businessinsider.com":"Business Insider","teslarati.com":"Teslarati","space.com":"Space.com","tesla.com":"Tesla","spacex.com":"SpaceX","neuralink.com":"Neuralink","forbes.com":"Forbes","fortune.com":"Fortune","wired.com":"WIRED","engadget.com":"Engadget","cnet.com":"CNET","npr.org":"NPR","apnews.com":"AP News","ft.com":"Financial Times"};
const site=u=>{try{const h=new URL(u).hostname.replace(/^www\./,'');return SITES[h]||h}catch{return u}};
const link=u=>`<a class="src" href="${esc(u)}" target="_blank" rel="noopener">${esc(site(u))}<span aria-hidden="true"> ↗</span></a>`;
const ICON={FSD:'<path d="M4 15l2-6h12l2 6v3H4z"/><circle cx="8" cy="18" r="1.5"/><circle cx="16" cy="18" r="1.5"/>',Robotaxi:'<path d="M4 15l2-6h12l2 6v3H4z"/><path d="M10 6h4v3h-4z"/>',Cybercab:'<path d="M3 16l9-8 9 8v2H3z"/>','火星':'<circle cx="12" cy="12" r="7"/><path d="M7 10c3 1 6-1 10 1M8 15c3-1 5 1 8 0"/>',Neuralink:'<path d="M12 4a6 6 0 0 0-6 6c0 3 2 4 2 7h8c0-3 2-4 2-7a6 6 0 0 0-6-6zM10 20h4"/>',Optimus:'<rect x="8" y="3" width="8" height="6" rx="1"/><path d="M12 9v3M7 12h10v7H7zM9 19v2M15 19v2"/>',Semi:'<path d="M2 7h11v9H2zM13 10h5l3 3v3h-8"/><circle cx="6" cy="17" r="1.5"/><circle cx="17" cy="17" r="1.5"/>'};
const icon=c=>`<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICON[c]||'<circle cx="12" cy="12" r="6"/>'}</svg>`;
const cat=c=>`<span class="cat">${icon(c)}${esc(c)}</span>`;
const days=(a,b)=>Math.round((new Date(b)-new Date(a))/864e5);

async function person(id){return cache[id]||(cache[id]=await (await fetch(`data/people/${id}.json`)).json())}
function bar(ps){const n=ps.length;return `<div class="dist" role="img" aria-label="状态分布">${STATUSES.map(s=>{const k=ps.filter(p=>p.status===s).length;return k?`<span class="seg s-${s}" style="flex:${k}" title="${s} ${k}"></span>`:''}).join('')}</div>
<ul class="legend">${STATUSES.map(s=>{const k=ps.filter(p=>p.status===s).length;return `<li><i class="dot s-${s}"></i>${s}<b>${k}</b><span>${Math.round(k/n*100)}%</span></li>`}).join('')}</ul>`}
const seal=p=>`<div class="seal" aria-hidden="true"><span>${esc(p.name_en.split(' ').map(w=>w[0]).join(''))}</span></div>`;
async function home(){const {people}=await (await fetch('data/people/index.json')).json();const list=await Promise.all(people.map(person));
const all=list.flatMap(p=>p.predictions.map(x=>({...x,pid:p.id,pname:p.name})));
const ev=all.reduce((a,x)=>a+(x.evidence_urls||[]).length,0)+all.filter(x=>x.source_url).length;
const up=all.filter(x=>x.status==='待定').sort((a,b)=>a.deadline.localeCompare(b.deadline)).slice(0,4);
const seen=new Set(),feat=[];for(const x of all){if(!seen.has(x.category)&&x.quote.en.length<160){seen.add(x.category);feat.push(x)}if(feat.length==3)break}
app.innerHTML=`<section class="hero"><p class="kicker">公开预测 · 到期核对 · 附原始出处</p><h1 class="display">说过的话，<br>到期后对照公开资料记录。</h1>
<p class="lead big">收集科技人物公开说过、带有明确时间的预测。截止日到来后，我们查找公开资料，记录实际发生了什么，并附上可点击的证据链接。</p>
<div class="figs"><div><b>${list.length}</b><span>位人物</span></div><div><b>${all.length}</b><span>条预测</span></div><div><b>${ev}</b><span>条出处与证据链接</span></div></div></section>
<section><h2 class="sec">即将到期</h2><p class="lead">状态为「待定」的预测，按截止日期排列。今天：${TODAY}</p><div class="grid">${up.map(x=>{const d=days(TODAY,x.deadline);return `<a class="tile" href="#/p/${x.pid}/${x.id}"><div class="count"><b>${d>=0?d:0}</b><span>${d>=0?'天后到期':'已到截止日'}</span></div><div class="meta">${cat(x.category)}<span>截止 ${x.deadline}</span></div><p>${esc(x.quote.zh)}</p></a>`}).join('')}</div></section>
<section><h2 class="sec">精选原话</h2>${feat.map(x=>`<a class="bigquote" href="#/p/${x.pid}/${x.id}"><p class="en" lang="en">“${esc(x.quote.en)}”</p><p class="zh">${esc(x.quote.zh)}</p><div class="meta"><span>— ${esc(x.pname)}，${x.published_date}</span>${cat(x.category)}${pill(x.status)}</div></a>`).join('')}</section>
<section><h2 class="sec">人物</h2>${list.map(p=>`<a class="card person" href="#/p/${p.id}">${seal(p)}<div style="flex:1"><h3>${esc(p.name)} <small>${esc(p.name_en)}</small></h3><div class="lead">${esc(p.title)} · 共 ${p.predictions.length} 条</div>${bar(p.predictions)}</div></a>`).join('')}</section>
<section class="method"><h2 class="sec">我们如何核对</h2><ol>
<li><b>只收录有原话的预测</b>每条必须附原始出处（采访、演讲、发帖或报道），并记录发布时间。</li>
<li><b>只收录有明确时间的预测</b>截止时间取自原话中的时间表述，例如“明年底”记为该年 12 月 31 日。</li>
<li><b>到期后对照公开资料</b>记录截至截止时间的实际情况，并附证据链接。</li>
<li><b>查不到就标「待定」</b>未到期或资料不足时一律标「待定」，不推测、不评分。</li>
<li><b>公开更正</b>发现错误欢迎提交更正，所有数据以 JSON 文件公开。</li></ol></section>`}
async function personPage(id,q){const p=await person(id);const cats=[...new Set(p.predictions.map(x=>x.category))];
const st=q.get('s')||'',ct=q.get('c')||'',view=q.get('v')||'list';const items=p.predictions.filter(x=>(!st||x.status===st)&&(!ct||x.category===ct));
const url=o=>{const u=new URLSearchParams({s:st,c:ct,v:view,...o});for(const[k,v]of[...u])if(!v||(k=='v'&&v=='list'))u.delete(k);return `#/p/${id}`+(u+''?'?'+u:'')};
const row=x=>`<a class="card" href="#/p/${id}/${x.id}"><div class="meta">${pill(x.status)}${cat(x.category)}<span>发布 ${x.published_date}</span><span>截止 ${x.deadline}</span></div><p class="q">${esc(x.quote.zh)}</p></a>`;
let body;if(view==='timeline'){const ys={};items.forEach(x=>(ys[x.published_date.slice(0,4)]??=[]).push(x));
body=`<div class="timeline">${Object.keys(ys).sort().map(y=>`<div class="yr"><div class="yl">${y}<span>${ys[y].length} 条</span></div><div class="yi">${ys[y].map(row).join('')}</div></div>`).join('')}</div>`}else body=items.map(row).join('');
app.innerHTML=`<p class="crumb"><a href="#/">首页</a> / 人物</p><header class="phead">${seal(p)}<div><h1>${esc(p.name)}</h1><p class="lead">${esc(p.name_en)} · ${esc(p.title)}</p></div></header>
<section class="panel"><div class="panel-h"><span>共 ${p.predictions.length} 条预测 · 状态分布</span></div>${bar(p.predictions)}</section>
<div class="filters"><select id="fs" aria-label="状态"><option value="">全部状态</option>${STATUSES.map(s=>`<option ${s===st?'selected':''}>${s}</option>`)}</select>
<select id="fc" aria-label="分类"><option value="">全部分类</option>${cats.map(c=>`<option ${c===ct?'selected':''}>${esc(c)}</option>`)}</select>
<span class="lead">显示 ${items.length} 条</span><span class="views"><a class="${view==='list'?'on':''}" href="${url({v:'list'})}">列表</a><a class="${view==='timeline'?'on':''}" href="${url({v:'timeline'})}">时间轴</a></span></div>${body}`;
fs.onchange=()=>location.hash=url({s:fs.value});fc.onchange=()=>location.hash=url({c:fc.value})}
async function detail(id,pid){const p=await person(id);const x=p.predictions.find(y=>y.id===pid);if(!x){app.innerHTML='未找到该条目';return}
const tot=days(x.published_date,x.deadline),el=days(x.published_date,TODAY),pct=Math.max(0,Math.min(100,el/tot*100)),over=el>tot;
const rel=p.predictions.filter(y=>y.category===x.category&&y.id!==x.id).slice(0,4);
app.innerHTML=`<p class="crumb"><a href="#/">首页</a> / <a href="#/p/${id}">${esc(p.name)}</a> / ${esc(x.id)}</p><div class="meta">${pill(x.status)}${cat(x.category)}</div>
<blockquote class="hugequote"><p class="zh">“${esc(x.quote.zh)}”</p><p class="en" lang="en">“${esc(x.quote.en)}”</p><cite>— ${esc(p.name)}，${x.published_date}，来源：${link(x.source_url)}</cite></blockquote>
<section class="panel"><div class="panel-h"><span>时间进度</span><span>${over?`截止日已过 ${el-tot} 天`:`距截止还有 ${tot-el} 天`}</span></div>
<div class="prog"><div class="fill" style="width:${over?100:pct}%"></div>${over?'':`<div class="today" style="left:${pct}%"><span>今天 ${TODAY}</span></div>`}</div>
<div class="prog-l"><span>发布<br><b>${x.published_date}</b></span>${over?`<span class="mid">今天 ${TODAY}</span>`:''}<span style="text-align:right">截止<br><b>${x.deadline}</b></span></div></section>
<dl><dt>实际结果</dt><dd>${esc(x.actual_result)}</dd><dt>原始出处</dt><dd>${link(x.source_url)}</dd><dt>证据链接</dt><dd class="links">${(x.evidence_urls||[]).map(link).join('')||'—'}</dd></dl>
${rel.length?`<section><h2 class="sec">同分类相关预测 · ${esc(x.category)}</h2>${rel.map(y=>`<a class="card" href="#/p/${id}/${y.id}"><div class="meta">${pill(y.status)}<span>截止 ${y.deadline}</span></div><p class="q">${esc(y.quote.zh)}</p></a>`).join('')}</section>`:''}
<p class="lead" style="font-size:14px;margin-top:28px">发现错误？欢迎提交更正。</p>`}
async function route(){const [path,qs]=(location.hash.slice(1)||'/').split('?');const seg=path.split('/').filter(Boolean);const q=new URLSearchParams(qs);
try{if(seg[0]==='p'&&seg[2])await detail(seg[1],seg[2]);else if(seg[0]==='p')await personPage(seg[1],q);else await home()}catch(e){app.textContent='加载失败：'+e}window.scrollTo(0,0)}
addEventListener('hashchange',route);route();

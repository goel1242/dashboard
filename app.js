
var currentShiftType='regular';
var SHIFT_TYPES={
  short:  {label:'קצרה',  hours:5.0,   times:'07:15-12:45', brk:30},
  regular:{label:'רגילה', hours:8.33,  times:'07:15-16:45', brk:70},
  long:   {label:'ארוכה', hours:10.08, times:'07:15-18:45', brk:85}
};
var LINES=[
  {id:'pick', name:'ליקוט',       type:'נפחי',    tc:'tv'},
  {id:'kit',  name:'ערכות',       type:'נפחי',    tc:'tv'},
  {id:'drive',name:'יחידות הנעה',type:'סיריאלי', tc:'ts'},
  {id:'spk',  name:'ספקי כוח',   type:'סיריאלי', tc:'ts'},
  {id:'cable',name:'כבלים',       type:'נפחי',    tc:'tv'}
];
var CTYPES=[
  {id:'dolbox', name:'דולבוקס', cm:50},
  {id:'upgrade',name:'אפגרייד', cm:25},
  {id:'box2x2', name:'2x2',     cm:31}
];
var STATUSNAMES=['תקין','מעל יעד','בסיכון','בעיכוב','ממתין'];
var PIN='1242';
var DAYS=['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
var SB_URL='https://euflsoldqwbvsgjsmmac.supabase.co';
var SB_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV1Zmxzb2xkcXdidnNnanNtbWFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMDEzMzgsImV4cCI6MjA5MDc3NzMzOH0.BaBDmAEu9IROjJxGpuVQJCwvmyRx8wFD6AVCMQuBk8U';
var DEFAULT_WORKERS={pick:3,kit:7,drive:5,spk:3,cable:3};

var targets={},reports={},redRows={},redClosed={},stoppages=[],alertsLog=[],history={};
var pallets=[],palletRequests=[],materialRequests=[];
var isManager=false,pinCb=null,histTab='week',summaryText='';
var lastReminderHour=-1;
var delayReasons=['מחסן','ליקוט','סט-אפ','הנדסה','פיתוח','ייצור','איכות','IT','תכנון','שיווק'];

// STORAGE
var store=(function(){
  try{localStorage.setItem('_t','1');localStorage.removeItem('_t');return localStorage;}
  catch(e){var m={};return{getItem:function(k){return m[k]||null;},setItem:function(k,v){m[k]=v;},removeItem:function(k){delete m[k];}};}
})();

function isNewDay(){
  var today=new Date().toDateString();
  var saved=store.getItem('ops_date');
  return saved && saved!==today;
}
function loadState(){
  var today=new Date().toDateString();
  var saved=store.getItem('ops_date');
  if(saved && saved!==today){saveToHist(saved);clearDay();clearServerDay();return;}
  try{
    targets      =JSON.parse(store.getItem('ops_targets') ||'{}');
    reports      =JSON.parse(store.getItem('ops_reports') ||'{}');
    redRows      =JSON.parse(store.getItem('ops_rr')      ||'{}');
    redClosed    =JSON.parse(store.getItem('ops_rc')      ||'{}');
    stoppages    =JSON.parse(store.getItem('ops_stops')   ||'[]');
    history      =JSON.parse(store.getItem('ops_history') ||'{}');
    pallets      =JSON.parse(store.getItem('ops_pallets') ||'[]');
    palletRequests=JSON.parse(store.getItem('ops_requests')||'[]');
    materialRequests=JSON.parse(store.getItem('ops_materials')||'[]');
    var ww=store.getItem('ops_workers');
    if(ww) DEFAULT_WORKERS=JSON.parse(ww);
  }catch(e){}
}
function saveState(){
  store.setItem('ops_date',   new Date().toDateString());
  store.setItem('ops_targets',JSON.stringify(targets));
  store.setItem('ops_reports',JSON.stringify(reports));
  store.setItem('ops_rr',     JSON.stringify(redRows));
  store.setItem('ops_rc',     JSON.stringify(redClosed));
  store.setItem('ops_stops',  JSON.stringify(stoppages));
  store.setItem('ops_history',JSON.stringify(history));
  store.setItem('ops_pallets',JSON.stringify(pallets));
  store.setItem('ops_requests',JSON.stringify(palletRequests));
  store.setItem('ops_materials',JSON.stringify(materialRequests));
  store.setItem('ops_workers',JSON.stringify(DEFAULT_WORKERS));
}
function clearDay(){
  // Archive open pallets to history before day reset
  if(pallets.length){
    try{
      var ph=JSON.parse(store.getItem('ops_pallet_history')||'[]');
      pallets.forEach(function(p){
        if(!p.closed){p.archivedAt=new Date().toLocaleDateString('he-IL');p.closedDate=p.closedDate||new Date().toLocaleDateString('he-IL');}
        var exists=ph.some(function(h){return h.id===p.id;});
        if(!exists) ph.unshift(JSON.parse(JSON.stringify(p)));
      });
      if(ph.length>500) ph=ph.slice(0,500);
      store.setItem('ops_pallet_history',JSON.stringify(ph));
    }catch(e){}
  }
  targets={};reports={};redRows={};redClosed={};stoppages=[];palletRequests=[];orderRows={};
  store.removeItem('ops_order_rows');
  // pallets NOT cleared - persist across days
  saveState();syncToServer();
}
function saveToHist(dateStr){
  try{
    var h=JSON.parse(store.getItem('ops_history')||'{}');
    var key=new Date(dateStr).toISOString().slice(0,10);
    h[key]={
      targets:JSON.parse(store.getItem('ops_targets')||'{}'),
      reports:JSON.parse(store.getItem('ops_reports')||'{}'),
      stoppages:JSON.parse(store.getItem('ops_stops')||'[]')
    };
    var keys=Object.keys(h).sort().reverse();
    if(keys.length>35) keys.slice(35).forEach(function(k){delete h[k];});
    store.setItem('ops_history',JSON.stringify(h));
  }catch(e){}
}

// SUPABASE
function sbFetch(path,opts){
  opts=opts||{};
  return fetch(SB_URL+'/rest/v1/'+path,{
    method:opts.method||'GET',
    headers:{'apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY,'Content-Type':'application/json','Prefer':opts.prefer||''},
    body:opts.body||undefined
  }).then(function(r){return r.status===204?null:r.json();});
}
function syncToServer(){
  var payload={
    targets:JSON.stringify(targets),reports:JSON.stringify(reports),
    redRows:JSON.stringify(redRows),redClosed:JSON.stringify(redClosed),
    stoppages:JSON.stringify(stoppages),pallets:JSON.stringify(pallets),
    requests:JSON.stringify(palletRequests),workers:JSON.stringify(DEFAULT_WORKERS),
    materials:JSON.stringify(materialRequests)
  };
  var rows=Object.entries(payload).map(function(e){return{key:e[0],value:e[1],updated_at:new Date().toISOString()};});
  sbFetch('ops_data',{method:'POST',prefer:'resolution=merge-duplicates',body:JSON.stringify(rows)})
    .then(function(){document.getElementById('sync-status').textContent='מסונכרן '+nowTime();document.getElementById('sync-dot').style.background='var(--green)';})
    .catch(function(){document.getElementById('sync-status').textContent='שגיאת סנכרון';document.getElementById('sync-dot').style.background='var(--red)';});
}
function syncFromServer(){
  if(isNewDay()){var saved=store.getItem('ops_date');saveToHist(saved);clearDay();clearServerDay();renderDash();return;}
  var mgrActive=document.getElementById('page-mgr').classList.contains('active');
  var mgrBodyOpen=document.getElementById('fb-morning')&&document.getElementById('fb-morning').classList.contains('open');
  if(mgrActive&&mgrBodyOpen){document.getElementById('sync-dot').style.background='var(--yellow)';document.getElementById('sync-status').textContent='הזנה פעילה...';return;}
  // Pause sync if user is actively typing in any input
  var ae=document.activeElement;
  var isTyping=ae&&(ae.tagName==='INPUT'||ae.tagName==='TEXTAREA'||ae.tagName==='SELECT');
  if(isTyping){document.getElementById('sync-dot').style.background='var(--yellow)';document.getElementById('sync-status').textContent='הזנה פעילה...';return;}
  sbFetch('ops_data?select=key,value').then(function(rows){
    if(!rows||!rows.length) return;
    var map={};rows.forEach(function(r){map[r.key]=r.value;});
    if(map.targets)   targets        =JSON.parse(map.targets);
    if(map.reports)   reports        =JSON.parse(map.reports);
    if(map.redRows)   redRows        =JSON.parse(map.redRows);
    if(map.redClosed) redClosed      =JSON.parse(map.redClosed);
    if(map.stoppages) stoppages      =JSON.parse(map.stoppages);
    if(map.pallets)   pallets        =JSON.parse(map.pallets);
    if(map.requests)  palletRequests =JSON.parse(map.requests);
    if(map.materials) materialRequests=JSON.parse(map.materials);
    if(map.workers)   DEFAULT_WORKERS=JSON.parse(map.workers);
    saveState();renderDash();updateStopBdg();updateAlertBdg();
    if(document.getElementById('page-pack').classList.contains('active')){buildRequestForms();renderPallets();renderPackRequests();}
    checkMaterialAlerts();updateMatBdg();
    document.getElementById('sync-status').textContent='מסונכרן '+nowTime();
    document.getElementById('sync-dot').style.background='var(--green)';
  }).catch(function(){
    document.getElementById('sync-status').textContent='לא מחובר';
    document.getElementById('sync-dot').style.background='var(--red)';
  });
}
function clearServerDay(){
  var rows=[
    {key:'targets',value:'{}',updated_at:new Date().toISOString()},
    {key:'reports',value:'{}',updated_at:new Date().toISOString()},
    {key:'redRows',value:'{}',updated_at:new Date().toISOString()},
    {key:'redClosed',value:'{}',updated_at:new Date().toISOString()},
    {key:'stoppages',value:'[]',updated_at:new Date().toISOString()},
    {key:'pallets',value:'[]',updated_at:new Date().toISOString()},
    {key:'requests',value:'[]',updated_at:new Date().toISOString()}
  ];
  sbFetch('ops_data',{method:'POST',prefer:'resolution=merge-duplicates',body:JSON.stringify(rows)}).catch(function(){});
}
setInterval(syncFromServer,15000);

// SHIFT
function shiftHours(){return SHIFT_TYPES[currentShiftType]?SHIFT_TYPES[currentShiftType].hours:(function(){var d=new Date().getDay();if(d===5)return 5;if(d===0||d===2||d===4)return 8.33;return 10.08;})();}
function shiftStart(){return 7.25;}
function elapsed(){var n=new Date();var e=(n.getHours()+n.getMinutes()/60)-shiftStart();return Math.max(0,Math.min(e,shiftHours()));}

// CALC
function calcLine(id){
  var target=targets[id]||0,sh=shiftHours(),el=elapsed();
  var cum=Math.round((target/sh)*el);
  var reps=reports[id]||[];
  var last=reps[reps.length-1]||null,prev=reps[reps.length-2]||null;
  var done=last?last.done:null;
  var achPct=null,gap=null,statusIdx=4,trend='flat';
  if(done!==null&&cum>0){achPct=Math.round(done/cum*100);gap=done-cum;statusIdx=achPct>105?1:achPct>=95?0:achPct>=85?2:3;}
  else if(done!==null){statusIdx=0;achPct=100;gap=0;}
  if(prev&&last) trend=last.done>prev.done?'up':last.done<prev.done?'dn':'fl';
  var lineName=(LINES.filter(function(l){return l.id===id;})[0]||{}).name||'';
  var lineStops=stoppages.filter(function(s){return !s.open&&s.lineName===lineName;});
  var stopMins=lineStops.reduce(function(s,x){return s+(x.durationMin||0);},0);
  var rrU=(redRows[id]||{}).units||0;
  var combined=target+rrU;
  var combCum=combined>0?Math.round((combined/sh)*el):cum;
  return{id:id,target:target,combined:combined,cum:cum,combCum:combCum,done:done,achPct:achPct,gap:gap,statusIdx:statusIdx,trend:trend,last:last,stopMins:stopMins,rrU:rrU};
}

// SCORE
function calcScore(){
  var calcs=LINES.map(function(l){return calcLine(l.id);});
  var wd=calcs.filter(function(c){return c.done!==null&&c.target>0;});
  if(!wd.length) return null;
  var avgAch=wd.reduce(function(s,c){return s+Math.min(c.achPct||0,120);},0)/wd.length;
  var achScore=Math.min(avgAch/100*60,60);
  var shMin=shiftHours()*60;
  var totStop=stoppages.filter(function(s){return !s.open;}).reduce(function(s,x){return s+(x.durationMin||0);},0);
  var stopScore=(1-Math.min(totStop/shMin,1))*25;
  var totRR=LINES.reduce(function(s,l){return s+((redRows[l.id]||{}).rows||0);},0);
  var closedRR=LINES.reduce(function(s,l){return s+((redClosed[l.id]||{}).rows||0);},0);
  var rrScore=totRR>0?(closedRR/totRR)*15:15;
  return Math.round(achScore+stopScore+rrScore);
}
function scoreInfo(s){
  if(s===null) return{cls:'',col:'var(--faint)',lbl:'אין נתונים'};
  if(s>=90) return{cls:'sg',col:'var(--green)',lbl:'מצוין'};
  if(s>=75) return{cls:'sa',col:'var(--blue)',lbl:'טוב'};
  if(s>=60) return{cls:'sb',col:'var(--yellow)',lbl:'בסיכון'};
  return{cls:'sc',col:'var(--red)',lbl:'דרוש שיפור'};
}

// CLOCK
function updateClock(){
  var n=new Date();
  document.getElementById('clock').textContent=pad(n.getHours())+':'+pad(n.getMinutes());
  document.getElementById('day-lbl').textContent='יום '+DAYS[n.getDay()]+' '+n.toLocaleDateString('he-IL');
  var sh=shiftHours(),d=n.getDay();
  var times=d===5?'07:15-12:45':(d===0||d===2||d===4)?'07:15-16:45':'07:15-18:45';
  var brk=d===5?30:(d===0||d===2||d===4)?70:85;
  document.getElementById('shift-pill').textContent=times+' - '+sh.toFixed(1)+'sh ('+brk+'m)';
  var h=n.getHours(),m=n.getMinutes();
  if(m===55&&h!==lastReminderHour){
    lastReminderHour=h;
    var next=pad(h+1)+':00';
    // Alert per line that hasn't been updated this hour
    var reps=reports;
    LINES.forEach(function(l){
      if(targets[l.id]>0){
        var lineReps=reports[l.id]||[];
        var lastRep=lineReps[lineReps.length-1];
        var updatedThisHour=lastRep&&lastRep.time&&lastRep.time.split(':')[0]===pad(h);
        if(!updatedThisHour){
          pushAlert('y',l.name+': עדכון שעתי בעוד 5 דקות ('+next+')');
        }
      }
    });
    showT('עדכון שעתי בעוד 5 דקות!','y');
  }
  // Check every minute for pending updates (after XX:55)
  checkPendingUpdates(h,m);
}
setInterval(updateClock,60000);updateClock();
setInterval(function(){if(document.getElementById('page-stops').classList.contains('active')) renderStops();updateStopBdg();},30000);
function pad(n){return String(n).padStart(2,'0');}
function nowTime(){var n=new Date();return pad(n.getHours())+':'+pad(n.getMinutes());}

// NAV
function goPage(name){
  document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active');});
  document.querySelectorAll('.nb').forEach(function(b){b.classList.remove('active');});
  var pg=document.getElementById('page-'+name);
  if(!pg) return;
  pg.classList.add('active');
  var nb=document.getElementById('nb-'+name);
  if(nb) nb.classList.add('active');
  if(name==='dash') renderDash();
  if(name==='stops') renderStops();
  if(name==='pack'){buildRequestForms();renderPallets();renderPackRequests();}
  if(name==='alerts') renderAlerts();
  if(name==='mat'){renderMaterials();startMatTimer();}
}

// FOLDER
function toggleF(name){
  var body=document.getElementById('fb-'+name);
  var arr=document.getElementById('fa-'+name);
  if(!body) return;
  var isOpen=body.classList.contains('open');
  body.classList.toggle('open',!isOpen);
  arr.innerHTML=isOpen?'&#9654;':'&#9660;';
  if(!isOpen){
    if(name==='analysis') renderAnalysis();
    if(name==='productivity') renderProductivity();
    if(name==='history') renderHistory();
    if(name==='weekly') genWeeklyReport();
    if(name==='eta') renderLineETAs();
    if(name==='delay-reasons') renderDelayReasonsMgr();
    if(name==='catalog'){if(!skuCatalog.length) loadSkuCatalog(); renderCatalogStats(); renderCatalogManager();}
    if(name==='ordertracking') renderOrderTrackingSummary();
    if(name==='redrowsmgr') renderRedRowsManager();
    if(name==='mathist') renderMatHistory();
    if(name==='pallethist') renderPalletHistory();
    if(name==='summary') genShiftSummary();
    if(name==='morning') buildMorningForms();
    if(name==='hourly') buildHourlyForms();
  }
}

// BUILD FORMS
function buildMorningForms(){
  var sh=shiftHours();
  document.getElementById('morning-forms').innerHTML=LINES.map(function(l){
    var t=targets[l.id]||'',hr=t?Math.round(t/sh):'';
    var rr=redRows[l.id]||{};
    return '<div class="ic">'+
      '<div class="ic-title"><span class="lc-type '+l.tc+'">'+l.type+'</span>'+l.name+'</div>'+
      '<div class="igrid">'+
        '<div class="fld"><label>יעד יומי</label><input type="number" id="m-'+l.id+'" placeholder="0" inputmode="numeric" value="'+t+'" oninput="document.getElementById(\'mhr-'+l.id+'\').value=this.value?Math.round(this.value/'+sh.toFixed(4)+'):\'\'"></div>'+
        '<div class="fld"><label>יעד שעתי</label><input type="number" id="mhr-'+l.id+'" placeholder="-" readonly style="opacity:.45;cursor:default" value="'+hr+'"></div>'+
      '</div>'+
      '<div class="divider"></div>'+
      '<div class="sub-lbl" style="color:var(--red)">שורות אדומות פתוחות</div>'+
      '<div class="igrid">'+
        '<div class="fld"><label>מספר שורות</label><input type="number" id="mr-'+l.id+'" placeholder="0" inputmode="numeric" value="'+(rr.rows||'')+'"></div>'+
        '<div class="fld"><label>יחידות</label><input type="number" id="mu-'+l.id+'" placeholder="0" inputmode="numeric" value="'+(rr.units||'')+'"></div>'+
      '</div>'+
    '</div>';
  }).join('');
}
function buildHourlyForms(){
  var hf=document.getElementById('hourly-forms');
  if(!hf) return;
  hf.innerHTML=LINES.map(function(l){
    var c=calcLine(l.id);
    var rr=redRows[l.id],rc=redClosed[l.id];
    var openRR=rr?rr.rows-(rc?rc.rows:0):0;
    var rrHtml='';
    if(openRR>0){
      rrHtml='<div class="divider"></div>'+
        '<div class="sub-lbl" style="color:var(--red)">שורות אדומות - עדכון</div>'+
        '<div class="igrid">'+
          '<div class="fld"><label>שורות שנסגרו</label><input type="number" id="hrc-'+l.id+'" placeholder="0" inputmode="numeric" value="'+(rc?rc.rows:'')+'"></div>'+
          '<div class="fld"><label>יחידות שנסגרו</label><input type="number" id="huc-'+l.id+'" placeholder="0" inputmode="numeric" value="'+(rc?rc.units:'')+'"></div>'+
        '</div>';
    }
    var tpl=c.target?'<span style="font-size:10px;color:var(--faint);font-family:var(--mono);margin-right:auto">תכנון: '+c.combCum+'</span>':'';
    return '<div class="ic">'+
      '<div class="ic-title"><span class="lc-type '+l.tc+'">'+l.type+'</span>'+l.name+tpl+'</div>'+
      '<div class="igrid">'+
        '<div class="fld"><label>הושלם עד עכשיו</label><input type="number" id="h-'+l.id+'" placeholder="'+(c.done!==null?c.done:'0')+'" inputmode="numeric" value="'+(c.done!==null?c.done:'')+'"></div>'+
        '<div class="fld"><label>סיבת עיכוב</label>'+
          '<select id="hr-'+l.id+'">'+
            '<option value="">-</option>'+
            '<option>מחסן</option><option>ליקוט</option><option>סט-אפ</option>'+
            '<option>הנדסה</option><option>פיתוח</option><option>ייצור</option>'+
            '<option>איכות</option><option>IT</option><option>תכנון</option><option>שיווק</option>'+
          '</select>'+
        '</div>'+
      '</div>'+
      rrHtml+
    '</div>';
  }).join('');
}

// SAVE MORNING
function saveMorning(){
  var any=false;
  LINES.forEach(function(l){
    var v=parseInt(document.getElementById('m-'+l.id).value)||0;
    if(v>0){targets[l.id]=v;any=true;}
    var r=parseInt(document.getElementById('mr-'+l.id).value)||0;
    var u=parseInt(document.getElementById('mu-'+l.id).value)||0;
    if(r>0||u>0) redRows[l.id]={rows:r,units:u};
  });
  if(!any){showT('הזן לפחות יעד אחד','y');return;}
  saveState();syncToServer();buildMorningForms();renderDash();
  pushAlert('g','יעדי בוקר נשמרו');showT('יעדים נשמרו!');
}

// SAVE HOURLY
function saveHourly(){
  var any=false,hasErr=false;
  LINES.forEach(function(l){
    var el=document.getElementById('h-'+l.id);if(!el) return;
    var v=el.value;
    if(v==='') return;
    var done=parseInt(v)||0,reason=document.getElementById('hr-'+l.id).value;
    var el=document.getElementById('h-'+l.id);
    // No upper limit - allow exceeding target
    el.style.borderColor='';
    var rcEl=document.getElementById('hrc-'+l.id),ruEl=document.getElementById('huc-'+l.id);
    if(rcEl){
      var rc=parseInt(rcEl.value)||0,ru=parseInt(ruEl.value)||0;
      var maxR=(redRows[l.id]||{}).rows||0,maxU=(redRows[l.id]||{}).units||0;
      if(rc>maxR){rcEl.style.borderColor='var(--red)';showT(l.name+': שורות סגורות מעל פתוחות','y');hasErr=true;return;}
      if(ru>maxU){ruEl.style.borderColor='var(--red)';showT(l.name+': יחידות סגורות מעל פתוחות','y');hasErr=true;return;}
      rcEl.style.borderColor='';if(ruEl)ruEl.style.borderColor='';
      redClosed[l.id]={rows:rc,units:ru};
    }
    if(!reports[l.id]) reports[l.id]=[];
    reports[l.id].push({done:done,reason:reason,time:nowTime()});
    any=true;
  });
  if(!any){showT('הזן לפחות עדכון אחד','y');return;}
  if(hasErr) return;
  saveState();syncToServer();runAlerts();buildHourlyForms();renderDash();
  showT('עדכון נשמר!');setTimeout(function(){goPage('dash');},600);
}

// RENDER DASH
function renderDash(){
  recalcRedRows();
  var hasTargets=LINES.some(function(l){return (targets[l.id]||0)>0;});
  if(isFriday()&&!hasTargets){renderFridayMode();return;}
  var calcs=LINES.map(function(l){return calcLine(l.id);});
  var totCom=calcs.reduce(function(s,c){return s+(c.combCum||0);},0);
  var totDone=calcs.filter(function(c){return c.done!==null;}).reduce(function(s,c){return s+(c.done||0);},0);
  var totGap=totDone-totCom;
  var totAch=totCom>0?Math.round(totDone/totCom*100):null;
  document.getElementById('k-target').textContent=totCom||'-';
  document.getElementById('k-done').textContent=totDone||'-';
  document.getElementById('k-gap').textContent=totGap>=0?('+'+totGap):totGap||'-';
  document.getElementById('k-ach').textContent=totAch?(totAch+'%'):'-';
  var ac=document.getElementById('k-ach-c');
  ac.className='kpi '+(totAch===null?'':(totAch>=95?'g':totAch>=85?'y':'r'));
  var sc=calcScore(),si=scoreInfo(sc);
  var sb=document.getElementById('score-bar');
  if(sc!==null){sb.style.display='flex';document.getElementById('score-num').textContent=sc;document.getElementById('score-num').style.color=si.col;document.getElementById('score-lbl').textContent=si.lbl;}
  else sb.style.display='none';
  var totalDoneAll=0,totalQtyAll=0;
  LINES.forEach(function(l){var rows=orderRows[l.id]||[];totalDoneAll+=rows.reduce(function(s,r){return s+(r.done||0);},0);totalQtyAll+=rows.reduce(function(s,r){return s+(r.qty||0);},0);});
  var overallPct=totalQtyAll>0?Math.round(totalDoneAll/totalQtyAll*100):0;
  var overallEl=document.getElementById('overall-progress');
  if(overallEl&&totalQtyAll>0){
    var oCol=overallPct>=100?'var(--green)':overallPct>=60?'var(--blue)':'var(--yellow)';
    overallEl.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span style="font-size:13px;font-weight:700">התקדמות כללית</span><span style="font-size:16px;font-weight:900;font-family:var(--mono);color:'+oCol+'">'+totalDoneAll+'/'+totalQtyAll+' יח ('+overallPct+'%)</span></div><div style="height:8px;background:var(--border);border-radius:4px;overflow:hidden"><div style="height:100%;background:'+oCol+';width:'+Math.min(overallPct,100)+'%;transition:width .3s"></div></div>';
    overallEl.style.display='block';
  }
  var list=document.getElementById('lines-list');
  if(!calcs.some(function(c){return c.target>0;})){list.innerHTML='<div class="empty">הזן יעדי בוקר בטאב מנהל</div>';return;}

  var openLineId=window._dashOpenLine||null;

  var cardsHtml='<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:8px">';
  cardsHtml+=calcs.map(function(c){
    var l=LINES.filter(function(x){return x.id===c.id;})[0];
    var rows=orderRows[c.id]||[];
    var dotCol=c.statusIdx===0||c.statusIdx===1?'#1D9E75':c.statusIdx===2?'#BA7517':c.statusIdx===3?'#E24B4A':'var(--faint)';
    var numCol=c.statusIdx===0||c.statusIdx===1?'#1D9E75':c.statusIdx===2?'#BA7517':c.statusIdx===3?'#E24B4A':'var(--dim)';
    var redOpen=rows.filter(function(r){return r.isRed&&r.status!=='done';}).length;
    var workOpen=rows.filter(function(r){return !r.isRed&&r.status==='open';}).length;
    var doneCount=rows.filter(function(r){return r.status==='done';}).length;
    var isOpen=(openLineId===c.id);
    var cardBg=isOpen?'#EFF6FF':'var(--card)';
    var cardBorder=isOpen?'2px solid #2563EB':'1px solid var(--border)';
    var arrIcon=isOpen?'▼':'▶';
    var arrCol=isOpen?'#2563EB':'var(--faint)';
    var strips='';
    if(redOpen>0) strips+='<div style="background:#FFF0F0;border:1px solid rgba(220,38,38,.2);border-radius:5px;padding:2px 4px;margin-bottom:2px"><span style="font-size:9px;color:#DC2626;font-weight:700">'+redOpen+' אדומות</span></div>';
    if(workOpen>0) strips+='<div style="background:#FFFBEB;border:1px solid rgba(217,119,6,.2);border-radius:5px;padding:2px 4px;margin-bottom:2px"><span style="font-size:9px;color:#D97706;font-weight:700">'+workOpen+' בעבודה</span></div>';
    if(doneCount>0) strips+='<div style="background:#F0FDF4;border:1px solid rgba(5,150,105,.2);border-radius:5px;padding:2px 4px;margin-bottom:2px"><span style="font-size:9px;color:#059669;font-weight:700">'+doneCount+' בוצעו</span></div>';
    return '<div data-lineid="'+c.id+'" style="background:'+cardBg+';border:'+cardBorder+';border-radius:12px;padding:10px 8px;cursor:pointer;text-align:center" onclick="dashToggleLine(this.getAttribute(&quot;data-lineid&quot;))">'+
      '<div style="display:flex;align-items:center;justify-content:center;gap:5px;margin-bottom:7px">'+
        '<span style="width:7px;height:7px;border-radius:50%;background:'+dotCol+';flex-shrink:0;display:inline-block"></span>'+
        '<span style="font-size:12px;font-weight:700">'+l.name+'</span>'+
        '<span style="font-size:10px;color:'+arrCol+'">'+arrIcon+'</span>'+
      '</div>'+
      '<div style="font-size:22px;font-weight:800;color:'+numCol+';line-height:1;font-family:var(--mono)">'+(c.done!==null?c.done:'-')+'</div>'+
      '<div style="font-size:10px;color:var(--dim);margin:2px 0 6px">מתוך '+(c.combined||'-')+'</div>'+
      '<div style="height:3px;background:var(--border);border-radius:2px;margin-bottom:5px;overflow:hidden">'+
        '<div style="height:100%;background:'+dotCol+';width:'+Math.min(c.combined>0&&c.done!==null?Math.round((c.done/c.combined)*100):0,100)+'%"></div>'+
      '</div>'+
      strips+
    '</div>';
  }).join('')+'</div>';

  // Inline rows section for open line
  var inlineRows='';
  if(openLineId){
    var openCalc=calcs.filter(function(c){return c.id===openLineId;})[0];
    var openLine=LINES.filter(function(l){return l.id===openLineId;})[0];
    if(openCalc&&openLine){
      var openRows2=orderRows[openLineId]||[];
      var totalD=openRows2.reduce(function(s,r){return s+(r.done||0);},0);
      var totalQ=openRows2.reduce(function(s,r){return s+(r.qty||0);},0);
      inlineRows='<div style="background:#fff;border:2px solid #2563EB;border-radius:12px;padding:12px 14px;margin-bottom:8px">';
      inlineRows+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
      inlineRows+='<span style="font-size:13px;font-weight:700">שורות '+openLine.name+'</span>';
      inlineRows+='<span style="font-size:12px;font-weight:700;color:var(--blue);font-family:var(--mono)">'+totalD+'/'+totalQ+'</span>';
      inlineRows+='</div>';
      inlineRows+='<input type="search" id="dash-row-search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="חפש הזמנה / מק-ט / מק-ט בן / פק-ע..." oninput="renderDash()" value="'+(window._dashSearch||'')+'" style="width:100%;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:7px 12px;color:var(--text);font-size:13px;margin-bottom:8px">';
      var searchTerm=(window._dashSearch||'').toLowerCase();
      var sorted2=openRows2.slice().sort(function(a,b){
        var ap=a.isRed&&a.status!=='done'?0:a.status==='open'?1:a.status==='partial'?2:3;
        var bp=b.isRed&&b.status!=='done'?0:b.status==='open'?1:b.status==='partial'?2:3;
        return ap-bp;
      });
      var filtered2=searchTerm?sorted2.filter(function(r){
        return (r.sku||'').toLowerCase().includes(searchTerm)||
               (r.order||'').toLowerCase().includes(searchTerm)||
               (r.customer||'').toLowerCase().includes(searchTerm)||
               (r.skuB||'').toLowerCase().includes(searchTerm)||
               (r.expiry||'').toLowerCase().includes(searchTerm);
      }):sorted2;
      var showExpiry2=['pick','kit','drive','spk'].indexOf(openLineId)>=0;
      var showSkuB2=['pick','cable','drive','spk'].indexOf(openLineId)>=0;
      filtered2.forEach(function(r){
        var realIdx=openRows2.indexOf(r);
        var isDone=r.status==='done',isPartial=r.status==='partial',isRed=r.isRed&&!isDone;
        var bg=isDone?'#F0FDF4':isPartial?'#FFF8F0':isRed?'#FFF0F0':'#fff';
        var border=isRed?'1.5px solid rgba(239,68,68,.4)':isPartial?'1.5px solid rgba(234,88,12,.4)':isDone?'1.5px solid rgba(34,197,94,.35)':'1px solid #E2E8F0';
        var orderCol=isRed?'#DC2626':isPartial?'#EA580C':isDone?'#16A34A':'#334155';
        var skuBorder=isRed?'rgba(239,68,68,.25)':isPartial?'rgba(234,88,12,.2)':isDone?'rgba(34,197,94,.25)':'#E2E8F0';
        var skuLabel=isRed?'#DC2626':isPartial?'#EA580C':isDone?'#16A34A':'#64748B';
        var skuBg=isDone||isRed||isPartial?'#fff':'#F8FAFC';
        inlineRows+='<div style="background:'+bg+';border:'+border+';border-radius:12px;padding:12px 14px;margin-bottom:8px">';
        inlineRows+='<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">';
        inlineRows+='<div style="flex:1;min-width:0">';
        if(r.customer) inlineRows+='<div style="font-size:15px;font-weight:800;color:#0F172A;margin-bottom:3px">'+r.customer+'</div>';
        if(r.order) inlineRows+='<div style="font-size:13px;font-weight:600;color:'+orderCol+'">'+r.order+'<span style="font-size:11px;font-weight:400;color:#64748B"> / שורה '+(r.orderLine||'')+'</span></div>';
        if(r.desc) inlineRows+='<div style="font-size:13px;font-weight:600;color:#334155;margin-top:2px">'+r.desc+'</div>';
        inlineRows+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:5px">';
        if(r.sku) inlineRows+='<div style="background:'+skuBg+';border:1px solid '+skuBorder+';border-radius:6px;padding:3px 8px"><div style="font-size:8px;color:'+skuLabel+';font-weight:700">מק"ט</div><div style="font-size:12px;font-weight:700;font-family:var(--mono);color:#1E293B">'+r.sku+'</div></div>';
        if(showSkuB2&&r.skuB) inlineRows+='<div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:6px;padding:3px 8px"><div style="font-size:8px;color:#1D4ED8;font-weight:700">מק"ט בן</div><div style="font-size:12px;font-weight:700;font-family:var(--mono);color:#1E40AF">'+r.skuB+'</div></div>';
        inlineRows+='</div></div>';
        inlineRows+='<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">';
        if(showExpiry2&&r.expiry){
          var expBorder=isRed?'rgba(239,68,68,.5)':isPartial?'rgba(234,88,12,.4)':'#E2E8F0';
          var expCol=isRed?'#DC2626':isPartial?'#EA580C':'#334155';
          inlineRows+='<div style="background:#fff;border:1.5px solid '+expBorder+';border-radius:8px;padding:3px 9px;text-align:center"><div style="font-size:8px;color:'+expCol+';font-weight:700">פק"ע</div><div style="font-size:13px;font-weight:900;font-family:var(--mono);color:'+expCol+'">'+r.expiry+'</div>'+(isRed?'<div style="font-size:8px;color:#DC2626">⚠ עבר</div>':'')+'</div>';
        }
        if(isDone){
          inlineRows+='<div style="font-size:20px;font-weight:800;font-family:var(--mono);color:#16A34A">'+r.done+'</div>';
          inlineRows+='<div style="background:#fff;border:1px solid rgba(34,197,94,.3);border-radius:6px;padding:2px 8px;font-size:9px;color:#16A34A;font-weight:700">הושלם ב-'+(r.completedAt||'')+'</div>';
          inlineRows+='<button data-lid="'+openLineId+'" data-idx="'+realIdx+'" onclick="undoRowMark(this.dataset.lid,parseInt(this.dataset.idx));renderDash()" style="font-size:10px;padding:2px 10px;background:#fff;border:1px solid rgba(34,197,94,.3);border-radius:5px;color:#16A34A;cursor:pointer">בטל</button>';
        } else if(isPartial){
          inlineRows+='<div><span style="font-size:20px;font-weight:800;font-family:var(--mono);color:#EA580C">'+r.done+'</span><span style="font-size:12px;color:#64748B">/'+r.qty+'</span></div>';
          if(r.completedAt) inlineRows+='<div style="background:#fff;border:1px solid rgba(234,88,12,.3);border-radius:6px;padding:2px 8px;font-size:9px;color:#EA580C;font-weight:700">עודכן ב-'+r.completedAt+'</div>';
          inlineRows+='<button data-lid="'+openLineId+'" data-idx="'+realIdx+'" onclick="undoRowMark(this.dataset.lid,parseInt(this.dataset.idx));renderDash()" style="font-size:10px;padding:2px 10px;background:#fff;border:1px solid rgba(234,88,12,.3);border-radius:5px;color:#EA580C;cursor:pointer">בטל</button>';
        } else {
          inlineRows+='<div style="text-align:left"><div style="font-size:20px;font-weight:800;font-family:var(--mono);color:#0F172A">'+r.qty+'</div><div style="font-size:9px;color:#64748B">יח לאריזה</div></div>';
          inlineRows+='<div style="display:flex;gap:4px">';
          inlineRows+='<button data-pidx="'+realIdx+'" onclick="var p=document.getElementById(\'dr-pinput-\'+this.dataset.pidx);if(p)p.style.display=p.style.display===\'flex\'?\'none\':\'flex\'" style="width:32px;height:32px;background:#F5C4B3;color:#993C1D;border:0.5px solid #F0997B;border-radius:7px;font-size:14px;cursor:pointer">~</button>';
          inlineRows+='<button data-lid="'+openLineId+'" data-idx="'+realIdx+'" onclick="markRowDone(this.dataset.lid,parseInt(this.dataset.idx));renderDash()" style="width:32px;height:32px;background:#C0DD97;color:#3B6D11;border:0.5px solid #97C459;border-radius:7px;font-size:15px;cursor:pointer">&#10003;</button>';
          inlineRows+='</div>';
        }
        inlineRows+='</div></div>';
        // Reason for non-completion
        if(!isDone){
          if(r.rowReason){
            inlineRows+='<div style="background:#F0FDF4;border:1px solid rgba(5,150,105,.25);border-radius:8px;padding:7px 10px;margin-top:8px;display:flex;justify-content:space-between;align-items:flex-start">';
            inlineRows+='<div><div style="font-size:10px;color:#64748B;margin-bottom:2px">סיבת אי ביצוע</div><div style="font-size:12px;font-weight:700;color:#059669">'+r.rowReason+'</div>'+(r.rowNote?'<div style="font-size:11px;color:#334155;margin-top:2px">'+r.rowNote+'</div>':'')+'</div>';
            inlineRows+='<button data-lid="'+openLineId+'" data-idx="'+realIdx+'" onclick="toggleDashRowReason(this.dataset.lid,parseInt(this.dataset.idx))" style="font-size:10px;padding:2px 8px;background:#fff;border:1px solid #E2E8F0;border-radius:5px;color:#64748B;cursor:pointer">ערוך</button>';
            inlineRows+='</div>';
          } else {
            inlineRows+='<button data-lid="'+openLineId+'" data-idx="'+realIdx+'" onclick="toggleDashRowReason(this.dataset.lid,parseInt(this.dataset.idx))" style="width:100%;font-size:11px;padding:5px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;color:#64748B;cursor:pointer;font-weight:600;margin-top:8px;font-family:Heebo,sans-serif">+ סיבת אי ביצוע</button>';
          }
          inlineRows+='<div id="dr-reason-'+openLineId+'-'+realIdx+'" style="display:none;background:#FFFBEB;border:1px solid rgba(234,179,8,.35);border-radius:9px;padding:10px 12px;margin-top:6px">';
          inlineRows+='<div style="font-size:11px;font-weight:700;color:#854D0E;margin-bottom:7px">סיבת אי ביצוע</div>';
          inlineRows+='<select id="dr-sel-'+openLineId+'-'+realIdx+'" style="width:100%;background:#fff;border:1px solid rgba(234,179,8,.4);border-radius:7px;padding:7px 10px;color:#1E293B;font-size:13px;font-family:Heebo,sans-serif;margin-bottom:7px">';
          var reasons2=['בחר סיבה...','מחסן','ליקוט','סט-אפ','הנדסה','פיתוח','ייצור','איכות','IT','תכנון','שיווק','אחר'];
          reasons2.forEach(function(opt){inlineRows+='<option value="'+opt+'"'+(r.rowReason===opt?' selected':'')+'>'+opt+'</option>';});
          inlineRows+='</select>';
          inlineRows+='<textarea id="dr-note-'+openLineId+'-'+realIdx+'" placeholder="פרט / הערה נוספת..." style="width:100%;background:#fff;border:1px solid rgba(234,179,8,.4);border-radius:7px;padding:7px 10px;color:#1E293B;font-size:13px;font-family:Heebo,sans-serif;resize:none;line-height:1.5;margin-bottom:7px" rows="2">'+(r.rowNote||'')+'</textarea>';
          inlineRows+='<div style="display:flex;gap:6px">';
          inlineRows+='<button data-lid="'+openLineId+'" data-idx="'+realIdx+'" onclick="saveDashRowReason(this.dataset.lid,parseInt(this.dataset.idx))" style="flex:1;padding:7px;background:var(--green);border:none;border-radius:7px;color:#fff;font-size:13px;font-weight:700;cursor:pointer">שמור</button>';
          inlineRows+='<button data-lid="'+openLineId+'" data-idx="'+realIdx+'" onclick="toggleDashRowReason(this.dataset.lid,parseInt(this.dataset.idx))" style="padding:7px 12px;background:#fff;border:1px solid var(--border);border-radius:7px;color:var(--dim);font-size:13px;cursor:pointer">ביטול</button>';
          inlineRows+='</div></div>';
          if(!isDone&&!isPartial){
            inlineRows+='<div id="dr-pinput-'+realIdx+'" style="display:none;align-items:center;gap:8px;margin-top:8px">';
            inlineRows+='<input type="number" inputmode="numeric" placeholder="כמה?" min="1" max="'+r.qty+'" id="dr-partial-'+realIdx+'" style="flex:1;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:7px 12px;color:var(--text);font-size:18px;font-family:var(--mono);text-align:center">';
            inlineRows+='<button data-lid="'+openLineId+'" data-idx="'+realIdx+'" onclick="markDashPartial(this.dataset.lid,parseInt(this.dataset.idx))" style="padding:7px 16px;background:var(--yellow);border:none;border-radius:8px;color:#fff;font-size:14px;font-weight:700;cursor:pointer">שמור</button>';
            inlineRows+='</div>';
          }
        }
        inlineRows+='</div>';
      });
      inlineRows+='</div>';
    }
  }

  list.innerHTML=cardsHtml+inlineRows;

  // Restore search value
  var searchInp=document.getElementById('dash-row-search');
  if(searchInp){
    var savedVal=window._dashSearch||'';
    searchInp.value=savedVal;
    searchInp.addEventListener('input',function(){window._dashSearch=this.value;renderDash();});
  }
}

function dashToggleLine(lineId){
  if(window._dashOpenLine===lineId){
    window._dashOpenLine=null;
    window._dashSearch='';
  } else {
    window._dashOpenLine=lineId;
    window._dashSearch='';
    currentLine=lineId;
  }
  renderDash();
  if(window._dashOpenLine){
    setTimeout(function(){
      var el=document.getElementById('dash-row-search');
      if(el) el.focus();
    },100);
  }
}

function toggleDashRowReason(lineId,rowIdx){
  var box=document.getElementById('dr-reason-'+lineId+'-'+rowIdx);
  if(box) box.style.display=box.style.display==='none'||!box.style.display?'block':'none';
}

function saveDashRowReason(lineId,rowIdx){
  var rows=orderRows[lineId]||[];
  if(!rows[rowIdx]) return;
  var reason=(document.getElementById('dr-sel-'+lineId+'-'+rowIdx)||{}).value||'';
  var note=(document.getElementById('dr-note-'+lineId+'-'+rowIdx)||{}).value||'';
  if(reason==='בחר סיבה...'){showT('בחר סיבה','y');return;}
  rows[rowIdx].rowReason=reason;
  rows[rowIdx].rowNote=note;
  orderRows[lineId]=rows;
  saveOrderRows();
  renderDash();
  showT('נשמר!');
}

function markDashPartial(lineId,rowIdx){
  var inp=document.getElementById('dr-partial-'+rowIdx);
  if(!inp) return;
  var val=parseInt(inp.value)||0;
  if(val<=0){showT('הזן כמות','y');return;}
  var rows=orderRows[lineId]||[];
  if(!rows[rowIdx]) return;
  rows[rowIdx].done=Math.min(val,rows[rowIdx].qty);
  rows[rowIdx].status=rows[rowIdx].done>=rows[rowIdx].qty?'done':'partial';
  rows[rowIdx].completedAt=nowTime();
  orderRows[lineId]=rows;
  saveOrderRows();
  renderDash();
}

function renderAnalysis(){
  var calcs=LINES.map(function(l){return calcLine(l.id);});
  var sorted=calcs.slice().sort(function(a,b){return (a.achPct||0)-(b.achPct||0);});
  document.getElementById('bn-list').innerHTML=sorted.map(function(c,i){
    var l=LINES.filter(function(x){return x.id===c.id;})[0];
    var p=c.achPct||0;
    var pc=p>105?'pg':p>=95?'pl':p>=85?'pm':'ph';
    var fc=p>105?'fb':p>=95?'fg':p>=85?'fy':'fr';
    return '<div class="bn-row"><span style="font-size:11px;color:var(--faint);width:20px">#'+(i+1)+'</span>'+
      '<span class="bn-name">'+l.name+'</span>'+
      '<div class="bn-bar"><div class="bn-fill '+fc+'" style="width:'+Math.min(p,100)+'%"></div></div>'+
      '<span class="bn-pct '+pc+'">'+(c.achPct!==null?p+'%':'-')+'</span></div>';
  }).join('');
  var totD=calcs.reduce(function(s,c){return s+(c.done||0);},0);
  var totT=calcs.reduce(function(s,c){return s+(c.target||0);},0);
  var totG=calcs.reduce(function(s,c){return s+(c.gap||0);},0);
  var el2=Math.max(elapsed(),.1);
  var rate=Math.round(totD/el2);
  var rem=totT-totD;
  var eta=rate>0?Math.ceil(rem/rate):'?';
  var etaT='-';
  if(typeof eta==='number'){var endH=shiftStart()+shiftHours();var remH=endH-eta;etaT=pad(Math.floor(remH))+':'+pad(Math.round((remH%1)*60));}
  document.getElementById('sa-done').textContent=totD||'-';
  document.getElementById('sa-gap').textContent=totG>=0?('+'+totG):totG||'-';
  document.getElementById('sa-rate').textContent=rate||'-';
  document.getElementById('sa-eta').textContent=etaT;
}

// PRODUCTIVITY

function renderProductivity(){
  var el2=document.getElementById('mgr-productivity');
  if(!el2) return;
  var data=LINES.map(function(l){
    var calc=calcLine(l.id),workers=DEFAULT_WORKERS[l.id]||1,done=calc.done||0,el3=Math.max(elapsed(),.1);
    var perLine=Math.round(done/el3*10)/10,perWorker=workers>0?Math.round(done/el3/workers*10)/10:0;
    var expectedByNow=Math.round((calc.target/shiftHours())*el3),gap=done-expectedByNow;
    // ETA: use work plan mins/unit if available, else actual rate
    var remaining=Math.max(0,(calc.combined||0)-done);
    var etaStr='-';
    var etaOver=false;
    var etaHours=null;
    var wpLine=wpParsed&&wpParsed[l.id]&&wpParsed[l.id].mins>0&&wpParsed[l.id].qty>0?wpParsed[l.id]:null;
    if(wpLine){
      // Use planned mins/unit from work plan
      var minPerUnit=wpLine.mins/wpLine.qty;
      var totalMinsRemaining=(remaining*minPerUnit)/workers;
      etaHours=totalMinsRemaining/60;
    } else if(done>0&&el3>0&&workers>0){
      // Fallback: actual rate
      var ratePerWorker=done/el3/workers;
      etaHours=ratePerWorker>0?remaining/ratePerWorker/workers:null;
    }
    if(etaHours!==null){
      var etaAtHour=elapsed()+etaHours;
      etaOver=etaAtHour>shiftHours();
      var etaTime=shiftStart()+etaAtHour;
      etaStr=pad(Math.floor(etaTime))+':'+pad(Math.round((etaTime%1)*60));
    }
    return{id:l.id,name:l.name,workers:workers,done:done,perLine:perLine,perWorker:perWorker,gap:gap,achPct:calc.achPct,remaining:remaining,etaStr:etaStr,etaOver:etaOver,ratePerWorker:ratePerWorker};
  });

  // Total workers input
  var totalWorkers=Object.values(DEFAULT_WORKERS).reduce(function(s,v){return s+v;},0);
  var html='<div style="background:var(--blue-bg);border:1px solid rgba(37,99,235,.2);border-radius:10px;padding:12px 14px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">';
  html+='<span style="font-size:13px;font-weight:700">סך כ"א זמין</span>';
  html+='<div style="display:flex;align-items:center;gap:8px">';
  html+='<input type="number" id="total-workers" value="'+totalWorkers+'" min="1" max="50" onchange="redistributeWorkers()" style="width:55px;background:var(--surface);border:1px solid var(--border);border-radius:7px;padding:5px;color:var(--text);font-size:18px;font-family:var(--mono);font-weight:700;text-align:center">';
  html+='<span style="font-size:11px;color:var(--dim)">עובדים</span>';
  html+='</div></div>';

  // Per line
  html+=data.map(function(d){
    var col=d.achPct===null?'var(--faint)':d.achPct>=95?'var(--green)':d.achPct>=85?'var(--yellow)':'var(--red)';
    return '<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,.06)">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
        '<span style="font-size:14px;font-weight:700">'+d.name+'</span>' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<span style="font-size:11px;color:var(--dim)">עובדים:</span>' +
          '<input type="number" id="wk-'+d.id+'" value="'+d.workers+'" min="0" max="20" onchange="updateWorkers(this.id.slice(3))" style="width:50px;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:4px 6px;color:var(--text);font-size:14px;font-family:var(--mono);font-weight:700;text-align:center">' +
        '</div>' +
      '</div>' +
      '<div class="sgrid3">' +
        '<div class="sbox"><div class="sbox-v" style="color:var(--blue)">'+d.perLine+'</div><div class="sbox-l">יח/ש נתיב</div></div>' +
        '<div class="sbox"><div class="sbox-v" style="color:var(--purple)">'+d.perWorker+'</div><div class="sbox-l">יח/ש עובד</div></div>' +
        '<div class="sbox"><div class="sbox-v" style="color:'+(d.etaOver?'var(--red)':'var(--green)')+'">'+d.etaStr+'</div><div class="sbox-l">ETA סיום</div></div>' +
      '</div>' +
      (d.gap!==0?'<div style="font-size:11px;margin-top:6px;color:'+(d.gap<0?'var(--red)':'var(--green)')+'">פער: '+(d.gap>=0?'+':'')+d.gap+' יח</div>':'') +
    '</div>';
  }).join('');

  // Recommendation
  html+=buildStaffingRecommendation(data);
  el2.innerHTML=html;
}

function redistributeWorkers(){
  var total=parseInt(document.getElementById('total-workers').value)||0;
  if(total<=0) return;
  // Simple: distribute proportionally to remaining work
  var data=LINES.map(function(l){
    var c=calcLine(l.id);
    return{id:l.id,remaining:Math.max(0,(c.combined||0)-(c.done||0)),target:c.combined||0};
  });
  var totalRemaining=data.reduce(function(s,d){return s+d.remaining;},0);
  if(totalRemaining===0){
    // Distribute evenly
    LINES.forEach(function(l){DEFAULT_WORKERS[l.id]=Math.max(1,Math.floor(total/LINES.length));});
  } else {
    var assigned=0;
    data.forEach(function(d,i){
      if(i===data.length-1){
        DEFAULT_WORKERS[d.id]=Math.max(1,total-assigned);
      } else {
        var w=Math.max(1,Math.round(d.remaining/totalRemaining*total));
        DEFAULT_WORKERS[d.id]=w;
        assigned+=w;
      }
    });
  }
  saveState();syncToServer();renderProductivity();
  showT('כ"א חולק אוטומטית!');
}

function buildStaffingRecommendation(data){
  var issues=data.filter(function(d){return d.done!==null&&(d.etaOver||d.achPct!==null&&d.achPct<85);});
  var good=data.filter(function(d){return d.done!==null&&d.achPct!==null&&d.achPct>105&&d.workers>1;});
  if(!issues.length&&!good.length) return '';
  var html='<div style="background:var(--yellow-bg);border:1px solid rgba(217,119,6,.25);border-radius:12px;padding:12px 14px;margin-top:4px">';
  html+='<div style="font-size:12px;font-weight:700;color:var(--yellow);margin-bottom:8px">המלצת כ"א</div>';
  issues.forEach(function(d){
    var donor=good[0];
    var msg=d.etaOver?'חריגת זמן — ':d.achPct<85?'פיגור — ':'';
    if(donor){
      html+='<div style="font-size:12px;color:var(--text);margin-bottom:5px">העבר עובד מ-<strong>'+donor.name+'</strong> ל-<strong>'+d.name+'</strong> ('+msg+'ETA '+d.etaStr+')</div>';
    } else {
      html+='<div style="font-size:12px;color:var(--text);margin-bottom:5px"><strong>'+d.name+'</strong> — '+msg+' שקול הגדלת כ"א</div>';
    }
  });
  if(!issues.length&&good.length){
    html+='<div style="font-size:12px;color:var(--green)">כל הנתיבים בסדר — ניתן לשחרר עובדים מ-'+good.map(function(d){return d.name;}).join(', ')+'</div>';
  }
  html+='</div>';
  return html;
}

function updateWorkers(lineId){
  var el=document.getElementById('wk-'+lineId);
  if(el) DEFAULT_WORKERS[lineId]=parseInt(el.value)||1;
  saveState();syncToServer();renderProductivity();
}

// MGR SUMMARY
function renderMgrSummary(){
  var sh=shiftHours(),el2=document.getElementById('mgr-summary');
  if(!LINES.some(function(l){return targets[l.id]>0;})){el2.innerHTML='<div class="empty">טרם הוזנו יעדים</div>';return;}
  el2.innerHTML=LINES.map(function(l){
    var t=targets[l.id]||0,hr=t?Math.round(t/sh):0;
    var rr=redRows[l.id]||{},rc2=redClosed[l.id]||{};
    var openR=rr.rows?(rr.rows-(rc2.rows||0)):0,openU=rr.units?(rr.units-(rc2.units||0)):0;
    return '<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:10px">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'+
        '<span style="font-size:15px;font-weight:700">'+l.name+'</span><span class="lc-type '+l.tc+'">'+l.type+'</span></div>'+
      '<div class="sgrid3" style="margin-bottom:'+(rr.rows?'8px':'0')+'">'+
        '<div class="sbox"><div class="sbox-v" style="color:var(--blue)">'+(t||'-')+'</div><div class="sbox-l">יעד יומי</div></div>'+
        '<div class="sbox"><div class="sbox-v" style="color:var(--blue)">'+(hr||'-')+'</div><div class="sbox-l">יעד שעתי</div></div>'+
        '<div class="sbox"><div class="sbox-v" style="color:'+(openR>0?'var(--red)':'var(--green)')+'">'+openR+'</div><div class="sbox-l">שורות א"ד</div></div>'+
      '</div>'+
      (rr.rows?'<div style="background:var(--red-bg);border:1px solid rgba(239,68,68,.2);border-radius:8px;padding:8px 10px;font-size:11px;color:var(--red)">'+openR+' שורות - '+openU+' יחידות פתוחות'+(rc2.rows?' - '+rc2.rows+' נסגרו':'')+'</div>':'')+
    '</div>';
  }).join('');
}

// STOPPAGES
function openStop(){
  var line=document.getElementById('stop-line').value,reason=document.getElementById('stop-reason').value;
  if(!line||!reason){showT('בחר נתיב וסיבה','y');return;}
  stoppages.unshift({id:Date.now().toString(),lineName:line,reason:reason,startTime:nowTime(),startTs:Date.now(),endTime:null,durationMin:null,open:true});
  document.getElementById('stop-line').value='';document.getElementById('stop-reason').value='';
  saveState();syncToServer();updateStopBdg();renderStops();
  pushAlert('r','עצירה: '+line+' - '+reason);showT('עצירה נפתחה!','r');
  // Auto-link to pending material request from same line if reason is מחסן
  if(reason==='מחסן'){
    var relMat=materialRequests.filter(function(r){return (r.status==='pending'||r.status==='inProgress')&&r.lineName===line;});
    if(relMat.length) pushAlert('b',line+': יש '+relMat.length+' בקשות חומר פתוחות - האם קשורות?');
  }
}
function closeStop(id){
  var s=stoppages.filter(function(x){return x.id===id;})[0];
  if(!s) return;
  s.endTime=nowTime();s.durationMin=Math.round((Date.now()-s.startTs)/60000);s.open=false;
  saveState();syncToServer();updateStopBdg();renderStops();
  pushAlert('g','עצירה נסגרה: '+s.lineName+' - '+s.durationMin+' min');showT('נסגרה - '+s.durationMin+' דקות');
}
function updateStopBdg(){
  var open=stoppages.filter(function(s){return s.open;}).length;
  var b=document.getElementById('stop-bdg');
  if(b){b.style.display=open>0?'flex':'none';b.textContent=open;}
}
function renderStops(){
  var active=stoppages.filter(function(s){return s.open;});
  // NEW STOPPAGE FORM - at top
  var stopLineOpts=LINES.map(function(l){return '<option value="'+l.name+'">'+l.name+'</option>';}).join('');
  var stopReasonOpts=['מחסן','ליקוט','סט-אפ','הנדסה','פיתוח','ייצור','איכות','IT','תכנון','שיווק'].map(function(r){return '<option>'+r+'</option>';}).join('');
  var newStopHtml='<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:10px">'+
    '<div style="font-size:11px;font-weight:700;color:var(--dim);margin-bottom:8px">פתח עצירה חדשה</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">'+
      '<select id="stop-line" style="background:var(--card);border:1px solid var(--border);border-radius:7px;padding:8px;color:var(--text);font-size:13px;font-family:var(--font)">'+
        '<option value="">בחר נתיב</option>'+stopLineOpts+'</select>'+
      '<select id="stop-reason" style="background:var(--card);border:1px solid var(--border);border-radius:7px;padding:8px;color:var(--text);font-size:13px;font-family:var(--font)">'+
        '<option value="">בחר סיבה</option>'+stopReasonOpts+'</select>'+
    '</div>'+
    '<button onclick="openStop()" style="width:100%;padding:9px;background:var(--red-bg);border:1px solid rgba(220,38,38,.3);border-radius:8px;color:var(--red);font-size:13px;font-weight:700;cursor:pointer">פתח עצירה</button>'+
  '</div>';
  document.getElementById('stop-form-top').innerHTML=newStopHtml;
  var hd=document.getElementById('active-hd'),aEl=document.getElementById('active-stops');
  hd.style.display=active.length>0?'flex':'none';
  aEl.innerHTML=active.map(function(s){
    var el2=Math.round((Date.now()-s.startTs)/60000);
    var uc=el2>20?'var(--red)':el2>10?'var(--yellow)':'var(--dim)';
    return '<div class="stop-active">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">'+
        '<div><span style="font-size:14px;font-weight:700;color:var(--red)">'+s.lineName+'</span> <span style="font-size:11px;color:var(--dim)">'+s.reason+'</span></div>'+
        '<span style="font-size:13px;font-weight:700;color:'+uc+';font-family:var(--mono)">'+el2+' min</span>'+
      '</div>'+
      '<div style="display:flex;justify-content:space-between;align-items:center">'+
        '<span style="font-size:10px;color:var(--faint);font-family:var(--mono)">'+s.startTime+'</span>'+
        '<button data-sid="'+s.id+'" onclick="closeStop(this.dataset.sid)" style="background:linear-gradient(135deg,#059669,#10b981);border:none;border-radius:7px;color:#fff;font-size:12px;font-weight:700;padding:6px 12px;cursor:pointer">סגור</button>'+
      '</div></div>';
  }).join('');
  document.getElementById('stop-hist').innerHTML=stoppages.length?stoppages.map(function(s){
    return '<div class="stop-hist-row">'+
      '<div><span style="font-size:13px;font-weight:600">'+s.lineName+'</span> <span style="font-size:11px;color:var(--dim)">'+s.reason+'</span>'+
        '<div style="font-size:10px;color:var(--faint);font-family:var(--mono);margin-top:2px">'+s.startTime+(s.endTime?' > '+s.endTime:' > פעיל')+'</div>'+
      '</div>'+
      '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">'+
        '<span style="font-size:14px;font-weight:700;font-family:var(--mono);color:'+(s.open?'var(--red)':s.durationMin>20?'var(--yellow)':'var(--dim)')+'">'+
          (s.open?'LIVE':s.durationMin+"'")+
        '</span>'+
        '<button data-sid="'+s.id+'" onclick="var sid=this.dataset.sid;requireMgr(function(){openEditStop(sid);})" style="font-size:10px;padding:2px 8px;background:var(--surface);border:1px solid var(--border);border-radius:5px;color:var(--dim);cursor:pointer">ערוך</button>'+
      '</div></div>';
  }).join(''):'<div class="empty" style="padding:14px">אין עצירות היום</div>';
}

function openEditStop(id){
  var isNew=id==='new';
  document.getElementById('es-id').value=isNew?'new_'+Date.now():id;
  if(!isNew){
    var s=stoppages.filter(function(x){return x.id===id;})[0];
    if(!s) return;
    document.getElementById('es-line').value=s.lineName;
    document.getElementById('es-reason').value=s.reason;
    document.getElementById('es-start').value=s.startTime||'';
    document.getElementById('es-end').value=s.endTime||'';
  } else {
    document.getElementById('es-line').value='';
    document.getElementById('es-reason').value='';
    document.getElementById('es-start').value=nowTime();
    document.getElementById('es-end').value='';
  }
  calcEsDur();
  document.getElementById('edit-stop-modal').classList.add('open');
}
function closeEditStop(){document.getElementById('edit-stop-modal').classList.remove('open');}
function calcEsDur(){
  var s=document.getElementById('es-start').value,e=document.getElementById('es-end').value,el3=document.getElementById('es-dur');
  if(s&&e){var sp=s.split(':').map(Number),ep=e.split(':').map(Number),d=(ep[0]*60+ep[1])-(sp[0]*60+sp[1]);el3.textContent=d>0?'משך: '+d+' דקות':'שעת סגירה לפני פתיחה';}else el3.textContent='';
}
function saveEditStop(){
  var id=document.getElementById('es-id').value,isNew=id.indexOf('new_')===0;
  var line=document.getElementById('es-line').value,reason=document.getElementById('es-reason').value;
  if(!line||!reason){showT('בחר נתיב וסיבה','y');return;}
  var start=document.getElementById('es-start').value,end=document.getElementById('es-end').value;
  var dur=null,open=true;
  if(end){var sp=start.split(':').map(Number),ep=end.split(':').map(Number);dur=Math.max(0,(ep[0]*60+ep[1])-(sp[0]*60+sp[1]));open=false;}
  var n=new Date(),sp2=start.split(':').map(Number),sd=new Date(n);sd.setHours(sp2[0],sp2[1],0,0);
  if(isNew){stoppages.unshift({id:Date.now().toString(),lineName:line,reason:reason,startTime:start,startTs:sd.getTime(),endTime:end||null,durationMin:dur,open:open});}
  else{var s2=stoppages.filter(function(x){return x.id===id;})[0];if(s2)Object.assign(s2,{lineName:line,reason:reason,startTime:start,startTs:sd.getTime(),endTime:end||null,durationMin:dur,open:open});}
  saveState();syncToServer();closeEditStop();updateStopBdg();renderStops();showT('נשמר');
}
function deleteStop(){
  var id=document.getElementById('es-id').value;
  stoppages=stoppages.filter(function(x){return x.id!==id;});
  saveState();syncToServer();closeEditStop();updateStopBdg();renderStops();showT('נמחק','y');
}

// PACKING
function calcPalletHeight(p){
  var db=p.cartons.dolbox||0,up=p.cartons.upgrade||0,b2=p.cartons.box2x2||0;
  var tot=db+up+b2,layers=tot>0?Math.ceil(tot/4):0;
  var allH=[];
  for(var i=0;i<db;i++) allH.push(50);
  for(var i=0;i<up;i++) allH.push(25);
  for(var i=0;i<b2;i++) allH.push(31);
  allH.sort(function(a,b){return b-a;});
  var totalCm=0;
  for(var i=0;i<allH.length;i+=4) totalCm+=allH[i];
  return{tot:tot,layers:layers,totalCm:totalCm};
}
function addPallet(){
  var id='P'+Date.now();
  pallets.push({id:id,orderId:'',customer:'',pkNum:'',shipType:'sea',maxHeight:220,special:false,specialNote:'',cartons:{dolbox:0,upgrade:0,box2x2:0},sourceLogs:[],closed:false,createdAt:nowTime()});
  saveState();syncToServer();renderPallets();buildRequestForms();
}
function palletField(el){
  var id=el.getAttribute('data-pid'),field=el.getAttribute('data-field');
  var p=pallets.filter(function(x){return x.id===id;})[0];
  if(!p) return;
  if(field==='shipType'){p.shipType=el.value;p.maxHeight=el.value==='air'?160:220;saveState();syncToServer();renderPallets();return;}
  if(field==='special'){
    p.special=el.checked;
    var n=document.getElementById('pnote-'+id);if(n)n.style.display=el.checked?'block':'none';
    var d=document.getElementById('pdot2-'+id);if(d)d.style.display=el.checked?'inline-block':'none';
    saveState();syncToServer();return;
  }
  if(field==='maxHeight') p.maxHeight=parseInt(el.value)||220;
  else p[field]=el.value;
  if(field==='orderId'){var h=document.getElementById('phdr-'+id);if(h)h.textContent=el.value||'משטח חדש';}
  saveState();syncToServer();
}
function closePallet(el){
  var id=el.getAttribute('data-pid'),p=pallets.filter(function(x){return x.id===id;})[0];
  if(!p) return;
  p.closed=true;p.closedAt=nowTime();
  saveState();syncToServer();renderPallets();buildRequestForms();
  pushAlert('g','משטח נסגר: '+(p.orderId||''));showT('משטח נסגר!');
}
function reopenPallet(el){
  var id=el.getAttribute('data-pid'),p=pallets.filter(function(x){return x.id===id;})[0];
  if(!p) return;
  p.closed=false;p.closedAt=null;
  saveState();syncToServer();renderPallets();buildRequestForms();showT('משטח נפתח','y');
}
function deletePallet(el){
  var id=el.getAttribute('data-pid');
  pallets=pallets.filter(function(x){return x.id!==id;});
  saveState();syncToServer();renderPallets();buildRequestForms();showT('משטח נמחק','y');
}
function editSourceLog(el){
  var pid=el.getAttribute('data-pid'),li=parseInt(el.getAttribute('data-li'));
  var p=pallets.filter(function(x){return x.id===pid;})[0];
  if(!p||!p.sourceLogs[li]) return;
  var log=p.sourceLogs[li];
  var newQty=parseInt(prompt('כמות קרטונים (נוכחי: '+log.qty+'):',log.qty));
  if(isNaN(newQty)||newQty<=0){showT('כמות לא תקינה','y');return;}
  var diff=newQty-log.qty;
  var ct=log.ctype||'dolbox';
  p.cartons[ct]=Math.max(0,(p.cartons[ct]||0)+diff);
  log.qty=newQty;
  saveState();syncToServer();renderPallets();showT('עודכן!');
}
function deleteSourceLog(el){
  var pid=el.getAttribute('data-pid'),li=parseInt(el.getAttribute('data-li'));
  var p=pallets.filter(function(x){return x.id===pid;})[0];
  if(!p||!p.sourceLogs[li]) return;
  var log=p.sourceLogs[li],ct=log.ctype||'dolbox';
  p.cartons[ct]=Math.max(0,(p.cartons[ct]||0)-log.qty);
  p.sourceLogs.splice(li,1);
  saveState();syncToServer();renderPallets();showT('נמחק','y');
}
function filterPallets(){
  var q=document.getElementById('pallet-search');
  if(!q) return;
  var term=q.value.trim().toLowerCase();
  if(!term){renderPallets();return;}
  var orig=pallets;
  pallets=pallets.filter(function(p){
    return (p.orderId||'').toLowerCase().includes(term)||
           (p.customer||'').toLowerCase().includes(term)||
           (p.pkNum||'').toLowerCase().includes(term);
  });
  renderPallets();
  pallets=orig;
}
function refreshPalletSelect(){
  var el=document.getElementById('req-pallet');
  if(!el) return;
  var cur=el.value;
  var active=pallets.filter(function(p){return !p.closed;});
  var opts='<option value="">-- בחר משטח --</option>';
  if(active.length){opts+=active.map(function(p){return '<option value="'+p.id+'">'+(p.orderId||'ללא מספר')+(p.customer?' | '+p.customer:'')+'</option>';}).join('');}
  else{opts+='<option value="" disabled>אין משטחים פתוחים</option>';}
  el.innerHTML=opts;
  if(cur) el.value=cur;
}
function renderPallets(){
  var el=document.getElementById('pallets-list');
  if(!el) return;
  if(!pallets.length){el.innerHTML='<div class="empty">לחץ + חדש להתחיל</div>';return;}
  var is='background:var(--surface);border:1px solid var(--border);border-radius:7px;padding:8px;color:var(--text);font-size:13px;text-align:center;width:100%';
  var ss='background:var(--surface);border:1px solid var(--border);border-radius:7px;padding:8px;color:var(--text);font-size:13px;width:100%;cursor:pointer';
  var html='';
  pallets.forEach(function(p){
    var dc=p.shipType==='air'?'var(--blue)':'var(--green)';
    var calc=calcPalletHeight(p);
    var cmColor=calc.totalCm>p.maxHeight?'var(--red)':calc.totalCm>p.maxHeight*.85?'var(--yellow)':'var(--green)';
    html+='<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:12px;opacity:'+(p.closed?'.75':'1')+'">';
    // Header
    html+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">';
    html+='<div style="display:flex;align-items:center;gap:6px">';
    html+='<span style="width:10px;height:10px;border-radius:50%;background:'+dc+';flex-shrink:0;display:inline-block"></span>';
    html+='<span id="pdot2-'+p.id+'" style="width:8px;height:8px;border-radius:50%;background:var(--red);flex-shrink:0;display:'+(p.special?'inline-block':'none')+'"></span>';
    html+='<span id="phdr-'+p.id+'" style="font-size:14px;font-weight:700">'+(p.orderId||'משטח חדש')+'</span>';
    if(p.customer) html+=' <span style="font-size:11px;color:var(--dim)">'+p.customer+'</span>';
    html+='</div>';
    html+='<div style="display:flex;gap:6px">';
    if(p.closed) html+='<button data-pid="'+p.id+'" onclick="reopenPallet(this)" style="font-size:11px;padding:3px 10px;background:var(--yellow-bg);border:1px solid rgba(245,158,11,.3);border-radius:6px;color:var(--yellow);cursor:pointer">פתח מחדש</button>';
    html+='<button data-pid="'+p.id+'" onclick="deletePallet(this)" style="font-size:11px;padding:3px 8px;background:var(--red-bg);border:1px solid rgba(239,68,68,.3);border-radius:6px;color:var(--red);cursor:pointer">מחק</button>';
    html+='</div></div>';
    // Fields
    html+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">';
    html+='<div class="fld"><label>מספר הזמנה</label><input type="text" data-pid="'+p.id+'" data-field="orderId" value="'+p.orderId+'" placeholder="HZ-1234" oninput="palletField(this)" style="'+is+';font-family:var(--mono)"></div>';
    html+='<div class="fld"><label>לקוח</label><input type="text" data-pid="'+p.id+'" data-field="customer" value="'+p.customer+'" placeholder="שם לקוח" oninput="palletField(this)" style="'+is+'"></div>';
    html+='<div class="fld"><label>מספר PK</label><input type="text" data-pid="'+p.id+'" data-field="pkNum" value="'+p.pkNum+'" placeholder="PK-001" oninput="palletField(this)" style="'+is+';font-family:var(--mono)"></div>';
    html+='<div class="fld"><label>סוג משלוח</label><select data-pid="'+p.id+'" data-field="shipType" onchange="palletField(this)" style="'+ss+'">';
    html+='<option value="sea"'+(p.shipType==='sea'?' selected':'')+'>ימי</option>';
    html+='<option value="air"'+(p.shipType==='air'?' selected':'')+'>אווירי</option>';
    html+='</select></div>';
    html+='<div class="fld"><label>גובה מקסימלי</label>';
    if(p.shipType==='air'){html+='<div style="'+is+';border-color:rgba(59,130,246,.3);color:var(--blue)">160 cm</div>';}
    else{html+='<select data-pid="'+p.id+'" data-field="maxHeight" onchange="palletField(this)" style="'+ss+';font-family:var(--mono)"><option value="220"'+(p.maxHeight===220?' selected':'')+'>220 cm</option><option value="240"'+(p.maxHeight===240?' selected':'')+'>240 cm</option></select>';}
    html+='</div>';
    html+='</div>';
    // Special
    html+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding:7px 10px;background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.2);border-radius:8px">';
    html+='<input type="checkbox" id="pspec-'+p.id+'" data-pid="'+p.id+'" data-field="special" onchange="palletField(this)"'+(p.special?' checked':'')+' style="width:16px;height:16px;cursor:pointer">';
    html+='<label for="pspec-'+p.id+'" style="font-size:12px;font-weight:700;color:var(--red);cursor:pointer">הנחיות מיוחדות</label>';
    html+='</div>';
    html+='<div id="pnote-'+p.id+'" style="display:'+(p.special?'block':'none')+';margin-bottom:10px"><textarea data-pid="'+p.id+'" data-field="specialNote" rows="2" oninput="palletField(this)" placeholder="פרט הנחיות לביצוע..." style="background:#FEF2F2;border:1px solid rgba(239,68,68,.3);border-radius:7px;padding:8px;color:var(--text);font-size:13px;width:100%;resize:none;line-height:1.5;font-family:var(--font)">'+(p.specialNote||'')+'</textarea></div>';
    // Cartons read-only
    html+='<div style="border-top:1px solid var(--border);padding-top:10px;margin-bottom:8px">';
    html+='<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">';
    CTYPES.forEach(function(ct){
      var qty=p.cartons[ct.id]||0;
      html+='<div style="text-align:center;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px 4px">';
      html+='<div style="font-size:20px;font-weight:700;font-family:var(--mono);color:'+(qty>0?'var(--text)':'var(--faint)')+'">'+qty+'</div>';
      html+='<div style="font-size:10px;color:var(--dim);margin-top:2px">'+ct.name+'</div>';
      html+='</div>';
    });
    html+='</div></div>';
    // Height summary
    html+='<div id="psum-'+p.id+'" style="font-size:11px;color:var(--dim);font-family:var(--mono);margin-bottom:8px;text-align:center">'+
      calc.tot+' קרטונים | '+calc.layers+' קומות | <span style="color:'+cmColor+';font-weight:700">'+calc.totalCm+'/'+p.maxHeight+' cm</span></div>';
    if(calc.totalCm>p.maxHeight&&calc.tot>0) html+='<div style="font-size:11px;font-weight:700;color:var(--red);background:var(--red-bg);border:1px solid rgba(239,68,68,.2);border-radius:6px;padding:5px 10px;margin-bottom:8px">חריגת גובה! '+calc.totalCm+'cm מעל '+p.maxHeight+'cm</div>';
    // Source logs
    if(p.sourceLogs&&p.sourceLogs.length){
      html+='<div style="border-top:1px solid var(--border);padding-top:8px;margin-bottom:8px">';
      html+='<div style="font-size:10px;font-weight:700;color:var(--faint);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">מקור</div>';
      p.sourceLogs.forEach(function(log,li){
        html+='<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;background:var(--surface);border-radius:6px;margin-bottom:4px">';
        html+='<div style="display:flex;align-items:center;gap:6px"><span style="font-size:12px;font-weight:600">'+log.lineName+'</span><span style="font-size:11px;color:var(--dim)">'+(log.ctypeName||log.ctype)+' x'+log.qty+'</span></div>';
        html+='<div style="display:flex;align-items:center;gap:6px">'+
          '<span style="font-size:10px;color:var(--faint);font-family:var(--mono)">'+log.time+'</span>'+
          '<button data-pid="'+p.id+'" data-li="'+li+'" onclick="editSourceLog(this)" style="font-size:10px;padding:2px 7px;background:var(--blue-bg);border:1px solid rgba(59,130,246,.3);border-radius:5px;color:var(--blue);cursor:pointer">ערוך</button>'+
          '<button data-pid="'+p.id+'" data-li="'+li+'" onclick="deleteSourceLog(this)" style="font-size:10px;padding:2px 7px;background:var(--red-bg);border:1px solid rgba(239,68,68,.3);border-radius:5px;color:var(--red);cursor:pointer">מחק</button>'+
        '</div></div>';
      });
      html+='</div>';
    }
    // Close button
    if(!p.closed){html+='<button data-pid="'+p.id+'" onclick="closePallet(this)" style="width:100%;padding:9px;background:var(--green-bg);border:1px solid rgba(16,185,129,.3);border-radius:8px;color:var(--green);font-size:13px;font-weight:700;cursor:pointer;margin-top:4px">סגור משטח</button>';}
    else{html+='<div style="text-align:center;font-size:11px;color:var(--green);font-family:var(--mono);margin-top:6px">נסגר: '+(p.closedAt||'')+'</div>';}
    html+='</div>';
  });
  el.innerHTML=html;
}

// REQUESTS
function buildRequestForms(){
  var el=document.getElementById('request-forms');
  if(!el) return;
  var active=pallets.filter(function(p){return !p.closed;});
  var pending=palletRequests.filter(function(r){return r.status==='pending';});
  var badge=document.getElementById('req-count-badge');
  if(badge) badge.textContent=pending.length>0?pending.length+' ממתינות':'';
  var is='background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:9px 8px;color:var(--text);font-size:14px;width:100%;cursor:pointer';
  var lineOpts=LINES.map(function(l){return '<option value="'+l.id+'">'+l.name+'</option>';}).join('');
  el.innerHTML='<div class="ic">'+
    '<div class="igrid" style="margin-bottom:8px">'+
      '<div class="fld"><label>נתיב</label><select id="req-line" style="'+is+'">'+lineOpts+'</select></div>'+
      '<div class="fld"><label>משטח יעד</label><select id="req-pallet" onfocus="refreshPalletSelect()" style="'+is+'"><option value="">-- בחר --</option></select></div>'+
    '</div>'+
    '<div class="igrid" style="margin-bottom:8px">'+
      '<div class="fld"><label>סוג קרטון</label><select id="req-ctype" style="'+is+'">'+
        '<option value="dolbox">דולבוקס</option>'+
        '<option value="upgrade">אפגרייד</option>'+
        '<option value="box2x2">קרטון 2x2</option>'+
      '</select></div>'+
      '<div class="fld"><label>כמות</label><input type="number" id="req-qty" placeholder="0" inputmode="numeric" style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:9px;color:var(--text);font-size:20px;font-family:var(--mono);text-align:center;width:100%"></div>'+
    '</div>'+
    '<input type="text" id="req-note" placeholder="הערה (לא חובה)..." style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:9px;color:var(--text);font-size:13px;width:100%;margin-bottom:8px">'+
    '<button onclick="submitPalletRequest()" style="width:100%;padding:11px;background:var(--blue-bg);border:1px solid rgba(59,130,246,.3);border-radius:8px;color:var(--blue);font-size:14px;font-weight:700;cursor:pointer">שלח בקשת שיבוץ</button>'+
  '</div>';
  renderPackRequests();
}
function submitPalletRequest(){
  var lineId=document.getElementById('req-line').value;
  var palletId=document.getElementById('req-pallet').value;
  var ctype=document.getElementById('req-ctype').value;
  var qty=parseInt(document.getElementById('req-qty').value)||0;
  var note=document.getElementById('req-note').value||'';
  if(!palletId){showT('בחר משטח','y');return;}
  if(!qty){showT('הזן כמות','y');return;}
  var p=pallets.filter(function(x){return x.id===palletId;})[0];
  var line=LINES.filter(function(x){return x.id===lineId;})[0];
  if(!p||!line) return;
  // Height check
  var ctH={dolbox:49,upgrade:25,box2x2:31};
  var sim=JSON.parse(JSON.stringify(p.cartons));
  sim[ctype]=(sim[ctype]||0)+qty;
  var allH2=[];
  for(var i=0;i<(sim.dolbox||0);i++) allH2.push(50);
  for(var i=0;i<(sim.upgrade||0);i++) allH2.push(25);
  for(var i=0;i<(sim.box2x2||0);i++) allH2.push(31);
  allH2.sort(function(a,b){return b-a;});
  var newCm=0;
  for(var i=0;i<allH2.length;i+=4) newCm+=allH2[i];
  if(newCm>p.maxHeight){showT('חריגת גובה! '+newCm+'cm > '+p.maxHeight+'cm','r');return;}
  var ctNames={dolbox:'דולבוקס',upgrade:'אפגרייד',box2x2:'קרטון 2x2'};
  var req={id:'R'+Date.now(),lineId:lineId,lineName:line.name,palletId:palletId,palletOrder:p.orderId||'ללא מספר',ctype:ctype,ctypeName:ctNames[ctype]||ctype,qty:qty,note:note,status:'pending',createdAt:nowTime()};
  palletRequests.unshift(req);
  saveState();syncToServer();
  document.getElementById('req-qty').value='';
  document.getElementById('req-note').value='';
  pushAlert('b','בקשת שיבוץ: '+line.name+' -> '+req.palletOrder+' ('+qty+' '+req.ctypeName+')');
  showT('בקשה נשלחה!');
  buildRequestForms();
}
function approveRequest(id){
  var req=palletRequests.filter(function(x){return x.id===id;})[0];
  if(!req) return;
  req.status='approved';req.resolvedAt=nowTime();
  var p=pallets.filter(function(x){return x.id===req.palletId;})[0];
  if(p){
    var ct=req.ctype||'dolbox';
    if(!p.cartons) p.cartons={dolbox:0,upgrade:0,box2x2:0};
    p.cartons[ct]=(p.cartons[ct]||0)+req.qty;
    if(!p.sourceLogs) p.sourceLogs=[];
    p.sourceLogs.push({lineId:req.lineId,lineName:req.lineName,ctype:ct,ctypeName:req.ctypeName||ct,qty:req.qty,time:nowTime(),reqId:req.id});
    saveState();syncToServer();
  }
  saveState();syncToServer();
  pushAlert('g','אושר: '+req.lineName+' -> '+req.palletOrder);
  showT('בקשה אושרה!');
  renderPackRequests();renderPallets();
}
function rejectRequest(id){
  var req=palletRequests.filter(function(x){return x.id===id;})[0];
  if(!req) return;
  req.status='rejected';req.resolvedAt=nowTime();
  saveState();syncToServer();
  pushAlert('r','נדחה: '+req.lineName+' -> '+req.palletOrder);
  showT('בקשה נדחתה','r');
  renderPackRequests();
}
function renderPackRequests(){
  var el=document.getElementById('pack-requests');
  if(!el) return;
  var pending=palletRequests.filter(function(r){return r.status==='pending';});
  var recent=palletRequests.filter(function(r){return r.status!=='pending';}).slice(0,5);
  var html='';
  if(pending.length){
    html+='<div style="font-size:11px;font-weight:700;color:var(--yellow);margin-bottom:8px">ממתינות לאישור ('+pending.length+')</div>';
    pending.forEach(function(r){
      html+='<div style="background:var(--yellow-bg);border:1px solid rgba(245,158,11,.3);border-radius:10px;padding:11px 13px;margin-bottom:8px">';
      html+='<div style="margin-bottom:8px"><span style="font-size:13px;font-weight:700">'+r.lineName+'</span> <span style="font-size:11px;color:var(--dim)">-> '+r.palletOrder+'</span>';
      html+='<div style="font-size:12px;color:var(--dim);margin-top:2px">'+(r.ctypeName||'')+': '+r.qty+(r.note?' | '+r.note:'')+'</div>';
      html+='<div style="font-size:10px;color:var(--faint);font-family:var(--mono)">'+r.createdAt+'</div></div>';
      html+='<div style="display:flex;gap:8px">';
      html+='<button data-rid="'+r.id+'" onclick="approveRequest(this.getAttribute(\'data-rid\'))" style="flex:1;padding:8px;background:var(--green-bg);border:1px solid rgba(16,185,129,.3);border-radius:7px;color:var(--green);font-size:13px;font-weight:700;cursor:pointer">אשר</button>';
      html+='<button data-rid="'+r.id+'" onclick="rejectRequest(this.getAttribute(\'data-rid\'))" style="flex:1;padding:8px;background:var(--red-bg);border:1px solid rgba(239,68,68,.3);border-radius:7px;color:var(--red);font-size:13px;font-weight:700;cursor:pointer">דחה</button>';
      html+='</div></div>';
    });
  }
  if(recent.length){
    html+='<div style="font-size:11px;font-weight:700;color:var(--faint);margin:10px 0 6px">אחרונות</div>';
    recent.forEach(function(r){
      var col=r.status==='approved'?'var(--green)':'var(--red)';
      var lbl=r.status==='approved'?'אושר':'נדחה';
      html+='<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:var(--surface);border:1px solid var(--border);border-radius:8px;margin-bottom:6px">';
      html+='<div><span style="font-size:12px;font-weight:600">'+r.lineName+'</span> <span style="font-size:11px;color:var(--dim)">'+r.palletOrder+' - '+r.qty+' '+(r.ctypeName||'')+'</span></div>';
      html+='<span style="font-size:11px;font-weight:700;color:'+col+'">'+lbl+'</span></div>';
    });
  }
  if(!pending.length&&!recent.length) html='<div class="empty" style="padding:16px">אין בקשות</div>';
  el.innerHTML=html;
}

// HISTORY
function switchHist(tab){
  histTab=tab;
  document.getElementById('ht-week').classList.toggle('active',tab==='week');
  document.getElementById('ht-month').classList.toggle('active',tab==='month');
  renderHistory();
}
function renderHistory(){
  var el2=document.getElementById('hist-content');
  var keys=Object.keys(history).sort().reverse();
  if(!keys.length){el2.innerHTML='<div class="empty">אין היסטוריה שמורה עדיין</div>';return;}
  var now=new Date();
  var filtered=keys.filter(function(k){return (now-new Date(k))<=(histTab==='week'?7:31)*24*3600*1000;});
  if(!filtered.length){el2.innerHTML='<div class="empty">אין נתונים בטווח זה</div>';return;}
  el2.innerHTML=filtered.map(function(dk){
    var d2=history[dk],dayName=DAYS[new Date(dk).getDay()],dateStr=new Date(dk).toLocaleDateString('he-IL');
    var totT=0,totD=0,totStop=0;
    LINES.forEach(function(l){
      totT+=(d2.targets[l.id]||0);
      var reps=d2.reports[l.id]||[];var last=reps[reps.length-1];totD+=last?last.done:0;
    });
    totStop=(d2.stoppages||[]).filter(function(s){return !s.open;}).reduce(function(s,x){return s+(x.durationMin||0);},0);
    var ach=totT>0?Math.round(totD/totT*100):null;
    var achCol=ach===null?'var(--faint)':ach>=95?'var(--green)':ach>=85?'var(--yellow)':'var(--red)';
    return '<div class="hist-day">'+
      '<div class="hist-day-hd" onclick="this.nextElementSibling.classList.toggle(\'open\')">'+
        '<div><span style="font-size:13px;font-weight:700">יום '+dayName+'</span> <span style="font-size:11px;color:var(--dim)">'+dateStr+'</span></div>'+
        '<div style="display:flex;gap:12px;align-items:center">'+
          '<span style="font-size:12px;font-family:var(--mono);color:'+achCol+'">'+(ach!==null?ach+'%':'-')+'</span>'+
          '<span style="font-size:11px;color:var(--faint);font-family:var(--mono)">'+totStop+" min</span>"+
        '</div>'+
      '</div>'+
      '<div class="hist-body">'+
        LINES.map(function(l){
          var t=(d2.targets[l.id]||0),reps=(d2.reports[l.id]||[]),last=reps[reps.length-1],done=last?last.done:0;
          var a=t>0?Math.round(done/t*100):null;
          var ac=a===null?'var(--faint)':a>=95?'var(--green)':a>=85?'var(--yellow)':'var(--red)';
          return '<div class="hist-row"><span style="font-size:13px;font-weight:600">'+l.name+'</span>'+
            '<div style="display:flex;gap:12px"><span style="font-size:12px;color:var(--dim);font-family:var(--mono)">'+done+'/'+t+'</span>'+
            '<span style="font-size:12px;font-weight:700;font-family:var(--mono);color:'+ac+'">'+(a!==null?a+'%':'-')+'</span></div></div>';
        }).join('')+
        '<div style="margin-top:8px;font-size:11px;color:var(--faint)">'+totStop+' min - '+(d2.stoppages||[]).length+' עצירות</div>'+
      '</div>'+
    '</div>';
  }).join('');
}

// SHIFT SUMMARY
function genShiftSummary(){
  var calcs=LINES.map(function(l){return calcLine(l.id);});
  var sc=calcScore(),si=scoreInfo(sc),n=new Date(),d=n.getDay();
  var dateStr=n.toLocaleDateString('he-IL',{weekday:'long',day:'numeric',month:'numeric'});
  var shiftLabel=d===5?'07:15-12:45':(d===0||d===2||d===4)?'07:15-16:45':'07:15-18:45';
  var totStop=stoppages.filter(function(s){return !s.open;}).reduce(function(s,x){return s+(x.durationMin||0);},0);
  var stopCount=stoppages.filter(function(s){return !s.open;}).length;
  var closedPallets=pallets.filter(function(p){return p.closed;}).length;
  var lines2=['סיכום משמרת - '+dateStr,'משמרת: '+shiftLabel,''];
  lines2.push('-- ביצוע נתיבים --');
  LINES.forEach(function(l){
    var c=calcLine(l.id),combined=(c.target||0)+((redRows[l.id]||{}).units||0),done=c.done||0;
    var pct=combined>0?Math.round(done/combined*100):0;
    var status=pct>=95?'OK':pct>=85?'WARN':'LATE';
    lines2.push(status+' '+l.name+': '+done+'/'+combined+' ('+pct+'%)');
  });
  lines2.push('');lines2.push('עצירות: '+stopCount+' - '+totStop+' min');
  lines2.push('משטחים שנסגרו: '+closedPallets);
  if(sc!==null) lines2.push('ציון יומי: '+sc+'/100 ('+si.lbl+')');
  summaryText=lines2.join('\n');
  var scoreHtml='<div class="score-circle '+si.cls+'" style="margin-bottom:6px">'+
    '<span style="font-size:26px;font-weight:900;font-family:var(--mono);color:'+si.col+'">'+(sc||'-')+'</span>'+
    '<span style="font-size:9px;color:var(--dim)">ציון</span></div>'+
    '<div style="font-size:13px;font-weight:700;margin-bottom:12px;text-align:center">'+si.lbl+'</div>';
  var rowsHtml=LINES.map(function(l){
    var c=calcLine(l.id),combined=(c.target||0)+((redRows[l.id]||{}).units||0),done=c.done||0;
    var pct=combined>0?Math.round(done/combined*100):0;
    var col=pct>=95?'var(--green)':pct>=85?'var(--yellow)':'var(--red)';
    return '<div class="sum-line"><span>'+l.name+'</span><strong style="color:'+col+'">'+done+'/'+combined+' ('+pct+'%)</strong></div>';
  }).join('');
  document.getElementById('shift-sum-content').innerHTML=
    '<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:10px">'+
    scoreHtml+rowsHtml+
    '<div class="sum-line"><span>עצירות</span><strong>'+stopCount+' x - '+totStop+' min</strong></div></div>';
  document.getElementById('wa-btn').style.display='flex';
}
function shareWA(){window.open('https://wa.me/?text='+encodeURIComponent(summaryText),'_blank');}

// DAILY SUMMARY
function genDailySummary(){
  var sc=calcScore(),si=scoreInfo(sc),n=new Date(),d=n.getDay();
  var dateStr=n.toLocaleDateString('he-IL',{day:'numeric',month:'numeric',year:'numeric'});
  var shiftLabel=d===5?'07:15-12:45':(d===0||d===2||d===4)?'07:15-16:45':'07:15-18:45';
  var totStop=stoppages.filter(function(s){return !s.open;}).reduce(function(s,x){return s+(x.durationMin||0);},0);
  var stopCount=stoppages.filter(function(s){return !s.open;}).length;
  var lines2=['סיכום יומי - יום '+DAYS[d]+' '+dateStr,'משמרת: '+shiftLabel,'','-- ביצוע נתיבים --'];
  LINES.forEach(function(l){
    var c=calcLine(l.id),combined=(c.target||0)+((redRows[l.id]||{}).units||0),done=c.done||0;
    var pct=combined>0?Math.round(done/combined*100):0;
    lines2.push((pct>=95?'OK':pct>=85?'WARN':'LATE')+' '+l.name+': '+done+'/'+combined+' ('+pct+'%)');
  });
  lines2.push('','-- עצירות --','סהכ: '+stopCount+' - '+totStop+' min');
  var byR={};
  stoppages.filter(function(s){return !s.open;}).forEach(function(s){if(!byR[s.reason])byR[s.reason]=0;byR[s.reason]+=s.durationMin||0;});
  Object.entries(byR).sort(function(a,b){return b[1]-a[1];}).slice(0,3).forEach(function(e){lines2.push('  '+e[0]+': '+e[1]+' min');});
  // Material summary
  var matDone=materialRequests.filter(function(r){return r.status==='arrived'||r.status==='delayed';});
  if(matDone.length){
    var matDelays=matDone.filter(function(r){return r.status==='delayed';});
    var matAvg=matDone.filter(function(r){return r.durationMin!==null&&r.status==='arrived';});
    var avgMin=matAvg.length?Math.round(matAvg.reduce(function(s,r){return s+r.durationMin;},0)/matAvg.length):null;
    var delByR={};matDelays.forEach(function(r){delByR[r.delayReason||'']=(delByR[r.delayReason||'']||0)+1;});
    var top2Del=Object.entries(delByR).sort(function(a,b){return b[1]-a[1];}).slice(0,2);
    var matLine='הזמנות חומר: '+matDone.length+(matDelays.length?' | עיכובים: '+matDelays.length:'')+(avgMin?' | ממוצע: '+avgMin+'m':'');
    if(top2Del.length) matLine+=' | '+top2Del.map(function(e){return e[0]+' '+e[1]+'x';}).join(' / ');
    lines2.push(matLine);
  }
  if(sc!==null){lines2.push('');lines2.push('ציון יומי: '+sc+'/100 ('+si.lbl+')');}
  var txt=lines2.join('\n');
  document.getElementById('daily-sum-text').value=txt;
  document.getElementById('daily-sum-box').style.display='block';
  document.getElementById('wa-daily-btn').style.display='flex';
  window._dailySummaryText=txt;
}
function shareDailySummaryWA(){window.open('https://wa.me/?text='+encodeURIComponent(window._dailySummaryText||''),'_blank');}

// WEEKLY REPORT
function genWeeklyReport(){
  var keys=Object.keys(history).sort().reverse().slice(0,7);
  if(!keys.length){document.getElementById('weekly-content').innerHTML='<div class="empty">אין היסטוריה שמורה עדיין</div>';return;}
  var totalAch=0,totalStop=0,totalDays=0,worstDay='',worstPct=200,bestDay='',bestPct=0;
  var reasonTotals={},lineAch={};
  LINES.forEach(function(l){lineAch[l.id]={total:0,count:0};});
  var rows=keys.map(function(dk){
    var d2=history[dk],dayName=DAYS[new Date(dk).getDay()],dateStr=new Date(dk).toLocaleDateString('he-IL');
    var totT=0,totD=0,totStop2=0;
    LINES.forEach(function(l){
      totT+=(d2.targets[l.id]||0);
      var reps=d2.reports[l.id]||[];var last=reps[reps.length-1];var done=last?last.done:0;totD+=done;
      if(totT>0&&lineAch[l.id]){lineAch[l.id].total+=Math.round(done/(d2.targets[l.id]||1)*100);lineAch[l.id].count++;}
    });
    totStop2=(d2.stoppages||[]).filter(function(s){return !s.open;}).reduce(function(s,x){return s+(x.durationMin||0);},0);
    (d2.stoppages||[]).filter(function(s){return !s.open;}).forEach(function(s){
      if(!reasonTotals[s.reason])reasonTotals[s.reason]={c:0,m:0};
      reasonTotals[s.reason].c++;reasonTotals[s.reason].m+=s.durationMin||0;
    });
    var ach=totT>0?Math.round(totD/totT*100):null;
    if(ach!==null){totalAch+=ach;totalDays++;totalStop+=totStop2;
      if(ach<worstPct){worstPct=ach;worstDay=dayName+' '+dateStr;}
      if(ach>bestPct){bestPct=ach;bestDay=dayName+' '+dateStr;}
    }
    var achCol=ach===null?'var(--faint)':ach>=95?'var(--green)':ach>=85?'var(--yellow)':'var(--red)';
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;background:var(--surface);border:1px solid var(--border);border-radius:8px;margin-bottom:6px">'+
      '<span style="font-size:13px;font-weight:600">יום '+dayName+' <span style="font-size:11px;color:var(--dim);font-weight:400">'+dateStr+'</span></span>'+
      '<div style="display:flex;gap:12px;align-items:center">'+
        '<span style="font-size:11px;color:var(--faint);font-family:var(--mono)">'+totStop2+' min</span>'+
        '<span style="font-size:14px;font-weight:700;font-family:var(--mono);color:'+achCol+'">'+(ach!==null?ach+'%':'-')+'</span>'+
      '</div></div>';
  }).join('');
  var avgAch=totalDays>0?Math.round(totalAch/totalDays):0,avgStop=totalDays>0?Math.round(totalStop/totalDays):0;
  var topReasons=Object.entries(reasonTotals).sort(function(a,b){return b[1].m-a[1].m;}).slice(0,3);
  var worstLine='',worstLinePct=200;
  LINES.forEach(function(l){var a=lineAch[l.id];if(a.count>0){var avg2=Math.round(a.total/a.count);if(avg2<worstLinePct){worstLinePct=avg2;worstLine=l.name;}}});
  var html='<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:12px">';
  html+='<div class="sgrid2">';
  html+='<div class="sbox"><div class="sbox-v" style="color:'+(avgAch>=95?'var(--green)':avgAch>=85?'var(--yellow)':'var(--red)')+'">'+avgAch+'%</div><div class="sbox-l">ביצוע ממוצע</div></div>';
  html+='<div class="sbox"><div class="sbox-v">'+avgStop+'</div><div class="sbox-l">עצירות ממוצע (min)</div></div>';
  html+='<div class="sbox" style="background:var(--green-bg);border-color:rgba(16,185,129,.2)"><div class="sbox-v" style="color:var(--green);font-size:13px">'+bestDay+'</div><div class="sbox-l">יום הכי טוב ('+bestPct+'%)</div></div>';
  html+='<div class="sbox" style="background:var(--red-bg);border-color:rgba(239,68,68,.2)"><div class="sbox-v" style="color:var(--red);font-size:13px">'+worstDay+'</div><div class="sbox-l">יום הכי חלש ('+worstPct+'%)</div></div>';
  html+='</div>';
  if(worstLine) html+='<div style="font-size:12px;color:var(--red);margin-top:8px">נתיב הכי בעייתי: <strong>'+worstLine+'</strong> ('+worstLinePct+'%)</div>';
  if(topReasons.length){
    html+='<div style="font-size:11px;font-weight:700;color:var(--dim);margin:10px 0 6px;text-transform:uppercase">סיבות עצירה מובילות</div>';
    topReasons.forEach(function(e){html+='<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px solid var(--border)"><span>'+e[0]+'</span><span style="font-family:var(--mono);color:var(--dim)">'+e[1].c+'x | '+e[1].m+' min</span></div>';});
  }
  html+='</div>';
  html+='<div style="font-size:11px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">יום יום</div>';
  html+=rows;
  var waLines=['דוח שבועי - '+new Date().toLocaleDateString('he-IL'),'','ביצוע ממוצע: '+avgAch+'%','עצירות ממוצע ליום: '+avgStop+' min'];
  if(bestDay) waLines.push('יום הכי טוב: '+bestDay+' ('+bestPct+'%)');
  if(worstDay) waLines.push('יום הכי חלש: '+worstDay+' ('+worstPct+'%)');
  if(worstLine) waLines.push('נתיב בעייתי: '+worstLine);
  window._weeklyReportText=waLines.join('\n');
  // Material delay analysis
  if(materialRequests.length>0){
    var matAll=materialRequests.filter(function(r){return r.status==='arrived'||r.status==='delayed';});
    if(matAll.length){
      html+='<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:12px">';
      html+='<div style="font-size:12px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">דוח הזמנות חומר</div>';
      var matAvgArr=matAll.filter(function(r){return r.status==='arrived'&&r.durationMin!==null;});
      var matAvgMin=matAvgArr.length?Math.round(matAvgArr.reduce(function(s,r){return s+r.durationMin;},0)/matAvgArr.length):null;
      var matDel=matAll.filter(function(r){return r.status==='delayed';});
      html+='<div class="sgrid2" style="margin-bottom:8px">';
      html+='<div class="sbox"><div class="sbox-v" style="font-size:18px">'+matAll.length+'</div><div class="sbox-l">סה"כ הזמנות</div></div>';
      html+='<div class="sbox"><div class="sbox-v" style="font-size:18px;color:'+(matDel.length>0?'var(--red)':'var(--green)')+'">'+matDel.length+'</div><div class="sbox-l">עיכובים</div></div>';
      html+='</div>';
      if(matAvgMin!==null) html+='<div style="font-size:12px;color:var(--dim);margin-bottom:8px">ממוצע זמן הגעה: <strong>'+matAvgMin+' דקות</strong></div>';
      // Top delayed SKUs
      var skuCount={};
      matAll.forEach(function(r){skuCount[r.sku]=(skuCount[r.sku]||0)+1;});
      var topSku=Object.entries(skuCount).sort(function(a,b){return b[1]-a[1];}).slice(0,3);
      if(topSku.length){
        html+='<div style="font-size:11px;font-weight:700;color:var(--dim);margin-bottom:6px">מק"טים מובילים</div>';
        topSku.forEach(function(e){html+='<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px solid var(--border)"><span style="font-family:var(--mono)">'+e[0]+'</span><span style="color:var(--dim)">'+e[1]+'x</span></div>';});
      }
      // Delay reasons
      var delReasons={};matDel.forEach(function(r){delReasons[r.delayReason]=(delReasons[r.delayReason]||0)+1;});
      var topReasons2=Object.entries(delReasons).sort(function(a,b){return b[1]-a[1];});
      if(topReasons2.length){
        html+='<div style="font-size:11px;font-weight:700;color:var(--dim);margin:8px 0 6px">סיבות עיכוב</div>';
        topReasons2.forEach(function(e){html+='<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px solid var(--border)"><span>'+e[0]+'</span><span style="color:var(--red)">'+e[1]+'x</span></div>';});
      }
      html+='</div>';
    }
  }
  html+='<button onclick="window.open(\'https://wa.me/?text=\'+encodeURIComponent(window._weeklyReportText||\'\'),(\'_blank\'))" style="width:100%;margin-top:10px;padding:11px;background:linear-gradient(135deg,#16a34a,#22c55e);border:none;border-radius:10px;color:#fff;font-size:13px;font-weight:700;cursor:pointer">שתף דוח שבועי ב-WhatsApp</button>';
  document.getElementById('weekly-content').innerHTML=html;
}

// ALERTS
function runAlerts(){
  LINES.forEach(function(l){
    var c=calcLine(l.id);
    var reps=reports[l.id]||[];
    if(reps.length>=2){
      var last2=reps.slice(-2);
      if(last2.every(function(r){var ct=Math.round((c.target/shiftHours())*elapsed());return ct>0&&(r.done/ct*100)<85;}))
        pushAlert('r',l.name+': בעיכוב שני עדכון ברצף');
    }
    if(c.achPct!==null&&c.achPct<80) pushAlert('r',l.name+': פער ביצוע '+(100-c.achPct)+'% - מתחת ל-80%');
    if(c.last&&c.last.reason) pushAlert('y',l.name+': '+c.last.reason);
    var rr=redRows[l.id];
    if(rr&&rr.rows>0){
      var openR=rr.rows-((redClosed[l.id]||{}).rows||0);
      if(openR>0) pushAlert('r',l.name+': '+openR+' שורות אדומות פתוחות');
      else pushAlert('g',l.name+': שורות אדומות נוקו');
    }
  });
  updateAlertBdg();
}
function pushAlert(type,text){
  alertsLog.unshift({type:type,text:text,time:nowTime()});
  if(alertsLog.length>50) alertsLog.pop();
  updateAlertBdg();
  if(document.getElementById('page-alerts').classList.contains('active')) renderAlerts();
}
function updateAlertBdg(){
  var n=alertsLog.filter(function(a){return a.type==='r';}).length;
  var b=document.getElementById('alert-bdg');
  b.style.display=n>0?'flex':'none';b.textContent=n>9?'9+':n;
}
function renderAlerts(){
  var el2=document.getElementById('alerts-list');
  el2.innerHTML=alertsLog.length?alertsLog.map(function(a){
    return '<div class="al-item '+a.type+'"><span class="al-dot"></span><span class="al-txt">'+a.text+'</span><span class="al-time">'+a.time+'</span></div>';
  }).join(''):'<div class="empty">אין התראות</div>';
}

// PIN
function requireMgr(cb){
  if(isManager){cb();return;}
  pinCb=cb;
  document.getElementById('pin-modal').classList.add('open');
  document.getElementById('pin-in').value='';
  document.getElementById('pin-err').style.display='none';
  setTimeout(function(){document.getElementById('pin-in').focus();},100);
}
function checkPin(){
  if(document.getElementById('pin-in').value===PIN){
    isManager=true;closePinModal();if(pinCb){pinCb();pinCb=null;}
  } else {document.getElementById('pin-err').style.display='block';document.getElementById('pin-in').value='';}
}
function closePinModal(){document.getElementById('pin-modal').classList.remove('open');pinCb=null;}

// TOAST
function showT(msg,type){
  type=type||'g';
  var t=document.getElementById('toast');
  t.textContent=msg;
  t.style.borderColor=type==='r'?'var(--red)':type==='y'?'var(--yellow)':'var(--green)';
  t.style.color=type==='r'?'var(--red)':type==='y'?'var(--yellow)':'var(--green)';
  t.classList.add('show');
  setTimeout(function(){t.classList.remove('show');},2300);
}



function buildHourlyMarkers(calc){
  if(!calc.combined||!calc.target) return '';
  var sh=shiftHours();
  var totalHours=Math.floor(sh);
  var html='';
  for(var h=1;h<=totalHours;h++){
    // Position on bar = cumulative target at hour h / total combined
    var cumAtHour=Math.round((calc.combined/sh)*h);
    var pct=Math.min(Math.round(cumAtHour/calc.combined*100),99);
    var isCurrent=(h===Math.floor(elapsed()));
    var color=isCurrent?'rgba(59,130,246,.9)':'rgba(255,255,255,.3)';
    var height=isCurrent?'100%':'60%';
    var top=isCurrent?'0':'20%';
    html+='<div style="position:absolute;top:'+top+';height:'+height+';width:1px;background:'+color+';left:'+pct+'%"></div>';
    // Show label: the cumulative target number (480, 960, 1440...)
    if(pct>4&&pct<96){
      html+='<div style="position:absolute;top:8px;font-size:9px;font-weight:'+(isCurrent?'700':'600')+';color:'+(isCurrent?'var(--blue)':'var(--dim)')+
        ';font-family:var(--mono);transform:translateX(-50%);left:'+pct+'%;white-space:nowrap">'+cumAtHour+'</div>';
    }
  }
  return html;
}



// ============================================================
// MATERIALS SYSTEM
// ============================================================
function saveMaterials(){
  store.setItem('ops_materials',JSON.stringify(materialRequests));
  updateMatBdg();
  var rows=[{key:'materials',value:JSON.stringify(materialRequests),updated_at:new Date().toISOString()}];
  sbFetch('ops_data',{method:'POST',prefer:'resolution=merge-duplicates',body:JSON.stringify(rows)}).catch(function(){});
}
function updateMatBdg(){
  var n=materialRequests.filter(function(r){return r.status==='pending'||r.status==='inProgress';}).length;
  var b=document.getElementById('mat-bdg');
  if(b){b.style.display=n>0?'flex':'none';b.textContent=n;}
}
function startMatTimer(){
  if(typeof matTimerInterval!=='undefined') clearInterval(matTimerInterval);
  matTimerInterval=setInterval(function(){
    var pg=document.getElementById('page-mat');
    if(pg&&pg.classList.contains('active')) renderMaterials();
  },30000);
}
var matTimerInterval=null;
function checkMaterialAlerts(){
  var now=Date.now();
  materialRequests.filter(function(r){return r.status==='pending';}).forEach(function(r){
    var w=Math.round((now-r.createdTs)/60000);
    if(w>5) pushAlert('y','\u05d1\u05e7\u05e9\u05ea \u05d7\u05d5\u05de\u05e8 \u05de\u05de\u05ea\u05d9\u05e0\u05d4 '+w+' \u05d3\u05e7\u05d5\u05ea: '+r.sku+' ('+r.lineName+')');
  });
  materialRequests.filter(function(r){return r.status==='inProgress';}).forEach(function(r){
    var w=Math.round((now-r.startTs)/60000);
    if(w>20) pushAlert('r','\u05d4\u05d6\u05de\u05e0\u05ea \u05d7\u05d5\u05de\u05e8 \u05d1\u05d8\u05d9\u05e4\u05d5\u05dc '+w+' \u05d3\u05e7\u05d5\u05ea: '+r.sku+' ('+r.lineName+')');
  });
}
function submitMaterialRequest(){
  var lineId=document.getElementById('mat-line').value;
  var sku=document.getElementById('mat-sku').value.trim();
  var qty=parseInt(document.getElementById('mat-qty').value)||0;
  var note=document.getElementById('mat-note').value.trim();
  if(!sku){showT('\u05d4\u05d6\u05df \u05de\u05e7"\u05d8','y');return;}
  if(!qty){showT('\u05d4\u05d6\u05df \u05db\u05de\u05d5\u05ea','y');return;}
  var line=LINES.filter(function(l){return l.id===lineId;})[0];
  var req={id:'M'+Date.now(),lineId:lineId,lineName:line?line.name:'',sku:sku,qty:qty,note:note,
    status:'pending',createdAt:nowTime(),createdTs:Date.now(),startTs:null,startTime:null,
    arrivalTs:null,arrivalTime:null,durationMin:null,delayReason:null};
  materialRequests.unshift(req);
  saveSku(sku);saveMaterials();
  document.getElementById('mat-sku').value='';
  document.getElementById('mat-qty').value='';
  document.getElementById('mat-note').value='';
  pushAlert('b','\u05d1\u05e7\u05e9\u05ea \u05d7\u05d5\u05de\u05e8: '+(line?line.name:'')+' - '+sku+' x'+qty);
  showT('\u05d1\u05e7\u05e9\u05d4 \u05e0\u05e9\u05dc\u05d7\u05d4!');
  renderMaterials();
}
function startMaterial(id){
  var r=materialRequests.filter(function(x){return x.id===id;})[0];
  if(!r) return;
  r.status='inProgress';r.startTs=Date.now();r.startTime=nowTime();
  saveMaterials();renderMaterials();showT('\u05d8\u05d9\u05e4\u05d5\u05dc \u05d4\u05ea\u05d7\u05d9\u05dc \u2014 \u05d8\u05d9\u05d9\u05de\u05e8 \u05e4\u05d5\u05e2\u05dc');
}
function arrivedMaterial(id){
  var r=materialRequests.filter(function(x){return x.id===id;})[0];
  if(!r) return;
  r.status=r.hasDelay?'delayed':'arrived';
  r.arrivalTs=Date.now();r.arrivalTime=nowTime();
  if(r.startTs) r.durationMin=Math.round((r.arrivalTs-r.startTs)/60000);
  saveMaterials();renderMaterials();
  pushAlert('g','\u05d7\u05d5\u05de\u05e8 \u05d4\u05d2\u05d9\u05e2: '+r.sku+' ('+r.durationMin+' min)'+(r.hasDelay?' \u2014 \u05e2\u05dd \u05e2\u05d9\u05db\u05d5\u05d1\u05d9\u05dd':''));
  showT('\u05d7\u05d5\u05de\u05e8 \u05d4\u05d2\u05d9\u05e2! '+r.durationMin+' \u05d3\u05e7\u05d5\u05ea');
}
function delayMaterial(id){
  document.getElementById('delay-modal-id').value=id;
  document.getElementById('delay-reason-select').value='';
  document.getElementById('delay-modal').classList.add('open');
}
function saveDelayReason(){
  var id=document.getElementById('delay-modal-id').value;
  var reason=document.getElementById('delay-reason-select').value;
  if(!reason){showT('\u05d1\u05d7\u05e8 \u05e1\u05d9\u05d1\u05ea \u05e2\u05d9\u05db\u05d5\u05d1','y');return;}
  var r=materialRequests.filter(function(x){return x.id===id;})[0];
  if(!r) return;
  if(!r.delayReasons) r.delayReasons=[];
  r.delayReasons.push({reason:reason,time:nowTime()});
  r.hasDelay=true;
  saveMaterials();
  document.getElementById('delay-modal').classList.remove('open');
  renderMaterials();
  pushAlert('r','\u05e2\u05d9\u05db\u05d5\u05d1 \u05d7\u05d5\u05de\u05e8: '+r.sku+' - '+reason);
  showT('\u05e2\u05d9\u05db\u05d5\u05d1 \u05e0\u05e8\u05e9\u05dd \u2014 \u05d8\u05d9\u05d9\u05de\u05e8 \u05de\u05de\u05e9\u05d9\u05da','y');
}
function deleteMaterial(id){
  materialRequests=materialRequests.filter(function(x){return x.id!==id;});
  saveMaterials();renderMaterials();showT('\u05e0\u05de\u05d7\u05e7','y');
}
function noStockMaterial(i){
  var req=materialRequests[i];
  if(!req) return;
  req.status='nostock';req.endTs=Date.now();
  saveMaterials();renderMaterials();showT('\u05e1\u05d5\u05de\u05df \u05d0\u05d9\u05df \u05de\u05dc\u05d0\u05d9');
}
function renderMaterials(){
  var el=document.getElementById('mat-list');
  if(!el) return;
  if(!materialRequests.length){el.innerHTML='<div class="empty">\u05d0\u05d9\u05df \u05d1\u05e7\u05e9\u05d5\u05ea \u05d7\u05d5\u05de\u05e8 \u05e4\u05e2\u05d9\u05dc\u05d5\u05ea</div>';return;}
  var pending=materialRequests.filter(function(r){return r.status==='pending';});
  var active=materialRequests.filter(function(r){return r.status==='inProgress';});
  var searchTerm=((document.getElementById('mat-search')||{}).value||'').toLowerCase();
  var done=materialRequests.filter(function(r){return (r.status==='arrived'||r.status==='delayed')&&(!searchTerm||(r.sku||'').toLowerCase().includes(searchTerm)||(r.lineName||'').toLowerCase().includes(searchTerm));});
  var html='';
  if(active.length){
    html+='<div style="font-size:10px;font-weight:700;color:var(--blue);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">\u05d1\u05d8\u05d9\u05e4\u05d5\u05dc</div>';
    active.forEach(function(r){
      var el2=r.startTs?Math.round((Date.now()-r.startTs)/60000):0;
      var tc=el2>20?'var(--red)':el2>10?'var(--yellow)':'var(--blue)';
      var delayDot=r.hasDelay?'<span style="width:8px;height:8px;border-radius:50%;background:var(--red);display:inline-block;margin-right:4px"></span>':'';
      html+='<div style="background:var(--blue-bg);border:1px solid rgba(37,99,235,.25);border-radius:10px;padding:12px;margin-bottom:8px">';
      html+='<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">';
      html+='<div><span style="font-size:13px;font-weight:700">'+r.sku+'</span> <span style="font-size:11px;color:var(--dim)">x'+r.qty+'</span>';
      html+='<div style="font-size:11px;color:var(--dim);margin-top:2px">'+r.lineName+(r.note?' | '+r.note:'')+'</div></div>';
      html+='<div style="text-align:left"><span style="font-size:18px;font-weight:800;font-family:var(--mono);color:'+tc+'">'+el2+'<span style="font-size:10px"> min</span></span>'+(r.hasDelay?'<div style="font-size:9px;color:var(--red);text-align:center">'+delayDot+'\u05e2\u05d9\u05db\u05d5\u05d1</div>':'')+'</div>';
      html+='</div>';
      html+='<div style="display:flex;gap:8px">';
      html+='<button data-mid="'+r.id+'" onclick="arrivedMaterial(this.dataset.mid)" style="flex:1;padding:8px;background:var(--green-bg);border:1px solid rgba(5,150,105,.3);border-radius:7px;color:var(--green);font-size:13px;font-weight:700;cursor:pointer">\u05d4\u05d2\u05d9\u05e2</button>';
      html+='<button data-mid="'+r.id+'" onclick="delayMaterial(this.dataset.mid)" style="flex:1;padding:8px;background:var(--red-bg);border:1px solid rgba(220,38,38,.3);border-radius:7px;color:var(--red);font-size:13px;font-weight:700;cursor:pointer">\u05e2\u05d9\u05db\u05d5\u05d1</button>';
      html+='</div></div>';
    });
  }
  if(pending.length){
    html+='<div style="font-size:10px;font-weight:700;color:var(--yellow);text-transform:uppercase;letter-spacing:1px;margin:10px 0 6px">\u05de\u05de\u05ea\u05d9\u05e0\u05d5\u05ea \u05dc\u05d8\u05d9\u05e4\u05d5\u05dc ('+pending.length+')</div>';
    pending.forEach(function(r){
      html+='<div style="background:var(--yellow-bg);border:1px solid rgba(217,119,6,.25);border-radius:10px;padding:11px 12px;margin-bottom:8px">';
      html+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
      html+='<div><span style="font-size:13px;font-weight:700">'+r.sku+'</span> <span style="font-size:11px;color:var(--dim)">x'+r.qty+'</span>';
      html+='<div style="font-size:11px;color:var(--dim);margin-top:2px">'+r.lineName+(r.note?' | '+r.note:'')+'</div></div>';
      html+='<button data-mid="'+r.id+'" onclick="deleteMaterial(this.dataset.mid)" style="font-size:11px;padding:2px 8px;background:var(--surface);border:1px solid var(--border);border-radius:5px;color:var(--faint);cursor:pointer">\u05de\u05d7\u05e7</button>';
      html+='</div>';
      html+='<button data-mid="'+r.id+'" onclick="startMaterial(this.dataset.mid)" style="width:100%;padding:9px;background:var(--blue-bg);border:1px solid rgba(37,99,235,.3);border-radius:8px;color:var(--blue);font-size:13px;font-weight:700;cursor:pointer">\u05d4\u05ea\u05d7\u05dc \u05d8\u05d9\u05e4\u05d5\u05dc</button>';
      html+='</div>';
    });
  }
  var allDone=materialRequests.filter(function(r){return r.status==='arrived'||r.status==='delayed';});
  if(allDone.length){
    var avgTime=allDone.filter(function(r){return r.durationMin!==null&&r.status==='arrived';});
    var avgMin=avgTime.length?Math.round(avgTime.reduce(function(s,r){return s+r.durationMin;},0)/avgTime.length):null;
    var delayCount=allDone.filter(function(r){return r.status==='delayed';}).length;
    html+='<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin:10px 0 8px">';
    html+='<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px">';
    html+='<div class="sbox"><div class="sbox-v" style="font-size:18px">'+allDone.length+'</div><div class="sbox-l">\u05e1\u05d4"\u05db \u05d4\u05d6\u05de\u05e0\u05d5\u05ea</div></div>';
    html+='<div class="sbox"><div class="sbox-v" style="font-size:18px;color:var(--green)">'+(avgMin!==null?avgMin:'\u2014')+'</div><div class="sbox-l">\u05de\u05de\u05d5\u05e6\u05e2 (min)</div></div>';
    html+='<div class="sbox"><div class="sbox-v" style="font-size:18px;color:'+(delayCount>0?'var(--red)':'var(--green)')+'">'+delayCount+'</div><div class="sbox-l">\u05e2\u05d9\u05db\u05d5\u05d1\u05d9\u05dd</div></div>';
    html+='</div>';
    html+='<input type="text" id="mat-search" placeholder="\u05d7\u05e4\u05e9..." oninput="renderMaterials()" style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:7px;padding:7px 10px;color:var(--text);font-size:12px">';
    html+='</div>';
    if(done.length){
      html+='<div style="font-size:10px;font-weight:700;color:var(--faint);text-transform:uppercase;letter-spacing:1px;margin:0 0 6px">\u05d4\u05d9\u05e1\u05d8\u05d5\u05e8\u05d9\u05d4 ('+done.length+')</div>';
      done.forEach(function(r){
        var isDelay=r.status==='delayed';
        var col=isDelay?'var(--red)':'var(--green)';
        var bg=isDelay?'var(--red-bg)':'var(--green-bg)';
        var bdr=isDelay?'rgba(220,38,38,.2)':'rgba(5,150,105,.2)';
        var reasons=(r.delayReasons||[]).map(function(d){return d.reason;}).join(', ')||r.delayReason||'';
        html+='<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;background:'+bg+';border:1px solid '+bdr+';border-radius:8px;margin-bottom:6px">';
        html+='<div><span style="font-size:12px;font-weight:600">'+r.sku+'</span> <span style="font-size:11px;color:var(--dim)">x'+r.qty+' | '+r.lineName+'</span>';
        if(isDelay&&reasons) html+='<div style="font-size:10px;color:var(--red);margin-top:1px">'+reasons+'</div>';
        html+='</div>';
        html+='<div style="text-align:left"><div style="font-size:13px;font-weight:700;font-family:var(--mono);color:'+col+'">'+(r.durationMin!==null?r.durationMin+' min':(isDelay?'\u05e2\u05d9\u05db\u05d5\u05d1':'\u05d4\u05d2\u05d9\u05e2'))+'</div><div style="font-size:9px;color:var(--faint)">'+(r.arrivalTime||'')+'</div></div></div>';
      });
    }
  }
  el.innerHTML=html;
}
function renderMatHistory(){
  var el=document.getElementById('mat-hist-content');
  if(!el) return;
  if(!materialRequests.length){el.innerHTML='<div class="empty">\u05d0\u05d9\u05df \u05d4\u05d9\u05e1\u05d8\u05d5\u05e8\u05d9\u05d4</div>';return;}
  var groups={};
  materialRequests.slice().sort(function(a,b){return (b.createdTs||0)-(a.createdTs||0);}).forEach(function(req){
    var d=new Date(req.createdTs||Date.now());
    var dk=d.toLocaleDateString('he-IL');
    if(!groups[dk]) groups[dk]=[];
    groups[dk].push(req);
  });
  var html='';
  Object.keys(groups).forEach(function(dk){
    html+='<div style="font-size:12px;font-weight:700;color:var(--dim);padding:6px 0;border-bottom:1px solid var(--border);margin-bottom:6px">\u05ea\u05d0\u05e8\u05d9\u05da: '+dk+'</div>';
    groups[dk].forEach(function(req){
      var statusLabel=req.status==='done'?'\u05d4\u05ea\u05e7\u05d1\u05dc':req.status==='nostock'?'\u05d0\u05d9\u05df \u05de\u05dc\u05d0\u05d9':req.status==='inProgress'?'\u05d1\u05d8\u05d9\u05e4\u05d5\u05dc':'\u05de\u05de\u05ea\u05d9\u05df';
      var statusCol=req.status==='done'?'var(--green)':req.status==='nostock'?'var(--red)':req.status==='inProgress'?'var(--yellow)':'var(--dim)';
      var dur=req.endTs&&req.createdTs?Math.round((req.endTs-req.createdTs)/60000)+'min':'';
      var d=new Date(req.createdTs||Date.now());
      var timeStr=pad(d.getHours())+':'+pad(d.getMinutes());
      html+='<div style="padding:8px 10px;background:var(--card);border:1px solid var(--border);border-radius:8px;margin-bottom:6px">';
      html+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">';
      html+='<span style="font-size:13px;font-weight:700;font-family:var(--mono)">'+(req.sku||'-')+'</span>';
      html+='<span style="font-size:11px;font-weight:700;color:'+statusCol+'">'+statusLabel+'</span>';
      html+='</div>';
      html+='<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--dim)">';
      html+='<span>'+(req.lineName||'')+' | '+req.qty+' \u05d9\u05d7</span>';
      html+='<span>'+timeStr+(dur?' | '+dur:'')+'</span>';
      html+='</div></div>';
    });
    html+='<div style="margin-bottom:10px"></div>';
  });
  el.innerHTML=html;
}

// ============================================================
// SKU MEMORY
// ============================================================
function getKnownSkus(){try{return JSON.parse(store.getItem('ops_skus')||'[]');}catch(e){return [];}}
function saveSku(sku){
  if(!sku) return;
  var skus=getKnownSkus();
  if(!skus.includes(sku)){skus.unshift(sku);if(skus.length>700)skus=skus.slice(0,700);store.setItem('ops_skus',JSON.stringify(skus));}
}
function selectSku(sku){var el=document.getElementById('mat-sku');if(el)el.value=sku;var box=document.getElementById('sku-suggestions');if(box)box.style.display='none';}
function deleteSku(sku){var skus=getKnownSkus().filter(function(s){return s!==sku;});store.setItem('ops_skus',JSON.stringify(skus));renderSkuManager();}
function clearAllSkus(){store.setItem('ops_skus','[]');renderSkuManager();showT('\u05e0\u05de\u05d7\u05e7\u05d5','y');}
function renderSkuManager(){
  var el=document.getElementById('sku-manager-list');if(!el) return;
  var skus=getKnownSkus();
  if(!skus.length){el.innerHTML='<div style="font-size:12px;color:var(--faint);text-align:center;padding:8px">\u05d0\u05d9\u05df \u05de\u05e7"\u05d8\u05d9\u05dd \u05e9\u05de\u05d5\u05e8\u05d9\u05dd</div>';return;}
  el.innerHTML='<div style="max-height:200px;overflow-y:auto">'+skus.map(function(s){
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border-bottom:1px solid var(--border);font-size:12px">'+
      '<span style="font-family:var(--mono)">'+s+'</span>'+
      '<button data-sku="'+s+'" onclick="deleteSku(this.dataset.sku)" style="font-size:10px;padding:1px 7px;background:var(--red-bg);border:1px solid rgba(220,38,38,.3);border-radius:4px;color:var(--red);cursor:pointer">\u05de\u05d7\u05e7</button>'+
    '</div>';
  }).join('')+'</div>'+
  '<button onclick="clearAllSkus()" style="width:100%;margin-top:8px;padding:7px;background:var(--red-bg);border:1px solid rgba(220,38,38,.3);border-radius:7px;color:var(--red);font-size:12px;font-weight:600;cursor:pointer">\u05de\u05d7\u05e7 \u05d4\u05db\u05dc</button>';
}

// ============================================================
// WORK PLAN
// ============================================================
var WP_LINE_MAP={
  '\u05e9\u05d5\u05dc\u05d7\u05df \u05dc\u05d9\u05e7\u05d5\u05d8 1':'pick',
  '\u05db\u05d1\u05dc\u05d9\u05dd':'cable',
  '\u05e9\u05d5\u05dc\u05d7\u05df 1 KIT':'kit',
  '\u05e0\u05ea\u05d9\u05d1 \u05e1\u05e4\u05e7\u05d9 \u05db\u05d7':'spk',
  "\u05e9\u05d5\u05dc\u05d7\u05df \u05d9\u05d7' \u05d4\u05e0\u05e2\u05d4":'drive'
};
var wpParsed=null;

function loadWorkPlan(event){
  var file=event.target.files[0];
  if(!file) return;
  var status=document.getElementById('wp-status');
  if(status){status.textContent='\u05e7\u05d5\u05e8\u05d0 \u05e7\u05d5\u05d1\u05e5...';status.style.color='var(--dim)';}
  var reader=new FileReader();
  reader.onload=function(e){
    try{
      var data=new Uint8Array(e.target.result);
      var wb=XLSX.read(data,{type:'array',cellDates:true});
      var ws=wb.Sheets[wb.SheetNames[0]];
      var rows=XLSX.utils.sheet_to_json(ws,{raw:false,dateNF:'yyyy-mm-dd'});
      parseWorkPlan(rows);
    }catch(err){
      if(status){status.textContent='\u05e9\u05d2\u05d9\u05d0\u05d4: '+err.message;status.style.color='var(--red)';}
    }
  };
  reader.readAsArrayBuffer(file);
}

function parseWorkPlan(rows){
  var today=new Date();today.setHours(0,0,0,0);
  var status=document.getElementById('wp-status');
  var totals={pick:{qty:0,orders:0,mins:0},kit:{qty:0,orders:0,mins:0},
    drive:{qty:0,orders:0,mins:0},spk:{qty:0,orders:0,mins:0},cable:{qty:0,orders:0,mins:0}};
  var redRowsData={pick:{rows:0,units:0},kit:{rows:0,units:0},drive:{rows:0,units:0},spk:{rows:0,units:0},cable:{rows:0,units:0}};
  var matched=0,skipped=0,skippedReasons={};
  orderRows={};
  rows.forEach(function(row){
    var lineName=row['\u05e7\u05d5']||'';
    var lineId=WP_LINE_MAP[lineName.trim()]||WP_LINE_MAP[lineName];
    if(!lineId){skipped++;var rn=row['\u05e7\u05d5']||'?';skippedReasons[rn]=(skippedReasons[rn]||0)+1;return;}
    var startStr=row['\u05ea.\u05d4\u05ea\u05d7\u05dc\u05ea \u05d9\u05d9\u05e6\u05d5\u05e8']||'';
    var qty=parseInt(row['\u05d9\u05ea\u05e8\u05d4 \u05dc\u05d0\u05e8\u05d9\u05d6\u05d4'])||0;
    var sku=row["\u05de\u05e7'\u05d8"]||"";
    var desc=row['\u05ea\u05d0\u05d5\u05e8 \u05de\u05d5\u05e6\u05e8']||'';
    var orderNum=row['\u05d4\u05d6\u05de\u05e0\u05d4']||'';
    var orderLine=row['\u05e9\u05d5\u05e8\u05d4']||'';
    var customer=row['\u05e9\u05dd \u05dc\u05e7\u05d5\u05d7']||'';
    var expiry=row["\u05e4\u05e7'\u05e2"]||"";
    var skuB=row["\u05d9\u05d7' \u05d4\u05e0\u05e2\u05d4 (\u05d1\u05df)"]||"";
    if(!qty){skipped++;skippedReasons['\u05db\u05de\u05d5\u05ea 0']=(skippedReasons['\u05db\u05de\u05d5\u05ea 0']||0)+1;return;}
    if(!startStr) return;
    var startDate=new Date(startStr);startDate.setHours(0,0,0,0);
    var endStr=row['\u05ea.\u05d9\u05e1\u05d5\u05dd \u05d9\u05d9\u05e6\u05d5\u05e8']||'';
    var endDate=endStr?new Date(endStr):startDate;endDate.setHours(0,0,0,0);
    if(endDate<today&&qty>0){redRowsData[lineId].rows++;redRowsData[lineId].units+=qty;}
    if(startDate.getTime()===today.getTime()||(endDate<today&&qty>0)){
      totals[lineId].qty+=qty;totals[lineId].orders++;matched++;
    }
    if(qty>0){
      var todayStr2=today.getFullYear()+'-'+('0'+(today.getMonth()+1)).slice(-2)+'-'+('0'+today.getDate()).slice(-2);
      var startNorm='';
      var s=String(startStr).trim();
      if(s.indexOf('T')>=0) startNorm=s.substring(0,10);
      else if(s.match(/^\d{4}-\d{2}-\d{2}/)) startNorm=s.substring(0,10);
      else if(s.match(/^\d{2}\/\d{2}\/\d{4}/)){var p=s.substring(0,10).split('/');startNorm=p[2]+'-'+p[1]+'-'+p[0];}
      else if(s.match(/^\d{1,2}\/\d{1,2}\/\d{4}/)){var p2=s.split(' ')[0].split('/');if(p2.length===3)startNorm=p2[2]+'-'+('0'+p2[1]).slice(-2)+'-'+('0'+p2[0]).slice(-2);}
      else if(s){var d=new Date(s);if(!isNaN(d))startNorm=d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);}
      var isRed=startNorm&&startNorm<todayStr2;
      if(!orderRows[lineId]) orderRows[lineId]=[];
      orderRows[lineId].push({sku:sku,desc:desc,qty:qty,done:0,status:'open',
        isRed:isRed,note:'',order:orderNum,orderLine:orderLine,
        customer:customer,expiry:expiry,skuB:skuB,startDate:startStr});
    }
    wpParsed=totals;wpParsed._redRows=redRowsData;
  });
  // Auto-fill targets if not set
  var hasTargets=LINES.some(function(l){return (targets[l.id]||0)>0;});
  if(!hasTargets){
    LINES.forEach(function(l){
      var total=totals[l.id]?totals[l.id].qty:0;
      if(total>0) targets[l.id]=total;
    });
  }
  var todayStr=today.toLocaleDateString('he-IL');
  var totalRed=Object.values(redRowsData).reduce(function(s,d){return s+d.rows;},0);
  var html='<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:8px">';
  html+='<div style="font-size:12px;font-weight:700;color:var(--blue);margin-bottom:10px">'+matched+' \u05d4\u05d6\u05de\u05e0\u05d5\u05ea \u05dc-'+todayStr+(totalRed>0?' | <span style="color:var(--red)">'+totalRed+' \u05e9\u05d5\u05e8\u05d5\u05ea \u05d0\u05d3\u05d5\u05de\u05d5\u05ea</span>':'')+'</div>';
  LINES.forEach(function(l){
    var d=totals[l.id],rr=redRowsData[l.id];
    if(d&&(d.qty>0||rr.rows>0)){
      html+='<div style="padding:8px 0;border-bottom:1px solid var(--border)">';
      html+='<span style="font-size:13px;font-weight:700">'+l.name+'</span> ';
      if(d.qty>0) html+='<span style="font-size:12px;font-family:var(--mono);color:var(--green)">'+d.qty+' \u05d9\u05d7</span> ';
      if(rr.rows>0) html+='<span style="font-size:10px;color:var(--red);background:var(--red-bg);padding:2px 6px;border-radius:4px">'+rr.rows+' \u05e9\u05d5\u05e8\u05d5\u05ea \u05d0\u05d3\u05d5\u05de\u05d5\u05ea</span>';
      html+='</div>';
    }
  });
  html+='</div>';
  var wpRes=document.getElementById('wp-results');
  var wpPrev=document.getElementById('wp-preview');
  if(wpRes) wpRes.innerHTML=html;
  if(wpPrev) wpPrev.style.display='block';
  var debugMsg=matched+' \u05e9\u05d5\u05e8\u05d5\u05ea \u05e0\u05d8\u05e2\u05e0\u05d5';
  if(skipped>0) debugMsg+=' | '+skipped+' \u05d4\u05d5\u05e9\u05de\u05d8\u05d5';
  if(status){status.textContent=debugMsg;status.style.color=skipped>0?'var(--yellow)':'var(--green)';}
  recalcRedRows();
  saveOrderRows();
  renderDash();
  renderLineRows();
}

function updateWpWorkers(el){
  var id=el.id.replace('wp-wk-','');
  DEFAULT_WORKERS[id]=parseInt(el.value)||1;
  saveState();
}

// ============================================================
// ORDER ROWS
// ============================================================
var orderRows={};
function loadOrderRows(){
  try{orderRows=JSON.parse(store.getItem('ops_order_rows')||'{}');}catch(e){orderRows={};}
  recalcRedRows();
}
function recalcRedRows(){
  var today=new Date();today.setHours(0,0,0,0);
  var todayStr=today.getFullYear()+'-'+('0'+(today.getMonth()+1)).slice(-2)+'-'+('0'+today.getDate()).slice(-2);
  Object.keys(orderRows).forEach(function(lineId){
    (orderRows[lineId]||[]).forEach(function(r){
      if(!r.startDate) return;
      var sd=String(r.startDate||'').trim();
      var norm='';
      if(sd.indexOf('T')>=0) norm=sd.substring(0,10);
      else if(sd.match(/^\d{4}-\d{2}-\d{2}/)) norm=sd.substring(0,10);
      else if(sd.match(/^\d{2}\/\d{2}\/\d{4}/)){var p=sd.substring(0,10).split('/');norm=p[2]+'-'+p[1]+'-'+p[0];}
      else if(sd.match(/^\d{1,2}\/\d{1,2}\/\d{4}/)){var p2=sd.split(' ')[0].split('/');if(p2.length===3)norm=p2[2]+'-'+('0'+p2[1]).slice(-2)+'-'+('0'+p2[0]).slice(-2);}
      else if(sd){var d=new Date(sd);if(!isNaN(d))norm=d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);}
      r.isRed=norm&&norm<todayStr;
    });
  });
}
function saveOrderRows(){
  store.setItem('ops_order_rows',JSON.stringify(orderRows));
  LINES.forEach(function(l){
    var rows=orderRows[l.id]||[];
    var totalDone=rows.reduce(function(s,r){return s+(r.done||0);},0);
    if(totalDone>0){
      if(!reports[l.id]) reports[l.id]=[];
      var existing=reports[l.id];
      var lastIdx=existing.map(function(r){return r.auto;}).lastIndexOf(true);
      var entry={done:totalDone,reason:'',time:nowTime(),auto:true};
      if(lastIdx>=0) existing[lastIdx]=entry;
      else existing.push(entry);
      reports[l.id]=existing;
    }
  });
  saveState();syncToServer();renderDash();
}
function markRowDone(lineId,rowIdx){
  var rows=orderRows[lineId]||[];if(!rows[rowIdx])return;
  rows[rowIdx].done=rows[rowIdx].qty;rows[rowIdx].status='done';rows[rowIdx].completedAt=nowTime();
  orderRows[lineId]=rows;saveOrderRows();
}
function markRowPartial(lineId,rowIdx){
  var inp=document.getElementById('partial-inp-'+lineId+'-'+rowIdx);
  if(!inp)return;var val=parseInt(inp.value)||0;
  if(val<=0){showT('\u05d4\u05d6\u05df \u05db\u05de\u05d5\u05ea','y');return;}
  var rows=orderRows[lineId]||[];if(!rows[rowIdx])return;
  rows[rowIdx].done=Math.min(val,rows[rowIdx].qty);
  rows[rowIdx].status=rows[rowIdx].done>=rows[rowIdx].qty?'done':'partial';
  rows[rowIdx].completedAt=nowTime();
  orderRows[lineId]=rows;saveOrderRows();
}
function undoRowMark(lineId,rowIdx){
  var rows=orderRows[lineId]||[];if(!rows[rowIdx])return;
  rows[rowIdx].done=0;rows[rowIdx].status='open';
  orderRows[lineId]=rows;saveOrderRows();
}
function addRowNote(lineId,rowIdx){
  var inp=document.getElementById('note-inp-'+lineId+'-'+rowIdx);
  if(!inp)return;
  var rows=orderRows[lineId]||[];if(!rows[rowIdx])return;
  rows[rowIdx].note=inp.value.trim();
  orderRows[lineId]=rows;saveOrderRows();renderOrderTracking();
  showT('\u05d4\u05e2\u05e8\u05d4 \u05e0\u05e9\u05de\u05e8\u05d4');
}
function togglePartialRow(btn){
  var row=btn.parentElement.nextElementSibling;
  if(row)row.style.display=row.style.display==='none'||!row.style.display?'flex':'none';
}
function searchOrderRows(){renderOrderTracking();}
function renderOrderTrackingSummary(){
  recalcRedRows();
  var el=document.getElementById('order-tracking');
  if(!el) return;
  var html='';var hasData=false;
  LINES.forEach(function(l){
    var rows=orderRows[l.id]||[];
    if(!rows.length) return;
    hasData=true;
    var done=rows.reduce(function(s,r){return s+(r.done||0);},0);
    var qty=rows.reduce(function(s,r){return s+(r.qty||0);},0);
    var pct=qty>0?Math.round(done/qty*100):0;
    var col=pct>=100?'var(--green)':pct>=60?'var(--blue)':'var(--yellow)';
    html+='<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;background:var(--card);border:1px solid var(--border);border-radius:8px;margin-bottom:6px">';
    html+='<span style="font-size:13px;font-weight:700">'+l.name+'</span>';
    html+='<span style="font-size:15px;font-weight:800;font-family:var(--mono);color:'+col+'">'+done+'/'+qty+'</span>';
    html+='</div>';
  });
  if(!hasData) html='<div class="empty">\u05d8\u05e2\u05df \u05ea\u05d5\u05db\u05e0\u05d9\u05ea \u05e2\u05d1\u05d5\u05d3\u05d4</div>';
  el.innerHTML=html;
}
function renderOrderTracking(){
  var el=document.getElementById('order-tracking');
  if(!el)return;
  var search=((document.getElementById('order-search')||{}).value||'').toLowerCase();
  var html='<input type="text" id="order-search" placeholder="\u05d7\u05e4\u05e9 \u05de\u05e7-\u05d8 \u05d0\u05d5 \u05ea\u05d9\u05d0\u05d5\u05e8..." oninput="searchOrderRows()" value="'+search+'" style="width:100%;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text);font-size:13px;margin-bottom:10px">';
  var hasData=false;
  LINES.forEach(function(l){
    var allRows=orderRows[l.id]||[];
    if(!allRows.length)return;
    var sorted=allRows.slice().sort(function(a,b){
      var ap=a.isRed?0:a.status==='open'?1:a.status==='partial'?2:3;
      var bp=b.isRed?0:b.status==='open'?1:b.status==='partial'?2:3;
      return ap-bp;
    });
    var rows=sorted.filter(function(r){return !search||(r.sku||'').toLowerCase().includes(search)||(r.desc||'').toLowerCase().includes(search);});
    if(!rows.length)return;
    hasData=true;
    var totalDone=allRows.reduce(function(s,r){return s+(r.done||0);},0);
    var totalQty=allRows.reduce(function(s,r){return s+(r.qty||0);},0);
    var pct=totalQty>0?Math.round(totalDone/totalQty*100):0;
    var barCol=pct>=100?'var(--green)':pct>=60?'var(--blue)':'var(--yellow)';
    html+='<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;margin-bottom:10px;overflow:hidden">';
    html+='<div style="padding:10px 14px;background:var(--surface);border-bottom:1px solid var(--border)">';
    html+='<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:14px;font-weight:700">'+l.name+'</span><span style="font-size:13px;font-weight:800;font-family:var(--mono);color:'+barCol+'">'+totalDone+'/'+totalQty+'</span></div>';
    html+='<div style="height:5px;background:var(--border);border-radius:3px;overflow:hidden"><div style="height:100%;background:'+barCol+';width:'+Math.min(pct,100)+'%"></div></div></div>';
    rows.forEach(function(r){
      var realIdx=allRows.indexOf(r);
      var isDone=r.status==='done',isPartial=r.status==='partial',isRed=r.isRed;
      var rowBg=isDone?'rgba(5,150,105,.04)':isPartial?'rgba(217,119,6,.04)':isRed?'rgba(220,38,38,.04)':'transparent';
      html+='<div style="padding:8px 14px;border-top:1px solid var(--border);background:'+rowBg+'">';
      html+='<div style="display:flex;justify-content:space-between;align-items:center">';
      html+='<span style="font-size:13px;font-weight:700;font-family:var(--mono)">'+(r.sku||'-')+'</span>';
      html+='<div style="display:flex;gap:6px">';
      if(isDone||isPartial){
        html+='<span style="font-size:13px;font-weight:700;font-family:var(--mono);color:'+(isDone?'var(--green)':'var(--yellow)')+'">'+r.done+'/'+r.qty+'</span>';
        html+='<button data-lid="'+l.id+'" data-idx="'+realIdx+'" onclick="undoRowMark(this.dataset.lid,parseInt(this.dataset.idx))" style="font-size:10px;padding:2px 7px;background:var(--surface);border:1px solid var(--border);border-radius:5px;color:var(--faint);cursor:pointer">\u05d1\u05d8\u05dc</button>';
      } else {
        html+='<span style="font-size:12px;color:var(--dim);font-family:var(--mono)">'+r.qty+'</span>';
        html+='<button data-lid="'+l.id+'" data-idx="'+realIdx+'" onclick="markRowDone(this.dataset.lid,parseInt(this.dataset.idx));renderOrderTracking()" style="padding:4px 12px;background:var(--green);border:none;border-radius:7px;color:#fff;cursor:pointer;font-weight:700">&#10003;</button>';
      }
      html+='</div></div></div>';
    });
    html+='</div>';
  });
  if(!hasData) html+='<div class="empty">\u05d8\u05e2\u05df \u05ea\u05d5\u05db\u05e0\u05d9\u05ea \u05e2\u05d1\u05d5\u05d3\u05d4</div>';
  el.innerHTML=html;
}
function exportLineRows(lineId){
  var rows=orderRows[lineId]||[];
  var line=LINES.filter(function(l){return l.id===lineId;})[0];
  if(!rows.length){showT('\u05d0\u05d9\u05df \u05e9\u05d5\u05e8\u05d5\u05ea','y');return;}
  var csv='\ufeff';
  csv+='SKU,desc,qty_plan,qty_done,status,note\n';
  rows.forEach(function(r){
    var status=r.status==='done'?'done':r.status==='partial'?'partial':'open';
    var row=[r.sku||'',r.desc||'',r.qty||0,r.done||0,status,r.note||''];
    csv+=row.map(function(v){return '"'+String(v).replace(/"/g,'""')+'"';}).join(',')+'\n';
  });
  var blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  var a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=(line?line.name:'export')+'_'+new Date().toLocaleDateString('he-IL').replace(/\//g,'-')+'.csv';
  a.click();
  showT('\u05d9\u05d9\u05e6\u05d5\u05d0 \u05d1\u05d5\u05e6\u05e2!');
}

// ============================================================
// LINE ROWS TAB
// ============================================================
var currentLine='pick';
function openLineDetail(lineId){
  var sec=document.getElementById('line-detail-section');
  if(sec){sec.style.display='block';sec.scrollIntoView({behavior:'smooth',block:'start'});}
  currentLine=lineId;
  ['pick','kit','drive','spk','cable'].forEach(function(id){
    var btn=document.getElementById('lt-'+id);
    if(btn) btn.classList.toggle('lt-active',id===lineId);
  });
  renderLineRows();
}
function selectLine(lineId){
  currentLine=lineId;
  ['pick','kit','drive','spk','cable'].forEach(function(id){
    var btn=document.getElementById('lt-'+id);
    if(btn) btn.classList.toggle('lt-active',id===lineId);
  });
  renderLineRows();
}
function renderLineRows(){
  recalcRedRows();
  var el=document.getElementById('lt-rows');
  var prog=document.getElementById('lt-progress');
  var title=document.getElementById('lt-title');
  if(!el) return;
  var line=LINES.filter(function(l){return l.id===currentLine;})[0];
  if(title) title.textContent=line?line.name:'';
  var rows=orderRows[currentLine]||[];
  var search=((document.getElementById('lt-search')||{}).value||'').toLowerCase();
  if(!rows.length){el.innerHTML='<div class="empty">טען תוכנית עבודה</div>';if(prog)prog.textContent='-';return;}
  var sorted=rows.slice().sort(function(a,b){
    var ap=a.isRed&&a.status!=='done'?0:a.status==='open'?1:a.status==='partial'?2:3;
    var bp=b.isRed&&b.status!=='done'?0:b.status==='open'?1:b.status==='partial'?2:3;
    if(ap!==bp) return ap-bp;
    var sm=window._ltSortMode||'default';
    var av=sm==='sku'?(a.sku||''):sm==='order'?(a.order||''):sm==='skuB'?(a.skuB||''):'';
    var bv=sm==='sku'?(b.sku||''):sm==='order'?(b.order||''):sm==='skuB'?(b.skuB||''):'';
    return av.localeCompare(bv);
  });
  var filtered=search?sorted.filter(function(r){
    return (r.sku||'').toLowerCase().includes(search)||
           (r.order||'').toLowerCase().includes(search)||
           (r.customer||'').toLowerCase().includes(search)||
           (r.desc||'').toLowerCase().includes(search);
  }):sorted;
  var totalDone=rows.reduce(function(s,r){return s+(r.done||0);},0);
  var totalQty=rows.reduce(function(s,r){return s+(r.qty||0);},0);
  var pct=totalQty>0?Math.round(totalDone/totalQty*100):0;
  if(prog) prog.textContent=totalDone+'/'+totalQty+' ('+pct+'%)';
  var showExpiry=['pick','kit','drive','spk'].indexOf(currentLine)>=0;
  var showSkuB=['pick','cable','drive','spk'].indexOf(currentLine)>=0;
  var sortMode=window._ltSortMode||'default';
  var html='';
  html+='<div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">';
  var sorts=[['default','\u05d0\u05d3\u05d5\u05de\u05d5\u05ea \u05e8\u05d0\u05e9\u05d5\u05e0\u05d5\u05ea'],['sku','\u05de\u05e7"\u05d8'],['order','\u05d4\u05d6\u05de\u05e0\u05d4'],['skuB','\u05de\u05e7"\u05d8 \u05d1\u05df']];
  sorts.forEach(function(s){
    var active=sortMode===s[0];
    html+='<button onclick="window._ltSortMode=\''+s[0]+'\';renderLineRows()" style="font-size:11px;padding:4px 10px;border-radius:16px;border:1px solid '+(active?'var(--blue)':'var(--border)')+';background:'+(active?'var(--blue)':'var(--surface)')+';color:'+(active?'#fff':'var(--dim)')+';cursor:pointer">'+(active?'&#10003; ':'')+s[1]+'</button>';
  });
  html+='</div>';
  html+='<input type="search" id="lt-search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="\u05d7\u05e4\u05e9 \u05d4\u05d6\u05de\u05e0\u05d4 / \u05de\u05e7-\u05d8 / \u05dc\u05e7\u05d5\u05d7..." oninput="renderLineRows()" value="'+search+'" style="width:100%;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px 12px;color:var(--text);font-size:13px;margin-bottom:8px">';
  filtered.forEach(function(r){
    var realIdx=rows.indexOf(r);
    var isDone=r.status==='done';
    var isPartial=r.status==='partial';
    var isRed=r.isRed&&!isDone;
    // Colors per design
    var bg=isDone?'#F0FDF4':isPartial?'#FFF8F0':isRed?'#FFF0F0':'#ffffff';
    var border=isRed?'1.5px solid rgba(239,68,68,0.4)':isPartial?'1.5px solid rgba(234,88,12,0.4)':isDone?'1.5px solid rgba(34,197,94,0.35)':'1px solid #E2E8F0';
    var orderCol=isRed?'#DC2626':isPartial?'#EA580C':isDone?'#16A34A':'#334155';
    var skuBorder=isRed?'rgba(239,68,68,0.25)':isPartial?'rgba(234,88,12,0.25)':isDone?'rgba(34,197,94,0.25)':'#E2E8F0';
    var skuLabel=isRed?'#DC2626':isPartial?'#EA580C':isDone?'#16A34A':'#64748B';
    var skuBg=isDone||isRed||isPartial?'#fff':'#F8FAFC';
    html+='<div style="background:'+bg+';border:'+border+';border-radius:12px;padding:12px 14px;margin-bottom:8px">';
    html+='<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">';
    // Left
    html+='<div style="flex:1;min-width:0">';
    if(r.customer) html+='<div style="font-size:16px;font-weight:800;color:#0F172A;margin-bottom:3px">'+r.customer+'</div>';
    if(r.order) html+='<div style="font-size:14px;font-weight:600;color:'+orderCol+'">'+r.order+'<span style="font-size:11px;font-weight:400;color:#64748B"> / \u05e9\u05d5\u05e8\u05d4 '+(r.orderLine||'')+'</span></div>';
    if(r.desc) html+='<div style="font-size:14px;font-weight:600;color:#334155;margin-top:2px">'+r.desc+'</div>';
    html+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">';
    if(r.sku){
      html+='<div style="background:'+skuBg+';border:1px solid '+skuBorder+';border-radius:6px;padding:3px 8px">';
      html+='<div style="font-size:9px;color:'+skuLabel+';font-weight:700">\u05de\u05e7"\u05d8</div>';
      html+='<div style="font-size:13px;font-weight:700;font-family:var(--mono);color:#1E293B">'+r.sku+'</div>';
      html+='</div>';
    }
    if(showSkuB&&r.skuB){
      html+='<div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:6px;padding:3px 8px">';
      html+='<div style="font-size:9px;color:#1D4ED8;font-weight:700">\u05de\u05e7"\u05d8 \u05d1\u05df</div>';
      html+='<div style="font-size:13px;font-weight:700;font-family:var(--mono);color:#1E40AF">'+r.skuB+'</div>';
      html+='</div>';
    }
    html+='</div></div>';
    // Right
    html+='<div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0">';
    if(showExpiry&&r.expiry){
      var expBg=isRed||isPartial?'#fff':'#F8FAFC';
      var expBorder=isRed?'rgba(239,68,68,0.5)':isPartial?'rgba(234,88,12,0.4)':'#E2E8F0';
      var expCol=isRed?'#DC2626':isPartial?'#EA580C':'#334155';
      var expLabelCol=isRed?'#DC2626':isPartial?'#EA580C':'#64748B';
      html+='<div style="background:'+expBg+';border:1.5px solid '+expBorder+';border-radius:8px;padding:5px 12px;text-align:center">';
      html+='<div style="font-size:9px;color:'+expLabelCol+';font-weight:700">\u05e4\u05e7"\u05e2</div>';
      html+='<div style="font-size:16px;font-weight:900;font-family:var(--mono);color:'+expCol+'">'+r.expiry+'</div>';
      if(isRed) html+='<div style="font-size:10px;color:#DC2626;font-weight:600">⚠ \u05e2\u05d1\u05e8</div>';
      html+='</div>';
    }
    if(isDone){
      html+='<div style="font-size:22px;font-weight:800;font-family:var(--mono);color:#16A34A">'+r.done+'</div>';
      html+='<div style="background:#fff;border:1px solid rgba(34,197,94,0.3);border-radius:6px;padding:3px 10px;font-size:10px;color:#16A34A;font-weight:700">\u05d4\u05d5\u05e9\u05dc\u05dd \u05d1-'+(r.completedAt||'')+'</div>';
      html+='<button data-lid="'+currentLine+'" data-idx="'+realIdx+'" onclick="undoRowMark(this.dataset.lid,parseInt(this.dataset.idx));renderLineRows()" style="font-size:11px;padding:3px 12px;background:#fff;border:1px solid rgba(34,197,94,0.3);border-radius:6px;color:#16A34A;cursor:pointer">\u05d1\u05d8\u05dc</button>';
    } else if(isPartial){
      html+='<div style="text-align:left"><span style="font-size:22px;font-weight:800;font-family:var(--mono);color:#EA580C">'+r.done+'</span><span style="font-size:13px;color:#64748B">/'+r.qty+'</span></div>';
      html+='<div style="font-size:10px;color:#64748B">\u05d9\u05d7 \u05dc\u05d0\u05e8\u05d9\u05d6\u05d4</div>';
      if(r.completedAt) html+='<div style="background:#fff;border:1px solid rgba(234,88,12,0.3);border-radius:6px;padding:3px 10px;font-size:10px;color:#EA580C;font-weight:700">\u05e2\u05d5\u05d3\u05db\u05df \u05d1-'+r.completedAt+'</div>';
      html+='<button data-lid="'+currentLine+'" data-idx="'+realIdx+'" onclick="undoRowMark(this.dataset.lid,parseInt(this.dataset.idx));renderLineRows()" style="font-size:11px;padding:3px 12px;background:#fff;border:1px solid rgba(234,88,12,0.3);border-radius:6px;color:#EA580C;cursor:pointer">\u05d1\u05d8\u05dc</button>';
    } else {
      html+='<div style="text-align:left"><div style="font-size:22px;font-weight:800;font-family:var(--mono);color:#0F172A">'+r.qty+'</div><div style="font-size:10px;color:#64748B">\u05d9\u05d7 \u05dc\u05d0\u05e8\u05d9\u05d6\u05d4</div></div>';
      html+='<div style="display:flex;gap:5px">';
      html+='<button data-partial="lt-pinput-'+realIdx+'" onclick="var p=document.getElementById(this.dataset.partial);if(p)p.style.display=p.style.display===\'flex\'?\'none\':\'flex\'" style="width:34px;height:34px;background:#F5C4B3;color:#993C1D;border:0.5px solid #F0997B;border-radius:8px;font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center">~</button>';
      html+='<button data-lid="'+currentLine+'" data-idx="'+realIdx+'" onclick="markRowDone(this.dataset.lid,parseInt(this.dataset.idx));renderLineRows()" style="width:34px;height:34px;background:#C0DD97;color:#3B6D11;border:0.5px solid #97C459;border-radius:8px;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center">&#10003;</button>';
      html+='</div>';
    }
    html+='</div></div>';
    // Delay reason for red rows
    if(isRed){
      if(r.delayReason){
        html+='<div style="background:#fff;border:1px solid rgba(34,197,94,0.2);border-radius:6px;padding:6px 10px;margin-top:6px;display:flex;justify-content:space-between;align-items:center">';
        html+='<span style="font-size:11px;font-weight:700;color:#16A34A">\u05e1\u05d9\u05d1\u05d4: '+r.delayReason+'</span>';
        html+='<button data-lid="'+currentLine+'" data-idx="'+realIdx+'" onclick="toggleRedRowReason(this.dataset.lid,parseInt(this.dataset.idx))" style="font-size:10px;padding:1px 8px;background:var(--surface);border:1px solid var(--border);border-radius:5px;color:var(--dim);cursor:pointer">\u05e2\u05d3\u05db\u05df</button>';
        html+='</div>';
      } else {
        html+='<button data-lid="'+currentLine+'" data-idx="'+realIdx+'" onclick="toggleRedRowReason(this.dataset.lid,parseInt(this.dataset.idx))" style="width:100%;font-size:11px;padding:5px;background:#FEF9C3;border:1px solid rgba(234,179,8,.4);border-radius:6px;color:#854D0E;cursor:pointer;font-weight:600;margin-top:6px">+ \u05d4\u05d5\u05e1\u05e3 \u05e1\u05d9\u05d1\u05d4 \u05dc\u05e2\u05d9\u05db\u05d5\u05d1</button>';
      }
      html+='<div id="rr-reason-'+currentLine+'-'+realIdx+'" style="display:none;background:#FFFBEB;border:1px solid rgba(234,179,8,.3);border-radius:8px;padding:10px 12px;margin-top:6px">';
      html+='<select id="rr-sel-'+currentLine+'-'+realIdx+'" style="width:100%;background:var(--surface);border:1px solid var(--border);border-radius:7px;padding:6px 10px;color:var(--text);font-size:13px;margin-bottom:6px">';
      delayReasons.forEach(function(opt){html+='<option value="'+opt+'"'+(r.delayReason===opt?' selected':'')+'>'+opt+'</option>';});
      html+='<option value="\u05d0\u05d7\u05e8"'+(r.delayReason==='\u05d0\u05d7\u05e8'?' selected':'')+'>אחר</option></select>';
      html+='<div style="display:flex;gap:6px">';
      html+='<button data-lid="'+currentLine+'" data-idx="'+realIdx+'" onclick="saveRedRowReason(this.dataset.lid,parseInt(this.dataset.idx))" style="flex:1;padding:7px;background:var(--green);border:none;border-radius:7px;color:#fff;font-size:13px;font-weight:700;cursor:pointer">\u05e9\u05de\u05d5\u05e8</button>';
      html+='<button data-lid="'+currentLine+'" data-idx="'+realIdx+'" onclick="toggleRedRowReason(this.dataset.lid,parseInt(this.dataset.idx))" style="padding:7px 12px;background:var(--surface);border:1px solid var(--border);border-radius:7px;color:var(--dim);font-size:13px;cursor:pointer">\u05d1\u05d9\u05d8\u05d5\u05dc</button>';
      html+='</div></div>';
    }
    // Partial input
    if(!isDone&&!isPartial){
      html+='<div id="lt-pinput-'+realIdx+'" style="display:none;align-items:center;gap:8px;margin-top:8px">';
      html+='<input type="number" inputmode="numeric" id="lt-partial-'+realIdx+'" placeholder="\u05db\u05de\u05d4?" min="1" max="'+r.qty+'" style="flex:1;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:7px 12px;color:var(--text);font-size:18px;font-family:var(--mono);text-align:center">';
      html+='<button data-lid="'+currentLine+'" data-idx="'+realIdx+'" onclick="markLtPartial(this.dataset.lid,parseInt(this.dataset.idx))" style="padding:7px 16px;background:var(--yellow);border:none;border-radius:8px;color:#fff;font-size:14px;font-weight:700;cursor:pointer">\u05e9\u05de\u05d5\u05e8</button>';
      html+='</div>';
    }
    html+='</div>';
  });
  var searchEl=document.getElementById('lt-search');
  var cursorPos=searchEl?searchEl.selectionStart:0;
  var searchVal=searchEl?searchEl.value:'';
  el.innerHTML=html;
  var newSearch=document.getElementById('lt-search');
  if(newSearch&&searchVal){newSearch.focus();newSearch.setSelectionRange(cursorPos,cursorPos);}
}


function showMatSkuSuggestions(){
  var lineEl=document.getElementById('mat-line');
  var lineId=lineEl?lineEl.value:'';
  renderCatalogSuggestions('mat-sku', lineId);
}

function applyWorkPlan(){
  if(!wpParsed) return;
  var applied=0,rrd=wpParsed._redRows||{};
  LINES.forEach(function(l){
    var d=wpParsed[l.id];
    if(d&&d.qty>0){targets[l.id]=d.qty;applied++;}
    var r=rrd[l.id];
    if(r&&r.rows>0) redRows[l.id]={rows:r.rows,units:r.units};
  });
  saveState();syncToServer();buildMorningForms();renderDash();
  showT(applied+' נתיבים עודכנו!');
  pushAlert('g','תוכנית עבודה נטענה - '+applied+' נתיבים');
}

function changeShift(type){
  currentShiftType=type;
  store.setItem('ops_shift_type',type);
  var sh=SHIFT_TYPES[type];
  var pill=document.getElementById('shift-pill');
  if(pill) pill.textContent=sh.times+' - '+sh.hours+'sh ('+sh.brk+'m)';
  renderDash();
  showT('משמרת שונתה ל'+sh.label);
}

function confirmDeleteSpecific(){
  document.getElementById('del-specific-modal').classList.add('open');
  renderDeleteOptions();
}

function confirmResetDay(){
  var today=new Date().toDateString();
  saveToHist(today);clearDay();clearServerDay();
  buildMorningForms();buildHourlyForms();renderDash();updateStopBdg();
  showT('משמרת אופסה!');
  pushAlert('g','איפוס יום בוצע');
  var fb=document.getElementById('fb-reset');var fa=document.getElementById('fa-reset');
  if(fb)fb.classList.remove('open');if(fa)fa.innerHTML='&#9654;';
}

function deleteLineReports(lid){
  reports[lid]=[];saveState();syncToServer();renderDash();renderDeleteOptions();showT('נמחקו','y');
}

function deleteOneReport(btn){
  var lid=btn.dataset.lid,idx=parseInt(btn.dataset.idx);
  if(reports[lid]) reports[lid].splice(idx,1);
  saveState();syncToServer();renderDash();renderDeleteOptions();showT('נמחק','y');
}

function deleteOneStop(btn){
  var idx=parseInt(btn.dataset.idx);
  stoppages.splice(idx,1);
  saveState();syncToServer();updateStopBdg();renderDeleteOptions();showT('נמחקה','y');
}

function exportRedRowsExcel(){
  var all=[];
  LINES.forEach(function(l){
    (orderRows[l.id]||[]).forEach(function(r){
      if(r.isRed&&r.status!=='done'){
        all.push({'קו':l.name,'הזמנה':r.order||'','שורה':r.orderLine||'','מק"ט':r.sku||'','תאור':r.desc||'','לקוח':r.customer||'','כמות':r.qty||0,'פק"ע':r.expiry||'','מק"ט בן':r.skuB||''});
      }
    });
  });
  if(!all.length){showT('אין שורות אדומות','y');return;}
  var ws=XLSX.utils.json_to_sheet(all);
  var wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'שורות אדומות');
  XLSX.writeFile(wb,'שורות_אדומות_'+new Date().toLocaleDateString('he-IL').replace(/\//g,'-')+'.xlsx');
  showT('ייצוא בוצע!');
}

function loadSkuCatalog(){
  var p1=typeof SKU_CATALOG_1!=='undefined'&&Array.isArray(SKU_CATALOG_1)?SKU_CATALOG_1:[];
  var p2=typeof SKU_CATALOG_2!=='undefined'&&Array.isArray(SKU_CATALOG_2)?SKU_CATALOG_2:[];
  skuCatalog=p1.concat(p2);
  if(skuCatalog.length){loadCatalogEdits();console.log('SKU catalog loaded:',skuCatalog.length,'items');}
  else{setTimeout(function(){
    var p1b=typeof SKU_CATALOG_1!=='undefined'&&Array.isArray(SKU_CATALOG_1)?SKU_CATALOG_1:[];
    var p2b=typeof SKU_CATALOG_2!=='undefined'&&Array.isArray(SKU_CATALOG_2)?SKU_CATALOG_2:[];
    skuCatalog=p1b.concat(p2b);
    if(skuCatalog.length){loadCatalogEdits();renderCatalogStats();}
  },1000);}
}

function manualSaveHistory(){
  saveToHist(new Date().toDateString());
  showT('היום נשמר להיסטוריה!');
  pushAlert('g','יום נוכחי נשמר להיסטוריה');
}

function npKey(k){
  var d=document.getElementById('np-display');
  if(!d) return;
  var v=d.textContent;
  if(k==='del'){d.textContent=v.slice(0,-1)||'';return;}
  if(k==='clr'){d.textContent='';return;}
  if(v.length>=5) return;
  d.textContent=v+k;
}

function npSave(){
  var lineId=document.getElementById('np-lid').value;
  var val=document.getElementById('np-display').textContent;
  var done=parseInt(val);
  var reason=document.getElementById('np-reason').value;
  if(!val||isNaN(done)){showT('הזן כמות','y');return;}
  if(!reports[lineId]) reports[lineId]=[];
  reports[lineId].push({done:done,reason:reason,time:nowTime()});
  saveState();syncToServer();runAlerts();renderDash();
  document.getElementById('np-modal').classList.remove('open');
  showT('עדכון נשמר!');
}

function npEdit(){
  var lineId=document.getElementById('np-lid').value;
  var reps=reports[lineId]||[];
  if(!reps.length){showT('אין עדכון לעריכה','y');return;}
  var last=reps[reps.length-1];
  document.getElementById('np-display').textContent=String(last.done);
  document.getElementById('np-reason').value=last.reason||'';
  reps.pop();reports[lineId]=reps;
  showT('ערוך ושמור מחדש','y');
}

function quickUpdate(lineId){
  var line=LINES.filter(function(l){return l.id===lineId;})[0];
  if(!line) return;
  var calc=calcLine(lineId);
  document.getElementById('np-title').textContent=line.name;
  document.getElementById('np-lid').value=lineId;
  document.getElementById('np-display').textContent=calc.done!==null?String(calc.done):'';
  document.getElementById('np-target').textContent='יעד: '+(calc.combined||'-')+' | תכנון: '+(calc.combCum||'-');
  document.getElementById('np-reason').value='';
  document.getElementById('np-modal').classList.add('open');
}

function showSkuSuggestions(){
  var val=((document.getElementById('mat-sku')||{}).value||'').trim().toLowerCase();
  var box=document.getElementById('sku-suggestions');
  if(!box) return;
  if(!val){box.style.display='none';return;}
  var matches=getKnownSkus().filter(function(s){return s.toLowerCase().includes(val);}).slice(0,6);
  if(!matches.length){box.style.display='none';return;}
  box.innerHTML=matches.map(function(s){return '<div onclick="selectSku(this.textContent)" style="padding:8px 12px;cursor:pointer;font-family:var(--mono);font-size:13px;border-bottom:1px solid var(--border)">'+s+'</div>';}).join('');
  box.style.display='block';
}

function toggleManualTargets(){
  var folder=document.getElementById('f-morning');
  var arr=document.getElementById('manual-arr');
  if(!folder) return;
  var isHidden=folder.style.display==='none';
  folder.style.display=isHidden?'block':'none';
  if(arr) arr.innerHTML=isHidden?'&#9660;':'&#9654;';
  if(isHidden) buildMorningForms();
}

function toggleTV(){
  var el=document.getElementById('tv-overlay');
  if(!el) return;
  var on=el.style.display==='none'||el.style.display==='';
  el.style.display=on?'block':'none';
  if(on){renderTV();if(typeof tvInterval!=='undefined')clearInterval(tvInterval);tvInterval=setInterval(renderTV,30000);}
  else{if(typeof tvInterval!=='undefined')clearInterval(tvInterval);}
}

function renderDeleteOptions(){
  var el=document.getElementById('del-options');
  if(!el) return;
  var html='';
  LINES.forEach(function(l){
    var reps=reports[l.id]||[];
    if(reps.length){
      html+='<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:6px">';
      html+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">';
      html+='<span style="font-size:13px;font-weight:600">'+l.name+'</span>';
      html+='<button data-lid="'+l.id+'" onclick="deleteLineReports(this.dataset.lid)" style="font-size:11px;padding:2px 8px;background:var(--red-bg);border:1px solid rgba(220,38,38,.3);border-radius:5px;color:var(--red);cursor:pointer">מחק הכל</button>';
      html+='</div>';
      reps.forEach(function(r,i){
        html+='<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--dim);padding:3px 0">';
        html+='<span>'+r.time+' — '+r.done+' יח</span>';
        html+='<button data-lid="'+l.id+'" data-idx="'+i+'" onclick="deleteOneReport(this)" style="font-size:10px;padding:1px 6px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--faint);cursor:pointer">X</button>';
        html+='</div>';
      });
      html+='</div>';
    }
  });
  if(stoppages.length){
    html+='<div style="font-size:11px;font-weight:700;color:var(--dim);margin:8px 0;text-transform:uppercase">עצירות</div>';
    html+='<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px 10px">';
    stoppages.forEach(function(s,i){
      html+='<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--dim);padding:3px 0">';
      html+='<span>'+s.lineName+' | '+s.reason+'</span>';
      html+='<button data-idx="'+i+'" onclick="deleteOneStop(this)" style="font-size:10px;padding:1px 6px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--faint);cursor:pointer">X</button>';
      html+='</div>';
    });
    html+='</div>';
  }
  el.innerHTML=html||'<div class="empty" style="padding:16px">אין נתונים</div>';
}

function isFriday(){return new Date().getDay()===5;}

function renderFridayMode(){var el=document.getElementById('lines-list');if(!el)return;el.innerHTML='<div class="empty">יום שישי</div>';}

function renderRedRowsManager(){
  var el=document.getElementById('mgr-red-rows');
  if(!el) return;
  var all=[];
  LINES.forEach(function(l){
    (orderRows[l.id]||[]).forEach(function(r){
      if(r.isRed&&r.status!=='done') all.push({line:l,row:r});
    });
  });
  if(!all.length){
    var hasRows=Object.keys(orderRows).some(function(k){return (orderRows[k]||[]).length>0;});
    el.innerHTML=hasRows?'<div class="empty">אין שורות אדומות פתוחות</div>':'<div class="empty">טען תוכנית עבודה תחילה</div>';
    return;
  }
  var byLine={};
  all.forEach(function(item){var lid=item.line.id;if(!byLine[lid])byLine[lid]={line:item.line,rows:[]};byLine[lid].rows.push(item);});
  var html='<div style="font-size:13px;font-weight:700;color:var(--red);margin-bottom:10px">'+all.length+' שורות אדומות פתוחות</div>';
  Object.values(byLine).forEach(function(group){
    var gid='rrmg-'+group.line.id;
    html+='<div style="margin-bottom:8px">';
    html+='<div data-gid="'+gid+'" onclick="toggleRRGroup(this.dataset.gid)" style="display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:700;color:var(--text);padding:8px 12px;background:var(--red-bg);border-radius:8px;border:1px solid rgba(220,38,38,.2);cursor:pointer;margin-bottom:0">';
    html+='<span>'+group.line.name+' — '+group.rows.length+' שורות</span>';
    html+='<span id="arr-'+gid+'">▶</span></div>';
    html+='<div id="'+gid+'" style="display:none">';
    group.rows.forEach(function(item){
      var r=item.row;
      html+='<div style="padding:10px 12px;background:var(--card);border:1px solid var(--border);border-top:none">';
      if(r.order) html+='<div style="font-size:13px;font-weight:700;color:var(--red)">'+r.order+(r.orderLine?' / '+r.orderLine:'')+'</div>';
      if(r.desc) html+='<div style="font-size:12px;color:var(--text)">'+r.desc+'</div>';
      if(r.sku) html+='<div style="font-size:11px;font-family:var(--mono);color:var(--dim)">'+r.sku+'</div>';
      if(r.customer) html+='<div style="font-size:11px;color:var(--dim)">'+r.customer+'</div>';
      html+='<div style="font-size:11px;color:var(--red)">'+r.qty+' יח'+(r.expiry?' | פק"ע '+r.expiry+' ⚠':'')+'</div>';
      html+='</div>';
    });
    html+='</div></div>';
  });
  el.innerHTML=html;
}

function renderLineETAs(){
  var el=document.getElementById('eta-content');
  if(!el) return;
  var shiftH=shiftHours(),elapsedH=elapsed(),shiftLeft=Math.max(0.1,shiftH-elapsedH);
  var html='<div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin-bottom:10px">';
  html+='<div style="font-size:12px;font-weight:700;color:var(--dim);margin-bottom:8px">כוח אדם לחישוב</div>';
  html+='<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px">';
  LINES.forEach(function(l){
    var w=DEFAULT_WORKERS[l.id]||1;
    html+='<div style="text-align:center"><div style="font-size:11px;color:var(--dim);margin-bottom:3px">'+l.name+'</div>';
    html+='<input type="number" min="1" max="20" value="'+w+'" data-lid="'+l.id+'" onchange="DEFAULT_WORKERS[this.dataset.lid]=parseInt(this.value)||1;saveState();renderLineETAs()" style="width:100%;text-align:center;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:4px;font-size:16px;font-weight:700;font-family:var(--mono);color:var(--text)">';
    html+='</div>';
  });
  html+='</div></div>';
  var hasData=false;
  LINES.forEach(function(l){
    var rows=orderRows[l.id]||[];
    var openRows=rows.filter(function(r){return r.status!=='done';});
    if(!rows.length) return;
    hasData=true;
    var workers=DEFAULT_WORKERS[l.id]||1;
    var totalSeconds=0,unknownQty=0,totalQty=0,coveredQty=0;
    openRows.forEach(function(r){
      var remaining=(r.qty||0)-(r.done||0);if(remaining<=0) return;
      totalQty+=remaining;
      var cat=skuLookup(r.sku);
      if(cat&&cat.duration>0){totalSeconds+=cat.duration*remaining;coveredQty+=remaining;}
      else unknownQty+=remaining;
    });
    var totalHours=totalSeconds/3600;
    var adjustedHours=totalHours/Math.max(1,workers);
    var onTime=adjustedHours<=shiftLeft;
    var col=onTime?'var(--green)':'var(--red)';
    var statusLabel=onTime?'יסיים בזמן':'חריגה: +'+(adjustedHours-shiftLeft).toFixed(1)+' שע';
    html+='<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:8px">';
    html+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><span style="font-size:14px;font-weight:700">'+l.name+'</span><span style="font-size:11px;padding:3px 10px;background:'+(onTime?'var(--green-bg)':'var(--red-bg)')+';color:'+col+';border-radius:8px;font-weight:700">'+statusLabel+'</span></div>';
    html+='<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">';
    html+='<div style="text-align:center;background:var(--surface);border-radius:7px;padding:7px"><div style="font-size:20px;font-weight:800;font-family:var(--mono);color:var(--blue)">'+totalHours.toFixed(1)+'</div><div style="font-size:10px;color:var(--dim)">שעות TT</div></div>';
    html+='<div style="text-align:center;background:var(--surface);border-radius:7px;padding:7px"><div style="font-size:20px;font-weight:800;font-family:var(--mono);color:'+col+'">'+adjustedHours.toFixed(1)+'</div><div style="font-size:10px;color:var(--dim)">'+workers+' עובדים</div></div>';
    html+='<div style="text-align:center;background:var(--surface);border-radius:7px;padding:7px"><div style="font-size:20px;font-weight:800;font-family:var(--mono);color:var(--faint)">'+shiftLeft.toFixed(1)+'</div><div style="font-size:10px;color:var(--dim)">שעות שנותרו</div></div>';
    html+='</div>';
    if(unknownQty>0) html+='<div style="font-size:10px;color:var(--yellow);margin-top:6px">'+unknownQty+' יח ללא TT בקטלוג</div>';
    html+='</div>';
  });
  if(!hasData) html+='<div class="empty">טען תוכנית עבודה תחילה</div>';
  el.innerHTML=html;
}

// ============================================================
// CATALOG FUNCTIONS
// ============================================================
function saveCatalogEdits(){
  try{return JSON.parse(store.getItem('ops_catalog_edits')||'[]');}catch(e){return [];}
}
function loadCatalogEdits(){
  var edits=saveCatalogEdits();
  edits.forEach(function(item){
    skuCatalog=skuCatalog.filter(function(e){return e.sku.toUpperCase()!==item.sku.toUpperCase();});
    skuCatalog.push(item);
  });
}
function removeCatalogEdit(idx){
  var edits=saveCatalogEdits();
  var removed=edits.splice(idx,1)[0];
  store.setItem('ops_catalog_edits',JSON.stringify(edits));
  if(removed) skuCatalog=skuCatalog.filter(function(e){return e.sku!==removed.sku;});
  showT('נמחק');
  renderCatalogManager();
}
function renderCatalogStats(){
  var el=document.getElementById('catalog-stats');
  if(!el) return;
  if(!skuCatalog.length){el.innerHTML='<div class="empty">טען קטלוג מק"ט</div>';return;}
  var byLine={pick:0,drive:0,kit:0,cable:0,spk:0,other:0};
  skuCatalog.forEach(function(item){byLine[item.lineId||'other']++;});
  var LINE_NAMES={pick:'ליקוט',drive:'יחידות הנעה',kit:'ערכות',cable:'כבלים',spk:'ספקי כוח',other:'אחר'};
  var html='<div style="font-size:12px;font-weight:700;color:var(--dim);margin-bottom:8px">'+skuCatalog.length+' מק"טים בקטלוג</div>';
  html+='<div style="display:flex;flex-wrap:wrap;gap:6px">';
  Object.keys(byLine).forEach(function(k){
    if(!byLine[k]) return;
    html+='<div style="font-size:11px;padding:3px 10px;background:var(--blue-bg);color:var(--blue);border-radius:12px;border:1px solid rgba(37,99,235,.2)">'+LINE_NAMES[k]+': '+byLine[k]+'</div>';
  });
  html+='</div>';
  el.innerHTML=html;
}
function renderCatalogManager(){
  var el=document.getElementById('catalog-manager');
  if(!el) return;
  var edits=saveCatalogEdits();
  var LINE_NAMES={pick:'ליקוט',drive:'יחידות הנעה',kit:'ערכות',cable:'כבלים',spk:'ספקי כוח'};
  var html='<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">';
  html+='<input type="text" id="cat-sku" placeholder="מק"ט" autocomplete="off" style="background:var(--surface);border:1px solid var(--border);border-radius:7px;padding:7px 10px;color:var(--text);font-size:13px;font-family:var(--mono)">';
  html+='<select id="cat-line" style="background:var(--surface);border:1px solid var(--border);border-radius:7px;padding:7px 10px;color:var(--text);font-size:13px">';
  html+='<option value="">בחר נתיב</option>';
  Object.entries(LINE_NAMES).forEach(function(e){html+='<option value="'+e[0]+'">'+e[1]+'</option>';});
  html+='</select>';
  html+='<input type="text" id="cat-desc" placeholder="תיאור" autocomplete="off" style="background:var(--surface);border:1px solid var(--border);border-radius:7px;padding:7px 10px;color:var(--text);font-size:13px">';
  html+='<input type="number" id="cat-dur" placeholder="זמן (שניות)" style="background:var(--surface);border:1px solid var(--border);border-radius:7px;padding:7px 10px;color:var(--text);font-size:13px">';
  html+='</div>';
  html+='<button onclick="addCatalogItem()" style="width:100%;padding:8px;background:var(--blue);border:none;border-radius:8px;color:#fff;font-size:13px;font-weight:700;cursor:pointer">שמור מק"ט</button>';
  if(edits.length){
    html+='<div style="font-size:12px;font-weight:700;color:var(--dim);margin:10px 0 6px">מק"טים מותאמים ('+edits.length+')</div>';
    edits.forEach(function(item,i){
      html+='<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;background:var(--card);border:1px solid var(--border);border-radius:7px;margin-bottom:5px">';
      html+='<div><div style="font-size:13px;font-weight:700;font-family:var(--mono)">'+item.sku+'</div>';
      html+='<div style="font-size:11px;color:var(--dim)">'+(item.desc||'')+' | '+(LINE_NAMES[item.lineId]||'')+' | '+item.duration+' שנ</div></div>';
      html+='<button data-idx="'+i+'" onclick="removeCatalogEdit(parseInt(this.dataset.idx))" style="font-size:10px;padding:2px 8px;background:var(--red-bg);border:1px solid rgba(220,38,38,.3);border-radius:5px;color:var(--red);cursor:pointer">מחק</button>';
      html+='</div>';
    });
  }
  el.innerHTML=html;
}
function addCatalogItem(){
  var sku=(document.getElementById('cat-sku')||{}).value||'';
  var desc=(document.getElementById('cat-desc')||{}).value||'';
  var lineId=(document.getElementById('cat-line')||{}).value||'';
  var duration=parseFloat((document.getElementById('cat-dur')||{}).value)||0;
  if(!sku){showT('הזן מק"ט','y');return;}
  var edits=saveCatalogEdits();
  edits=edits.filter(function(e){return e.sku.toUpperCase()!==sku.toUpperCase();});
  edits.push({sku:sku.trim(),desc:desc.trim(),lineId:lineId,duration:duration,pkgQty:0});
  store.setItem('ops_catalog_edits',JSON.stringify(edits));
  skuCatalog=skuCatalog.filter(function(e){return e.sku.toUpperCase()!==sku.toUpperCase();});
  skuCatalog.push({sku:sku.trim(),desc:desc.trim(),lineId:lineId,duration:duration,pkgQty:0});
  showT('מק"ט נשמר!');
  renderCatalogManager();
  renderCatalogStats();
}

// ============================================================
// PALLET HISTORY
// ============================================================
function renderPalletHistory(){
  var el=document.getElementById('pallet-hist-content');
  if(!el) return;
  var hist=[];
  try{hist=JSON.parse(store.getItem('ops_pallet_history')||'[]');}catch(e){}
  if(!hist.length){el.innerHTML='<div class="empty">אין היסטוריית משטחים</div>';return;}
  var groups={};
  hist.forEach(function(p){
    var dk=p.closedDate||p.createdDate||'לא ידוע';
    if(!groups[dk]) groups[dk]=[];
    groups[dk].push(p);
  });
  var html='<div style="font-size:12px;font-weight:700;color:var(--dim);margin-bottom:8px">'+hist.length+' משטחים</div>';
  Object.keys(groups).forEach(function(dk){
    var dayP=groups[dk];
    var closed=dayP.filter(function(p){return p.closed;}).length;
    html+='<div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;color:var(--dim);padding:6px 0;border-bottom:1px solid var(--border);margin-bottom:6px">';
    html+='<span>'+dk+'</span><span style="color:var(--green)">נסגרו: '+closed+' / '+dayP.length+'</span></div>';
    dayP.forEach(function(p){
      var shipCol=p.shipType==='air'?'var(--blue)':'var(--green)';
      html+='<div style="padding:8px 10px;background:var(--card);border:1px solid var(--border);border-radius:8px;margin-bottom:5px">';
      html+='<div style="display:flex;justify-content:space-between;align-items:center">';
      html+='<div><span style="font-size:13px;font-weight:700;color:var(--blue)">'+(p.orderId||'-')+'</span>';
      if(p.customer) html+=' <span style="font-size:11px;color:var(--dim)">'+p.customer+'</span>';
      html+='</div>';
      html+='<div style="display:flex;gap:6px;align-items:center">';
      html+='<span style="font-size:10px;color:'+shipCol+'">'+(p.shipType==='air'?'✈ אוויר':'⛵ ים')+'</span>';
      if(p.closedAt) html+='<span style="font-size:10px;color:var(--dim)">נסגר: '+p.closedAt+'</span>';
      html+='</div></div>';
      var calc=calcPalletHeight(p);
      html+='<div style="font-size:11px;color:var(--dim);margin-top:2px">'+calc.tot+' קרטונים | '+calc.totalCm+' ס"מ</div>';
      html+='</div>';
    });
    html+='<div style="margin-bottom:10px"></div>';
  });
  el.innerHTML=html;
}

// ============================================================
// RED ROWS MANAGER - with per-line toggle
// ============================================================
function toggleRRGroup(gid){
  var el=document.getElementById(gid);
  var arr=document.getElementById('arr-'+gid);
  if(!el) return;
  var open=el.style.display!=='none';
  el.style.display=open?'none':'block';
  if(arr) arr.textContent=open?'▶':'▼';
}

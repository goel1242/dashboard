
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
function clearDay(){targets={};reports={};redRows={};redClosed={};stoppages=[];pallets=[];palletRequests=[];saveState();}
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
  sbFetch('ops_data?select=key,value').then(function(rows){
    var syncDot=document.getElementById('sync-dot');
    var syncSt=document.getElementById('sync-status');
    if(syncDot) syncDot.style.background='var(--green)';
    if(syncSt) syncSt.textContent='מסונכרן '+nowTime();
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
    if(map.order_rows){orderRows=JSON.parse(map.order_rows);recalcRedRows();}
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
  var shObj=SHIFT_TYPES[currentShiftType]||SHIFT_TYPES['regular'];
  document.getElementById('shift-pill').textContent=shObj.times+' - '+shObj.hours+'sh ('+shObj.brk+'m)';
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
  if(name==='lines') renderLineRows();
  if(name==='ordertracking') renderOrderTracking();
  if(name==='pack'){buildRequestForms();renderPallets();renderPackRequests();}
  if(name==='alerts') renderAlerts();
  if(name==='mat'){renderMaterials();startMatTimer();}
}

// FOLDER
function toggleF(name){
  var body=document.getElementById('fb-'+name);
  var arr=document.getElementById('fa-'+name);
  var isOpen=body.classList.contains('open');
  body.classList.toggle('open',!isOpen);
  arr.innerHTML=isOpen?'&#9654;':'&#9660;';
  if(!isOpen){
    if(name==='analysis') renderAnalysis();
    if(name==='productivity') renderProductivity();
    if(name==='workplan'){}
    if(name==='productivity') renderProductivity();
    if(name==='history') renderHistory();
    if(name==='weekly') genWeeklyReport();
    if(name==='reset'){}
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
            '<option>איכות</option><option>IT</option>'+
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
  if(sc!==null){
    sb.style.display='flex';
    document.getElementById('score-num').textContent=sc;
    document.getElementById('score-num').style.color=si.col;
    document.getElementById('score-lbl').textContent=si.lbl;
  } else sb.style.display='none';
  // Overall KPI
  var totalDoneAll=0,totalQtyAll=0;
  LINES.forEach(function(l){
    var rows=orderRows[l.id]||[];
    totalDoneAll+=rows.reduce(function(s,r){return s+(r.done||0);},0);
    totalQtyAll+=rows.reduce(function(s,r){return s+(r.qty||0);},0);
  });
  var overallPct=totalQtyAll>0?Math.round(totalDoneAll/totalQtyAll*100):0;
  var overallEl=document.getElementById('overall-progress');
  if(overallEl&&totalQtyAll>0){
    var oCol=overallPct>=100?'var(--green)':overallPct>=60?'var(--blue)':'var(--yellow)';
    overallEl.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'+
      '<span style="font-size:13px;font-weight:700">התקדמות כללית</span>'+
      '<span style="font-size:16px;font-weight:900;font-family:var(--mono);color:'+oCol+'">'+totalDoneAll+'/'+totalQtyAll+' יח ('+overallPct+'%)</span>'+
    '</div>'+
    '<div style="height:8px;background:var(--border);border-radius:4px;overflow:hidden">'+
    '<div style="height:100%;background:'+oCol+';width:'+Math.min(overallPct,100)+'%;transition:width .3s"></div></div>';
    overallEl.style.display='block';
  }
  var list=document.getElementById('lines-list');
  if(!calcs.some(function(c){return c.target>0;})){list.innerHTML='<div class="empty">הזן יעדי בוקר בטאב מנהל</div>';return;}
  list.innerHTML='<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px">'+
  calcs.map(function(c){
    var l=LINES.filter(function(x){return x.id===c.id;})[0];
    var rows=orderRows[c.id]||[];
    var rowDone=rows.reduce(function(s,r){return s+(r.done||0);},0);
    var rowQty=rows.reduce(function(s,r){return s+(r.qty||0);},0);
    var rowPct=rowQty>0?Math.round(rowDone/rowQty*100):0;
    var dotCol=c.statusIdx===0||c.statusIdx===1?'#1D9E75':c.statusIdx===2?'#BA7517':c.statusIdx===3?'#E24B4A':'var(--faint)';
    var numCol=c.statusIdx===0||c.statusIdx===1?'#1D9E75':c.statusIdx===2?'#BA7517':c.statusIdx===3?'#E24B4A':'var(--dim)';
    var redOpen=rows.filter(function(r){return r.isRed&&r.status!=='done';}).length;
    return '<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:10px 8px;cursor:pointer;text-align:center" onclick="openLineDetail(\''+c.id+'\')">'+
      '<div style="display:flex;align-items:center;justify-content:center;gap:5px;margin-bottom:7px">'+
        '<span style="width:7px;height:7px;border-radius:50%;background:'+dotCol+';flex-shrink:0;display:inline-block"></span>'+
        '<span style="font-size:12px;font-weight:700">'+l.name+'</span>'+
      '</div>'+
      '<div style="font-size:22px;font-weight:800;color:'+numCol+';line-height:1;font-family:var(--mono)">'+(c.done!==null?c.done:'-')+'</div>'+
      '<div style="font-size:10px;color:var(--dim);margin:2px 0 6px">מתוך '+(c.combined||'-')+'</div>'+
      '<div style="height:3px;background:var(--border);border-radius:2px;margin-bottom:5px;overflow:hidden">'+
        '<div style="height:100%;background:'+dotCol+';width:'+Math.min(c.combined>0&&c.done!==null?Math.round((c.done/c.combined)*100):0,100)+'%"></div>'+
      '</div>'+
      (redOpen>0?'<div style="font-size:10px;color:#E24B4A;margin-bottom:4px">'+redOpen+' אדומות</div>':'<div style="font-size:10px;color:var(--faint);margin-bottom:4px">'+(c.achPct!==null?c.achPct+'%':'תקין')+'</div>')+
      '<button data-lid="'+c.id+'" onclick="event.stopPropagation();quickUpdate(this.dataset.lid)" style="font-size:10px;padding:3px 0;width:100%;background:var(--blue-bg);border:1px solid rgba(37,99,235,.3);border-radius:6px;color:var(--blue);cursor:pointer;font-weight:700">עדכן</button>'+
    '</div>';
  }).join('')+'</div>';
}

// ANALYSIS
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
        '<button data-sid="'+s.id+'" onclick="closeStop(this.getAttribute(\'data-sid\'))" style="background:linear-gradient(135deg,#059669,#10b981);border:none;border-radius:7px;color:#fff;font-size:12px;font-weight:700;padding:6px 12px;cursor:pointer">סגור</button>'+
      '</div></div>';
  }).join('');
  var closed=stoppages.filter(function(s){return !s.open;});
  document.getElementById('stop-hist').innerHTML=stoppages.length?stoppages.map(function(s){
    return '<div class="stop-hist-row">'+
      '<div><span style="font-size:13px;font-weight:600">'+s.lineName+'</span> <span style="font-size:11px;color:var(--dim)">'+s.reason+'</span>'+
        '<div style="font-size:10px;color:var(--faint);font-family:var(--mono);margin-top:2px">'+s.startTime+(s.endTime?' > '+s.endTime:' > פעיל')+'</div>'+
      '</div>'+
      '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">'+
        '<span style="font-size:14px;font-weight:700;font-family:var(--mono);color:'+(s.open?'var(--red)':s.durationMin>20?'var(--yellow)':'var(--dim)')+'">'+
          (s.open?'LIVE':s.durationMin+"'")+
        '</span>'+
        '<button data-sid="'+s.id+'" onclick="requireMgr(function(){openEditStop(this.getAttribute(\'data-sid\'))}.bind(document.querySelector(\'[data-sid=\"'+s.id+'\"]\')))" style="font-size:10px;padding:2px 8px;background:var(--surface);border:1px solid var(--border);border-radius:5px;color:var(--dim);cursor:pointer">ערוך</button>'+
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
    html+='<div id="pnote-'+p.id+'" style="display:'+(p.special?'block':'none')+';margin-bottom:10px"><input type="text" data-pid="'+p.id+'" data-field="specialNote" value="'+(p.specialNote||'')+'" placeholder="פרט הנחיות..." oninput="palletField(this)" style="background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.3);border-radius:7px;padding:8px;color:var(--text);font-size:13px;width:100%"></div>';
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

function changeShift(type){
  currentShiftType=type;
  store.setItem('ops_shift_type',type);
  store.setItem('ops_shift_locked','1');
  var sh=SHIFT_TYPES[type];
  var pill=document.getElementById('shift-pill');
  if(pill) pill.textContent=sh.times+' - '+sh.hours+'sh ('+sh.brk+'m)';
  renderDash();
  showT('משמרת שונה ל'+sh.label);
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
  var now2=new Date();checkPendingUpdates(now2.getHours(),now2.getMinutes());
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
  reps.pop();
  reports[lineId]=reps;
  showT('ערוך ושמור מחדש','y');
}

function submitMaterialRequest(){
  var lineId=document.getElementById('mat-line').value;
  var sku=document.getElementById('mat-sku').value.trim();
  var qty=parseInt(document.getElementById('mat-qty').value)||0;
  var note=document.getElementById('mat-note').value.trim();
  if(!sku){showT('הזן מק"ט','y');return;}
  if(!qty){showT('הזן כמות','y');return;}
  var line=LINES.filter(function(l){return l.id===lineId;})[0];
  var req={id:'M'+Date.now(),lineId:lineId,lineName:line?line.name:'',sku:sku,qty:qty,note:note,
    status:'pending',createdAt:nowTime(),createdTs:Date.now(),startTs:null,startTime:null,
    arrivalTs:null,arrivalTime:null,durationMin:null,delayReason:null};
  materialRequests.unshift(req);
  saveSku(sku);saveMaterials();
  document.getElementById('mat-sku').value='';
  document.getElementById('mat-qty').value='';
  document.getElementById('mat-note').value='';
  pushAlert('b','בקשת חומר: '+(line?line.name:'')+' - '+sku+' x'+qty);
  showT('בקשה נשלחה!');
  renderMaterials();
}

function startMaterial(id){
  var r=materialRequests.filter(function(x){return x.id===id;})[0];
  if(!r) return;
  r.status='inProgress';r.startTs=Date.now();r.startTime=nowTime();
  saveMaterials();renderMaterials();showT('טיפול התחיל — טיימר פועל');
}

function arrivedMaterial(id){
  var r=materialRequests.filter(function(x){return x.id===id;})[0];
  if(!r) return;
  r.status=r.hasDelay?'delayed':'arrived';
  r.arrivalTs=Date.now();r.arrivalTime=nowTime();
  if(r.startTs) r.durationMin=Math.round((r.arrivalTs-r.startTs)/60000);
  saveMaterials();renderMaterials();
  pushAlert('g','חומר הגיע: '+r.sku+' ('+r.durationMin+' min)'+(r.hasDelay?' — עם עיכובים':''));
  showT('חומר הגיע! '+r.durationMin+' דקות');
}

function delayMaterial(id){
  document.getElementById('delay-modal-id').value=id;
  document.getElementById('delay-reason-select').value='';
  document.getElementById('delay-modal').classList.add('open');
}

function saveDelayReason(){
  var id=document.getElementById('delay-modal-id').value;
  var reason=document.getElementById('delay-reason-select').value;
  if(!reason){showT('בחר סיבת עיכוב','y');return;}
  var r=materialRequests.filter(function(x){return x.id===id;})[0];
  if(!r) return;
  if(!r.delayReasons) r.delayReasons=[];
  r.delayReasons.push({reason:reason,time:nowTime()});
  r.hasDelay=true;
  saveMaterials();
  document.getElementById('delay-modal').classList.remove('open');
  renderMaterials();
  pushAlert('r','עיכוב חומר: '+r.sku+' - '+reason);
  showT('עיכוב נרשם — טיימר ממשיך','y');
}

function deleteMaterial(id){
  materialRequests=materialRequests.filter(function(x){return x.id!==id;});
  saveMaterials();renderMaterials();showT('נמחק','y');
}

function renderMaterials(){
  var el=document.getElementById('mat-list');
  if(!el) return;
  if(!materialRequests.length){el.innerHTML='<div class="empty">אין בקשות חומר פעילות</div>';return;}
  var pending=materialRequests.filter(function(r){return r.status==='pending';});
  var active=materialRequests.filter(function(r){return r.status==='inProgress';});
  var searchTerm=((document.getElementById('mat-search')||{}).value||'').toLowerCase();
  var done=materialRequests.filter(function(r){return (r.status==='arrived'||r.status==='delayed')&&(!searchTerm||(r.sku||'').toLowerCase().includes(searchTerm)||(r.lineName||'').toLowerCase().includes(searchTerm)||(r.delayReason||'').toLowerCase().includes(searchTerm));});
  var html='';
  if(active.length){
    html+='<div style="font-size:10px;font-weight:700;color:var(--blue);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">בטיפול</div>';
    active.forEach(function(r){
      var elapsed2=r.startTs?Math.round((Date.now()-r.startTs)/60000):0;
      var tc=elapsed2>20?'var(--red)':elapsed2>10?'var(--yellow)':'var(--blue)';
      html+='<div style="background:var(--blue-bg);border:1px solid rgba(37,99,235,.25);border-radius:10px;padding:12px;margin-bottom:8px">';
      html+='<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">';
      html+='<div><span style="font-size:13px;font-weight:700">'+r.sku+'</span> <span style="font-size:11px;color:var(--dim)">x'+r.qty+'</span>';
      html+='<div style="font-size:11px;color:var(--dim);margin-top:2px">'+r.lineName+(r.note?' | '+r.note:'')+'</div></div>';
      var delayDot=r.hasDelay?'<span style="width:8px;height:8px;border-radius:50%;background:var(--red);display:inline-block;margin-right:4px"></span>':'';
      html+='<div style="text-align:left"><span style="font-size:18px;font-weight:800;font-family:var(--mono);color:'+tc+'">'+elapsed2+'<span style="font-size:10px"> min</span></span>'+(r.hasDelay?'<div style="font-size:9px;color:var(--red);text-align:center">'+delayDot+'עיכוב</div>':'')+'</div>';
      html+='</div>';
      html+='<div style="display:flex;gap:8px">';
      html+='<button data-mid="'+r.id+'" onclick="arrivedMaterial(this.dataset.mid)" style="flex:1;padding:8px;background:var(--green-bg);border:1px solid rgba(5,150,105,.3);border-radius:7px;color:var(--green);font-size:13px;font-weight:700;cursor:pointer">הגיע</button>';
      html+='<button data-mid="'+r.id+'" onclick="delayMaterial(this.dataset.mid)" style="flex:1;padding:8px;background:var(--red-bg);border:1px solid rgba(220,38,38,.3);border-radius:7px;color:var(--red);font-size:13px;font-weight:700;cursor:pointer">עיכוב</button>';
      html+='</div></div>';
    });
  }
  if(pending.length){
    html+='<div style="font-size:10px;font-weight:700;color:var(--yellow);text-transform:uppercase;letter-spacing:1px;margin:10px 0 6px">ממתינות לטיפול ('+pending.length+')</div>';
    pending.forEach(function(r){
      html+='<div style="background:var(--yellow-bg);border:1px solid rgba(217,119,6,.25);border-radius:10px;padding:11px 12px;margin-bottom:8px">';
      html+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
      html+='<div><span style="font-size:13px;font-weight:700">'+r.sku+'</span> <span style="font-size:11px;color:var(--dim)">x'+r.qty+'</span>';
      html+='<div style="font-size:11px;color:var(--dim);margin-top:2px">'+r.lineName+(r.note?' | '+r.note:'')+'</div></div>';
      html+='<button data-mid="'+r.id+'" onclick="deleteMaterial(this.dataset.mid)" style="font-size:11px;padding:2px 8px;background:var(--surface);border:1px solid var(--border);border-radius:5px;color:var(--faint);cursor:pointer">מחק</button>';
      html+='</div>';
      html+='<button data-mid="'+r.id+'" onclick="startMaterial(this.dataset.mid)" style="width:100%;padding:9px;background:var(--blue-bg);border:1px solid rgba(37,99,235,.3);border-radius:8px;color:var(--blue);font-size:13px;font-weight:700;cursor:pointer">התחל טיפול</button>';
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
    html+='<div class="sbox"><div class="sbox-v" style="font-size:18px">'+allDone.length+'</div><div class="sbox-l">סה"כ הזמנות</div></div>';
    html+='<div class="sbox"><div class="sbox-v" style="font-size:18px;color:var(--green)">'+(avgMin!==null?avgMin:'—')+'</div><div class="sbox-l">ממוצע (min)</div></div>';
    html+='<div class="sbox"><div class="sbox-v" style="font-size:18px;color:'+(delayCount>0?'var(--red)':'var(--green)')+'">'+delayCount+'</div><div class="sbox-l">עיכובים</div></div>';
    html+='</div>';
    html+='<input type="text" id="mat-search" placeholder="חפש..." oninput="renderMaterials()" style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:7px;padding:7px 10px;color:var(--text);font-size:12px">';
    html+='</div>';
    html+='<div style="font-size:10px;font-weight:700;color:var(--faint);text-transform:uppercase;letter-spacing:1px;margin:0 0 6px">היסטוריה ('+done.length+')</div>';
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
      html+='<div style="text-align:left"><div style="font-size:13px;font-weight:700;font-family:var(--mono);color:'+col+'">'+(r.durationMin!==null?r.durationMin+' min':(isDelay?'עיכוב':'הגיע'))+'</div><div style="font-size:9px;color:var(--faint)">'+(r.arrivalTime||'')+'</div></div></div>';
    });
  }
  el.innerHTML=html;
}

function applyWorkPlan(){
  if(!wpParsed) return;
  var applied=0;
  var rrd=wpParsed._redRows||{};
  LINES.forEach(function(l){
    var d=wpParsed[l.id];
    if(d&&d.qty>0){targets[l.id]=d.qty;applied++;}
    var r=rrd[l.id];
    if(r&&r.rows>0) redRows[l.id]={rows:r.rows,units:r.units};
  });
  saveState();syncToServer();
  buildMorningForms();renderDash();
  document.getElementById('fb-workplan').classList.remove('open');
  document.getElementById('fa-workplan').innerHTML='&#9654;';
  document.getElementById('fb-morning').classList.remove('open');
  document.getElementById('fa-morning').innerHTML='&#9654;';
  document.getElementById('fb-summary')&&document.getElementById('fb-summary').classList.add('open');
  document.getElementById('fa-summary')&&(document.getElementById('fa-summary').innerHTML='&#9660;');
  showT(applied+' נתיבים עודכנו אוטומטית!');
  pushAlert('g','תוכנית עבודה נטענה - '+applied+' נתיבים');
}

function manualSaveHistory(){
  var today=new Date().toDateString();
  saveToHist(today);
  showT('היום נשמר להיסטוריה!');
  pushAlert('g','יום נוכחי נשמר להיסטוריה');
}

function confirmResetDay(){
  var today=new Date().toDateString();
  saveToHist(today);clearDay();clearServerDay();
  buildMorningForms();buildHourlyForms();renderDash();updateStopBdg();
  showT('משמרת אופסה — מוכן ליום חדש!');
  pushAlert('g','איפוס יום בוצע');
  document.getElementById('fb-reset').classList.remove('open');
  document.getElementById('fa-reset').innerHTML='&#9654;';
}

function confirmDeleteSpecific(){
  document.getElementById('del-specific-modal').classList.add('open');
  renderDeleteOptions();
}

function renderDeleteOptions(){
  var el=document.getElementById('del-options');
  if(!el) return;
  var html='<div style="font-size:11px;font-weight:700;color:var(--dim);margin-bottom:8px;text-transform:uppercase">עדכונים שעתיים</div>';
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
        html+='<span>'+r.time+' — '+r.done+' יח'+(r.reason?' ('+r.reason+')':'')+'</span>';
        html+='<button data-lid="'+l.id+'" data-idx="'+i+'" onclick="deleteOneReport(this)" style="font-size:10px;padding:1px 6px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--faint);cursor:pointer">X</button>';
        html+='</div>';
      });
      html+='</div>';
    }
  });
  if(stoppages.length){
    html+='<div style="font-size:11px;font-weight:700;color:var(--dim);margin:10px 0 8px;text-transform:uppercase">עצירות</div>';
    html+='<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:6px">';
    stoppages.forEach(function(s,i){
      html+='<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--dim);padding:3px 0">';
      html+='<span>'+s.lineName+' | '+s.reason+' | '+s.startTime+'</span>';
      html+='<button data-idx="'+i+'" onclick="deleteOneStop(this)" style="font-size:10px;padding:1px 6px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--faint);cursor:pointer">X</button>';
      html+='</div>';
    });
    html+='</div>';
  }
  if(!html.includes('sbox')) html='<div class="empty" style="padding:16px">אין נתונים למחיקה</div>';
  el.innerHTML=html;
}

function deleteLineReports(lid){
  reports[lid]=[];
  saveState();syncToServer();renderDash();renderDeleteOptions();showT('עדכונים נמחקו','y');
}

function deleteOneReport(btn){
  var lid=btn.dataset.lid,idx=parseInt(btn.dataset.idx);
  if(reports[lid]) reports[lid].splice(idx,1);
  saveState();syncToServer();renderDash();renderDeleteOptions();showT('עדכון נמחק','y');
}

function deleteOneStop(btn){
  var idx=parseInt(btn.dataset.idx);
  stoppages.splice(idx,1);
  saveState();syncToServer();updateStopBdg();renderDeleteOptions();showT('עצירה נמחקה','y');
}

var pendingUpdateLines={};
function checkPendingUpdates(h,m){
  if(!Object.keys(targets).length) return;
  if(m>=55||m<=5){
    var targetHour=m>=55?h+1:h;
    LINES.forEach(function(l){
      if(!targets[l.id]) return;
      var lineReps=reports[l.id]||[];
      var lastRep=lineReps[lineReps.length-1];
      var updatedThisHour=lastRep&&lastRep.time&&parseInt(lastRep.time.split(':')[0])>=targetHour-1;
      if(!updatedThisHour) pendingUpdateLines[l.id]=targetHour;
      else delete pendingUpdateLines[l.id];
    });
    renderPendingReminders();
  } else {
    pendingUpdateLines={};renderPendingReminders();
  }
}

function renderPendingReminders(){
  var el=document.getElementById('pending-reminders');
  if(!el) return;
  var ids=Object.keys(pendingUpdateLines);
  if(!ids.length){el.style.display='none';el.innerHTML='';return;}
  el.style.display='block';
  el.innerHTML='<div style="background:var(--yellow-bg);border:1px solid rgba(217,119,6,.3);border-radius:10px;padding:10px 14px;margin-bottom:8px">';
  el.innerHTML+='<div style="font-size:12px;font-weight:700;color:var(--yellow);margin-bottom:6px">ממתינים לעדכון שעתי</div>';
  ids.forEach(function(id){
    var l=LINES.filter(function(x){return x.id===id;})[0];
    if(!l) return;
    el.innerHTML+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><span style="font-size:13px;font-weight:600">'+l.name+'</span><button data-lid="'+id+'" onclick="quickUpdate(this.dataset.lid)" style="font-size:11px;padding:4px 12px;background:var(--yellow);border:none;border-radius:6px;color:#fff;cursor:pointer;font-weight:700">עדכן עכשיו</button></div>';
  });
  el.innerHTML+='</div>';
}

function toggleTV(){
  var el=document.getElementById('tv-overlay');
  if(!el) return;
  var on=el.style.display==='none'||el.style.display==='';
  el.style.display=on?'block':'none';
  if(on){renderTV();if(typeof tvInterval!=='undefined')clearInterval(tvInterval);tvInterval=setInterval(renderTV,30000);}
  else{if(typeof tvInterval!=='undefined')clearInterval(tvInterval);}
}

var tvInterval=null;
function renderTV(){
  var overlay=document.getElementById('tv-overlay');
  if(!overlay||overlay.style.display==='none') return;
  var n=new Date();
  var cl=document.getElementById('tv-clock');var dl=document.getElementById('tv-date');
  if(cl)cl.textContent=pad(n.getHours())+':'+pad(n.getMinutes());
  if(dl)dl.textContent='יום '+DAYS[n.getDay()]+' '+n.toLocaleDateString('he-IL');
  var sc=calcScore(),si=scoreInfo(sc);
  var sv=document.getElementById('tv-score');
  if(sv){sv.textContent=sc!==null?sc:'-';sv.style.color=si.col;}
  var linesEl=document.getElementById('tv-lines');
  if(linesEl){
    linesEl.innerHTML=LINES.map(function(l){
      var calc=calcLine(l.id);
      var dotCol=calc.statusIdx===0||calc.statusIdx===1?'var(--green)':calc.statusIdx===2?'var(--yellow)':calc.statusIdx===3?'var(--red)':'var(--faint)';
      var pp=calc.combined>0&&calc.done!==null?Math.min(Math.round(calc.done/calc.combined*100),100):0;
      var fc=calc.statusIdx===1?'fb':calc.statusIdx===0?'fg':calc.statusIdx===2?'fy':calc.statusIdx===3?'fr':'fgr';
      return '<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px;text-align:center">'+
        '<div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:10px">'+
          '<span style="width:10px;height:10px;border-radius:50%;background:'+dotCol+';display:inline-block"></span>'+
          '<span style="font-size:16px;font-weight:800">'+l.name+'</span></div>'+
        '<div style="font-size:48px;font-weight:900;font-family:var(--mono);color:var(--green);line-height:1">'+(calc.done!==null?calc.done:'-')+'</div>'+
        '<div style="font-size:12px;color:var(--dim);margin:4px 0">מתוך '+calc.combined+'</div>'+
        '<div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden;margin-top:8px">'+
          '<div class="pg-fill '+fc+'" style="width:'+pp+'%"></div></div>'+
        '<div style="font-size:11px;color:var(--faint);font-family:var(--mono);margin-top:4px">'+pp+'%</div></div>';
    }).join('');
  }
  var stopsEl=document.getElementById('tv-stops');
  if(stopsEl){
    var active=stoppages.filter(function(s){return s.open;});
    stopsEl.innerHTML=active.length?active.map(function(s){
      var min=Math.round((Date.now()-s.startTs)/60000);
      return '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px"><span><strong>'+s.lineName+'</strong> '+s.reason+'</span><span style="font-family:var(--mono);color:'+(min>20?'var(--red)':min>10?'var(--yellow)':'var(--dim)')+'">'+min+' min</span></div>';
    }).join(''):'<div style="font-size:13px;color:var(--green);font-weight:700">אין עצירות פעילות</div>';
  }
  var matEl=document.getElementById('tv-mat');
  if(matEl){
    var active2=materialRequests.filter(function(r){return r.status==='pending'||r.status==='inProgress';});
    matEl.innerHTML=active2.length?active2.map(function(r){
      var min2=r.startTs?Math.round((Date.now()-r.startTs)/60000):Math.round((Date.now()-r.createdTs)/60000);
      return '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px"><span><strong>'+r.lineName+'</strong> '+r.sku+'</span><span style="font-family:var(--mono);color:'+(r.hasDelay?'var(--red)':min2>20?'var(--yellow)':'var(--dim)')+'">'+min2+' min'+(r.hasDelay?' !':'')+'</span></div>';
    }).join(''):'<div style="font-size:13px;color:var(--green);font-weight:700">אין הזמנות פתוחות</div>';
  }
}

function showSkuSuggestions(){
  var val=(document.getElementById('mat-sku')||{}).value||'';
  var box=document.getElementById('sku-suggestions');
  if(!box) return;
  var term=val.trim().toLowerCase();
  if(!term){box.style.display='none';return;}
  var matches=getKnownSkus().filter(function(s){return s.toLowerCase().includes(term);}).slice(0,6);
  if(!matches.length){box.style.display='none';return;}
  box.innerHTML=matches.map(function(s){return '<div onclick="selectSku(this.textContent)" style="padding:8px 12px;cursor:pointer;font-family:var(--mono);font-size:13px;border-bottom:1px solid var(--border)">'+s+'</div>';}).join('');
  box.style.display='block';
}


// ============================================================
// WORK PLAN LOADING
// ============================================================
var WP_LINE_MAP = {
  'שולחן ליקוט 1': 'pick', 'כבלים': 'cable', 'כבלים ': 'cable',
  'שולחן 1 KIT': 'kit', 'נתיב ספקי כח': 'spk', "שולחן יח' הנעה": 'drive'
};
var wpParsed = null;

function loadWorkPlan(event){
  var file=event.target.files[0];
  if(!file) return;
  var status=document.getElementById('wp-status');
  if(status){status.textContent='קורא קובץ...';status.style.color='var(--dim)';}
  var reader=new FileReader();
  reader.onload=function(e){
    try{
      var data=new Uint8Array(e.target.result);
      var wb=XLSX.read(data,{type:'array',cellDates:true});
      var ws=wb.Sheets[wb.SheetNames[0]];
      var rows=XLSX.utils.sheet_to_json(ws,{raw:false,dateNF:'yyyy-mm-dd'});
      parseWorkPlan(rows);
    }catch(err){
      if(status){status.textContent='שגיאה: '+err.message;status.style.color='var(--red)';}
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
    var lineName=row['קו']||'';
    var lineId=WP_LINE_MAP[lineName.trim()]||WP_LINE_MAP[lineName];
    if(!lineId){
      skipped++;
      var rn=row['קו']||'?';
      skippedReasons[rn]=(skippedReasons[rn]||0)+1;
      return;
    }
    var startStr=row['ת.התחלת ייצור']||'';
    var endStr=row['ת.יסום ייצור']||'';
    var qty=parseInt(row['יתרה לאריזה'])||0;
    var sku=row['מק"ט']||row['מקט']||'';
    var desc=row['תאור מוצר']||'';
    var orderNum=row['הזמנה']||'';
    var orderLine=row['שורה']||'';
    var customer=row['שם לקוח']||'';
    var expiry=row['פק"ע']||'';
    var skuB=row['מק"ט בן']||row['מקט בן']||'';
    if(!qty){skipped++;skippedReasons['כמות 0']=(skippedReasons['כמות 0']||0)+1;return;}
    if(!startStr) return;
    var startDate=new Date(startStr);startDate.setHours(0,0,0,0);
    var endDate=endStr?new Date(endStr):startDate;endDate.setHours(0,0,0,0);
    if(endDate<today&&qty>0){redRowsData[lineId].rows++;redRowsData[lineId].units+=qty;}
    if(startDate.getTime()===today.getTime()){
      totals[lineId].qty+=qty;totals[lineId].orders++;matched++;
      if(startStr&&endStr){var sf=new Date(startStr),ef=new Date(endStr);var m=(ef-sf)/60000;if(m>0)totals[lineId].mins+=m;}
    }
    // Order tracking rows - ALL rows regardless of date
    if(qty>0){
      // Parse DD/MM/YYYY format and compare
      var todayStr2=today.getFullYear()+'-'+('0'+(today.getMonth()+1)).slice(-2)+'-'+('0'+today.getDate()).slice(-2);
      var startParts=startStr.substring(0,10).split('/');
      var startNorm=startParts.length===3?startParts[2]+'-'+startParts[1]+'-'+startParts[0]:startStr.substring(0,10);
      var isRed=startNorm<todayStr2;
      if(!orderRows[lineId]) orderRows[lineId]=[];
      orderRows[lineId].push({sku:sku,desc:desc,qty:qty,done:0,status:'open',
        isRed:isRed,note:'',order:orderNum,orderLine:orderLine,
        customer:customer,expiry:expiry,skuB:skuB,startDate:startStr});
    }
  wpParsed=totals;wpParsed._redRows=redRowsData;
  });
  var todayStr=today.toLocaleDateString('he-IL');
  var totalRed=Object.values(redRowsData).reduce(function(s,d){return s+d.rows;},0);
  var html='<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:8px">';
  html+='<div style="font-size:12px;font-weight:700;color:var(--blue);margin-bottom:10px">'+matched+' הזמנות ל-'+todayStr+(totalRed>0?' | <span style="color:var(--red)">'+totalRed+' שורות אדומות</span>':'')+'</div>';
  LINES.forEach(function(l){
    var d=totals[l.id],rr=redRowsData[l.id];
    if(d.qty>0||rr.rows>0){
      html+='<div style="padding:8px 0;border-bottom:1px solid var(--border)">';
      html+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">';
      html+='<span style="font-size:13px;font-weight:700">'+l.name+'</span>';
      html+='<div style="display:flex;align-items:center;gap:6px"><span style="font-size:11px;color:var(--dim)">עובדים:</span>';
      html+='<input type="number" id="wp-wk-'+l.id+'" value="'+(DEFAULT_WORKERS[l.id]||1)+'" min="1" max="20" onchange="updateWpWorkers(this)" style="width:45px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:3px 5px;color:var(--text);font-size:13px;font-family:var(--mono);text-align:center">';
      html+='</div></div>';
      html+='<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">';
      if(d.qty>0) html+='<span style="font-size:12px;font-family:var(--mono);font-weight:700;color:var(--green)">'+d.qty+' יח</span>';
      if(rr.rows>0) html+='<span style="font-size:10px;color:var(--red);background:var(--red-bg);padding:2px 6px;border-radius:4px;font-weight:700">'+rr.rows+' שורות אדומות</span>';
      html+='</div></div>';
    }
  });
  html+='</div>';
  var wpRes=document.getElementById('wp-results');
  var wpPrev=document.getElementById('wp-preview');
  if(wpRes) wpRes.innerHTML=html;
  if(wpPrev) wpPrev.style.display='block';
  var debugMsg=matched+' שורות נטענו';
  if(skipped>0){
    debugMsg+=' | '+skipped+' הושמטו: '+Object.entries(skippedReasons).map(function(e){return e[0]+'('+e[1]+')';}).join(', ');
  }
  if(status){status.textContent=debugMsg;status.style.color=skipped>0?'var(--yellow)':'var(--green)';}
  saveOrderRows();
}

function updateWpWorkers(el){
  var id=el.id.replace('wp-wk-','');
  DEFAULT_WORKERS[id]=parseInt(el.value)||1;
  saveState();
}

function renderWpEta(){}

// ============================================================
// ORDER TRACKING
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
      var parts=r.startDate.substring(0,10).split('/');
      var norm=parts.length===3?parts[2]+'-'+parts[1]+'-'+parts[0]:r.startDate.substring(0,10);
      r.isRed=norm<todayStr;
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
  var rows2=[{key:'order_rows',value:JSON.stringify(orderRows),updated_at:new Date().toISOString()}];
  sbFetch('ops_data',{method:'POST',prefer:'resolution=merge-duplicates',body:JSON.stringify(rows2)}).catch(function(){});
}

function markRowDone(lineId,rowIdx){
  var rows=orderRows[lineId]||[];if(!rows[rowIdx])return;
  rows[rowIdx].done=rows[rowIdx].qty;rows[rowIdx].status='done';
  orderRows[lineId]=rows;saveOrderRows();renderOrderTracking();
}

function markRowPartial(lineId,rowIdx){
  var inp=document.getElementById('partial-inp-'+lineId+'-'+rowIdx);
  if(!inp)return;var val=parseInt(inp.value)||0;
  if(val<=0){showT('הזן כמות','y');return;}
  var rows=orderRows[lineId]||[];if(!rows[rowIdx])return;
  rows[rowIdx].done=Math.min(val,rows[rowIdx].qty);
  rows[rowIdx].status=rows[rowIdx].done>=rows[rowIdx].qty?'done':'partial';
  orderRows[lineId]=rows;saveOrderRows();renderOrderTracking();
}

function undoRowMark(lineId,rowIdx){
  var rows=orderRows[lineId]||[];if(!rows[rowIdx])return;
  rows[rowIdx].done=0;rows[rowIdx].status='open';
  orderRows[lineId]=rows;saveOrderRows();renderOrderTracking();
}

function addRowNote(lineId,rowIdx){
  var inp=document.getElementById('note-inp-'+lineId+'-'+rowIdx);
  if(!inp)return;
  var rows=orderRows[lineId]||[];if(!rows[rowIdx])return;
  rows[rowIdx].note=inp.value.trim();
  orderRows[lineId]=rows;saveOrderRows();renderOrderTracking();
  showT('הערה נשמרה');
}

function togglePartialRow(btn){
  var row=btn.parentElement.nextElementSibling;
  if(row)row.style.display=row.style.display==='none'||!row.style.display?'flex':'none';
}

function searchOrderRows(){renderOrderTracking();}

function renderOrderTrackingSummary(){
  var el=document.getElementById('order-tracking');
  if(!el) return;
  var html='';
  var hasData=false;
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
  if(!hasData) html='<div class="empty">טען תוכנית עבודה</div>';
  el.innerHTML=html;
}

function renderOrderTracking(){
  var el=document.getElementById('order-tracking');
  if(!el)return;
  var search=((document.getElementById('order-search')||{}).value||'').toLowerCase();
  var html='<input type="text" id="order-search" placeholder="חפש מק-ט או תיאור..." oninput="searchOrderRows()" value="'+search+'" style="width:100%;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text);font-size:13px;margin-bottom:10px">';
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
    var doneCnt=allRows.filter(function(r){return r.status==='done';}).length;
    var partialCnt=allRows.filter(function(r){return r.status==='partial';}).length;
    var openCnt=allRows.filter(function(r){return r.status==='open';}).length;
    var totalDone=allRows.reduce(function(s,r){return s+(r.done||0);},0);
    var totalQty=allRows.reduce(function(s,r){return s+(r.qty||0);},0);
    var pct=totalQty>0?Math.round(totalDone/totalQty*100):0;
    var barCol=pct>=100?'var(--green)':pct>=60?'var(--blue)':'var(--yellow)';
    html+='<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;margin-bottom:10px;overflow:hidden">';
    html+='<div style="padding:10px 14px;background:var(--surface);border-bottom:1px solid var(--border)">';
    html+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">';
    html+='<span style="font-size:14px;font-weight:700">'+l.name+'</span>';
    html+='<span style="font-size:13px;font-weight:800;font-family:var(--mono);color:'+barCol+'">'+totalDone+'/'+totalQty+' יח</span>';
    html+='</div>';
    html+='<div style="height:5px;background:var(--border);border-radius:3px;overflow:hidden;margin-bottom:5px"><div style="height:100%;background:'+barCol+';width:'+Math.min(pct,100)+'%"></div></div>';
    html+='<div style="font-size:10px;color:var(--dim)">'+doneCnt+' הושלמו | '+partialCnt+' חלקי | '+openCnt+' פתוחות</div></div>';
    rows.forEach(function(r){
      var realIdx=allRows.indexOf(r);
      var isDone=r.status==='done',isPartial=r.status==='partial',isRed=r.isRed;
      var rowBg=isDone?'rgba(5,150,105,.04)':isPartial?'rgba(217,119,6,.04)':isRed?'rgba(220,38,38,.04)':'transparent';
      var dotCol=isDone?'var(--green)':isPartial?'var(--yellow)':isRed?'var(--red)':'var(--border)';
      html+='<div style="padding:9px 14px;border-top:1px solid var(--border);background:'+rowBg+'">';
      html+='<div style="display:flex;justify-content:space-between;align-items:center">';
      html+='<div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0">';
      html+='<span style="width:7px;height:7px;border-radius:50%;background:'+dotCol+';flex-shrink:0;display:inline-block"></span>';
      html+='<div style="min-width:0"><span style="font-size:13px;font-weight:700;font-family:var(--mono)">'+(r.sku||'-')+'</span>';
      if(r.desc) html+=' <span style="font-size:11px;color:var(--dim)">'+r.desc.substring(0,25)+(r.desc.length>25?'...':'')+'</span>';
      if(r.note) html+='<div style="font-size:10px;color:var(--yellow);margin-top:1px">'+r.note+'</div>';
      html+='</div></div>';
      html+='<div style="display:flex;align-items:center;gap:6px;flex-shrink:0">';
      if(isDone||isPartial){
        html+='<span style="font-size:14px;font-weight:800;font-family:var(--mono);color:'+(isDone?'var(--green)':'var(--yellow)')+'">'+r.done+'/'+r.qty+'</span>';
        html+='<button data-lid="'+l.id+'" data-idx="'+realIdx+'" onclick="undoRowMark(this.dataset.lid,parseInt(this.dataset.idx))" style="font-size:10px;padding:2px 7px;background:var(--surface);border:1px solid var(--border);border-radius:5px;color:var(--faint);cursor:pointer">בטל</button>';
      } else {
        html+='<span style="font-size:12px;color:var(--dim);font-family:var(--mono)">'+r.qty+'</span>';
        html+='<button data-lid="'+l.id+'" data-idx="'+realIdx+'" onclick="markRowDone(this.dataset.lid,parseInt(this.dataset.idx))" style="font-size:13px;padding:5px 12px;background:var(--green);border:none;border-radius:7px;color:#fff;cursor:pointer;font-weight:700">&#10003;</button>';
        html+='<button data-lid="'+l.id+'" data-idx="'+realIdx+'" onclick="togglePartialRow(this)" style="font-size:11px;padding:5px 8px;background:var(--yellow-bg);border:1px solid rgba(217,119,6,.3);border-radius:7px;color:var(--yellow);cursor:pointer;font-weight:700">חלקי</button>';
      }
      html+='</div></div>';
      if(!isDone&&!isPartial){
        html+='<div style="display:none;align-items:center;gap:6px;margin-top:7px">';
        html+='<input type="number" id="partial-inp-'+l.id+'-'+realIdx+'" inputmode="numeric" placeholder="הושלם..." min="1" max="'+r.qty+'" style="flex:1;background:var(--surface);border:1px solid var(--border);border-radius:7px;padding:6px 10px;color:var(--text);font-size:14px;font-family:var(--mono);text-align:center">';
        html+='<button data-lid="'+l.id+'" data-idx="'+realIdx+'" onclick="markRowPartial(this.dataset.lid,parseInt(this.dataset.idx))" style="font-size:12px;padding:6px 14px;background:var(--yellow);border:none;border-radius:7px;color:#fff;cursor:pointer;font-weight:700">שמור</button>';
        html+='</div>';
        html+='<div style="display:flex;align-items:center;gap:6px;margin-top:5px">';
        html+='<input type="text" id="note-inp-'+l.id+'-'+realIdx+'" placeholder="הערה..." value="'+(r.note||'')+'" style="flex:1;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:5px 9px;color:var(--text);font-size:12px">';
        html+='<button data-lid="'+l.id+'" data-idx="'+realIdx+'" onclick="addRowNote(this.dataset.lid,parseInt(this.dataset.idx))" style="font-size:11px;padding:5px 10px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--dim);cursor:pointer">שמור</button>';
        html+='</div>';
      } else {
        html+='<div style="display:none"></div><div style="display:none"></div>';
      }
      html+='</div>';
    });
    html+='<div style="padding:8px 14px;border-top:1px solid var(--border);text-align:left">';
    html+='<button data-lid="'+l.id+'" onclick="exportLineRows(this.dataset.lid)" style="font-size:11px;padding:4px 12px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--dim);cursor:pointer">ייצא Excel</button>';
    html+='</div></div>';
  });
  if(!hasData) html+='<div class="empty">טען תוכנית עבודה</div>';
  el.innerHTML=html;
}

function exportLineRows(lineId){
  var rows=orderRows[lineId]||[];
  var line=LINES.filter(function(l){return l.id===lineId;})[0];
  if(!rows.length){showT('אין שורות','y');return;}
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
  showT('ייצוא בוצע!');
}

// ============================================================
// LINES TAB - work plan per line
// ============================================================
var currentLine = 'pick';


function openLineDetail(lineId){
  var sec=document.getElementById('line-detail-section');
  if(sec){
    sec.style.display='block';
    sec.scrollIntoView({behavior:'smooth',block:'start'});
  }
  currentLine=lineId;
  // Update tab buttons if any
  ['pick','kit','drive','spk','cable'].forEach(function(id){
    var btn=document.getElementById('lt-'+id);
    if(btn) btn.classList.toggle('lt-active',id===lineId);
  });
  renderLineRows();
  // Show red badge
  var rows=orderRows[lineId]||[];
  var redCnt=rows.filter(function(r){return r.isRed&&r.status!=='done';}).length;
  var badge=document.getElementById('lt-red-badge');
  if(badge){
    if(redCnt>0){badge.style.display='inline';badge.textContent=redCnt+' שורות אדומות';}
    else badge.style.display='none';
  }
}

function selectLine(lineId){
  currentLine = lineId;
  // Update tab buttons
  ['pick','kit','drive','spk','cable'].forEach(function(id){
    var btn = document.getElementById('lt-'+id);
    if(btn){
      btn.classList.toggle('lt-active', id===lineId);
    }
  });
  renderLineRows();
}

function renderLineRows(){
  var el=document.getElementById('lt-rows');
  var prog=document.getElementById('lt-progress');
  var title=document.getElementById('lt-title');
  if(!el) return;

  var line=LINES.filter(function(l){return l.id===currentLine;})[0];
  if(title) title.textContent=line?line.name:'';

  var rows=orderRows[currentLine]||[];
  var search=((document.getElementById('lt-search')||{}).value||'').toLowerCase();

  if(!rows.length){
    el.innerHTML='<div class="empty">טען תוכנית עבודה</div>';
    if(prog) prog.textContent='-';
    return;
  }

  // Sort: red first, then open, partial, done
  var sorted=rows.slice().sort(function(a,b){
    var ap=a.isRed&&a.status!=='done'?0:a.status==='open'?1:a.status==='partial'?2:3;
    var bp=b.isRed&&b.status!=='done'?0:b.status==='open'?1:b.status==='partial'?2:3;
    return ap-bp;
  });

  var filtered=search?sorted.filter(function(r){
    return (r.sku||'').toLowerCase().includes(search)||
           (r.order||'').toLowerCase().includes(search)||
           (r.customer||'').toLowerCase().includes(search)||
           (r.desc||'').toLowerCase().includes(search);
  }):sorted;

  var totalDone=rows.reduce(function(s,r){return s+(r.done||0);},0);
  var totalQty=rows.reduce(function(s,r){return s+(r.qty||0);},0);
  var redCnt=rows.filter(function(r){return r.isRed&&r.status!=='done';}).length;
  var pct=totalQty>0?Math.round(totalDone/totalQty*100):0;

  if(prog) prog.textContent=totalDone+'/'+totalQty+' ('+pct+'%)';

  // Show expiry and skuB based on line
  var showExpiry=['pick','kit','drive','spk'].indexOf(currentLine)>=0;
  var showSkuB=['pick','cable','drive','spk'].indexOf(currentLine)>=0;

  var html='';
  // Search
  html+='<input type="text" id="lt-search" placeholder="חפש הזמנה / מק-ט / לקוח..." oninput="renderLineRows()" value="'+search+'" style="width:100%;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px 12px;color:var(--text);font-size:13px;margin-bottom:8px">';

  filtered.forEach(function(r){
    var realIdx=rows.indexOf(r);
    var isDone=r.status==='done';
    var isPartial=r.status==='partial';
    var isRed=r.isRed&&!isDone;
    var rowBg=isDone?'rgba(5,150,105,.04)':isPartial?'rgba(217,119,6,.04)':isRed?'rgba(220,38,38,.05)':'var(--card)';
    var borderCol=isRed?'rgba(220,38,38,.3)':isPartial?'rgba(217,119,6,.3)':'var(--border)';
    var textCol=isRed?'#E24B4A':isDone?'var(--dim)':'var(--text)';
    var orderCol=isRed?'#E24B4A':'var(--blue)';

    html+='<div style="background:'+rowBg+';border:1px solid '+borderCol+';border-radius:12px;padding:12px 14px;margin-bottom:8px">';
    html+='<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">';

    // Left side
    html+='<div style="flex:1;min-width:0">';
    // Order + line
    if(r.order) html+='<div style="display:flex;align-items:baseline;gap:6px;margin-bottom:4px"><span style="font-size:15px;font-weight:700;color:'+orderCol+'">'+r.order+'</span><span style="font-size:12px;color:var(--dim)">/ שורה '+(r.orderLine||'')+'</span></div>';
    // Desc + sku
    if(r.desc) html+='<div style="font-size:15px;font-weight:700;color:'+textCol+';margin-bottom:3px;line-height:1.3">'+r.desc+(r.sku?' <span style="font-size:13px;font-family:var(--mono);font-weight:500">'+r.sku+'</span>':'')+'</div>';
    else if(r.sku) html+='<div style="font-size:15px;font-weight:700;font-family:var(--mono);color:'+textCol+';margin-bottom:3px">'+r.sku+'</div>';
    // Customer
    if(r.customer) html+='<div style="font-size:14px;color:var(--dim)">'+r.customer+'</div>';
    // skuB
    if(showSkuB&&r.skuB) html+='<div style="font-size:12px;margin-top:4px;padding:2px 8px;background:var(--blue-bg);color:var(--blue);border-radius:5px;display:inline-block">בן: '+r.skuB+'</div>';
    html+='</div>';

    // Right side: expiry + qty + buttons
    html+='<div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0">';
    if(showExpiry&&r.expiry){
      var expiryCol=isRed?'#E24B4A':'var(--dim)';
      var expiryBg=isRed?'rgba(252,235,235,0.9)':'var(--surface)';
      html+='<span style="font-size:11px;color:'+expiryCol+';padding:2px 7px;background:'+expiryBg+';border-radius:6px;white-space:nowrap">פק"ע '+r.expiry+(isRed?' ⚠':'')+'</span>';
    }
    if(isDone||isPartial){
      var doneCol=isDone?'#1D9E75':'#BA7517';
      html+='<div style="text-align:right"><span style="font-size:20px;font-weight:700;color:'+doneCol+';font-family:var(--mono)">'+r.done+'</span><span style="font-size:13px;color:var(--dim)">/'+r.qty+'</span><div style="font-size:10px;color:var(--dim)">יח לאריזה</div></div>';
      html+='<button data-lid="'+currentLine+'" data-idx="'+realIdx+'" onclick="undoRowMark(this.dataset.lid,parseInt(this.dataset.idx));renderLineRows()" style="font-size:11px;padding:3px 10px;background:var(--surface);border:1px solid var(--border);border-radius:5px;color:var(--faint);cursor:pointer">בטל</button>';
    } else {
      html+='<div style="text-align:right"><span style="font-size:20px;font-weight:700;color:var(--text);font-family:var(--mono)">'+r.qty+'</span><div style="font-size:10px;color:var(--dim)">יח לאריזה</div></div>';
      html+='<div style="display:flex;gap:5px">';
      html+='<button data-partial="lt-pinput-'+realIdx+'" onclick="var p=document.getElementById(this.dataset.partial);if(p)p.style.display=p.style.display===\'flex\'?\'none\':\'flex\'" style="width:34px;height:34px;background:#F5C4B3;color:#993C1D;border:0.5px solid #F0997B;border-radius:8px;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center">~</button>';
      html+='<button data-lid="'+currentLine+'" data-idx="'+realIdx+'" onclick="markRowDone(this.dataset.lid,parseInt(this.dataset.idx));renderLineRows()" style="width:34px;height:34px;background:#C0DD97;color:#3B6D11;border:0.5px solid #97C459;border-radius:8px;font-size:17px;cursor:pointer;display:flex;align-items:center;justify-content:center">&#10003;</button>';
      html+='</div>';
    }
    html+='</div></div>';

    // Partial input (hidden)
    if(!isDone){
      html+='<div id="lt-pinput-'+realIdx+'" style="display:none;align-items:center;gap:8px;margin-top:8px">';
      html+='<input type="number" id="lt-partial-'+realIdx+'" inputmode="numeric" placeholder="כמה?" min="1" max="'+r.qty+'" style="flex:1;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:7px 12px;color:var(--text);font-size:18px;font-family:var(--mono);text-align:center">';
      html+='<button data-lid="'+currentLine+'" data-idx="'+realIdx+'" onclick="markLtPartial(this.dataset.lid,parseInt(this.dataset.idx))" style="padding:7px 16px;background:var(--yellow);border:none;border-radius:8px;color:#fff;font-size:14px;font-weight:700;cursor:pointer">שמור</button>';
      html+='</div>';
    } else {
      html+='<div style="display:none"></div>';
    }
    html+='</div>';
  });

  el.innerHTML=html;
  renderHourlyLog(currentLine);
}

function toggleLtPartial(btn){
  var row = btn.parentElement.nextElementSibling;
  if(row) row.style.display = row.style.display==='none'||!row.style.display ? 'flex' : 'none';
}

function markLtPartial(lineId, rowIdx){
  var inp = document.getElementById('lt-partial-'+rowIdx);
  if(!inp) return;
  var val = parseInt(inp.value)||0;
  if(val<=0){showT('הזן כמות','y');return;}
  var rows = orderRows[lineId]||[];
  if(!rows[rowIdx]) return;
  rows[rowIdx].done = Math.min(val, rows[rowIdx].qty);
  rows[rowIdx].status = rows[rowIdx].done>=rows[rowIdx].qty?'done':'partial';
  orderRows[lineId] = rows;
  saveOrderRows();
  renderLineRows();
}

// HOURLY LOG - track units done per hour slot
var hourlyLog = {}; // {lineId: [{slot:'07:15-08:00', units:40, target:60, ts:...}]}

function loadHourlyLog(){
  try{hourlyLog=JSON.parse(store.getItem('ops_hourly_log')||'{}');}catch(e){hourlyLog={};}
}

function saveHourlyToLog(){
  var now=new Date();
  var h=now.getHours(),m=now.getMinutes();
  // Only log at exact hour (within 2 min window)
  if(m>2&&m<58) return;
  var slotEnd=pad(h)+':00';
  var slotStart=pad(h-1)+':00';
  if(h===7&&m<=17) return; // too early

  LINES.forEach(function(l){
    var reps=reports[l.id]||[];
    if(!reps.length) return;
    var lastDone=reps[reps.length-1].done||0;
    if(!hourlyLog[l.id]) hourlyLog[l.id]=[];
    // Check if slot already logged
    var existing=hourlyLog[l.id].filter(function(s){return s.slotEnd===slotEnd;});
    if(existing.length) return;
    // Previous slot's done
    var prevSlot=hourlyLog[l.id][hourlyLog[l.id].length-1];
    var prevDone=prevSlot?prevSlot.cumDone:0;
    var unitsThisHour=lastDone-prevDone;
    var calc=calcLine(l.id);
    var hourlyTarget=calc.combined>0?Math.round(calc.combined/shiftHours()):0;
    var pct=hourlyTarget>0?Math.round(unitsThisHour/hourlyTarget*100):100;
    var status=pct>=95?'ok':pct>=80?'warn':'bad';
    hourlyLog[l.id].push({
      slotStart:slotStart,slotEnd:slotEnd,
      units:unitsThisHour,cumDone:lastDone,
      target:hourlyTarget,pct:pct,status:status,ts:Date.now()
    });
  });
  store.setItem('ops_hourly_log',JSON.stringify(hourlyLog));
}

function renderHourlyLog(lineId){
  var el=document.getElementById('hourly-log-'+lineId);
  if(!el) return;
  var slots=hourlyLog[lineId]||[];
  if(!slots.length){el.innerHTML='';return;}
  var html='<div style="margin-top:10px;border-top:1px solid var(--border);padding-top:8px">';
  slots.forEach(function(s){
    var col=s.status==='ok'?'var(--green)':s.status==='warn'?'var(--yellow)':'var(--red)';
    var bg=s.status==='ok'?'var(--green-bg)':s.status==='warn'?'var(--yellow-bg)':'var(--red-bg)';
    html+='<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;background:'+bg+';border-radius:6px;margin-bottom:4px">';
    html+='<span style="font-size:11px;color:var(--dim);font-family:var(--mono)">'+s.slotStart+'-'+s.slotEnd+'</span>';
    html+='<span style="font-size:12px;font-weight:700;font-family:var(--mono);color:'+col+'">'+s.units+' יח</span>';
    html+='</div>';
  });
  html+='</div>';
  el.innerHTML=html;
}

function checkRedRowsAge(){
  var today=new Date();today.setHours(0,0,0,0);
  LINES.forEach(function(l){
    var rows=orderRows[l.id]||[];
    rows.forEach(function(r){
      if(!r.isRed||r.status==='done') return;
      if(!r.expiry) return;
      var exp=new Date(r.expiry);exp.setHours(0,0,0,0);
      var diffDays=Math.round((today-exp)/(1000*60*60*24));
      if(diffDays>=2){
        pushAlert('r','שורה אדומה '+diffDays+' ימים: '+l.name+' - '+r.sku+' ('+r.customer+')');
      }
    });
  });
}

// SKU MEMORY
function getKnownSkus(){try{return JSON.parse(store.getItem('ops_skus')||'[]');}catch(e){return [];}}
function saveSku(sku){
  if(!sku) return;
  var skus=getKnownSkus();
  if(!skus.includes(sku)){skus.unshift(sku);if(skus.length>700)skus=skus.slice(0,700);store.setItem('ops_skus',JSON.stringify(skus));}
}
function selectSku(sku){var el=document.getElementById('mat-sku');if(el)el.value=sku;var box=document.getElementById('sku-suggestions');if(box)box.style.display='none';}
function deleteSku(sku){var skus=getKnownSkus().filter(function(s){return s!==sku;});store.setItem('ops_skus',JSON.stringify(skus));renderSkuManager();}
function clearAllSkus(){store.setItem('ops_skus','[]');renderSkuManager();showT('נמחקו','y');}
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
function renderSkuManager(){
  var el=document.getElementById('sku-manager-list');if(!el) return;
  var skus=getKnownSkus();
  if(!skus.length){el.innerHTML='<div style="font-size:12px;color:var(--faint);text-align:center;padding:8px">אין מק"טים שמורים</div>';return;}
  el.innerHTML='<div style="max-height:200px;overflow-y:auto">'+skus.map(function(s){
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border-bottom:1px solid var(--border);font-size:12px">'+
      '<span style="font-family:var(--mono)">'+s+'</span>'+
      '<button data-sku="'+s+'" onclick="deleteSku(this.dataset.sku)" style="font-size:10px;padding:1px 7px;background:var(--red-bg);border:1px solid rgba(220,38,38,.3);border-radius:4px;color:var(--red);cursor:pointer">מחק</button>'+
    '</div>';
  }).join('')+'</div>'+
  '<button onclick="clearAllSkus()" style="width:100%;margin-top:8px;padding:7px;background:var(--red-bg);border:1px solid rgba(220,38,38,.3);border-radius:7px;color:var(--red);font-size:12px;font-weight:600;cursor:pointer">מחק הכל</button>';
}

// MAT TIMER
var matTimerInterval=null;
function startMatTimer(){
  if(matTimerInterval) clearInterval(matTimerInterval);
  matTimerInterval=setInterval(function(){
    var pg=document.getElementById('page-mat');
    if(pg&&pg.classList.contains('active')) renderMaterials();
  },30000);
}
function updateMatBdg(){
  var n=materialRequests.filter(function(r){return r.status==='pending'||r.status==='inProgress';}).length;
  var b=document.getElementById('mat-bdg');
  if(b){b.style.display=n>0?'flex':'none';b.textContent=n;}
}
function saveMaterials(){
  store.setItem('ops_materials',JSON.stringify(materialRequests));
  updateMatBdg();
  var rows=[{key:'materials',value:JSON.stringify(materialRequests),updated_at:new Date().toISOString()}];
  sbFetch('ops_data',{method:'POST',prefer:'resolution=merge-duplicates',body:JSON.stringify(rows)}).catch(function(){});
}
function checkMaterialAlerts(){
  var now=Date.now();
  materialRequests.filter(function(r){return r.status==='pending';}).forEach(function(r){
    var w=Math.round((now-r.createdTs)/60000);
    if(w>5) pushAlert('y','בקשת חומר ממתינה '+w+' דקות: '+r.sku+' ('+r.lineName+')');
  });
  materialRequests.filter(function(r){return r.status==='inProgress';}).forEach(function(r){
    var w=Math.round((now-r.startTs)/60000);
    if(w>20) pushAlert('r','הזמנת חומר בטיפול '+w+' דקות: '+r.sku+' ('+r.lineName+')');
  });
}

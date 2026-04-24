// ===== SKU CATALOG =====
var skuCatalog = {};
function loadSkuCatalog(){
  if(typeof SKU_CATALOG_1!=='undefined') Object.assign(skuCatalog,SKU_CATALOG_1);
  if(typeof SKU_CATALOG_2!=='undefined') Object.assign(skuCatalog,SKU_CATALOG_2);
}
function getKnownSkus(){return Object.keys(skuCatalog);}
function selectSku(sku){
  var el=document.getElementById('mat-sku');
  if(el){el.value=sku;document.getElementById('sku-suggestions').style.display='none';document.getElementById('mat-sku-suggestions').style.display='none';}
}
function showMatSkuSuggestions(){showSkuSuggestions();}

function saveSku(sku){
  if(!sku) return;
  var saved=JSON.parse(store.getItem('ops_skus')||'[]');
  if(!saved.includes(sku)){saved.unshift(sku);if(saved.length>200)saved.pop();store.setItem('ops_skus',JSON.stringify(saved));}
}
function saveMaterials(){
  store.setItem('ops_materials',JSON.stringify(materialRequests));
  syncToServer();
}
function startMatTimer(){
  if(typeof matTimerInterval!=='undefined') clearInterval(matTimerInterval);
  matTimerInterval=setInterval(function(){
    if(document.getElementById('page-mat').classList.contains('active')) renderMaterials();
  },60000);
}
function checkMaterialAlerts(){
  var active=materialRequests.filter(function(r){return r.status==='inProgress';});
  active.forEach(function(r){
    var mins=r.startTs?Math.round((Date.now()-r.startTs)/60000):0;
    if(mins>20&&!r._alerted20){r._alerted20=true;pushAlert('r','חומר מאחר: '+r.sku+' - '+mins+' דקות');}
  });
  updateMatBdg();
}
function updateMatBdg(){
  var n=materialRequests.filter(function(r){return r.status==='pending'||r.status==='inProgress';}).length;
  var b=document.getElementById('mat-bdg');
  if(b){b.style.display=n>0?'flex':'none';b.textContent=n;}
}

function renderSkuManager(){
  var el=document.getElementById('sku-manager-list');
  if(!el) return;
  var saved=JSON.parse(store.getItem('ops_skus')||'[]');
  if(!saved.length){el.innerHTML='<div style="font-size:12px;color:var(--faint)">אין מק"טים שמורים</div>';return;}
  el.innerHTML=saved.slice(0,20).map(function(s){
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--border)">'+
      '<span style="font-size:12px;font-family:var(--mono)">'+s+'</span>'+
      '<button onclick="deleteSku(\''+s+'\')" style="font-size:10px;padding:1px 6px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--faint);cursor:pointer">מחק</button>'+
    '</div>';
  }).join('');
}
function deleteSku(sku){
  var saved=JSON.parse(store.getItem('ops_skus')||'[]');
  store.setItem('ops_skus',JSON.stringify(saved.filter(function(s){return s!==sku;})));
  renderSkuManager();
}

function renderCatalogStats(){
  var el=document.getElementById('catalog-stats');
  if(!el) return;
  var total=Object.keys(skuCatalog).length;
  el.innerHTML='<div style="font-size:13px;color:var(--green);font-weight:700">'+total+' מק"טים נטענו בהצלחה</div>';
}
function renderCatalogManager(){
  var el=document.getElementById('catalog-manager');
  if(!el) return;
  var sample=Object.entries(skuCatalog).slice(0,5);
  if(!sample.length){el.innerHTML='';return;}
  el.innerHTML='<div style="font-size:11px;color:var(--dim);margin-bottom:6px">דוגמאות:</div>'+
    sample.map(function(e){return '<div style="font-size:11px;font-family:var(--mono);color:var(--faint);padding:2px 0">'+e[0]+' — '+e[1].takt+'min</div>';}).join('');
}

// ===== WORK PLAN + TAKT MODULE =====
var wpParsed = null;
var wpLineMap = {
  'שולחן ליקוט 1':'pick',
  "שולחן יח' הנעה":'drive',
  'שולחן 1 KIT':'kit',
  'נתיב ספקי כח':'spk',
  'כבלים':'cable'
};
var wpRows = {}; // {lineId: [{so,row,sku,desc,customer,qty,takt,totalMins,done,partial,flagReason,id}]}
var wpWorkers = {}; // {lineId: N}
var wpLoaded = false;

function loadWorkPlan(event){
  var file=event.target.files[0];
  if(!file) return;
  var reader=new FileReader();
  reader.onload=function(e){
    try{
      var data=new Uint8Array(e.target.result);
      var wb=XLSX.read(data,{type:'array'});
      var ws=wb.Sheets[wb.SheetNames[0]];
      var json=XLSX.utils.sheet_to_json(ws,{defval:''});
      parseWorkPlan(json,file.name);
    }catch(err){
      document.getElementById('wp-status').textContent='שגיאה בקריאת הקובץ';
    }
  };
  reader.readAsArrayBuffer(file);
}

function parseWorkPlan(rows, fname){
  var results={};
  var lineTargets={};
  LINES.forEach(function(l){results[l.id]=[];lineTargets[l.id]=0;});

  var hasTakt=(Object.keys(skuCatalog).length>0);

  rows.forEach(function(r){
    var lineRaw=(r['קו']||r['קו '||'קו']||'').toString().trim();
    var lineId=wpLineMap[lineRaw]||wpLineMap[lineRaw.replace(/\s+/g,'')];
    if(!lineId) return;

    var sku=(r["מק'ט"]||r["מק\"ט"]||r['מקט']||'').toString().trim();
    var qty=parseFloat(r['יתרה לאריזה'])||0;
    if(qty<=0) return;

    // Get takt from catalog
    var takt=0;
    if(hasTakt && skuCatalog[sku]){
      takt=parseFloat(skuCatalog[sku].takt)||0;
    }

    var rowId=sku+'_'+(r['הזמנה']||'')+'_'+(r['שורה']||Date.now());
    results[lineId].push({
      id:rowId,
      so:(r['הזמנה']||'').toString(),
      row:parseInt(r['שורה'])||0,
      sku:sku,
      desc:(r['תאור מוצר']||'').toString().slice(0,50),
      customer:(r['שם לקוח']||'').toString().slice(0,30),
      qty:qty,
      takt:takt,
      totalMins:Math.round(takt*qty*10)/10,
      done:false,
      partial:0,
      flagReason:''
    });
    lineTargets[lineId]+=qty;
  });

  wpParsed=results;
  wpLoaded=true;

  // Show preview
  var totalRows=Object.values(results).reduce(function(s,a){return s+a.length;},0);
  var totalQty=Object.values(lineTargets).reduce(function(s,v){return s+v;},0);

  var previewHtml='<div style="background:var(--green-bg);border:1px solid rgba(16,185,129,.2);border-radius:8px;padding:10px 12px;margin-bottom:8px">'+
    '<div style="font-size:13px;font-weight:700;color:var(--green);margin-bottom:4px">'+fname+'</div>'+
    '<div style="font-size:12px;color:var(--dim)">'+totalRows+' שורות | '+totalQty+' יחידות סה"כ</div>'+
  '</div>';

  LINES.forEach(function(l){
    var arr=results[l.id]||[];
    if(!arr.length) return;
    var totalMins=arr.reduce(function(s,r){return s+r.totalMins;},0);
    var withTakt=arr.filter(function(r){return r.takt>0;}).length;
    previewHtml+='<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px">'+
      '<span style="font-weight:600">'+l.name+'</span>'+
      '<span style="font-family:var(--mono);color:var(--dim)">'+arr.length+' שורות | '+arr.reduce(function(s,r){return s+r.qty;},0)+' יח | '+Math.round(totalMins/60*10)/10+'h</span>'+
    '</div>';
  });

  document.getElementById('wp-results').innerHTML=previewHtml;
  document.getElementById('wp-preview').style.display='block';
  document.getElementById('wp-status').textContent='';
}

function applyWorkPlan(){
  if(!wpParsed) return;
  var applied=0;

  // Save parsed rows to wpRows
  LINES.forEach(function(l){
    if(wpParsed[l.id]&&wpParsed[l.id].length){
      // Merge with existing if already have partial completions
      var existing=wpRows[l.id]||[];
      var existingMap={};
      existing.forEach(function(r){existingMap[r.id]=r;});
      wpRows[l.id]=wpParsed[l.id].map(function(r){
        var ex=existingMap[r.id];
        if(ex) return Object.assign({},r,{done:ex.done,partial:ex.partial,flagReason:ex.flagReason});
        return r;
      });
      var totQty=wpRows[l.id].reduce(function(s,r){return s+r.qty;},0);
      targets[l.id]=totQty;
      applied++;
    }
  });

  // Initialize workers if not set
  LINES.forEach(function(l){if(!wpWorkers[l.id]) wpWorkers[l.id]=DEFAULT_WORKERS[l.id]||3;});

  saveState();
  saveWpRows();
  syncToServer();
  buildMorningForms();
  renderDash();
  renderOrderTracking();

  document.getElementById('fb-workplan').classList.remove('open');
  document.getElementById('fa-workplan').innerHTML='&#9654;';
  showT(applied+' נתיבים עודכנו אוטומטית!');
  pushAlert('g','תוכנית עבודה נטענה - '+applied+' נתיבים');
}

function saveWpRows(){
  store.setItem('ops_wp_rows',JSON.stringify(wpRows));
  store.setItem('ops_wp_workers',JSON.stringify(wpWorkers));
  store.setItem('ops_wp_loaded',wpLoaded?'1':'0');
}
function loadWpRows(){
  try{
    var r=store.getItem('ops_wp_rows');
    if(r) wpRows=JSON.parse(r);
    var w=store.getItem('ops_wp_workers');
    if(w) wpWorkers=JSON.parse(w);
    wpLoaded=store.getItem('ops_wp_loaded')==='1';
  }catch(e){}
}
loadWpRows();

// ===== ORDER TRACKING RENDER =====
function renderOrderTracking(){
  var el=document.getElementById('order-tracking');
  if(!el) return;
  if(!wpLoaded||!Object.keys(wpRows).length){
    el.innerHTML='<div class="empty">טען תוכנית עבודה להציג שורות</div>';
    return;
  }

  var shMins=shiftHours()*60;
  var html='';

  LINES.forEach(function(l){
    var rows=wpRows[l.id]||[];
    if(!rows.length) return;

    var workers=wpWorkers[l.id]||DEFAULT_WORKERS[l.id]||1;
    var availMins=shMins*workers;
    var usedMins=0;
    var canDo=0,canDoRows=0;
    var remaining=[];

    // Calculate which rows we CAN do this shift
    rows.forEach(function(r){
      if(r.done){usedMins+=r.totalMins;canDo+=r.qty;canDoRows++;return;}
      var needed=r.takt>0?r.totalMins:0;
      if(usedMins+needed<=availMins){
        usedMins+=needed;canDo+=r.qty;canDoRows++;
      } else {
        remaining.push(r);
      }
    });

    var totalRows=rows.length;
    var doneRows=rows.filter(function(r){return r.done;}).length;
    var pct=totalRows>0?Math.round(doneRows/totalRows*100):0;
    var overload=remaining.length>0;
    var overloadMins=remaining.reduce(function(s,r){return s+r.totalMins;},0);

    html+='<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;margin-bottom:12px;overflow:hidden">';
    // Header
    html+='<div style="padding:12px 14px;background:var(--surface);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;cursor:pointer" onclick="toggleOtLine(\''+l.id+'\')">';
    html+='<div style="display:flex;align-items:center;gap:8px">';
    html+='<span style="font-size:14px;font-weight:700">'+l.name+'</span>';
    html+='<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:'+(overload?'var(--red-bg)':'var(--green-bg)')+';color:'+(overload?'var(--red)':'var(--green)')+';border:1px solid '+(overload?'rgba(220,38,38,.2)':'rgba(16,185,129,.2)')+'">'+(overload?remaining.length+' שורות עודפות':'כל השורות אפשריות')+'</span>';
    html+='</div>';
    html+='<div style="display:flex;align-items:center;gap:12px">';
    html+='<span style="font-size:11px;color:var(--dim);font-family:var(--mono)">'+doneRows+'/'+totalRows+' שורות</span>';
    html+='<span style="font-size:12px;font-weight:700;font-family:var(--mono);color:'+(pct>=100?'var(--green)':pct>=50?'var(--yellow)':'var(--dim)')+'">'+pct+'%</span>';
    html+='<span id="ot-arr-'+l.id+'" style="font-size:11px;color:var(--faint)">&#9654;</span>';
    html+='</div></div>';

    // Worker + capacity bar
    html+='<div id="ot-body-'+l.id+'" style="display:none;padding:12px 14px">';

    // Workers input + capacity
    html+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;padding:8px 10px;background:var(--blue-bg);border:1px solid rgba(59,130,246,.15);border-radius:8px">';
    html+='<span style="font-size:12px;color:var(--dim)">עובדים:</span>';
    html+='<input type="number" id="ot-wk-'+l.id+'" value="'+workers+'" min="1" max="20" onchange="updateOtWorkers(\''+l.id+'\')" style="width:50px;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:4px;font-size:14px;font-family:var(--mono);font-weight:700;text-align:center;color:var(--text)">';
    html+='<span style="font-size:12px;color:var(--dim)">|</span>';
    html+='<span style="font-size:12px;color:var(--blue)">קיבולת משמרת: <strong>'+Math.round(availMins/60*10)/10+'h</strong></span>';
    if(overload) html+='<span style="font-size:12px;color:var(--red);margin-right:auto">עודף: <strong>'+Math.round(overloadMins/60*10)/10+'h</strong></span>';
    html+='</div>';

    // Progress bar
    var usedPct=Math.min(Math.round(usedMins/availMins*100),100);
    html+='<div style="margin-bottom:12px">';
    html+='<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--dim);margin-bottom:3px;font-family:var(--mono)">';
    html+='<span>ניצול קיבולת</span><span>'+usedPct+'%</span></div>';
    html+='<div style="height:6px;background:var(--border);border-radius:3px"><div style="height:100%;border-radius:3px;background:'+(usedPct>95?'var(--red)':usedPct>80?'var(--yellow)':'var(--green)')+';width:'+usedPct+'%"></div></div>';
    html+='</div>';

    // Rows table
    html+='<div style="font-size:11px;font-weight:700;color:var(--faint);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">שורות תוכנית</div>';

    var cumulMins=0;
    rows.forEach(function(r,idx){
      cumulMins+=r.totalMins;
      var inShift=cumulMins<=availMins||r.done;
      var rowColor=r.done?'var(--green-bg)':!inShift?'var(--red-bg)':r.flagReason?'var(--yellow-bg)':'var(--card)';
      var rowBorder=r.done?'rgba(16,185,129,.2)':!inShift?'rgba(220,38,38,.2)':r.flagReason?'rgba(217,119,6,.2)':'var(--border)';
      var statusDot=r.done?'var(--green)':!inShift?'var(--red)':r.partial>0?'var(--yellow)':'var(--faint)';

      html+='<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:'+rowColor+';border:1px solid '+rowBorder+';border-radius:8px;margin-bottom:5px">';
      html+='<span style="width:8px;height:8px;border-radius:50%;background:'+statusDot+';flex-shrink:0;display:inline-block"></span>';
      html+='<div style="flex:1;min-width:0">';
      html+='<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">';
      html+='<span style="font-size:12px;font-weight:700;font-family:var(--mono)">'+r.sku+'</span>';
      html+='<span style="font-size:11px;color:var(--dim)">'+r.so+'/'+r.row+'</span>';
      html+='</div>';
      html+='<div style="font-size:11px;color:var(--dim);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+r.desc+'</div>';
      html+='<div style="font-size:10px;color:var(--faint);font-family:var(--mono);margin-top:1px">';
      html+=r.takt+'min/יח | '+r.qty+' יח | '+(r.takt>0?Math.round(r.totalMins)+'min':'ללא טקט');
      if(r.partial>0) html+=' | עשוי: '+r.partial;
      html+='</div>';
      if(r.flagReason) html+='<div style="font-size:10px;color:var(--yellow);margin-top:2px">עיכוב: '+r.flagReason+'</div>';
      html+='</div>';
      html+='<div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">';
      if(!r.done){
        html+='<button data-lid="'+l.id+'" data-idx="'+idx+'" onclick="markRowDone(this)" style="font-size:11px;padding:3px 8px;background:var(--green-bg);border:1px solid rgba(16,185,129,.3);border-radius:5px;color:var(--green);cursor:pointer;font-weight:700">✓ סיום</button>';
        html+='<button data-lid="'+l.id+'" data-idx="'+idx+'" onclick="flagRow(this)" style="font-size:11px;padding:3px 8px;background:var(--yellow-bg);border:1px solid rgba(217,119,6,.3);border-radius:5px;color:var(--yellow);cursor:pointer">עיכוב</button>';
      } else {
        html+='<button data-lid="'+l.id+'" data-idx="'+idx+'" onclick="undoRowDone(this)" style="font-size:11px;padding:3px 8px;background:var(--surface);border:1px solid var(--border);border-radius:5px;color:var(--faint);cursor:pointer">בטל</button>';
      }
      html+='</div></div>';
    });

    html+='</div></div>';
  });

  el.innerHTML=html||'<div class="empty">אין שורות לתצוגה</div>';
}

function toggleOtLine(lid){
  var body=document.getElementById('ot-body-'+lid);
  var arr=document.getElementById('ot-arr-'+lid);
  if(!body) return;
  var open=body.style.display==='block';
  body.style.display=open?'none':'block';
  if(arr) arr.innerHTML=open?'&#9654;':'&#9660;';
}

function updateOtWorkers(lid){
  var el=document.getElementById('ot-wk-'+lid);
  if(el){wpWorkers[lid]=parseInt(el.value)||1;DEFAULT_WORKERS[lid]=wpWorkers[lid];}
  saveWpRows();syncToServer();renderOrderTracking();renderProductivity();
}

function markRowDone(btn){
  var lid=btn.dataset.lid,idx=parseInt(btn.dataset.idx);
  if(!wpRows[lid]||!wpRows[lid][idx]) return;
  wpRows[lid][idx].done=true;
  wpRows[lid][idx].doneAt=nowTime();
  saveWpRows();syncToServer();
  renderOrderTracking();
  checkOtAlerts(lid);
  showT('שורה הושלמה!');
}

function undoRowDone(btn){
  var lid=btn.dataset.lid,idx=parseInt(btn.dataset.idx);
  if(!wpRows[lid]||!wpRows[lid][idx]) return;
  wpRows[lid][idx].done=false;
  wpRows[lid][idx].doneAt=null;
  saveWpRows();syncToServer();renderOrderTracking();showT('בוטל','y');
}

function flagRow(btn){
  var lid=btn.dataset.lid,idx=parseInt(btn.dataset.idx);
  var reasons=['מחסן','ליקוט','הנדסה','איכות','IT','ייצור','אחר'];
  var reason=prompt('סיבת עיכוב:\n'+reasons.map(function(r,i){return (i+1)+'. '+r;}).join('\n'));
  if(!reason) return;
  var r=wpRows[lid]&&wpRows[lid][idx];
  if(!r) return;
  var num=parseInt(reason);
  r.flagReason=num&&reasons[num-1]?reasons[num-1]:reason;
  saveWpRows();syncToServer();renderOrderTracking();
  pushAlert('y',wpRows[lid][idx].sku+': עיכוב - '+r.flagReason);
  showT('עיכוב נרשם','y');
}

function checkOtAlerts(lid){
  if(!wpRows[lid]) return;
  var rows=wpRows[lid];
  var doneRows=rows.filter(function(r){return r.done;}).length;
  var totalRows=rows.length;
  var pct=Math.round(doneRows/totalRows*100);

  // Alert if 50% done ahead of shift midpoint
  var elPct=Math.round(elapsed()/shiftHours()*100);
  if(pct>elPct+20) pushAlert('g',LINES.filter(function(l){return l.id===lid;})[0].name+': מוביל! '+pct+'% שורות הושלמו');
  if(pct<elPct-20&&elPct>30) pushAlert('r',LINES.filter(function(l){return l.id===lid;})[0].name+': מפגר! '+pct+'% מ-'+totalRows+' שורות');
}

// ===== ETA SECTION (inside manager) =====
function renderEtaContent(){
  var el=document.getElementById('eta-content');
  if(!el) return;
  if(!wpLoaded||!Object.keys(wpRows).length){
    el.innerHTML='<div class="empty">טען תוכנית עבודה תחילה</div>';
    return;
  }
  var shMins=shiftHours()*60;
  var html='';
  LINES.forEach(function(l){
    var rows=wpRows[l.id]||[];
    if(!rows.length) return;
    var workers=wpWorkers[l.id]||DEFAULT_WORKERS[l.id]||1;
    var availMins=shMins*workers;
    var doneMins=rows.filter(function(r){return r.done;}).reduce(function(s,r){return s+r.totalMins;},0);
    var remainMins=rows.filter(function(r){return !r.done;}).reduce(function(s,r){return s+r.totalMins;},0);
    var usedPct=availMins>0?Math.round((doneMins/availMins)*100):0;

    // ETA calc: remaining mins / workers
    var etaMins=workers>0?remainMins/workers:remainMins;
    var etaH=shiftStart()+elapsed()+etaMins/60;
    var etaStr=etaH<=shiftStart()+shiftHours()?pad(Math.floor(etaH))+':'+pad(Math.round((etaH%1)*60)):'אחרי סוף משמרת';
    var over=etaH>shiftStart()+shiftHours();

    html+='<div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px">';
    html+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
    html+='<span style="font-size:14px;font-weight:700">'+l.name+'</span>';
    html+='<span style="font-size:13px;font-weight:700;font-family:var(--mono);color:'+(over?'var(--red)':'var(--green)')+'">'+etaStr+'</span>';
    html+='</div>';
    html+='<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font-size:11px;text-align:center">';
    html+='<div><div style="font-weight:700;font-family:var(--mono)">'+Math.round(remainMins/60*10)/10+'h</div><div style="color:var(--faint)">נותר</div></div>';
    html+='<div><div style="font-weight:700;font-family:var(--mono)">'+workers+'</div><div style="color:var(--faint)">עובדים</div></div>';
    html+='<div><div style="font-weight:700;font-family:var(--mono);color:'+(over?'var(--red)':'var(--green)')+'">'+usedPct+'%</div><div style="color:var(--faint)">ניצול</div></div>';
    html+='</div></div>';
  });
  el.innerHTML=html||'<div class="empty">אין נתונים</div>';
}

// Hook into toggleF to render ETA when opened
var _origToggleF=toggleF;
toggleF=function(name){
  _origToggleF(name);
  if(name==='eta') renderEtaContent();
  if(name==='ordertracking') renderOrderTracking();
};

// ===== HISTORY SAVE FUNCTION =====
function manualSaveHistory(){
  var today=new Date().toDateString();
  saveToHist(today);
  showT('היום נשמר להיסטוריה!');
  pushAlert('g','יום נוכחי נשמר להיסטוריה');
}

// ===== INIT =====
loadSkuCatalog();
loadState();
loadWpRows();

var savedShift=store.getItem('ops_shift_type');
if(savedShift&&SHIFT_TYPES[savedShift]){
  currentShiftType=savedShift;
  var sh=SHIFT_TYPES[savedShift];
  document.getElementById('shift-pill').textContent=sh.times+' - '+sh.hours+'sh ('+sh.brk+'m)';
  var sel=document.getElementById('mgr-shift-sel');
  if(sel) sel.value=savedShift;
}

buildMorningForms();
renderDash();
updateStopBdg();
updateAlertBdg();
updateMatBdg();
checkMaterialAlerts();
syncFromServer();

// Initial active stop banner
var activeStops=stoppages.filter(function(s){return s.open;});
var banner=document.getElementById('active-stop-banner');
var txt=document.getElementById('active-stop-txt');
if(banner&&txt){
  banner.style.display=activeStops.length>0?'block':'none';
  if(activeStops.length>0) txt.textContent=activeStops[0].lineName+': '+activeStops[0].reason;
}

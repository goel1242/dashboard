// ===== SKU CATALOG =====
var skuCatalog = {};
var skuOverrides = {};

function loadSkuCatalog(){
  if(typeof SKU_CATALOG_1!=='undefined') Object.assign(skuCatalog,SKU_CATALOG_1);
  if(typeof SKU_CATALOG_2!=='undefined') Object.assign(skuCatalog,SKU_CATALOG_2);
  try{var ov=store.getItem('ops_sku_overrides');if(ov)skuOverrides=JSON.parse(ov);}catch(e){}
}

function getSkuTaktSec(sku){
  if(skuOverrides[sku]!==undefined) return skuOverrides[sku];
  if(skuCatalog[sku]) return skuCatalog[sku].takt||0;
  return 0;
}

function getKnownSkus(){
  var saved=JSON.parse(store.getItem('ops_skus')||'[]');
  var catKeys=Object.keys(skuCatalog).slice(0,100);
  return Array.from(new Set(saved.concat(catKeys)));
}

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
  materialRequests.filter(function(r){return r.status==='inProgress';}).forEach(function(r){
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

// ===== CATALOG UI =====
var catalogSearch='';
var catalogPage=0;
var CATALOG_PAGE=30;

function renderCatalogStats(){
  var el=document.getElementById('catalog-stats');
  if(!el) return;
  var total=Object.keys(skuCatalog).length;
  var ov=Object.keys(skuOverrides).length;
  el.innerHTML=
    '<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">'+
      '<span style="font-size:13px;font-weight:700;color:var(--green)">'+total.toLocaleString()+' מק"טים נטענו</span>'+
      (ov?'<span style="font-size:11px;padding:2px 8px;background:var(--yellow-bg);border:1px solid rgba(217,119,6,.2);border-radius:6px;color:var(--yellow)">'+ov+' עריכות ידניות</span>':'')+
      (ov?'<button onclick="resetCatalogOverrides()" style="font-size:10px;padding:2px 8px;background:var(--surface);border:1px solid var(--border);border-radius:5px;color:var(--faint);cursor:pointer">אפס עריכות</button>':'')+
    '</div>'+
    '<input type="text" id="catalog-search-in" placeholder="חפש לפי מק\"ט או תיאור..." oninput="catalogSearch=this.value;catalogPage=0;renderCatalogTable()" '+
    'style="width:100%;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:9px 12px;color:var(--text);font-size:13px;margin-bottom:8px">'+
    '<div id="catalog-table-wrap"></div>';
  renderCatalogTable();
}

function renderCatalogManager(){
  renderCatalogTable();
}

function renderCatalogTable(){
  var wrap=document.getElementById('catalog-table-wrap');
  if(!wrap) return;
  var term=(catalogSearch||'').toLowerCase().trim();
  var allKeys=Object.keys(skuCatalog);
  var filtered=term?allKeys.filter(function(k){
    var e=skuCatalog[k];
    return k.toLowerCase().includes(term)||(e.desc&&e.desc.toLowerCase().includes(term));
  }):allKeys;
  var total=filtered.length;
  var start=catalogPage*CATALOG_PAGE;
  var page=filtered.slice(start,start+CATALOG_PAGE);
  if(!page.length){wrap.innerHTML='<div style="font-size:12px;color:var(--faint);padding:12px;text-align:center">לא נמצאו תוצאות</div>';return;}

  var lineLabels={T1:'ליקוט',T2:'יח.הנעה',T3:'ערכות',T4:'ערכות',T5:'כבלים',TD5:'כבלים',T6:'ספכ"ים'};
  var lineColors={T1:'var(--blue)',T2:'var(--purple)',T3:'var(--green)',T4:'var(--green)',T5:'var(--yellow)',TD5:'var(--yellow)',T6:'var(--red)'};

  var html='<div style="font-size:11px;color:var(--faint);margin-bottom:6px;font-family:var(--mono)">'+
    total.toLocaleString()+' תוצאות'+(term?' | "'+catalogSearch+'"':'')+
    ' | עמוד '+(catalogPage+1)+'/'+Math.ceil(total/CATALOG_PAGE)+'</div>';

  // Header row
  html+='<div style="display:grid;grid-template-columns:130px 1fr 70px 80px 50px;gap:4px;padding:5px 8px;background:var(--surface);border:1px solid var(--border);border-radius:8px 8px 0 0;font-size:10px;font-weight:700;color:var(--faint);text-transform:uppercase;letter-spacing:.5px">'+
    '<div>מק"ט</div><div>תיאור</div><div>נתיב</div><div>טקט (שנ)</div><div></div>'+
  '</div>';

  html+='<div style="border:1px solid var(--border);border-top:none;border-radius:0 0 8px 8px;overflow:hidden">';
  page.forEach(function(sku,i){
    var e=skuCatalog[sku]||{};
    var takt=skuOverrides[sku]!==undefined?skuOverrides[sku]:(e.takt||0);
    var isOv=skuOverrides[sku]!==undefined;
    var ll=lineLabels[e.line]||e.line||'';
    var lc=lineColors[e.line]||'var(--faint)';
    var bg=i%2===0?'var(--card)':'var(--surface)';
    var safeId=sku.replace(/[^a-zA-Z0-9]/g,'_');

    html+='<div style="display:grid;grid-template-columns:130px 1fr 70px 80px 50px;gap:4px;padding:7px 8px;background:'+bg+';border-bottom:1px solid rgba(203,213,225,.35);align-items:center">';
    html+='<div style="font-size:11px;font-family:var(--mono);color:var(--blue);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+sku+'">'+sku+'</div>';
    html+='<div style="font-size:11px;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+(e.desc||'')+'">'+( e.desc||'—')+'</div>';
    html+='<div style="font-size:10px;font-weight:700;color:'+lc+'">'+ll+'</div>';
    html+='<div style="display:flex;align-items:center;gap:4px">'+
      '<span style="font-size:12px;font-family:var(--mono);font-weight:700;color:'+(isOv?'var(--yellow)':'var(--text)')+'">'+takt+'"</span>'+
      (isOv?'<span style="font-size:9px;color:var(--yellow)">✎</span>':'')+
    '</div>';
    html+='<button onclick="editCatalogTakt(\''+sku+'\')" style="font-size:10px;padding:2px 6px;background:var(--surface);border:1px solid var(--border);border-radius:5px;color:var(--dim);cursor:pointer">ערוך</button>';
    html+='</div>';
  });
  html+='</div>';

  // Pagination
  var totalPages=Math.ceil(total/CATALOG_PAGE);
  if(totalPages>1){
    html+='<div style="display:flex;justify-content:center;align-items:center;gap:8px;margin-top:8px">';
    html+='<button onclick="catalogPage=Math.max(0,catalogPage-1);renderCatalogTable()" '+(catalogPage===0?'disabled':'')+' style="padding:4px 10px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--dim);cursor:pointer;font-size:11px">◀</button>';
    html+='<span style="font-size:11px;color:var(--faint);font-family:var(--mono)">'+(catalogPage+1)+' / '+totalPages+'</span>';
    html+='<button onclick="catalogPage=Math.min('+( totalPages-1)+',catalogPage+1);renderCatalogTable()" '+(catalogPage===totalPages-1?'disabled':'')+' style="padding:4px 10px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--dim);cursor:pointer;font-size:11px">▶</button>';
    html+='</div>';
  }

  wrap.innerHTML=html;
  if(term){var s=document.getElementById('catalog-search-in');if(s){s.value=catalogSearch;s.focus();s.setSelectionRange(s.value.length,s.value.length);}}
}

function editCatalogTakt(sku){
  var cur=skuOverrides[sku]!==undefined?skuOverrides[sku]:(skuCatalog[sku]?skuCatalog[sku].takt:0);
  var e=skuCatalog[sku]||{};
  var v=prompt('עריכת טקט טיים:\n'+sku+(e.desc?' | '+e.desc:'')+'\n\nערך נוכחי: '+cur+' שניות\nהזן ערך חדש:',cur);
  if(v===null) return;
  var p=parseFloat(v);
  if(isNaN(p)||p<0){showT('ערך לא תקין','y');return;}
  skuOverrides[sku]=p;
  store.setItem('ops_sku_overrides',JSON.stringify(skuOverrides));
  renderCatalogTable();
  showT('טקט עודכן: '+p+'"');
}

function resetCatalogOverrides(){
  skuOverrides={};
  store.setItem('ops_sku_overrides','{}');
  renderCatalogStats();
  showT('אופס','y');
}

function renderSkuManager(){
  var el=document.getElementById('sku-manager-list');
  if(!el) return;
  var saved=JSON.parse(store.getItem('ops_skus')||'[]');
  if(!saved.length){el.innerHTML='<div style="font-size:12px;color:var(--faint)">אין מק"טים שמורים</div>';return;}
  el.innerHTML=saved.slice(0,20).map(function(s){
    var e=skuCatalog[s]||{};
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border)">'+
      '<div><div style="font-size:12px;font-family:var(--mono)">'+s+'</div>'+(e.desc?'<div style="font-size:10px;color:var(--faint)">'+e.desc+'</div>':'')+
      '</div><button onclick="deleteSku(\''+s+'\')" style="font-size:10px;padding:1px 6px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--faint);cursor:pointer">מחק</button></div>';
  }).join('');
}
function deleteSku(sku){
  var saved=JSON.parse(store.getItem('ops_skus')||'[]');
  store.setItem('ops_skus',JSON.stringify(saved.filter(function(s){return s!==sku;})));
  renderSkuManager();
}

// ===== WORK PLAN =====
var wpParsed=null;
var wpLineMap={'שולחן ליקוט 1':'pick',"שולחן יח' הנעה":'drive','שולחן 1 KIT':'kit','נתיב ספקי כח':'spk','כבלים':'cable'};
var wpRows={};
var wpWorkers={};
var wpLoaded=false;

function loadWorkPlan(event){
  var file=event.target.files[0];if(!file) return;
  document.getElementById('wp-status').textContent='טוען...';
  var reader=new FileReader();
  reader.onload=function(e){
    try{
      var data=new Uint8Array(e.target.result);
      var wb=XLSX.read(data,{type:'array'});
      var ws=wb.Sheets[wb.SheetNames[0]];
      var json=XLSX.utils.sheet_to_json(ws,{defval:''});
      parseWorkPlan(json,file.name);
    }catch(err){document.getElementById('wp-status').textContent='שגיאה: '+err.message;}
  };
  reader.readAsArrayBuffer(file);
}

function parseWorkPlan(rows,fname){
  var results={};
  LINES.forEach(function(l){results[l.id]=[];});
  rows.forEach(function(r){
    var lineRaw=(r['קו']||'').toString().trim();
    var lineId=wpLineMap[lineRaw];if(!lineId) return;
    var sku=(r["מק'ט"]||r["מק\"ט"]||'').toString().trim();
    var qty=parseFloat(r['יתרה לאריזה'])||0;if(qty<=0) return;
    var taktSec=getSkuTaktSec(sku);
    var totalMins=Math.round(taktSec/60*qty*10)/10;
    results[lineId].push({
      id:sku+'_'+(r['הזמנה']||'')+'_'+(r['שורה']||''),
      so:(r['הזמנה']||'').toString(),row:parseInt(r['שורה'])||0,
      sku:sku,desc:(r['תאור מוצר']||'').toString().slice(0,50),
      customer:(r['שם לקוח']||'').toString().slice(0,30),
      qty:qty,taktSec:taktSec,totalMins:totalMins,
      done:false,partial:0,flagReason:''
    });
  });
  wpParsed=results;wpLoaded=true;
  var totalR=Object.values(results).reduce(function(s,a){return s+a.length;},0);
  var totalQ=Object.values(results).reduce(function(s,a){return s+a.reduce(function(ss,r){return ss+r.qty;},0);},0);
  var ph='<div style="background:var(--green-bg);border:1px solid rgba(16,185,129,.2);border-radius:8px;padding:10px 12px;margin-bottom:10px">'+
    '<div style="font-size:13px;font-weight:700;color:var(--green);margin-bottom:3px">✓ '+fname+'</div>'+
    '<div style="font-size:12px;color:var(--dim)">'+totalR+' שורות | '+totalQ+' יחידות</div></div>';
  LINES.forEach(function(l){
    var arr=results[l.id]||[];if(!arr.length) return;
    var tm=arr.reduce(function(s,r){return s+r.totalMins;},0);
    ph+='<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px">'+
      '<span style="font-weight:600">'+l.name+'</span>'+
      '<span style="font-family:var(--mono);color:var(--dim)">'+arr.length+' שורות | '+arr.reduce(function(s,r){return s+r.qty;},0)+' יח | '+Math.round(tm/60*10)/10+'h</span></div>';
  });
  document.getElementById('wp-results').innerHTML=ph;
  document.getElementById('wp-preview').style.display='block';
  document.getElementById('wp-status').textContent='';
}

function applyWorkPlan(){
  if(!wpParsed) return;
  var applied=0;
  LINES.forEach(function(l){
    if(wpParsed[l.id]&&wpParsed[l.id].length){
      var ex={};(wpRows[l.id]||[]).forEach(function(r){ex[r.id]=r;});
      wpRows[l.id]=wpParsed[l.id].map(function(r){var e=ex[r.id];return e?Object.assign({},r,{done:e.done,partial:e.partial,flagReason:e.flagReason}):r;});
      targets[l.id]=wpRows[l.id].reduce(function(s,r){return s+r.qty;},0);applied++;
    }
  });
  LINES.forEach(function(l){if(!wpWorkers[l.id])wpWorkers[l.id]=DEFAULT_WORKERS[l.id]||3;});
  saveState();saveWpRows();syncToServer();buildMorningForms();renderDash();renderOrderTracking();
  document.getElementById('fb-workplan').classList.remove('open');document.getElementById('fa-workplan').innerHTML='&#9654;';
  showT(applied+' נתיבים עודכנו!');pushAlert('g','תוכנית עבודה נטענה - '+applied+' נתיבים');
}

function saveWpRows(){
  store.setItem('ops_wp_rows',JSON.stringify(wpRows));
  store.setItem('ops_wp_workers',JSON.stringify(wpWorkers));
  store.setItem('ops_wp_loaded',wpLoaded?'1':'0');
}
function loadWpRows(){
  try{
    var r=store.getItem('ops_wp_rows');if(r)wpRows=JSON.parse(r);
    var w=store.getItem('ops_wp_workers');if(w)wpWorkers=JSON.parse(w);
    wpLoaded=store.getItem('ops_wp_loaded')==='1';
  }catch(e){}
}
loadWpRows();

// ===== ORDER TRACKING RENDER =====
function renderOrderTracking(){
  var el=document.getElementById('order-tracking');if(!el) return;
  if(!wpLoaded||!Object.keys(wpRows).some(function(k){return wpRows[k]&&wpRows[k].length;})){
    el.innerHTML='<div class="empty">טען תוכנית עבודה להציג שורות</div>';return;
  }
  var shMins=shiftHours()*60;
  var html='';
  LINES.forEach(function(l){
    var rows=wpRows[l.id]||[];if(!rows.length) return;
    var workers=wpWorkers[l.id]||DEFAULT_WORKERS[l.id]||1;
    var availMins=shMins*workers;
    var doneRows=rows.filter(function(r){return r.done;}).length;
    var pct=rows.length>0?Math.round(doneRows/rows.length*100):0;

    // Which rows fit in shift (parallel)
    var cumulP=0;var overRows=0;
    rows.forEach(function(r){
      if(r.done) return;
      var pm=workers>0?r.totalMins/workers:r.totalMins;
      if(cumulP+pm>shMins) overRows++;
      else cumulP+=pm;
    });

    var remainMins=rows.filter(function(r){return !r.done;}).reduce(function(s,r){return s+r.totalMins;},0);
    var remainH=Math.round(remainMins/workers/60*10)/10;
    var over=overRows>0;
    var allDone=doneRows===rows.length&&rows.length>0;

    html+='<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;margin-bottom:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.05)">';

    // Header
    html+='<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;cursor:pointer;border-bottom:1px solid var(--border);background:var(--surface)" onclick="toggleOtLine(\''+l.id+'\')">';
    html+='<div style="display:flex;align-items:center;gap:10px">';
    html+='<div style="width:4px;height:36px;border-radius:2px;background:'+(allDone?'var(--green)':over?'var(--red)':'var(--blue)')+';flex-shrink:0"></div>';
    html+='<div><div style="font-size:14px;font-weight:700">'+l.name+'</div>';
    html+='<div style="font-size:11px;color:var(--dim);font-family:var(--mono);margin-top:2px">'+doneRows+'/'+rows.length+' שורות | נותר: '+remainH+'h עם '+workers+' עובדים</div></div>';
    html+='<div style="display:flex;gap:5px;flex-wrap:wrap">';
    if(over) html+='<span style="font-size:10px;padding:2px 7px;border-radius:10px;background:var(--red-bg);color:var(--red);border:1px solid rgba(220,38,38,.2);font-weight:700">'+overRows+' שורות עודפות</span>';
    if(allDone) html+='<span style="font-size:10px;padding:2px 7px;border-radius:10px;background:var(--green-bg);color:var(--green);border:1px solid rgba(16,185,129,.2);font-weight:700">הושלם ✓</span>';
    html+='</div></div>';
    html+='<div style="display:flex;align-items:center;gap:10px"><div style="text-align:center"><div style="font-size:20px;font-weight:900;font-family:var(--mono);color:'+(pct===100?'var(--green)':pct>50?'var(--blue)':'var(--faint)')+'">'+pct+'%</div><div style="font-size:9px;color:var(--faint)">ביצוע</div></div>';
    html+='<span id="ot-arr-'+l.id+'" style="font-size:11px;color:var(--faint)">&#9654;</span></div></div>';

    // Body
    html+='<div id="ot-body-'+l.id+'" style="display:none">';

    // Workers strip
    html+='<div style="padding:9px 16px;background:rgba(37,99,235,.04);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;flex-wrap:wrap">';
    html+='<div style="display:flex;align-items:center;gap:6px"><span style="font-size:11px;color:var(--dim)">עובדים במשמרת:</span>';
    html+='<input type="number" id="ot-wk-'+l.id+'" value="'+workers+'" min="1" max="20" onchange="updateOtWorkers(\''+l.id+'\')" ';
    html+='style="width:48px;background:var(--card);border:1.5px solid var(--blue);border-radius:7px;padding:4px;font-size:15px;font-family:var(--mono);font-weight:800;text-align:center;color:var(--blue)"></div>';
    html+='<span style="font-size:11px;color:var(--dim)">קיבולת: <strong style="color:var(--blue)">'+Math.round(availMins/60*10)/10+'h</strong></span>';
    // Capacity progress bar
    var doneMinsP=rows.filter(function(r){return r.done;}).reduce(function(s,r){return s+r.totalMins/workers;},0);
    var capPct=availMins/workers>0?Math.min(Math.round(doneMinsP/(availMins/workers)*100),100):0;
    html+='<div style="flex:1;min-width:80px"><div style="height:4px;background:var(--border);border-radius:2px"><div style="height:100%;border-radius:2px;background:var(--green);width:'+capPct+'%;transition:width .5s"></div></div><div style="font-size:9px;color:var(--faint);margin-top:2px;font-family:var(--mono)">'+capPct+'% שנוצל</div></div>';
    html+='</div>';

    // Rows
    html+='<div style="padding:10px 16px">';
    var cumP2=0;
    rows.forEach(function(r,idx){
      var pm=workers>0?r.totalMins/workers:r.totalMins;
      if(!r.done) cumP2+=pm;
      var inShift=cumP2<=shMins||r.done;
      var bg=r.done?'rgba(5,150,105,.07)':!inShift?'rgba(220,38,38,.05)':r.flagReason?'rgba(217,119,6,.05)':'var(--surface)';
      var bdr=r.done?'rgba(5,150,105,.2)':!inShift?'rgba(220,38,38,.2)':r.flagReason?'rgba(217,119,6,.2)':'var(--border)';
      var bar=r.done?'var(--green)':!inShift?'var(--red)':r.flagReason?'var(--yellow)':'transparent';

      html+='<div style="display:flex;align-items:stretch;margin-bottom:6px;border-radius:9px;border:1px solid '+bdr+';overflow:hidden;background:'+bg+'">';
      html+='<div style="width:3px;background:'+bar+';flex-shrink:0"></div>';
      html+='<div style="flex:1;padding:9px 10px;display:flex;align-items:center;gap:8px;min-width:0">';
      html+='<span style="font-size:16px;flex-shrink:0">'+(r.done?'✅':!inShift?'🔴':r.flagReason?'⚠️':'⬜')+'</span>';
      html+='<div style="flex:1;min-width:0">';
      html+='<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">';
      html+='<span style="font-size:12px;font-weight:700;font-family:var(--mono);color:var(--blue)">'+r.sku+'</span>';
      html+='<span style="font-size:10px;color:var(--faint);font-family:var(--mono)">'+r.so+'/'+r.row+'</span>';
      if(r.taktSec>0) html+='<span style="font-size:10px;padding:1px 6px;border-radius:5px;background:var(--blue-bg);color:var(--blue);font-family:var(--mono)">'+r.taktSec+'"</span>';
      html+='</div>';
      html+='<div style="font-size:11px;color:var(--dim);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+r.desc+'</div>';
      html+='<div style="font-size:10px;color:var(--faint);font-family:var(--mono);margin-top:2px">'+r.qty+' יח | '+Math.round(r.totalMins)+'min | '+r.customer+(r.doneAt?' | ✓ '+r.doneAt:'')+'</div>';
      if(r.flagReason) html+='<div style="font-size:10px;color:var(--yellow);margin-top:2px;font-weight:600">⚠ '+r.flagReason+'</div>';
      html+='</div>';
      html+='<div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">';
      if(!r.done){
        html+='<button data-lid="'+l.id+'" data-idx="'+idx+'" onclick="markRowDone(this)" style="font-size:11px;padding:5px 10px;background:linear-gradient(135deg,#059669,#10b981);border:none;border-radius:7px;color:#fff;cursor:pointer;font-weight:700">✓ סיום</button>';
        html+='<button data-lid="'+l.id+'" data-idx="'+idx+'" onclick="flagRow(this)" style="font-size:10px;padding:4px 8px;background:var(--yellow-bg);border:1px solid rgba(217,119,6,.3);border-radius:7px;color:var(--yellow);cursor:pointer">⚠ עיכוב</button>';
      } else {
        html+='<button data-lid="'+l.id+'" data-idx="'+idx+'" onclick="undoRowDone(this)" style="font-size:10px;padding:4px 8px;background:var(--surface);border:1px solid var(--border);border-radius:7px;color:var(--faint);cursor:pointer">↩ בטל</button>';
      }
      html+='</div></div></div>';
    });
    html+='</div></div></div>';
  });
  el.innerHTML=html||'<div class="empty">אין שורות</div>';
}

function toggleOtLine(lid){
  var b=document.getElementById('ot-body-'+lid),a=document.getElementById('ot-arr-'+lid);
  if(!b) return;
  var open=b.style.display==='block';
  b.style.display=open?'none':'block';
  if(a) a.innerHTML=open?'&#9654;':'&#9660;';
}
function updateOtWorkers(lid){
  var el=document.getElementById('ot-wk-'+lid);
  if(el){wpWorkers[lid]=parseInt(el.value)||1;DEFAULT_WORKERS[lid]=wpWorkers[lid];}
  saveWpRows();syncToServer();renderOrderTracking();renderProductivity();
}
function markRowDone(btn){
  var lid=btn.dataset.lid,idx=parseInt(btn.dataset.idx);
  if(!wpRows[lid]||!wpRows[lid][idx]) return;
  wpRows[lid][idx].done=true;wpRows[lid][idx].doneAt=nowTime();
  saveWpRows();syncToServer();renderOrderTracking();checkOtAlerts(lid);showT('שורה הושלמה!');
}
function undoRowDone(btn){
  var lid=btn.dataset.lid,idx=parseInt(btn.dataset.idx);
  if(!wpRows[lid]||!wpRows[lid][idx]) return;
  wpRows[lid][idx].done=false;wpRows[lid][idx].doneAt=null;
  saveWpRows();syncToServer();renderOrderTracking();showT('בוטל','y');
}
function flagRow(btn){
  var lid=btn.dataset.lid,idx=parseInt(btn.dataset.idx);
  var reasons=['1. מחסן','2. ליקוט','3. הנדסה','4. איכות','5. IT','6. ייצור','7. אחר'];
  var v=prompt('סיבת עיכוב:\n'+reasons.join('\n'));
  if(v===null) return;
  var r=wpRows[lid]&&wpRows[lid][idx];if(!r) return;
  var num=parseInt(v);
  var labels=['מחסן','ליקוט','הנדסה','איכות','IT','ייצור','אחר'];
  r.flagReason=num>=1&&num<=7?labels[num-1]:v;
  saveWpRows();syncToServer();renderOrderTracking();
  var ln=(LINES.filter(function(l){return l.id===lid;})[0]||{}).name||lid;
  pushAlert('y',ln+' | '+r.sku+': '+r.flagReason);showT('עיכוב נרשם','y');
}
function checkOtAlerts(lid){
  if(!wpRows[lid]) return;
  var rows=wpRows[lid];
  var doneRows=rows.filter(function(r){return r.done;}).length;
  var pct=Math.round(doneRows/rows.length*100);
  var elPct=Math.round(elapsed()/shiftHours()*100);
  var ln=(LINES.filter(function(l){return l.id===lid;})[0]||{}).name||lid;
  if(pct>elPct+20) pushAlert('g',ln+': מוביל — '+pct+'% הושלמו');
  if(pct<elPct-20&&elPct>30) pushAlert('r',ln+': מפגר — '+pct+'% מ-'+rows.length+' שורות');
}

// ===== ETA =====
function renderEtaContent(){
  var el=document.getElementById('eta-content');if(!el) return;
  if(!wpLoaded||!Object.keys(wpRows).some(function(k){return wpRows[k]&&wpRows[k].length;})){
    el.innerHTML='<div class="empty">טען תוכנית עבודה תחילה</div>';return;
  }
  var html='';
  LINES.forEach(function(l){
    var rows=wpRows[l.id]||[];if(!rows.length) return;
    var workers=wpWorkers[l.id]||DEFAULT_WORKERS[l.id]||1;
    var remainMins=rows.filter(function(r){return !r.done;}).reduce(function(s,r){return s+r.totalMins;},0);
    var parallelRemain=workers>0?remainMins/workers:remainMins;
    var etaH=shiftStart()+elapsed()+parallelRemain/60;
    var over=etaH>shiftStart()+shiftHours();
    var etaStr=over?'חורג ממשמרת':pad(Math.floor(etaH))+':'+pad(Math.round((etaH%1)*60));
    var doneMinsP=rows.filter(function(r){return r.done;}).reduce(function(s,r){return s+r.totalMins/workers;},0);
    var shMins=shiftHours()*60;
    var capPct=Math.min(Math.round(doneMinsP/shMins*100),100);

    html+='<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:13px 14px;margin-bottom:8px">';
    html+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
    html+='<span style="font-size:14px;font-weight:700">'+l.name+'</span>';
    html+='<div style="text-align:left"><div style="font-size:16px;font-weight:900;font-family:var(--mono);color:'+(over?'var(--red)':'var(--green)')+'">'+etaStr+'</div><div style="font-size:9px;color:var(--faint)">זמן סיום</div></div>';
    html+='</div>';
    html+='<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px">';
    html+='<div class="sbox"><div class="sbox-v" style="font-size:16px;color:var(--blue)">'+workers+'</div><div class="sbox-l">עובדים</div></div>';
    html+='<div class="sbox"><div class="sbox-v" style="font-size:16px">'+Math.round(parallelRemain/60*10)/10+'h</div><div class="sbox-l">נותר</div></div>';
    html+='<div class="sbox"><div class="sbox-v" style="font-size:16px;color:'+(capPct>80?'var(--green)':'var(--blue)')+'">'+capPct+'%</div><div class="sbox-l">ניצול</div></div>';
    html+='</div>';
    html+='<div style="height:5px;background:var(--border);border-radius:3px"><div style="height:100%;border-radius:3px;background:'+(over?'var(--red)':capPct>80?'var(--green)':'var(--blue)')+';width:'+capPct+'%;transition:width .5s"></div></div>';
    html+='</div>';
  });
  el.innerHTML=html||'<div class="empty">אין נתונים</div>';
}

// Hook toggleF
var _origToggleF=toggleF;
toggleF=function(name){
  _origToggleF(name);
  if(name==='eta') renderEtaContent();
  if(name==='ordertracking') renderOrderTracking();
  if(name==='catalog'){renderCatalogStats();renderCatalogManager();}
};

// ===== MISC =====
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

var activeStops=stoppages.filter(function(s){return s.open;});
var banner=document.getElementById('active-stop-banner');
var txt=document.getElementById('active-stop-txt');
if(banner&&txt){
  banner.style.display=activeStops.length>0?'block':'none';
  if(activeStops.length>0) txt.textContent=activeStops[0].lineName+': '+activeStops[0].reason;
}

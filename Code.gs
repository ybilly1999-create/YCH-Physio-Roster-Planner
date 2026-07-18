/*************************************************************************
 * YCH Physio Dept — Roster Web App API  (Google Apps Script Web App)
 * Standalone project for 仁濟醫院物理治療部. NOT related to PhysioEdHub etc.
 *
 * DEPLOY: Extensions ▸ Apps Script ▸ paste this file ▸ Deploy ▸ New deployment
 *   Type: Web app | Execute as: Me | Who has access: Anyone
 * Then set Script Properties (Project Settings ▸ Script properties):
 *   ADMIN_TOKEN = ychphysioadmin
 *   STAFF_TOKEN = ychphysio
 * Copy the /exec URL into the frontend config (VITE_API_URL).
 *
 * Frontend does FAST reads directly from the Sheet via gviz JSON.
 * This script handles WRITES + server-side rule checks + role enforcement.
 *************************************************************************/

// ---- Layout constants (match YCH_Physio_Roster workbook) ----
var SM = 'Staff_Master';
var SM_HR = 5, SM_FIRST = 6, SM_LAST = 56;
// Staff_Master columns (1-based)
var C = {
  name:2, abbr:3, ort:4, neuro:5, ms:6, tier:7, mentor:8,
  ph_order:9, ph_round:10, shs_order:11,
  ty_active:12, ty_round:13, ty_order:14,
  ew_active:15, ew_round:16, ew_order:17,
  sk_active:18, sk_round:19, sk_order:20,
  active:21, leave_start:22, leave_end:23,
  cnt_sat:25, cnt_sun:26, cnt_prs:27, cnt_shs:28, total:29, fair:30
};
var CAL_PREFIX = 'CAL_';
var CAL_HR = 7, CAL_FIRST = 8;
// CAL columns: B date .. W status X failreason
var CC = { date:2, weekday:3, type:4, ipd1:5, ipd6:10, opd:11, status:23, fail:24 };
var LOG = 'Change_Log';
var HOL = 'Holidays';
var WL  = 'Workload';
var DR  = 'Duty_Record';
var MK = { // make-up sheets + their Staff_Master round/order columns
  sick:    { sheet:'Sick_Leave_Roster',      active:C.sk_active, round:C.sk_round, order:C.sk_order },
  typhoon: { sheet:'Typhoon_Roster',          active:C.ty_active, round:C.ty_round, order:C.ty_order },
  exwx:    { sheet:'Extreme_Weather_Roster',  active:C.ew_active, round:C.ew_round, order:C.ew_order }
};
var MK_HIST_FIRST = 6, MK_HIST_DATE = 13, MK_HIST_ABBR = 14, MK_HIST_NAME = 15;

// ---------------------------------------------------------------- utils
function _ss(){ return SpreadsheetApp.getActiveSpreadsheet(); }
function _sh(n){ return _ss().getSheetByName(n); }
function _props(){ return PropertiesService.getScriptProperties(); }
function _out(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
function _role(token){
  var p=_props();
  if (token && token===p.getProperty('ADMIN_TOKEN')) return 'admin';
  if (token && token===p.getProperty('STAFF_TOKEN')) return 'staff';
  return null;
}
function _now(){ return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'); }
function _lock(fn){
  var lock=LockService.getScriptLock();
  lock.waitLock(25000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function _log(action, detail, who){
  var sh=_sh(LOG); if(!sh) return;
  sh.appendRow([_now(), who||'', action||'', detail||'']);
}

// ---------------------------------------------------------------- doGet (reads)
function doGet(e){
  try {
    var a=(e && e.parameter && e.parameter.action) || 'getMeta';
    switch(a){
      case 'login':       return _out(loginCheck(e.parameter.token));
      case 'getMeta':      return _out(getMeta());
      case 'getStaff':     return _out({ok:true, rows:getStaff()});
      case 'getHolidays':  return _out({ok:true, rows:readTable(HOL)});
      case 'getCalendar':  return _out({ok:true, rows:getCalendar(e.parameter.year, e.parameter.from, e.parameter.to)});
      case 'getMakeup':    return _out({ok:true, rows:getMakeup(e.parameter.type)});
      case 'getRollcall':  return _out({ok:true, rows:getRollcall(e.parameter.date)});
      case 'getWorkload':  return _out({ok:true, rows:readTable(WL)});
      default:             return _out({ok:false, error:'unknown action '+a});
    }
  } catch(err){ return _out({ok:false, error:String(err)}); }
}

// ---------------------------------------------------------------- doPost (writes)
function doPost(e){
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    var role = _role(body.token);
    if(!role) return _out({ok:false, error:'unauthorized'});
    var a = body.action;
    var adminOnly = {generateCalendar:1, generateRoster:1, randomizePH:1, upsertStaff:1,
                     setActive:1, rebuildOrders:1, importHolidays:1, addHoliday:1,
                     editHoliday:1, deleteHoliday:1, forceOverride:1, approveSwap:1, rejectSwap:1};
    if(adminOnly[a] && role!=='admin') return _out({ok:false, error:'admin only'});

    return _lock(function(){
      switch(a){
        case 'applyChange':    return _out(applyChange(body, role));
        case 'requestSwap':    return _out(requestSwap(body, role));
        case 'forceOverride':  return _out(forceOverride(body, role));
        case 'recordBack':     return _out(recordBack(body, role));
        case 'saveRollcall':   return _out(saveRollcall(body, role));
        case 'randomizePH':    return _out(randomizePH(body, role));
        case 'upsertStaff':    return _out(upsertStaff(body, role));
        case 'setActive':      return _out(setActive(body, role));
        case 'rebuildOrders':  return _out(rebuildOrders(body, role));
        case 'generateCalendar': return _out(generateCalendar(body, role));
        case 'generateRoster': return _out(generateRoster(body, role));
        case 'importHolidays': return _out(importHolidays(body, role));
        case 'addHoliday':     return _out(holidayOp('add', body, role));
        case 'editHoliday':    return _out(holidayOp('edit', body, role));
        case 'deleteHoliday':  return _out(holidayOp('delete', body, role));
        default: return _out({ok:false, error:'unknown action '+a});
      }
    });
  } catch(err){ return _out({ok:false, error:String(err)}); }
}

// ---------------------------------------------------------------- login (validate token server-side)
// Frontend sends the entered token; we return the role WITHOUT the real tokens ever
// appearing in the public frontend code.
function loginCheck(token){
  var role=_role(token);
  if(!role) return {ok:false, error:'invalid token'};
  return {ok:true, role:role};
}

// ---------------------------------------------------------------- READ helpers
function getMeta(){
  var ss=_ss(); var years=[];
  ss.getSheets().forEach(function(s){
    var m=s.getName().match(/^CAL_(\d{4})$/); if(m) years.push(Number(m[1]));
  });
  years.sort();
  return {ok:true, name:'YCH Physio Dept Roster', years:years,
          tz:Session.getScriptTimeZone(), serverTime:_now()};
}
function getStaff(){
  var sh=_sh(SM);
  var last=SM_LAST, rows=[];
  var vals=sh.getRange(SM_FIRST,1,last-SM_FIRST+1, C.fair).getValues();
  vals.forEach(function(r){
    if(!r[C.abbr-1]) return;
    rows.push({
      name:r[C.name-1], abbr:r[C.abbr-1], ort:r[C.ort-1], neuro:r[C.neuro-1], ms:r[C.ms-1],
      tier:r[C.tier-1], mentor:r[C.mentor-1],
      ph_order:r[C.ph_order-1], ph_round:r[C.ph_round-1], shs_order:r[C.shs_order-1],
      ty:{active:r[C.ty_active-1], round:r[C.ty_round-1], order:r[C.ty_order-1]},
      ew:{active:r[C.ew_active-1], round:r[C.ew_round-1], order:r[C.ew_order-1]},
      sk:{active:r[C.sk_active-1], round:r[C.sk_round-1], order:r[C.sk_order-1]},
      active:r[C.active-1], leave_start:r[C.leave_start-1], leave_end:r[C.leave_end-1]
    });
  });
  return rows;
}
function readTable(name){
  var sh=_sh(name); if(!sh) return [];
  var data=sh.getDataRange().getValues();
  // find header row (first row with >=2 non-empty cells after row 4)
  var hr=-1;
  for(var i=0;i<data.length;i++){
    var nonEmpty=data[i].filter(function(v){return v!==''&&v!==null;}).length;
    if(nonEmpty>=2 && i>=4){ hr=i; break; }
  }
  if(hr<0) return [];
  var heads=data[hr].map(function(h){return String(h).trim();});
  var out=[];
  for(var r=hr+1;r<data.length;r++){
    var row=data[r]; if(row.every(function(v){return v===''||v===null;})) continue;
    var o={}; for(var c=0;c<heads.length;c++){ if(heads[c]) o[heads[c]]=row[c]; }
    out.push(o);
  }
  return out;
}
function getCalendar(year, from, to){
  var sh=_sh(CAL_PREFIX+(year||new Date().getFullYear()));
  if(!sh) return [];
  var last=sh.getLastRow();
  if(last<CAL_FIRST) return [];
  var vals=sh.getRange(CAL_FIRST,1,last-CAL_FIRST+1, CC.fail).getValues();
  var tz=Session.getScriptTimeZone(); var out=[];
  vals.forEach(function(r){
    var d=r[CC.date-1]; if(!d) return;
    var ds=(d instanceof Date)?Utilities.formatDate(d,tz,'yyyy-MM-dd'):String(d);
    if(from && ds<from) return; if(to && ds>to) return;
    out.push({
      date:ds, weekday:r[CC.weekday-1], type:r[CC.type-1],
      ipd:[r[4],r[5],r[6],r[7],r[8],r[9]].filter(function(x){return x;}),
      opd:r[CC.opd-1], status:r[CC.status-1], fail:r[CC.fail-1]
    });
  });
  return out;
}
function getMakeup(type){
  var m=MK[type]; if(!m) return [];
  var staff=getStaff().filter(function(s){
    var g = type==='sick'?s.sk : type==='typhoon'?s.ty : s.ew;
    return g.active==='Y';
  });
  staff.forEach(function(s){ s.g = type==='sick'?s.sk : type==='typhoon'?s.ty : s.ew; });
  staff.sort(function(a,b){ return (a.g.round-b.g.round)||(a.g.order-b.g.order); });
  return staff.map(function(s,i){
    return {pos:i+1, abbr:s.abbr, name:s.name, round:s.g.round, order:s.g.order};
  });
}
function getRollcall(date){
  var all=readTable(DR);
  var tz=Session.getScriptTimeZone();
  return all.filter(function(r){
    var d=r.Date; var ds=(d instanceof Date)?Utilities.formatDate(d,tz,'yyyy-MM-dd'):String(d);
    return ds===date;
  });
}

// ---------------------------------------------------------------- Staff_Master row lookup
function _findStaffRow(abbr){
  var sh=_sh(SM);
  var col=sh.getRange(SM_FIRST,C.abbr,SM_LAST-SM_FIRST+1,1).getValues();
  for(var i=0;i<col.length;i++) if(String(col[i][0]).trim()===String(abbr).trim()) return SM_FIRST+i;
  return -1;
}

// ---------------------------------------------------------------- rule-check (dryRun) — read CAL STATUS
// Frontend already does a precheck; here we re-read the STATUS/FailReason produced by the
// sheet formulas after a tentative write, so the sheet formulas remain single source of truth.
function _calStatusForDate(year, dateStr){
  var sh=_sh(CAL_PREFIX+year); if(!sh) return {status:'', fail:'no calendar'};
  var last=sh.getLastRow();
  var dates=sh.getRange(CAL_FIRST,CC.date,last-CAL_FIRST+1,1).getValues();
  var tz=Session.getScriptTimeZone();
  for(var i=0;i<dates.length;i++){
    var d=dates[i][0]; if(!d) continue;
    var ds=(d instanceof Date)?Utilities.formatDate(d,tz,'yyyy-MM-dd'):String(d);
    if(ds===dateStr){
      var row=CAL_FIRST+i;
      var st=sh.getRange(row,CC.status).getValue();
      var fa=sh.getRange(row,CC.fail).getValue();
      return {row:row, status:st, fail:fa};
    }
  }
  return {status:'', fail:'date not found'};
}
function _writeIpd(year, row, names){ // names = array up to 6
  var sh=_sh(CAL_PREFIX+year);
  var arr=[[names[0]||'',names[1]||'',names[2]||'',names[3]||'',names[4]||'',names[5]||'']];
  sh.getRange(row, CC.ipd1, 1, 6).setValues(arr);
  SpreadsheetApp.flush();
}
function _readIpd(year, row){
  var sh=_sh(CAL_PREFIX+year);
  return sh.getRange(row, CC.ipd1, 1, 6).getValues()[0].filter(function(x){return x;});
}

// ---------------------------------------------------------------- applyChange (edit IPD/PH/SH/RD/SHS with rule check)
function applyChange(body, role){
  var year=body.year, dateStr=body.date, names=body.ipd || [];
  var info=_calStatusForDate(year, dateStr);
  if(info.fail && !info.row) return {ok:false, error:info.fail};
  var backup=_readIpd(year, info.row);
  _writeIpd(year, info.row, names);
  var chk=_calStatusForDate(year, dateStr);
  var ok = String(chk.status).toUpperCase().indexOf('OK')>=0 || String(chk.status).toUpperCase().indexOf('PASS')>=0;
  if(body.dryRun){
    _writeIpd(year, info.row, backup); // revert
    return {ok:ok, status:chk.status, fail:chk.fail};
  }
  if(!ok && role!=='admin'){
    _writeIpd(year, info.row, backup);
    return {ok:false, status:chk.status, fail:chk.fail, error:'rule check failed: '+chk.fail};
  }
  _log('applyChange', dateStr+' -> '+names.join(','), body.user||role);
  return {ok:true, status:chk.status, fail:chk.fail, forced:(!ok && role==='admin')};
}
function forceOverride(body, role){ body.dryRun=false; return applyChange(body, 'admin'); }

// ---------------------------------------------------------------- requestSwap (commit if valid)
function requestSwap(body, role){
  var year=body.year, dateStr=body.date, fromAbbr=body.fromAbbr, toAbbr=body.toAbbr;
  var info=_calStatusForDate(year, dateStr);
  if(!info.row) return {ok:false, error:'date not found'};
  // weekend-only rule for staff
  var wk=_sh(CAL_PREFIX+year).getRange(info.row, CC.weekday).getValue();
  var typ=_sh(CAL_PREFIX+year).getRange(info.row, CC.type).getValue();
  var names=_readIpd(year, info.row);
  var idx=names.indexOf(fromAbbr);
  if(idx<0) return {ok:false, error:fromAbbr+' not on duty '+dateStr};
  var backup=names.slice();
  names[idx]=toAbbr;
  _writeIpd(year, info.row, names);
  var chk=_calStatusForDate(year, dateStr);
  var ok = String(chk.status).toUpperCase().indexOf('OK')>=0;
  if(!ok){ _writeIpd(year, info.row, backup); return {ok:false, status:chk.status, fail:chk.fail, error:'swap breaks rule: '+chk.fail}; }
  _log('swap', dateStr+' '+fromAbbr+'->'+toAbbr, body.user||role);
  return {ok:true, status:chk.status};
}

// ---------------------------------------------------------------- recordBack (make-up: bump round)
function recordBack(body, role){
  var type=body.type, abbr=body.abbr, date=body.date;
  var m=MK[type]; if(!m) return {ok:false, error:'bad type'};
  var row=_findStaffRow(abbr); if(row<0) return {ok:false, error:'staff not found'};
  var sh=_sh(SM);
  var cur=sh.getRange(row, m.round).getValue()||1;
  sh.getRange(row, m.round).setValue(cur+1);
  // write to history block of that make-up sheet
  _appendMakeupHistory(m.sheet, date, abbr, sh.getRange(row,C.name).getValue());
  _log('recordBack', type+' '+abbr+' '+date+' round '+cur+'->'+(cur+1), body.user||role);
  return {ok:true, newRound:cur+1};
}
function _appendMakeupHistory(sheetName, date, abbr, name){
  var sh=_sh(sheetName); if(!sh) return;
  var r=MK_HIST_FIRST;
  while(sh.getRange(r, MK_HIST_DATE).getValue()!=='' && sh.getRange(r,MK_HIST_DATE).getValue()!==null) r++;
  sh.getRange(r, MK_HIST_DATE).setValue(date);
  sh.getRange(r, MK_HIST_ABBR).setValue(abbr);
  sh.getRange(r, MK_HIST_NAME).setValue(name);
}

// ---------------------------------------------------------------- saveRollcall (attendance + subs + workload)
function saveRollcall(body, role){
  var date=body.date;
  var att = body.attendance || [];  // [{abbr, post, status:'present'|'sick', substitute?}]
  var wl  = body.workload || null;  // {icuhdu, ortho, neuro, ms, newcase, by}
  var dr=_sh(DR);
  att.forEach(function(a){
    dr.appendRow([date, a.abbr, a.post||'', a.status||'present', a.substitute||'', a.type||'', _now()]);
    if(a.status==='sick' && a.substitute){
      // bump substitute's sick round
      var row=_findStaffRow(a.substitute);
      if(row>0){ var cur=_sh(SM).getRange(row,C.sk_round).getValue()||1;
        _sh(SM).getRange(row,C.sk_round).setValue(cur+1);
        _appendMakeupHistory(MK.sick.sheet, date, a.substitute, _sh(SM).getRange(row,C.name).getValue());
      }
    }
  });
  if(wl){
    var w=_sh(WL); var r=_wlRowForDate(date);
    var vals=[date, num(wl.icuhdu), num(wl.ortho), num(wl.neuro), num(wl.ms), num(wl.newcase)];
    w.getRange(r,2,1,6).setValues([vals]);
    w.getRange(r,9).setValue(wl.by||role);           // Confirmed by (col I=9)
    w.getRange(r,10).setValue(_now());               // Timestamp (col J=10)
  }
  _log('saveRollcall', date+' ('+att.length+' staff)', body.user||role);
  return {ok:true, saved:att.length};
}
function num(x){ return (x===''||x===null||x===undefined)?'':Number(x); }
function _wlRowForDate(date){
  var w=_sh(WL); var last=Math.max(w.getLastRow(),6);
  var col=w.getRange(6,2,last-5,1).getValues(); var tz=Session.getScriptTimeZone();
  for(var i=0;i<col.length;i++){
    var d=col[i][0]; if(!d) continue;
    var ds=(d instanceof Date)?Utilities.formatDate(d,tz,'yyyy-MM-dd'):String(d);
    if(ds===date) return 6+i;
  }
  // first empty
  for(var j=0;j<col.length;j++) if(!col[j][0]) return 6+j;
  return last+1;
}

// ---------------------------------------------------------------- randomizePH
function randomizePH(body, role){
  var sh=_sh(SM);
  var rng=sh.getRange(SM_FIRST, C.abbr, SM_LAST-SM_FIRST+1, 1).getValues();
  var idxs=[]; for(var i=0;i<rng.length;i++) if(rng[i][0]) idxs.push(i);
  // Fisher-Yates on the order values
  var orders=idxs.map(function(_,k){return k+1;});
  for(var k=orders.length-1;k>0;k--){ var j=Math.floor(Math.random()*(k+1)); var t=orders[k];orders[k]=orders[j];orders[j]=t; }
  idxs.forEach(function(rowIdx,k){ sh.getRange(SM_FIRST+rowIdx, C.ph_order).setValue(orders[k]); });
  _log('randomizePH','reshuffled '+idxs.length+' staff', body.user||role);
  return {ok:true, count:idxs.length};
}

// ---------------------------------------------------------------- upsertStaff / setActive
function upsertStaff(body, role){
  var s=body.staff; if(!s||!s.abbr) return {ok:false, error:'need abbr'};
  var row=_findStaffRow(s.abbr);
  var sh=_sh(SM);
  if(row<0){ // add at first empty
    var col=sh.getRange(SM_FIRST,C.abbr,SM_LAST-SM_FIRST+1,1).getValues();
    for(var i=0;i<col.length;i++) if(!col[i][0]){ row=SM_FIRST+i; break; }
    if(row<0) return {ok:false, error:'staff master full'};
  }
  var map={name:C.name,abbr:C.abbr,ort:C.ort,neuro:C.neuro,ms:C.ms,tier:C.tier,mentor:C.mentor,
           ph_order:C.ph_order, shs_order:C.shs_order, active:C.active,
           leave_start:C.leave_start, leave_end:C.leave_end};
  Object.keys(map).forEach(function(k){ if(s[k]!==undefined) sh.getRange(row,map[k]).setValue(s[k]); });
  ['ty','ew','sk'].forEach(function(g){
    if(s[g]){ sh.getRange(row,C[g+'_active']).setValue(s[g].active);
      if(s[g].round!==undefined) sh.getRange(row,C[g+'_round']).setValue(s[g].round);
      if(s[g].order!==undefined) sh.getRange(row,C[g+'_order']).setValue(s[g].order); }
  });
  _log('upsertStaff', s.abbr, body.user||role);
  return {ok:true, row:row};
}
function setActive(body, role){
  var row=_findStaffRow(body.abbr); if(row<0) return {ok:false,error:'not found'};
  _sh(SM).getRange(row, C.active).setValue(body.active?'Y':'N');
  _log('setActive', body.abbr+'='+ (body.active?'Y':'N'), body.user||role);
  return {ok:true};
}

// ---------------------------------------------------------------- rebuildOrders (re-sort each round contiguous)
function rebuildOrders(body, role){
  ['sk','ty','ew'].forEach(function(g){
    var sh=_sh(SM);
    var vals=sh.getRange(SM_FIRST,1,SM_LAST-SM_FIRST+1,C.fair).getValues();
    var arr=[];
    vals.forEach(function(r,i){ if(r[C.abbr-1] && r[C[g+'_active']-1]==='Y')
      arr.push({i:i, round:r[C[g+'_round']-1]||1, order:r[C[g+'_order']-1]||999}); });
    // group by round, renumber order 1..n
    var byRound={}; arr.forEach(function(a){ (byRound[a.round]=byRound[a.round]||[]).push(a); });
    Object.keys(byRound).forEach(function(rd){
      byRound[rd].sort(function(a,b){return a.order-b.order;});
      byRound[rd].forEach(function(a,k){ sh.getRange(SM_FIRST+a.i, C[g+'_order']).setValue(k+1); });
    });
  });
  _log('rebuildOrders','', body.user||role);
  return {ok:true};
}

// ---------------------------------------------------------------- generateCalendar (create CAL_<year> shell)
function generateCalendar(body, role){
  var year=Number(body.year); if(!year) return {ok:false,error:'need year'};
  var name=CAL_PREFIX+year;
  if(_sh(name)) return {ok:false, error:name+' already exists'};
  var tmpl=_sh(CAL_PREFIX+ (getMeta().years[0]||'2026'));
  if(!tmpl) return {ok:false, error:'no template calendar'};
  var copy=tmpl.copyTo(_ss()); copy.setName(name);
  // rewrite dates for the new year: fill B column Jan1..Dec31
  var start=new Date(year,0,1), end=new Date(year,11,31);
  var days=Math.round((end-start)/86400000)+1;
  for(var d=0; d<days; d++){
    var dt=new Date(year,0,1+d);
    copy.getRange(CAL_FIRST+d, CC.date).setValue(dt);
  }
  _log('generateCalendar', String(year), body.user||role);
  SpreadsheetApp.flush();
  return {ok:true, sheet:name, days:days};
}

// ---------------------------------------------------------------- generateRoster (round-based auto-fill)
// Assign eligible staff (Tier 1/2, Active=Y, not on leave) down PH order for PH/RD/SH days,
// skipping any who make the day FAIL, continuing from skipped position next day; one duty per
// round per person. Days that can't satisfy STATUS get marked NEEDS ADMIN.
function generateRoster(body, role){
  var year=Number(body.year);
  var sh=_sh(CAL_PREFIX+year); if(!sh) return {ok:false, error:'no '+CAL_PREFIX+year};
  var staff=getStaff().filter(function(s){ return (s.tier==1||s.tier==2) && s.active==='Y'; });
  staff.sort(function(a,b){ return (a.ph_order||999)-(b.ph_order||999); });
  var pool=staff.map(function(s){return s.abbr;});
  var ptr=0, used={};
  var last=sh.getLastRow();
  var rows=sh.getRange(CAL_FIRST,1,last-CAL_FIRST+1,CC.fail).getValues();
  var tz=Session.getScriptTimeZone(); var filled=0, needAdmin=0;
  var fromM=body.fromMonth||1, toM=body.toMonth||12;
  for(var i=0;i<rows.length;i++){
    var d=rows[i][CC.date-1]; if(!(d instanceof Date)) continue;
    if((d.getMonth()+1)<fromM || (d.getMonth()+1)>toM) continue;
    var type=String(rows[i][CC.type-1]||'').toUpperCase();
    if(['PH','RD','SH','SUN'].indexOf(type)<0 && type!=='') { /* only auto weekend/PH */ }
    // We only auto-generate for PH/RD/SH/Sun (5 IPD). Skip normal weekdays.
    if(['PH','RD','SH','SUN'].indexOf(type)<0) continue;
    var need=5, chosen=[], tried=0;
    while(chosen.length<need && tried<pool.length*2){
      if(Object.keys(used).length>=pool.length) used={}; // round complete -> reset
      var cand=pool[ptr%pool.length]; ptr++; tried++;
      if(used[cand]) continue;
      chosen.push(cand); used[cand]=1;
    }
    _writeIpd(year, CAL_FIRST+i, chosen);
    var chk=_calStatusForDate(year, Utilities.formatDate(d,tz,'yyyy-MM-dd'));
    if(String(chk.status).toUpperCase().indexOf('OK')<0){
      sh.getRange(CAL_FIRST+i, CC.status).setNote('NEEDS ADMIN'); needAdmin++;
    } else filled++;
  }
  SpreadsheetApp.flush();
  _log('generateRoster', year+' m'+fromM+'-'+toM+' filled='+filled+' needAdmin='+needAdmin, body.user||role);
  return {ok:true, filled:filled, needAdmin:needAdmin};
}

// ---------------------------------------------------------------- Holidays
function importHolidays(body, role){
  var year=Number(body.year)||new Date().getFullYear();
  var cal=CalendarApp.getCalendarById('en.hong_kong#holiday@group.v.calendar.google.com');
  var added=0;
  if(cal){
    var evs=cal.getEvents(new Date(year,0,1), new Date(year,11,31,23,59));
    var sh=_sh(HOL);
    evs.forEach(function(ev){
      var d=Utilities.formatDate(ev.getStartTime(),Session.getScriptTimeZone(),'yyyy-MM-dd');
      sh.appendRow([d, ev.getTitle()]); added++;
    });
  }
  _log('importHolidays', year+' ('+added+')', body.user||role);
  return {ok:true, added:added};
}
function holidayOp(op, body, role){
  var sh=_sh(HOL);
  if(op==='add'){ sh.appendRow([body.date, body.name||'']); }
  else {
    var data=sh.getDataRange().getValues(); var tz=Session.getScriptTimeZone();
    for(var i=0;i<data.length;i++){
      var d=data[i][0]; var ds=(d instanceof Date)?Utilities.formatDate(d,tz,'yyyy-MM-dd'):String(d);
      if(ds===body.date){
        if(op==='edit'){ sh.getRange(i+1,2).setValue(body.name); }
        if(op==='delete'){ sh.deleteRow(i+1); }
        break;
      }
    }
  }
  _log('holiday_'+op, body.date, body.user||role);
  return {ok:true};
}

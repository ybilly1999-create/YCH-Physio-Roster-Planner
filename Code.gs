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
var SM_HR = 5, SM_FIRST = 6, SM_LAST = 205; // pre-reserved 200 staff rows (was 56)
var CAL_TEMPLATE = 'CAL_Template'; // master template sheet (formulas + conditional formatting), no data
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
// CAL columns: workload now lives IN the calendar (L-Q) so everything for a year is one sheet.
var CC = { date:2, weekday:3, type:4, ipd1:5, ipd6:10, opd:11,
           icu:12, ort:13, neu:14, others:15, newcase:16, total:17,
           shs1:18, shs2:19, status:24, fail:25 };
var LOG = 'Change_Log';
var HOL = 'Holidays';
var WL  = 'Workload';
var DR  = 'Duty_Record';
var MK = { // make-up sheets + their Staff_Master round/order columns
  sick:    { sheet:'Sick_Leave_Roster',      active:C.sk_active, round:C.sk_round, order:C.sk_order },
  typhoon: { sheet:'Typhoon_Roster',          active:C.ty_active, round:C.ty_round, order:C.ty_order },
  exwx:    { sheet:'Extreme_Weather_Roster',  active:C.ew_active, round:C.ew_round, order:C.ew_order }
};
// HISTORY block (auto-written by roll-call / record-back): col O=15 Date, P=16 Abbrev, Q=17 Name
var MK_HIST_FIRST = 6, MK_HIST_DATE = 15, MK_HIST_ABBR = 16, MK_HIST_NAME = 17;
var TEAM = 'Team_List';
var SHSCL = 'SHS_CL_Tracker';
// SHS_CL_Tracker layout (1-based): LEFT block (SHS draw) B Date | C Type | D SHS Staff;
// RIGHT block (PH/RD/SH compensated-leave) I Date | J Type | K Staff | L CL Date | M CL Deadline | N CL Status.
var SHSCL_FIRST = 3;
var SHSCL_L = { date:2, type:3, staff:4 };
var SHSCL_R = { date:9, type:10, staff:11, cldate:12, deadline:13, status:14 };
// Duty_Record columns (1-based): B date C post D original E status F substitute G type H confirmed I timestamp
var DRC = { date:2, post:3, orig:4, status:5, sub:6, type:7, confirmed:8, ts:9 };
var DR_FIRST = 6;

// ---------------------------------------------------------------- utils
function _ss(){ return SpreadsheetApp.getActiveSpreadsheet(); }
function _sh(n){ return _ss().getSheetByName(n); }

// ---- Lightweight caching (CacheService) to speed up repeated reads ----
// Staff_Master and Team_List change rarely; cache their parsed JSON for 6 hours.
// Any write that changes those sheets calls _cacheBust() to clear stale entries.
var _CACHE_TTL = 21600; // 6 hours (max allowed)
function _cacheGet(key){
  try{ var c=CacheService.getScriptCache().get(key); return c?JSON.parse(c):null; }catch(e){ return null; }
}
function _cachePut(key, obj){
  try{ CacheService.getScriptCache().put(key, JSON.stringify(obj), _CACHE_TTL); }catch(e){}
}
function _cacheBust(){
  try{ CacheService.getScriptCache().removeAll(['staff','team']); }catch(e){}
}
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
// Change_Log layout (1-based): B Timestamp | C User | D swap-phase pointer (row 2 only) |
// E Date affected | F From | G To | H Notes.  Entries are appended from row LOG_FIRST down,
// writing ONLY B/C/E/H so the D pointer and F/G stay intact.
var LOG_FIRST = 4;   // first data row (header is row 3)
var LGC = { ts:2, user:3, date:5, from:6, to:7, notes:8 };
function _log(action, detail, who){
  var sh=_sh(LOG); if(!sh) return;
  // find first empty row at/below LOG_FIRST by scanning the Timestamp column
  var last=Math.max(sh.getLastRow(), LOG_FIRST-1);
  var r=LOG_FIRST;
  for(; r<=last; r++){ if(!sh.getRange(r, LGC.ts).getValue()) break; }
  sh.getRange(r, LGC.ts).setValue(_now());
  sh.getRange(r, LGC.user).setValue(who||'');
  // parse a leading yyyy-MM-dd out of detail into the "Date affected" column when present
  var dm=String(detail||'').match(/\d{4}-\d{2}-\d{2}/);
  if(dm) sh.getRange(r, LGC.date).setValue(dm[0]);
  sh.getRange(r, LGC.notes).setValue((action||'')+(detail?(': '+detail):''));
}

// ---------------------------------------------------------------- onOpen menu (Sheet UI)
// Adds a ▶ YCH Roster menu so the admin can run one-time setup from the spreadsheet.
function onOpen(){
  try{
    SpreadsheetApp.getUi().createMenu('▶ YCH Roster')
      .addItem('Run setupSheets (install formulas + template)', 'menuSetupSheets')
      .addToUi();
  }catch(e){}
}
function menuSetupSheets(){
  var res=setupSheets({user:'menu'}, 'admin');
  try{ SpreadsheetApp.getUi().alert('setupSheets done:\n\n'+(res.report||[]).join('\n')); }catch(e){}
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
      case 'getMakeup':    return _out({ok:true, rows:getMakeup(e.parameter.type), off:getMakeupOff(e.parameter.type)});
      case 'getTeam':      return _out({ok:true, rows:getTeam()});
      case 'getRollcall':  return _out({ok:true, rows:getRollcall(e.parameter.date), workload:getRollcallWorkload(e.parameter.date)});
      case 'getShsClTracker': var _t=getShsClTracker(); return _out({ok:true, shs:_t.shs, cl:_t.cl});
      // Workload now lives inside the CAL_<year> sheet (single source of truth).
      case 'getWorkload':  return _out({ok:true, workload:getRollcallWorkload(e.parameter.date)});
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
        case 'deleteStaff':    return _out(deleteStaff(body, role));
        case 'setActive':      return _out(setActive(body, role));
        case 'rebuildOrders':  return _out(rebuildOrders(body, role));
        case 'setupSheets':    return _out(setupSheets(body, role));
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
  return {ok:true, name:'YCH Physio Dept Roster Management System', version:'r5-2026-07-19', years:years,
          tz:Session.getScriptTimeZone(), serverTime:_now()};
}
function getStaff(){
  var _c=_cacheGet('staff'); if(_c) return _c;
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
      active:r[C.active-1], leave_start:r[C.leave_start-1], leave_end:r[C.leave_end-1],
      // Capability flags (Y/N) derived from order numbers so the UI can show them.
      cap_ph:(Number(r[C.ph_order-1])>0)?'Y':'N',
      cap_shs:(Number(r[C.shs_order-1])>0)?'Y':'N',
      cap_ty:(Number(r[C.ty_order-1])>0 && String(r[C.ty_active-1]||'').toUpperCase()!=='N')?'Y':'N',
      cap_ew:(Number(r[C.ew_order-1])>0 && String(r[C.ew_active-1]||'').toUpperCase()!=='N')?'Y':'N',
      cap_sk:(Number(r[C.sk_order-1])>0)?'Y':'N'
    });
  });
  _cachePut('staff', rows);
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
  // Build a date-keyed roll-call map from Duty_Record so each calendar day
  // can be coloured (confirmed / sick / substitute) directly in the grid.
  var drMap=_dutyRecordByDate();
  vals.forEach(function(r){
    var d=r[CC.date-1]; if(!d) return;
    var ds=(d instanceof Date)?Utilities.formatDate(d,tz,'yyyy-MM-dd'):String(d);
    if(from && ds<from) return; if(to && ds>to) return;
    var dr=drMap[ds]||null;
    out.push({
      date:ds, weekday:r[CC.weekday-1], type:r[CC.type-1],
      ipd:[r[4],r[5],r[6],r[7],r[8],r[9]].filter(function(x){return x;}),
      opd:r[CC.opd-1],
      // SHS kept as TWO separate values (never merged into one cell)
      shs1:r[CC.shs1-1]||'', shs2:r[CC.shs2-1]||'',
      shs:[r[CC.shs1-1],r[CC.shs2-1]].filter(function(x){return x;}),
      // Workload read straight from the calendar row (single source of truth)
      workload:{ icuhdu:r[CC.icu-1], ortho:r[CC.ort-1], neuro:r[CC.neu-1],
                 ms:r[CC.others-1], newcase:r[CC.newcase-1], total:r[CC.total-1] },
      status:r[CC.status-1], fail:r[CC.fail-1],
      confirmed: dr?dr.confirmed:false,
      sick: dr?dr.sick:[],
      substitute: dr?dr.substitute:[]
    });
  });
  return out;
}
// Read Duty_Record once and group by date -> {confirmed, sick:[names], substitute:[names]}.
function _dutyRecordByDate(){
  var sh=_sh(DR); var map={};
  if(!sh) return map;
  var last=sh.getLastRow(); if(last<DR_FIRST) return map;
  var vals=sh.getRange(DR_FIRST,1,last-DR_FIRST+1, DRC.ts).getValues();
  var tz=Session.getScriptTimeZone();
  vals.forEach(function(r){
    var d=r[DRC.date-1]; if(!d) return;
    var ds=(d instanceof Date)?Utilities.formatDate(d,tz,'yyyy-MM-dd'):String(d);
    if(!map[ds]) map[ds]={confirmed:false, sick:[], substitute:[]};
    var e=map[ds];
    if(r[DRC.confirmed-1]===true || String(r[DRC.confirmed-1]).toUpperCase()==='TRUE' || String(r[DRC.confirmed-1]).toUpperCase()==='Y') e.confirmed=true;
    var st=String(r[DRC.status-1]||'').toLowerCase();
    var orig=r[DRC.orig-1], sub=r[DRC.sub-1];
    if(st.indexOf('sick')>=0 && orig) e.sick.push(orig);
    if(sub) e.substitute.push(sub);
  });
  return map;
}
// CAPABILITY RULE: a staff is capable for a make-up list only when they have a
// VALID ORDER NUMBER (> 0). "No order number = non-capable" (user rule). The
// Active/Y-N flag is honoured too: an explicit 'N' excludes even if an order exists.
function _isCapable(g){
  var ord=Number(g.order);
  if(!(ord>0)) return false;               // blank / 0 order = not capable
  var act=String(g.active||'').trim().toUpperCase();
  if(act==='N') return false;              // explicit N = not capable
  return true;                             // Y or blank-but-has-order = capable
}
function getMakeup(type){
  var m=MK[type]; if(!m) return [];
  var staff=getStaff();
  staff.forEach(function(s){ s.g = type==='sick'?s.sk : type==='typhoon'?s.ty : s.ew; });
  var on=staff.filter(function(s){ return _isCapable(s.g); });
  on.sort(function(a,b){ return (Number(a.g.round)-Number(b.g.round))||(Number(a.g.order)-Number(b.g.order)); });
  return on.map(function(s,i){
    return {pos:i+1, abbr:s.abbr, name:s.name, round:Number(s.g.round)||1, order:Number(s.g.order)||0,
            capable:'Y'};
  });
}
// Staff NOT capable for the given make-up list (no order number, or capability = N)
function getMakeupOff(type){
  var staff=getStaff();
  staff.forEach(function(s){ s.g = type==='sick'?s.sk : type==='typhoon'?s.ty : s.ew; });
  var off=staff.filter(function(s){ return !_isCapable(s.g); });
  return off.map(function(s){ return {abbr:s.abbr, name:s.name, capable:'N'}; });
}
// Team_List (for Sat/Sun rotation + display)
function getTeam(){
  var _ct=_cacheGet('team'); if(_ct) return _ct;
  var sh=_sh(TEAM); if(!sh) return [];
  var data=sh.getDataRange().getValues();
  var hr=-1;
  for(var i=0;i<data.length;i++){
    var row=data[i].map(function(v){return String(v).trim();});
    if(row.indexOf('Team')>=0 && row.indexOf('Sub')>=0){ hr=i; break; }
  }
  if(hr<0) return [];
  var heads=data[hr].map(function(h){return String(h).trim();});
  var iTeam=heads.indexOf('Team'), iSub=heads.indexOf('Sub'), iCat=heads.indexOf('Cat'),
      iAb=heads.indexOf('Abbrev'), iNm=heads.indexOf('Name'), iTier=heads.indexOf('Tier');
  var out=[];
  for(var r=hr+1;r<data.length;r++){
    var d=data[r]; if(!d[iAb]) continue;
    out.push({team:String(d[iTeam]).trim(), sub:String(d[iSub]).trim(), cat:String(d[iCat]).trim(),
              abbr:String(d[iAb]).trim(), name:String(d[iNm]).trim(), tier:d[iTier]});
  }
  _cachePut('team', out);
  return out;
}
function getRollcall(date){
  var sh=_sh(DR); var out=[];
  if(sh){
    var last=sh.getLastRow();
    if(last>=DR_FIRST){
      var vals=sh.getRange(DR_FIRST,1,last-DR_FIRST+1, DRC.ts).getValues();
      var tz=Session.getScriptTimeZone();
      vals.forEach(function(r){
        var d=r[DRC.date-1]; if(!d) return;
        var ds=(d instanceof Date)?Utilities.formatDate(d,tz,'yyyy-MM-dd'):String(d);
        if(ds!==date) return;
        out.push({ date:ds, post:r[DRC.post-1], original:r[DRC.orig-1], status:r[DRC.status-1],
                   substitute:r[DRC.sub-1], type:r[DRC.type-1], confirmed:r[DRC.confirmed-1] });
      });
    }
  }
  return out;
}
// SHS_CL_Tracker — return ALL rows from both blocks (fixes "only shows 2026-01-01").
function getShsClTracker(){
  var sh=_sh(SHSCL); if(!sh) return {shs:[], cl:[]};
  var last=sh.getLastRow(); if(last<SHSCL_FIRST) return {shs:[], cl:[]};
  var tz=Session.getScriptTimeZone();
  var vals=sh.getRange(SHSCL_FIRST,1,last-SHSCL_FIRST+1, SHSCL_R.status).getValues();
  function ds(v){ return (v instanceof Date)?Utilities.formatDate(v,tz,'yyyy-MM-dd'):(v?String(v):''); }
  var shs=[], cl=[];
  vals.forEach(function(r){
    // LEFT: SHS draw list
    var ld=r[SHSCL_L.date-1], lstaff=r[SHSCL_L.staff-1];
    if(ld || lstaff){ shs.push({ date:ds(ld), type:String(r[SHSCL_L.type-1]||''), staff:String(lstaff||'') }); }
    // RIGHT: compensated-leave rows — include EVERY row that has a date or staff
    var rd=r[SHSCL_R.date-1], rstaff=r[SHSCL_R.staff-1];
    if(rd || rstaff){
      cl.push({
        date:ds(rd), type:String(r[SHSCL_R.type-1]||''), staff:String(rstaff||''),
        clDate:ds(r[SHSCL_R.cldate-1]), deadline:ds(r[SHSCL_R.deadline-1]),
        status:String(r[SHSCL_R.status-1]||'')
      });
    }
  });
  return {shs:shs, cl:cl};
}
// Workload for a given date, read from the CAL_<year> row (single source of truth).
function getRollcallWorkload(date){
  var year=Number(String(date).slice(0,4));
  var info=_calStatusForDate(year, date);
  if(!info || !info.row) return null;
  var cal=_sh(CAL_PREFIX+year); var r=info.row;
  return {
    icuhdu:cal.getRange(r, CC.icu).getValue(),
    ortho :cal.getRange(r, CC.ort).getValue(),
    neuro :cal.getRange(r, CC.neu).getValue(),
    ms    :cal.getRange(r, CC.others).getValue(),
    newcase:cal.getRange(r, CC.newcase).getValue(),
    total :cal.getRange(r, CC.total).getValue()
  };
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
  _cacheBust();
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
// UPSERT by date: removes any existing Duty_Record rows for that date, then rewrites the full
// day. Records Original (rostered staff) + Substitute (helper). Bumps the substitute's sick round
// ONLY for newly-added sick subs (compared to what was previously saved). Updates Workload row
// (one per date). Marks the calendar day confirmed so the frontend colours it.
function saveRollcall(body, role){
  var date=body.date;
  var att = body.attendance || [];  // [{post, original, status:'present'|'sick', substitute?, type?}]
  var wl  = body.workload || null;  // {icuhdu, ortho, neuro, ms, newcase, by}
  var dr=_sh(DR);

  // 1) prior saved rows (avoid double-bumping sick rounds on re-save)
  var prior=getRollcall(date);
  var priorSubs={}; prior.forEach(function(p){ if(p.status==='sick' && p.substitute) priorSubs[p.original+'>'+p.substitute]=1; });

  // 2) delete existing rows for this date (upsert — no duplicates)
  _deleteDutyRecordRows(date);

  // 3) append fresh rows
  att.forEach(function(a){
    var r=_firstEmptyDutyRow();
    dr.getRange(r,DRC.date).setValue(date);
    dr.getRange(r,DRC.post).setValue(a.post||'');
    dr.getRange(r,DRC.orig).setValue(a.original||a.abbr||'');
    dr.getRange(r,DRC.status).setValue(a.status||'present');
    dr.getRange(r,DRC.sub).setValue(a.substitute||'');
    dr.getRange(r,DRC.type).setValue(a.type||'');
    dr.getRange(r,DRC.confirmed).setValue('Y');
    dr.getRange(r,DRC.ts).setValue(_now());
    if(a.status==='sick' && a.substitute && !priorSubs[(a.original||a.abbr)+'>'+a.substitute]){
      var row=_findStaffRow(a.substitute);
      if(row>0){ var cur=Number(_sh(SM).getRange(row,C.sk_round).getValue())||1;
        _sh(SM).getRange(row,C.sk_round).setValue(cur+1);
        _appendMakeupHistory(MK.sick.sheet, date, a.substitute, _sh(SM).getRange(row,C.name).getValue());
      }
    }
  });

  // 4) Workload — stored directly in the CAL_<year> row (cols L..P), NOT a separate
  //    Workload sheet, so all data for a year lives in one sheet.
  if(wl){
    var year=Number(String(date).slice(0,4));
    var info=_calStatusForDate(year, date);
    if(info && info.row){
      var cal=_sh(CAL_PREFIX+year), cr=info.row;
      cal.getRange(cr, CC.icu).setValue(num(wl.icuhdu));
      cal.getRange(cr, CC.ort).setValue(num(wl.ortho));
      cal.getRange(cr, CC.neu).setValue(num(wl.neuro));
      cal.getRange(cr, CC.others).setValue(num(wl.ms));
      cal.getRange(cr, CC.newcase).setValue(num(wl.newcase));
      // Total(New) col Q is a sheet formula; leave it to recalc. If it's blank, sum here.
      var tot=cal.getRange(cr, CC.total).getFormula();
      if(!tot){
        var sum=[wl.icuhdu,wl.ortho,wl.neuro,wl.ms,wl.newcase]
          .reduce(function(a,x){return a+(Number(x)||0);},0);
        cal.getRange(cr, CC.total).setValue(sum);
      }
    }
  }

  // 5) mark calendar day confirmed (note) so colours refresh
  _markCalendarConfirmed(date);

  SpreadsheetApp.flush();
  _log('saveRollcall', date+' ('+att.length+' staff)', body.user||role);
  return {ok:true, saved:att.length, rows:getRollcall(date)};
}
function _firstEmptyDutyRow(){
  var dr=_sh(DR); var last=Math.max(dr.getLastRow(),DR_FIRST-1);
  for(var r=DR_FIRST;r<=last;r++){ if(!dr.getRange(r,DRC.date).getValue()) return r; }
  return last+1;
}
function _deleteDutyRecordRows(date){
  var dr=_sh(DR); var last=dr.getLastRow(); if(last<DR_FIRST) return;
  var tz=Session.getScriptTimeZone(); var toDel=[];
  var vals=dr.getRange(DR_FIRST,DRC.date,last-DR_FIRST+1,1).getValues();
  for(var i=0;i<vals.length;i++){
    var d=vals[i][0]; if(!d) continue;
    var ds=(d instanceof Date)?Utilities.formatDate(d,tz,'yyyy-MM-dd'):String(d);
    if(ds===date) toDel.push(DR_FIRST+i);
  }
  for(var k=toDel.length-1;k>=0;k--) dr.deleteRow(toDel[k]);
}
function _markCalendarConfirmed(date){
  var year=Number(String(date).slice(0,4));
  var info=_calStatusForDate(year, date);
  if(info && info.row){
    _sh(CAL_PREFIX+year).getRange(info.row, CC.status).setNote('CONFIRMED '+_now());
  }
}
function num(x){ return (x===''||x===null||x===undefined)?'':Number(x); }
// (Workload sheet removed — workload now stored in CAL_<year>. _wlRowForDate deleted.)

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
  var s=body.staff || body; // tolerate {staff:{...}} or flat
  var abbr=(s.abbr!==undefined?s.abbr:body.abbr);
  if(abbr===undefined || String(abbr).trim()===''){ return {ok:false, error:'need abbr / 缺少 Abbreviation'}; }
  abbr=String(abbr).trim();
  var sh=_sh(SM);
  var row=_findStaffRow(abbr);
  var isNew=false;
  if(row<0){
    var col=sh.getRange(SM_FIRST,C.abbr,SM_LAST-SM_FIRST+1,1).getValues();
    for(var i=0;i<col.length;i++) if(!col[i][0] || String(col[i][0]).trim()===''){ row=SM_FIRST+i; break; }
    // No pre-reserved blank row left -> append a brand-new row (NO hard limit).
    if(row<0){ row=Math.max(sh.getLastRow()+1, SM_LAST+1); }
    isNew=true;
  }
  sh.getRange(row,C.abbr).setValue(abbr);
  var map={name:C.name,ort:C.ort,neuro:C.neuro,ms:C.ms,tier:C.tier,mentor:C.mentor,
           ph_order:C.ph_order, ph_round:C.ph_round, shs_order:C.shs_order, active:C.active,
           leave_start:C.leave_start, leave_end:C.leave_end};
  Object.keys(map).forEach(function(k){ if(s[k]!==undefined && s[k]!==null) sh.getRange(row,map[k]).setValue(s[k]); });
  if(isNew){
    if(s.active===undefined) sh.getRange(row,C.active).setValue('Y');
    if(s.ph_round===undefined) sh.getRange(row,C.ph_round).setValue(1);
    if(s.ph_order===undefined) sh.getRange(row,C.ph_order).setValue(_countStaff());
  }
  ['ty','ew','sk'].forEach(function(g){
    var grp=s[g];
    if(grp){
      if(grp.active!==undefined) sh.getRange(row,C[g+'_active']).setValue(grp.active);
      if(grp.round!==undefined && grp.round!=='') sh.getRange(row,C[g+'_round']).setValue(Number(grp.round));
      if(grp.order!==undefined && grp.order!=='') sh.getRange(row,C[g+'_order']).setValue(Number(grp.order));
    } else if(isNew){
      sh.getRange(row,C[g+'_active']).setValue('Y');
      sh.getRange(row,C[g+'_round']).setValue(1);
      sh.getRange(row,C[g+'_order']).setValue(_countStaff());
    }
    sh.getRange(row,C[g+'_round']).setNumberFormat('General');
    sh.getRange(row,C[g+'_order']).setNumberFormat('General');
  });
  // ---- Also upsert into Team_List when team/sub provided (add-staff-to-team logistic) ----
  var teamMsg='';
  var teamVal = (s.team!==undefined?s.team:body.team);
  var subVal  = (s.sub !==undefined?s.sub :body.sub);
  if(teamVal!==undefined && String(teamVal).trim()!==''){
    teamMsg=_upsertTeamMember({abbr:abbr, name:(s.name!==undefined?s.name:body.name)||abbr,
                               team:teamVal, sub:subVal, cat:(s.cat||body.cat||''), tier:(s.tier||body.tier||'')});
  }
  SpreadsheetApp.flush();
  _log('upsertStaff', abbr+(isNew?' (new)':' (edit)')+(teamMsg?(' | '+teamMsg):''), body.user||role);
  _cacheBust();
  return {ok:true, row:row, isNew:isNew, team:teamMsg};
}

// Insert or update a Team_List row for a staff member.
// sub accepts: '1','2','Sat only','Sun only','OPD'. One staff may appear in multiple
// sub groups (e.g. core team '1' + 'OPD'); we upsert by (abbr + sub) pair.
function _upsertTeamMember(m){
  var sh=_sh(TEAM); if(!sh) return 'no Team_List';
  var data=sh.getDataRange().getValues();
  var hr=-1;
  for(var i=0;i<data.length;i++){
    var rw=data[i].map(function(v){return String(v).trim();});
    if(rw.indexOf('Team')>=0 && rw.indexOf('Sub')>=0){ hr=i; break; }
  }
  if(hr<0) return 'no Team_List header';
  var heads=data[hr].map(function(h){return String(h).trim();});
  var iTeam=heads.indexOf('Team'), iSub=heads.indexOf('Sub'), iCat=heads.indexOf('Cat'),
      iAb=heads.indexOf('Abbrev'), iNm=heads.indexOf('Name'), iTier=heads.indexOf('Tier');
  var sub=String(m.sub||'').trim();
  // find existing row with same abbr + same sub
  var foundRow=-1, firstEmpty=-1;
  for(var r=hr+1;r<data.length;r++){
    var ab=String(data[r][iAb]||'').trim();
    var sb=String(data[r][iSub]||'').trim();
    if(!ab && firstEmpty<0) firstEmpty=r;
    if(ab===m.abbr && sb===sub){ foundRow=r; break; }
  }
  var targetRow = foundRow>=0 ? foundRow : (firstEmpty>=0 ? firstEmpty : data.length);
  var rowNum = targetRow+1; // 1-based
  function setC(idx,val){ if(idx>=0 && val!==undefined && val!=='') sh.getRange(rowNum, idx+1).setValue(val); }
  setC(iTeam, m.team); setC(iSub, sub); setC(iCat, m.cat); setC(iAb, m.abbr);
  setC(iNm, m.name); setC(iTier, m.tier);
  return foundRow>=0 ? ('team updated '+m.team+'/'+sub) : ('team added '+m.team+'/'+sub);
}
function _countStaff(){
  var sh=_sh(SM); var col=sh.getRange(SM_FIRST,C.abbr,SM_LAST-SM_FIRST+1,1).getValues();
  var n=0; col.forEach(function(r){ if(r[0]&&String(r[0]).trim()!=='') n++; }); return n;
}
function deleteStaff(body, role){
  var abbr=String(body.abbr||'').trim(); if(!abbr) return {ok:false, error:'need abbr'};
  var sh=_sh(SM); var row=_findStaffRow(abbr);
  if(row<0) return {ok:false, error:'staff not found'};
  sh.getRange(row,C.name, 1, C.leave_end-C.name+1).clearContent();
  SpreadsheetApp.flush();
  _log('deleteStaff', abbr, body.user||role);
  return {ok:true};
}
function setActive(body, role){
  var row=_findStaffRow(body.abbr); if(row<0) return {ok:false,error:'not found'};
  _sh(SM).getRange(row, C.active).setValue(body.active?'Y':'N');
  _log('setActive', body.abbr+'='+ (body.active?'Y':'N'), body.user||role);
  _cacheBust();
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
  _cacheBust();
  return {ok:true};
}

// ---------------------------------------------------------------- setupSheets (ONE-TIME installer)
// Installs everything that lives IN the spreadsheet (not in code):
//  1. Staff_Master statistic formulas (Sat/Sun/PH-RD-SH/SHS/Total/Fairness) for all rows.
//  2. A "reference year" dropdown (K2) so the stats can point at CAL_2026 / CAL_2027 / ...
//  3. Moves the Tier-definitions help text to the far RIGHT (frees rows for adding staff).
//  4. SHS_CL_Tracker: a year dropdown (B1) + FILTER formulas that skip Sat/Sun blanks.
//  5. Builds a CAL_Template sheet (headers + formulas + conditional formatting, NO data)
//     used by generateCalendar so new years keep colours + status formulas.
// Safe to re-run (idempotent-ish): it overwrites the same cells each time.
function setupSheets(body, role){
  var ss=_ss();
  var report=[];

  // ---------- helper: list existing CAL_<year> sheet names ----------
  var calNames=[];
  ss.getSheets().forEach(function(s){ if(/^CAL_\d{4}$/.test(s.getName())) calNames.push(s.getName()); });
  calNames.sort();
  var defaultCal = calNames.length ? calNames[calNames.length-1] : 'CAL_2026';

  // ================= 1 + 2 + 3 : Staff_Master =================
  var sm=_sh(SM);
  if(sm){
    // -- (2) reference-year dropdown in K2 (row above the header) --
    var refCell = sm.getRange(2, 11); // K2
    if(calNames.length){
      var rule=SpreadsheetApp.newDataValidation().requireValueInList(calNames, true).setAllowInvalid(false).build();
      refCell.setDataValidation(rule);
      if(!calNames.some(function(n){return n===String(refCell.getValue()).trim();})) refCell.setValue(defaultCal);
      sm.getRange(2,10).setValue('Ref sheet:'); // J2 label
    }
    var refA1 = "'"+SM+"'!$K$2"; // referenced dynamically via INDIRECT

    // -- (1) statistic formulas for every data row --
    // CAL columns: Type=D(4), IPD staff E..J(5..10), OPD=K(11), SHS1=R(18), SHS2=S(19)
    // We COUNTIF the referenced calendar for this staff's Abbrev across the duty columns.
    // Sat  = Type='Sat' rows where staff appears in IPD or OPD range
    // Sun  = Type='Sun'
    // PRS  = Type in PH/RD/SH
    // SHS  = staff appears in SHS1/SHS2 columns (any type)
    var first=SM_FIRST, last=SM_LAST;
    var fSat=[], fSun=[], fPrs=[], fShs=[], fTot=[], fFair=[];
    for(var r=first;r<=last;r++){
      var ab='$C'+r; // Abbrev cell
      // duty range E:K (IPD1..OPD), SHS range R:S
      var dutyRng = 'INDIRECT($K$2&"!$E:$K")';
      var typeRng = 'INDIRECT($K$2&"!$D:$D")';
      var shsRng  = 'INDIRECT($K$2&"!$R:$S")';
      // count rows where type matches AND staff appears in duty range on same row -> use SUMPRODUCT
      var typeCol='INDIRECT($K$2&"!D8:D400")';
      var dutyBlk='INDIRECT($K$2&"!E8:K400")';
      var shsBlk ='INDIRECT($K$2&"!R8:S400")';
      fSat.push('=IF('+ab+'="",,SUMPRODUCT(('+typeCol+'="Sat")*(MMULT(--('+dutyBlk+'='+ab+'),TRANSPOSE(COLUMN('+dutyBlk+')^0))>0)))');
      fSun.push('=IF('+ab+'="",,SUMPRODUCT(('+typeCol+'="Sun")*(MMULT(--('+dutyBlk+'='+ab+'),TRANSPOSE(COLUMN('+dutyBlk+')^0))>0)))');
      fPrs.push('=IF('+ab+'="",,SUMPRODUCT((('+typeCol+'="PH")+('+typeCol+'="RD")+('+typeCol+'="SH"))*(MMULT(--('+dutyBlk+'='+ab+'),TRANSPOSE(COLUMN('+dutyBlk+')^0))>0)))');
      fShs.push('=IF('+ab+'="",,SUMPRODUCT(--('+shsBlk+'='+ab+')))');
      fTot.push('=IF('+ab+'="",,Y'+r+'+Z'+r+'+AA'+r+'+AB'+r+')');
      // fairness = total / average(total of all active) ; 1.00 = exactly average
      fFair.push('=IF('+ab+'="",,IFERROR(AC'+r+'/AVERAGE($AC$'+first+':$AC$'+last+'),))');
    }
    sm.getRange(first, C.cnt_sat, fSat.length, 1).setFormulas(fSat.map(function(x){return [x];}));
    sm.getRange(first, C.cnt_sun, fSun.length, 1).setFormulas(fSun.map(function(x){return [x];}));
    sm.getRange(first, C.cnt_prs, fPrs.length, 1).setFormulas(fPrs.map(function(x){return [x];}));
    sm.getRange(first, C.cnt_shs, fShs.length, 1).setFormulas(fShs.map(function(x){return [x];}));
    sm.getRange(first, C.total,   fTot.length, 1).setFormulas(fTot.map(function(x){return [x];}));
    sm.getRange(first, C.fair,    fFair.length,1).setFormulas(fFair.map(function(x){return [x];}));
    sm.getRange(first, C.fair, fFair.length, 1).setNumberFormat('0.00');
    report.push('Staff_Master stats formulas set for rows '+first+'-'+last);

    // -- (3) move Tier-definitions help text to the far right (col AH=34) --
    var helpLines=[
      'Tier definitions:',
      'Tier 1 = Senior therapist (can lead a shift; roster needs >=2 per shift).',
      'Tier 2 = Independent Registered Physiotherapist (works unsupervised).',
      'Tier 3 = New recruit (must be paired with their named Mentor on the same shift).',
      'PH order / SHS order = numeric draw priority; blank = excluded from that auto-draw (e.g. TI).',
      'Active = N: staff has left the department (excluded from all draws).',
      'Leave Start / Leave End = short-term leave window (e.g. pregnancy); staff skipped on duty dates inside it.',
      '',
      'EW = Extreme Weather roster draw.  SK = Sick-leave roster draw.'
    ];
    var helpCol=34; // AH
    sm.getRange(SM_HR+1, helpCol, helpLines.length, 1).setValues(helpLines.map(function(x){return [x];}));
    sm.getRange(SM_HR+1, helpCol).setFontWeight('bold');
    report.push('Tier-definitions text moved to column AH');
  } else report.push('Staff_Master NOT found');

  // ================= 4 : SHS_CL_Tracker (year dropdown + FILTER) =================
  var cl=_sh(SHSCL);
  if(cl){
    // year dropdown in B1
    if(calNames.length){
      var clRule=SpreadsheetApp.newDataValidation().requireValueInList(calNames, true).setAllowInvalid(false).build();
      cl.getRange(1,2).setDataValidation(clRule);
      if(!calNames.some(function(n){return n===String(cl.getRange(1,2).getValue()).trim();})) cl.getRange(1,2).setValue(defaultCal);
      cl.getRange(1,1).setValue('Source:'); // A1 label
    }
    // LEFT block (SHS draw) starting B3: FILTER dates+type+SHS staff where SHS1/SHS2 not blank.
    // Skips Sat/Sun empty rows automatically because FILTER drops rows failing the condition.
    var srcDate='INDIRECT($B$1&"!B8:B400")';
    var srcType='INDIRECT($B$1&"!D8:D400")';
    var srcS1  ='INDIRECT($B$1&"!R8:R400")';
    var srcS2  ='INDIRECT($B$1&"!S8:S400")';
    // SHS list: any row with an SHS(1) entry
    cl.getRange(SHSCL_FIRST, SHSCL_L.date).setFormula(
      '=IFERROR(FILTER({'+srcDate+','+srcType+','+srcS1+'},('+srcS1+'<>"")),"")');
    // RIGHT block (PH/RD/SH compensated-leave) starting I3: FILTER dates+type+staff where Type is PH/RD/SH.
    var pDate='INDIRECT($B$1&"!B8:B400")';
    var pType='INDIRECT($B$1&"!D8:D400")';
    var pStaff='INDIRECT($B$1&"!E8:E400")'; // first IPD staff as representative; full list still on CAL
    cl.getRange(SHSCL_FIRST, SHSCL_R.date).setFormula(
      '=IFERROR(FILTER({'+pDate+','+pType+'},('+pType+'="PH")+('+pType+'="RD")+('+pType+'="SH")),"")');
    report.push('SHS_CL_Tracker FILTER formulas + year dropdown set');
  } else report.push('SHS_CL_Tracker NOT found');

  // ================= 5 : CAL_Template =================
  var tmplName=CAL_TEMPLATE;
  if(!_sh(tmplName)){
    var src=_sh(defaultCal);
    if(src){
      var t=src.copyTo(ss).setName(tmplName);
      // wipe all input data but keep formulas (total/status/fail) + conditional formatting
      var lr=t.getLastRow();
      if(lr>=CAL_FIRST){
        var nr=lr-CAL_FIRST+1;
        t.getRange(CAL_FIRST, CC.date, nr, CC.newcase-CC.date+1).clearContent();
        t.getRange(CAL_FIRST, CC.shs1, nr, CC.shs2-CC.shs1+1).clearContent();
        t.getRange(CAL_FIRST, CC.status, nr, 1).clearNote();
      }
      // hide the template so it isn't mistaken for a real year
      t.hideSheet();
      report.push('CAL_Template created from '+defaultCal+' (formulas + conditional formatting kept)');
    } else report.push('cannot build CAL_Template: '+defaultCal+' missing');
  } else report.push('CAL_Template already exists (kept)');

  SpreadsheetApp.flush();
  _cacheBust();
  _log('setupSheets', report.join(' | '), (body&&body.user)||role);
  return {ok:true, report:report};
}

// ---------------------------------------------------------------- generateCalendar (create CAL_<year> shell)
// Read Holidays sheet into a map { 'yyyy-MM-dd' : 'PH'|'SH'|'RD' } for the given year.
// Holidays layout: B=Date, C=Type, D=Name.
function _holidayMap(year){
  var sh=_sh(HOL); var map={}; if(!sh) return map;
  var tz=Session.getScriptTimeZone();
  var data=sh.getDataRange().getValues();
  for(var i=0;i<data.length;i++){
    var d=data[i][1];                 // col B (index 1)
    if(!(d instanceof Date)) continue;
    if(d.getFullYear()!==year) continue;
    var ds=Utilities.formatDate(d,tz,'yyyy-MM-dd');
    var ty=String(data[i][2]||'').trim().toUpperCase();  // col C
    if(!ty) continue;
    // normalise to PH / SH / RD
    if(ty.indexOf('PH')>=0) ty='PH';
    else if(ty.indexOf('SH')>=0 || ty.indexOf('STAT')>=0) ty='SH';
    else if(ty.indexOf('RD')>=0 || ty.indexOf('REST')>=0) ty='RD';
    map[ds]=ty;
  }
  return map;
}

// Generate a BRAND-NEW empty calendar for `year`.
// - Copies only the TEMPLATE (headers/formatting) from the newest existing CAL sheet,
//   then CLEARS every data cell so NO staff/workload data is carried over.
// - Sets Weekday + Type per day: Holidays (PH/SH/RD) take priority over Sat/Sun.
function generateCalendar(body, role){
  var year=Number(body.year); if(!year) return {ok:false,error:'need year'};
  var name=CAL_PREFIX+year;
  if(_sh(name)) return {ok:false, error:name+' already exists'};
  // Prefer the dedicated CAL_Template (carries formulas + conditional formatting, NO data).
  // Fall back to the newest CAL_<year> sheet only if no template exists.
  var usingTemplate=true;
  var tmpl=_sh(CAL_TEMPLATE);
  if(!tmpl){ usingTemplate=false; tmpl=_sh(CAL_PREFIX+ (getMeta().years[getMeta().years.length-1]||'2026')); }
  if(!tmpl) return {ok:false, error:'no CAL_Template and no existing calendar to copy'};

  // Duplicate the template (keeps formulas + conditional formatting), then wipe DATA rows.
  var copy=tmpl.copyTo(_ss()); copy.setName(name);
  var lastRow=copy.getLastRow();
  if(lastRow>=CAL_FIRST){
    // Clear only INPUT columns so staff/workload data never carries over,
    // but KEEP the formula columns (total, status, fail) which recompute automatically.
    // Inputs: date(2)..newcase(16) and shs1(18)..shs2(19). Skip total(17)=formula.
    var nRows=lastRow-CAL_FIRST+1;
    copy.getRange(CAL_FIRST, CC.date, nRows, CC.newcase-CC.date+1).clearContent(); // 2..16
    copy.getRange(CAL_FIRST, CC.shs1, nRows, CC.shs2-CC.shs1+1).clearContent();     // 18..19
    copy.getRange(CAL_FIRST, CC.status, lastRow-CAL_FIRST+1, 1).clearNote();
    // If copied from a real year sheet, also blank the make-up/right block leftovers.
    if(!usingTemplate){
      copy.getRange(CAL_FIRST, CC.status, lastRow-CAL_FIRST+1, CC.fail-CC.status+1).clearContent();
    }
  }

  var tz=Session.getScriptTimeZone();
  var wkNames=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var hol=_holidayMap(year);
  var start=new Date(year,0,1), end=new Date(year,11,31);
  var days=Math.round((end-start)/86400000)+1;
  var holCount=0;

  // Build the day rows in memory then write once (fast, single setValues).
  var out=[]; // [date, weekday, type]
  for(var d=0; d<days; d++){
    var dt=new Date(year,0,1+d);
    var ds=Utilities.formatDate(dt,tz,'yyyy-MM-dd');
    var dow=dt.getDay(); // 0=Sun..6=Sat
    var wk=wkNames[dow];
    var type='';
    // Priority: Holiday (PH/SH/RD) first, then Sat/Sun, else blank weekday.
    if(hol[ds]){ type=hol[ds]; holCount++; }
    else if(dow===6) type='Sat';
    else if(dow===0) type='Sun';
    out.push([dt, wk, type]);
  }
  // Write date (B), weekday (C), type (D) in one shot.
  copy.getRange(CAL_FIRST, CC.date, out.length, 1).setValues(out.map(function(r){return [r[0]];}));
  copy.getRange(CAL_FIRST, CC.weekday, out.length, 1).setValues(out.map(function(r){return [r[1]];}));
  copy.getRange(CAL_FIRST, CC.type, out.length, 1).setValues(out.map(function(r){return [r[2]];}));

  _log('generateCalendar', year+' (empty; holidays='+holCount+')', body.user||role);
  SpreadsheetApp.flush();
  return {ok:true, sheet:name, days:days, holidays:holCount};
}

// ---------------------------------------------------------------- generateRoster
// Sat / Sun duty follows the TEAM LIST rotation (NOT PH order):
//   Round 1 sub-team order: A1, A2, B1, B2, C1, C2, D1, D2
//   Round 2 swaps each team's sub-teams: A2, A1, B2, B1, C2, C1, D2, D1
//   ...alternating every round.
// A whole sub-team backs one weekend day together. Sat needs 6 IPD, Sun needs 5.
// "Sat Only" staff (= sub-team 1 helpers) join their TEAM when that team backs a SAT.
// "Sun Only" staff (= sub-team 2 helpers) join their TEAM when that team backs a SUN.
// PH / SH / RD days keep the old PH-order round-robin.
function generateRoster(body, role){
  var year=Number(body.year);
  var sh=_sh(CAL_PREFIX+year); if(!sh) return {ok:false, error:'no '+CAL_PREFIX+year};
  var tz=Session.getScriptTimeZone();
  var fromM=body.fromMonth||1, toM=body.toMonth||12;
  var last=sh.getLastRow();
  var rows=sh.getRange(CAL_FIRST,1,last-CAL_FIRST+1,CC.fail).getValues();

  // ---- Build team-list sub-team roster ----
  var team=getTeam();                      // [{team,sub,cat,abbr,name,tier}]
  var activeMap={}; getStaff().forEach(function(s){ activeMap[s.abbr]=(s.active==='Y'); });
  var teams=['A','B','C','D'];
  // core members: sub == '1' or '2'
  var core={};   // core['A']['1'] = [abbr,...]
  var satOnly={},sunOnly={},opd={}; // per team
  teams.forEach(function(t){ core[t]={'1':[],'2':[]}; satOnly[t]=[]; sunOnly[t]=[]; opd[t]=[]; });
  team.forEach(function(m){
    var t=m.team, sub=String(m.sub||'');
    if(!core[t]) return;
    if(/opd/i.test(sub)) opd[t].push(m.abbr);           // OPD grouping in Team_List
    else if(sub==='1'||sub==='2') core[t][sub].push(m.abbr);
    else if(/sat/i.test(sub)) satOnly[t].push(m.abbr);
    else if(/sun/i.test(sub)) sunOnly[t].push(m.abbr);
  });
  // Flat OPD rotation pool ordered by team A,B,C,D so Sat OPD cycles through teams.
  var opdPool=[]; teams.forEach(function(t){ (opd[t]||[]).forEach(function(a){ if(activeMap[a]!==false) opdPool.push(a); }); });
  var opdPtr=0;
  // rotation sequence of {team,sub}
  function rotationSeq(roundEven){
    var seq=[];
    teams.forEach(function(t){
      if(!roundEven){ seq.push({team:t,sub:'1'}); seq.push({team:t,sub:'2'}); }
      else          { seq.push({team:t,sub:'2'}); seq.push({team:t,sub:'1'}); }
    });
    return seq;
  }

  // ---- PH-order pool (for PH/SH/RD) with skip-and-carry rule ----
  // PH capability = active staff WITH a valid PH order number (>0). No order = not capable.
  var allStaff=getStaff();
  // Capability map: abbr -> {ort:bool, neuro:bool, tier:number, name, ph_round}
  var capMap={};
  allStaff.forEach(function(s){
    capMap[s.abbr]={
      ort:   String(s.ort||'').toUpperCase()==='Y',
      neuro: String(s.neuro||'').toUpperCase()==='Y',
      tier:  Number(s.tier)||2,
      name:  s.name,
      ph_round: Number(s.ph_round)||1
    };
  });
  var phStaff=allStaff.filter(function(s){ return s.active==='Y' && (Number(s.ph_order)>0); });
  phStaff.sort(function(a,b){ return (Number(a.ph_order)||999)-(Number(b.ph_order)||999); });
  var phPool=phStaff.map(function(s){return s.abbr;}); var phPtr=0;
  // Optional start staff for the FIRST PH/RD/SH draw.
  if(body.startPh){
    var sp=String(body.startPh).trim();
    var spIdx=phPool.indexOf(sp);
    if(spIdx>=0) phPtr=spIdx;
  }
  // Round tracking: each staff has a current round; we only advance to the next round
  // once EVERYONE in the pool has served the current round (prevents double duty).
  var phRound={}; phPool.forEach(function(a){ phRound[a]=capMap[a]?capMap[a].ph_round:1; });
  var phServedThisRound={};   // abbr -> true once used in the current round
  var phRoundNo = phPool.length ? Math.min.apply(null, phPool.map(function(a){return phRound[a];})) : 1;

  // Does adding `cand` to `chosen` keep us on track to satisfy the rule?
  // Rule (matches STATUS formula): need >=2 Tier-1, >=1 ORT, >=1 NEURO in the final `need2` picks.
  // We SKIP a candidate only if picking them would make it IMPOSSIBLE to still satisfy
  // the remaining requirements with the seats left. Skipped staff are carried to next round.
  function phCounts(list){
    var t1=0,ort=0,neu=0;
    list.forEach(function(a){ var c=capMap[a]; if(!c)return; if(c.tier===1)t1++; if(c.ort)ort++; if(c.neuro)neu++; });
    return {t1:t1, ort:ort, neu:neu};
  }
  // Given current chosen + a candidate pool remaining, can we still finish valid?
  function canStillSatisfy(chosen, remainingAbbrs, need){
    var seatsLeft=need-chosen.length;
    var cur=phCounts(chosen);
    var needT1=Math.max(0,2-cur.t1), needOrt=Math.max(0,1-cur.ort), needNeu=Math.max(0,1-cur.neu);
    if(seatsLeft<=0) return needT1===0&&needOrt===0&&needNeu===0;
    // count how many remaining can fill each requirement
    var remT1=0,remOrt=0,remNeu=0;
    remainingAbbrs.forEach(function(a){ var c=capMap[a]; if(!c)return; if(c.tier===1)remT1++; if(c.ort)remOrt++; if(c.neuro)remNeu++; });
    if(remT1<needT1||remOrt<needOrt||remNeu<needNeu) return false;
    // rough seat feasibility: sum of distinct requirements must fit remaining seats
    return (needT1+needOrt+needNeu)<=seatsLeft+2; // +2 slack: one staff may cover ORT+NEURO+T1
  }

  // weekend rotation pointers
  // ---- Optional START offsets (user chooses where the roster begins drawing) ----
  // body.startTeam e.g. 'A1','A2','B1'..'D2' -> which team+sub takes the FIRST Sat/Sun.
  // body.startPh e.g. staff abbr -> who takes the FIRST PH/RD/SH.
  var startWkOffset=0;
  if(body.startTeam){
    var st=String(body.startTeam).trim().toUpperCase();
    var stTeam=st.charAt(0), stSub=st.slice(1)||'1';
    var baseSeq=rotationSeq(false); // round-0 order [A1,A2,B1,B2,...]
    for(var qi=0; qi<baseSeq.length; qi++){
      if(baseSeq[qi].team===stTeam && String(baseSeq[qi].sub)===stSub){ startWkOffset=qi; break; }
    }
  }
  var wkIdx=startWkOffset;   // index into full rotation sequence (advances per weekend DAY)
  var filled=0, needAdmin=0, satDone=0, sunDone=0;

  for(var i=0;i<rows.length;i++){
    var d=rows[i][CC.date-1]; if(!(d instanceof Date)) continue;
    if((d.getMonth()+1)<fromM || (d.getMonth()+1)>toM) continue;
    var rawType=String(rows[i][CC.type-1]||'').trim();
    var type=rawType.toUpperCase();
    var calRow=CAL_FIRST+i;
    var ds=Utilities.formatDate(d,tz,'yyyy-MM-dd');

    if(type==='SAT' || type==='SUN'){
      var isSat=(type==='SAT');
      // pick next sub-team in rotation
      var round=Math.floor(wkIdx/(teams.length*2));      // which pass
      var seq=rotationSeq(round%2===1);
      var pick=seq[wkIdx%(teams.length*2)];
      wkIdx++;
      var t=pick.team, sub=pick.sub;
      var members=(core[t][sub]||[]).filter(function(a){return activeMap[a]!==false;});
      // add day-specific helpers who follow this team
      var helpers=isSat?satOnly[t]:sunOnly[t];
      helpers=helpers.filter(function(a){return activeMap[a]!==false;});
      var chosen=members.concat(helpers);
      var need=isSat?6:5;
      // top up from the OTHER sub-team of same team if short, then next teams
      if(chosen.length<need){
        var other=core[t][sub==='1'?'2':'1']||[];
        other.forEach(function(a){ if(chosen.length<need && chosen.indexOf(a)<0 && activeMap[a]!==false) chosen.push(a); });
      }
      chosen=chosen.slice(0,need);
      _writeIpd(year, calRow, chosen);
      // ---- OPD staff on SAT: pick next from the A,B,C,D OPD rotation pool ----
      var opdPick='';
      if(isSat && opdPool.length){
        opdPick=opdPool[opdPtr%opdPool.length]; opdPtr++;
        sh.getRange(calRow, CC.opd).setValue(opdPick);
      }
      var remark='Team '+t+' (sub-team '+sub+')'+(helpers.length?' + '+(isSat?'Sat-only':'Sun-only')+' '+helpers.join(','):'')+(opdPick?' | OPD: '+opdPick:'');
      sh.getRange(calRow, CC.status).setNote(remark);
      var chkW=_calStatusForDate(year, ds);
      if(String(chkW.status).toUpperCase().indexOf('OK')<0){ needAdmin++; }
      else { filled++; if(isSat) satDone++; else sunDone++; }
      continue;
    }

    if(['PH','RD','SH'].indexOf(type)>=0){
      var need2=5, chosen2=[], skippedToday=[];
      // Candidates eligible THIS round = still on their current round (not yet served).
      // We iterate in ph_order; skip a candidate if adding them would make the rule
      // impossible to satisfy, OR to reserve a needed specialty for a later seat.
      var guard=0, maxGuard=phPool.length*3;
      while(chosen2.length<need2 && guard<maxGuard){
        guard++;
        // If everyone has served this round, advance the round for all.
        var eligible=phPool.filter(function(a){ return !phServedThisRound[a] && chosen2.indexOf(a)<0; });
        if(eligible.length===0){
          // round complete -> bump round for everyone, reset served flags
          phPool.forEach(function(a){ phRound[a]=(phRound[a]||1)+1; });
          phRoundNo++; phServedThisRound={};
          eligible=phPool.filter(function(a){ return chosen2.indexOf(a)<0; });
          if(eligible.length===0) break;
        }
        // Walk eligible in order starting from phPtr.
        var picked=null, startPtr=phPtr;
        for(var scan=0; scan<eligible.length; scan++){
          var cand=eligible[(startPtr+scan)%eligible.length];
          var trial=chosen2.concat([cand]);
          var remaining=eligible.filter(function(a){return a!==cand && trial.indexOf(a)<0;});
          // Accept cand only if we can STILL finish the rule with the seats left.
          if(canStillSatisfy(trial, remaining, need2)){ picked=cand; break; }
          else { if(skippedToday.indexOf(cand)<0) skippedToday.push(cand); }
        }
        if(picked===null){
          // No single pick keeps us feasible -> take next eligible anyway (best effort).
          picked=eligible[startPtr%eligible.length];
        }
        chosen2.push(picked);
        phServedThisRound[picked]=true;
        // advance pointer to just after the picked staff's ph_order position
        phPtr=(phPool.indexOf(picked)+1)%phPool.length;
      }
      _writeIpd(year, calRow, chosen2);
      var chk=_calStatusForDate(year, ds);
      var note='Round '+phRoundNo+(skippedToday.length?' | Skipped(carry): '+skippedToday.join(','):'');
      if(String(chk.status).toUpperCase().indexOf('OK')<0){ note+=' | NEEDS ADMIN'; needAdmin++; }
      else filled++;
      sh.getRange(calRow, CC.status).setNote(note);
      continue;
    }
    // normal weekdays: skip (manual)
  }

  // ---- Persist updated PH rounds back to Staff_Master (task: record round on generate) ----
  var roundsWritten=0;
  if(phPool.length){
    var smSh=_sh(SM);
    var smVals=smSh.getRange(SM_FIRST,1,SM_LAST-SM_FIRST+1, C.ph_round).getValues();
    for(var si=0; si<smVals.length; si++){
      var ab=String(smVals[si][C.abbr-1]||'').trim();
      if(ab && phRound[ab]!==undefined){
        smSh.getRange(SM_FIRST+si, C.ph_round).setValue(phRound[ab]);
        roundsWritten++;
      }
    }
  }
  SpreadsheetApp.flush();
  _cacheBust(); // ph_round changed in Staff_Master
  _log('generateRoster', year+' m'+fromM+'-'+toM+' filled='+filled+' sat='+satDone+' sun='+sunDone+' needAdmin='+needAdmin+' phRound->'+phRoundNo+' rounds='+roundsWritten, body.user||role);
  return {ok:true, filled:filled, sat:satDone, sun:sunDone, needAdmin:needAdmin, phRound:phRoundNo, roundsWritten:roundsWritten};
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

const REPAIR_BASE = 'https://bf56-kms-wms-web-pr9.jdadelivers.com/data/WM/wm';
const REPAIR_SITE = 'siteId=AZ02&subsites=COKE&subsites=FAIRLIFE';
const REPAIR_ACTIVITY = ['pickQuantity','pickedQuantity','actualLpnPicks','actualSubLpnPicks','actualDetailLpnPicks','completedLpnPicks','completedSubLpnPicks','completedDetailPicks'];
const REPAIR_PHASES = {load:'Checking the load',appointment:'Checking the existing appointment',waves:'Finding the existing wave',wave:'Checking allocation',waveLoads:'Checking wave ownership',picks:'Checking pick work',recheckWave:'Rechecking allocation',recheckAppointment:'Rechecking the appointment',recheckLoad:'Rechecking the load',cancelWave:'Deleting the unallocated wave',pollWave:'Waiting for wave deletion',verifyWavesGone:'Verifying wave deletion',appointmentBeforeDelete:'Rechecking the appointment before deletion',loadBeforeDelete:'Rechecking the load before deletion',deleteAppointment:'Deleting the old appointment',verifyAppointmentGone:'Verifying appointment deletion',loadBeforeCreate:'Checking the load before recreation',wavesBeforeCreate:'Checking for concurrent wave changes',createAppointment:'Creating the replacement appointment',verifyNewAppointment:'Verifying the replacement appointment',verifyNewLoad:'Verifying the replacement assignment'};
function repairParse(value, fallback) {try {return typeof value==='string'?JSON.parse(value):value??fallback;}catch{return fallback;}}
function repairDate(value) {return new Date(value-7*3600000).toISOString().slice(0,10);}
function repairStop(s, status, note, uncertain=false) {
 s.phase='done';s.audit.recoveryStatus=status;s.audit.recoveryNote=note;
 s.audit.repairNeedsReview=uncertain;s.audit.manualReviewRequired=true;return s;
}
function repairResponse(response) {
 const body=repairParse(response.body??response.data,null),status=Number(response.statusCode);
 return {status,body,ok:Number.isInteger(status)&&status>=200&&status<300&&body&&typeof body==='object'&&!body.errors};
}
function repairList(result) {
 if(!result.ok||!Array.isArray(result.body.data))return null;
 const list=result.body.data;
 if(result.body.totalCount!==undefined&&result.body.totalCount!==list.length)return null;
 return list;
}
function repairObject(result) {if(!result.ok)return null;const d=result.body.data;return Array.isArray(d)?(d.length===1?d[0]:null):d&&typeof d==='object'?d:null;}
function repairLoadMatches(s,l,appointment) {return l&&l.resourceId===s.loadResourceId&&l.carrierMoveId===s.row.carMoveId&&l.warehouseId==='AZ02'&&(!appointment||l.appointmentId===appointment);}
function repairAppMatches(s,a,id) {return a&&a.appointmentId===id&&a.resourceId===id&&a.carrierMoveId===s.row.carMoveId&&a.warehouseId==='AZ02'&&a.appointmentType==='S'&&a.trailerCode==='SHIP';}
function repairAppSafe(a) {return a&&a.dispatch===false&&a.close===false&&a.trailerCheckedIn===false&&!a.trailerId&&!a.trailerNumber&&!a.trailerArrivalDate&&!a.closeDate&&!a.recurringAppointmentId&&!a.recurrenceRule&&!a.advancedAllocation&&!a.storageLocation;}
function repairAppFingerprint(a) {return JSON.stringify([a.resourceId,a.carrierMoveId,a.warehouseId,a.startDate,a.endDate,a.slotId,a.carrierCode,a.version,a.dateLastModified,a.dispatch,a.close,a.trailerCheckedIn,a.trailerId,a.storageLocation,a.advancedAllocation,a.recurringAppointmentId,a.recurrenceRule]);}
function repairWaveSafe(s,w) {
 if(!w||w.waveNumber!==s.waveNumber||w.warehouseId!=='AZ02')return 'The wave identity or warehouse could not be verified.';
 const labels={ALOC:'Allocated',AINP:'Allocation in progress',REL:'Released',SCH:'Scheduled for release',CMPL:'Complete'};
 if(labels[w.waveStatus]||w.dateReleased||w.dateCompleted||REPAIR_ACTIVITY.some(k=>typeof w[k]==='number'&&w[k]>0)||[w.pickCount,w.totalShipmentsStaged,w.replCount,w.xdkCount].some(v=>typeof v==='number'&&v>0)) {
  s.audit.allocationStatus=labels[w.waveStatus]||'Allocation or work activity';return 'The wave has allocation or work activity and must remain unchanged.';
 }
 if(w.waveStatus!=='PLAN'||w.pickCount!==0||w.totalShipmentsStaged!==0||w.replCount!==0||w.xdkCount!==0||REPAIR_ACTIVITY.some(k=>w[k]!=null&&(typeof w[k]!=='number'||!Number.isFinite(w[k])||w[k]!==0)))return 'Allocation is not confirmed as empty; manual review is required.';
 if(w.loadCount!==1)return 'The wave does not belong to exactly one load; manual review is required.';
 const expected=REPAIR_BASE+'/waves/'+encodeURIComponent(s.waveNumber);
 if(w.picks_uri!==expected+'/picks'||w.loads_uri!==expected+'/outboundLoads')return 'Wave association links could not be verified.';
 s.audit.allocationStatus='Unallocated';return '';
}
export function startRepair(run,q,now=Date.now()) {
 if(q.confirm!==true)throw new Error('Confirm the production appointment repair.');
 if(!run?.runId||String(q.runId)!==run.runId||!['completed','completed_with_issues','failed'].includes(run.status))throw new Error('The selected run must finish before repairing an appointment.');
 if(q.expectedUpdatedAt!==run.updatedAt)throw new Error('The run has changed. Refresh before continuing.');
 if(!Number.isInteger(q.rowIndex)||q.rowIndex<0||!/^\w{8}-\w{4}-4\w{3}-[89ab]\w{3}-\w{12}$/i.test(q.repairId||''))throw new Error('The repair request is invalid.');
 const summary=repairParse(run.summaryJson,{}),storedRow=summary.results?.[q.rowIndex];
 const row=storedRow?{...storedRow,whId:storedRow.whId??'AZ02'}:null;
 if(!row||row.carMoveId!==q.load)throw new Error('The selected load no longer matches the saved result.');
 if(row.direction!=='OB'||row.whId!=='AZ02')throw new Error('Only outbound AZ02 appointment conflicts can be repaired here.');
 if(row.appointmentConflict!==true&&!/load has been assigned to another appoi(?:nt|t)ment/i.test(String(row.apptWarning||'')))throw new Error('This load has no recorded appointment conflict.');
 if(summary.appointmentRepairs?.some(a=>a.repairId===q.repairId))throw new Error('This repair request was already submitted. Refresh to see its result.');
 if(row.repairWriteAttempted||row.appointmentRecreated||row.waveDeleted||row.appointmentDeleted)throw new Error('A previous repair changed or may have changed this load. Review it in Blue Yonder before taking further action.');
 if(!/^[A-Za-z0-9_-]{1,100}$/.test(row.carMoveId)||!String(row.carcod||'').trim()||!['CHILLED_DOORS','AMBIENT_NORTH_DOORS','AMBIENT_SOUTH_DOORS'].includes(row.slotId))throw new Error('The saved load, carrier or appointment slot is incomplete.');
 if(!Number.isFinite(Date.parse(row.startIso))||!Number.isFinite(Date.parse(row.endIso))||repairDate(Date.parse(row.startIso))<repairDate(now)||Date.parse(row.endIso)<=Date.parse(row.startIso)||Date.parse(row.endIso)-Date.parse(row.startIso)>86400000)throw new Error('The requested appointment date is invalid or in the past. Prepare a current file.');
 return {runId:run.runId,originalStatus:run.status,rowIndex:q.rowIndex,row:{...row},summary,phase:'load',startedAt:new Date(now).toISOString(),step:0,pollCount:0,repairId:q.repairId,actor:String(q.actor||'').slice(0,240),persistedSummary:run.summaryJson,audit:{repairId:q.repairId,repairBy:String(q.actor||'').slice(0,240),repairStartedAt:new Date(now).toISOString(),recoveryStatus:'Checking',recoveryNote:'Repair requested from Wave Bot.',allocationStatus:'Not checked',waveDeleted:false,appointmentDeleted:false,appointmentRecreated:false,repairWriteAttempted:false,repairNeedsReview:false,manualReviewRequired:true,previousWave:'',previousAppointmentId:''}};
}
export function planRepair(input,now=Date.now()) {
 const s=JSON.parse(JSON.stringify(input));s.step++;
 if(s.phase!=='done'&&(s.step>100||now-Date.parse(s.startedAt)>10*60000))repairStop(s,'Stopped','The repair exceeded its time limit. Review the recorded actions before trying again.',s.audit.repairWriteAttempted);
 const enc=encodeURIComponent,loadPath=REPAIR_BASE+'/outboundLoads/'+enc(s.loadResourceId||s.row.carMoveId),wavePath=REPAIR_BASE+'/waves/'+enc(s.waveNumber||''),apptPath=REPAIR_BASE+'/appointments/'+enc(s.audit.previousAppointmentId||'');
 const get=url=>({method:'GET',url,body:{}}),withSite=url=>url+(url.includes('?')?'&':'?')+REPAIR_SITE;
 let request,route=1;
 switch(s.phase){
  case 'done':route=0;break;
  case 'load': request=get(withSite(REPAIR_BASE+'/outboundLoads?query='+enc(JSON.stringify([{column:'carrierMoveId',operator:'EQ',value:s.row.carMoveId,options:{exact:[true,true]}}]))+'&offset=0&limit=2'));break;
  case 'appointment':case 'recheckAppointment':case 'appointmentBeforeDelete':case 'verifyAppointmentGone':request=get(withSite(apptPath));break;
  case 'waves':case 'verifyWavesGone':case 'wavesBeforeCreate':request=get(withSite(loadPath+'/waves?warehouseId=AZ02'));break;
  case 'wave':case 'recheckWave':request=get(withSite(REPAIR_BASE+'/waves/waveDetail?schbat='+enc(s.waveNumber)+'&wh_id=AZ02'));break;
  case 'waveLoads':request=get(withSite(wavePath+'/outboundLoads?offset=0&limit=2'));break;
  case 'picks':request=get(withSite(wavePath+'/picks?offset=0&limit=1'));break;
  case 'recheckLoad':case 'loadBeforeDelete':case 'loadBeforeCreate':case 'verifyNewLoad':request=get(withSite(REPAIR_BASE+'/outboundLoads?query='+enc(JSON.stringify([{column:'carrierMoveId',operator:'EQ',value:s.row.carMoveId,options:{exact:[true,true]}}]))+'&offset=0&limit=2'));break;
  case 'cancelWave':route=2;request={method:'PUT',url:withSite(REPAIR_BASE+'/waves/cancelWave/async'),body:s.wave};break;
  case 'pollWave':request=get(s.pollUrl);break;
  case 'deleteAppointment':route=3;request={method:'DELETE',url:withSite(apptPath),body:s.appointment};break;
  case 'createAppointment':route=4;request={method:'POST',url:withSite(REPAIR_BASE+'/appointments?ignoreWarnings=false'),body:{appointmentType:'S',trailerCode:'SHIP',carrierCode:s.row.carcod,scacCode:s.row.carcod,carrierMoveId:s.row.carMoveId,slotId:s.row.slotId,startDate:s.row.startIso,endDate:s.row.endIso,warehouseId:'AZ02',dispatch:false,close:false,liveLoadFlag:false,hotFlag:false,hazmat:false,turnAroundFlag:false,surplusFlag:false,advancedAllocation:false,advancedAllocationHours:0,expectedQuantity:0,receivedQuantity:0,isAvailable:false,short:false,storageLocation:'',trailerNumber:'',autoGenerated:false,waiting:false,overTime:false,lateToDoor:false,trailerCheckedIn:false}};break;
  case 'verifyNewAppointment':request=get(withSite(REPAIR_BASE+'/appointments/'+enc(s.audit.appointmentId)));break;
  default:throw new Error('Unknown repair stage.');
 }
 if(request&&(!request.url.startsWith(REPAIR_BASE+'/')||/[\r\n#]/.test(request.url)))throw new Error('Unexpected repair request destination.');
 if(route>=2){
  if(repairDate(Date.parse(s.row.startIso))<repairDate(now))return planRepair(repairStop(s,'Stopped','The requested appointment date has passed.',s.audit.repairWriteAttempted),now);
  if(route===2&&(!s.picksVerified||!s.loadVerified||!s.appointmentVerified||repairWaveSafe(s,s.wave)))throw new Error('Wave deletion safeguards are incomplete.');
  if(route===3&&(!s.audit.waveDeleted||!s.appointmentVerified||!s.loadVerified))throw new Error('Appointment deletion safeguards are incomplete.');
  if(route===4&&(!s.audit.appointmentDeleted||!s.emptyLoadVerified||!s.emptyWavesVerified))throw new Error('Appointment recreation safeguards are incomplete.');
  s.audit.repairWriteAttempted=true;s.audit.lastWriteStage=s.phase;
 }
 s.audit.recoveryCheckedAt=new Date(now).toISOString();
 if(s.phase!=='done'){s.audit.recoveryStatus=REPAIR_PHASES[s.phase];s.audit.recoveryNote=route>=2?'Production change requested. Check the final result before retrying.':'Repair in progress. No action should be submitted again while this run is active.';}
 s.route=route;s.request=request||{method:'GET',url:'',body:{}};
 return s;
}
export function applyRepairResponse(input,response,now=Date.now()) {
 const s=JSON.parse(JSON.stringify(input)),r=repairResponse(response),list=repairList(r),obj=repairObject(r);
 const stop=(note,uncertain=s.audit.repairWriteAttempted)=>repairStop(s,uncertain?'Manual review required':'Protected — left unchanged',note,uncertain);
 if(s.phase==='verifyAppointmentGone'&&r.status===404){s.audit.appointmentDeleted=true;s.phase='loadBeforeCreate';return s;}
 if(s.phase==='deleteAppointment'&&r.status===204){s.phase='verifyAppointmentGone';return s;}
 if(!r.ok)return stop('Blue Yonder did not confirm '+(REPAIR_PHASES[s.phase]||s.phase).toLowerCase()+' (HTTP '+(r.status||'unavailable')+'). No automatic retry was sent.');
 switch(s.phase){
  case 'load':{
   const l=list?.length===1?list[0]:null;
   if(!l||l.carrierMoveId!==s.row.carMoveId||l.warehouseId!=='AZ02'||!l.resourceId||!l.appointmentId||l.resourceId!==s.row.carMoveId||l.waves_uri!==REPAIR_BASE+'/outboundLoads/'+encodeURIComponent(l.resourceId)+'/waves')return stop('The load and its existing appointment could not be identified uniquely.',false);
   s.loadResourceId=l.resourceId;s.audit.previousAppointmentId=l.appointmentId;s.phase='appointment';break;
  }
  case 'appointment':
   if(!repairAppMatches(s,obj,s.audit.previousAppointmentId)||!repairAppSafe(obj))return stop('The existing appointment is not an unchanged, unassigned outbound appointment eligible for repair.',false);
   s.appointment=obj;s.appointmentFingerprint=repairAppFingerprint(obj);s.audit.previousAppointmentStart=obj.startDate;s.audit.previousAppointmentEnd=obj.endDate;s.phase='waves';break;
  case 'waves':
   if(!list||list.length!==1||!list[0].waveNumber||(list[0].warehouseId!=null&&list[0].warehouseId!=='AZ02'))return stop('Exactly one existing wave is required; no wave or multiple waves needs manual review.',false);
   s.waveNumber=list[0].waveNumber;s.audit.previousWave=s.waveNumber;s.phase='wave';break;
  case 'wave':{
   const reason=repairWaveSafe(s,obj);if(reason)return stop(reason,false);s.wave=obj;s.phase='waveLoads';break;
  }
  case 'waveLoads':
   if(!list||list.length!==1||!repairLoadMatches(s,list[0],s.audit.previousAppointmentId))return stop('The wave is shared or its load association changed.',false);
   s.loadVerified=true;s.phase='picks';break;
  case 'picks':
   if(!list||list.length!==0)return stop('Pick work could not be confirmed as empty.',false);
   s.picksVerified=true;s.phase='recheckWave';break;
  case 'recheckWave':{
   const reason=repairWaveSafe(s,obj);if(reason)return stop(reason,false);
   if(obj.dateLastModified!==s.wave.dateLastModified)return stop('The wave changed during inspection. Refresh and inspect it before retrying.',false);
   s.wave=obj;
   if(Date.parse(s.appointment.startDate)===Date.parse(s.row.startIso)&&Date.parse(s.appointment.endDate)===Date.parse(s.row.endIso)&&s.appointment.slotId===s.row.slotId)return repairStop(s,'Already correct — left unchanged','The existing appointment already has the requested date, time and slot. No wave or appointment was deleted.');
   s.phase='recheckAppointment';break;
  }
  case 'recheckAppointment':case 'appointmentBeforeDelete':
   if(!repairAppMatches(s,obj,s.audit.previousAppointmentId)||!repairAppSafe(obj)||repairAppFingerprint(obj)!==s.appointmentFingerprint)return stop('The existing appointment changed during repair. No further changes were sent.');
   s.appointment=obj;s.appointmentVerified=true;s.phase=s.phase==='recheckAppointment'?'recheckLoad':'loadBeforeDelete';break;
  case 'recheckLoad':case 'loadBeforeDelete':
   if(!list||list.length!==1||!repairLoadMatches(s,list[0],s.audit.previousAppointmentId))return stop('The load assignment changed during repair. No further changes were sent.');
   s.loadVerified=true;s.phase=s.phase==='recheckLoad'?'cancelWave':'deleteAppointment';break;
  case 'cancelWave':{
   const uri=obj?.asynchronousResources_uri;
   if(typeof uri!=='string'||!uri.startsWith(REPAIR_BASE+'/waves/cancelWave/async/')||!/^https:\/\/[^?#]+(?:\?[^#]*)?$/.test(uri))return stop('Wave deletion was submitted, but its tracking address could not be verified.');
   s.pollUrl=uri;s.phase='pollWave';break;
  }
  case 'pollWave':{
   if(!list||list.length!==1)return stop('Wave deletion returned an unexpected tracking response.');
   const status=list[0].asynchronousStatus;
   if(status==='COMPLETE')s.phase='verifyWavesGone';else if(status==='FAILURE'||++s.pollCount>=30)return stop('Wave deletion did not finish successfully. The appointment was left untouched.');
   break;
  }
  case 'verifyWavesGone':
   if(!list||list.length!==0)return stop('Wave deletion completed, but the load still has a wave or its associations could not be verified.');
   s.audit.waveDeleted=true;s.phase='appointmentBeforeDelete';break;
  case 'deleteAppointment':s.phase='verifyAppointmentGone';break;
  case 'verifyAppointmentGone':return stop('The old appointment still exists after deletion; recreation was stopped.');
  case 'loadBeforeCreate':
   if(!list||list.length!==1||!repairLoadMatches(s,list[0])||list[0].appointmentId)return stop('The load is still assigned to an appointment. A replacement was not created.');
   s.emptyLoadVerified=true;s.phase='wavesBeforeCreate';break;
  case 'wavesBeforeCreate':
   if(!list||list.length!==0)return stop('A wave appeared during repair. Appointment recreation was stopped.');
   s.emptyWavesVerified=true;s.phase='createAppointment';break;
  case 'createAppointment':
   if(!obj?.appointmentId||obj.appointmentId===s.audit.previousAppointmentId)return stop('The replacement request did not return a new appointment ID. Check Blue Yonder before retrying.');
   s.audit.appointmentId=String(obj.appointmentId);s.phase='verifyNewAppointment';break;
  case 'verifyNewAppointment':
   if(!repairAppMatches(s,obj,s.audit.appointmentId)||Date.parse(obj.startDate)!==Date.parse(s.row.startIso)||Date.parse(obj.endDate)!==Date.parse(s.row.endIso)||obj.slotId!==s.row.slotId)return stop('The replacement appointment did not match the requested load, date, time and slot.');
   s.phase='verifyNewLoad';break;
  case 'verifyNewLoad':
   if(!list||list.length!==1||!repairLoadMatches(s,list[0],s.audit.appointmentId))return stop('The replacement appointment exists, but the load assignment was not verified.');
   s.audit.appointmentRecreated=true;
   return repairStop(s,'Appointment recreated','The unallocated wave and old appointment were deleted. The replacement appointment was verified at the requested time. The wave was not recreated; manually verify this load before further processing.');
  default:return stop('An unexpected repair response was received.');
 }
 s.audit.recoveryCheckedAt=new Date(now).toISOString();return s;
}
export function repairSummary(s) {
 const summary=JSON.parse(JSON.stringify(s.summary)),audit={...s.audit,load:s.row.carMoveId,order:s.row.ordnum,requestedStart:s.row.startIso,requestedEnd:s.row.endIso,phase:s.phase};
 summary.results[s.rowIndex]={...summary.results[s.rowIndex],...s.audit,appointmentConflict:true};
 const history=Array.isArray(summary.appointmentRepairs)?summary.appointmentRepairs:[];
 summary.appointmentRepairs=[...history.filter(a=>a.repairId!==s.repairId),audit];
 summary.repairActive=s.phase!=='done'?audit:null;
 return summary;
}

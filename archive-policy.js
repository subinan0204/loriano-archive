/* LORIANO: evidence-based read projection. Never changes stored personal records. */
(function(root){
'use strict';
const excluded = new Set(['F5jQv9RPmhE']);
let evidence = new Map();
const status = {loaded:false, count:0, error:null};
function classifyDimensions(width,height){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0)return 'review';
 if(width>=height)return 'long';
 return width*16===height*9?'short':'review';
}
function setEvidence(data){
 const rows=Array.isArray(data)?data:data?.rows;
 if(!Array.isArray(rows))throw new Error('Invalid aspect evidence');
 const next=new Map();
 for(const row of rows){if(!/^[\w-]{11}$/.test(row.id)||excluded.has(row.id)||next.has(row.id))throw new Error('Invalid or duplicate evidence ID');
 const type=row.consistent===false?'review':classifyDimensions(row.width,row.height);
 if(row.classification!==type)throw new Error('Evidence classification mismatch for '+row.id);
 if(!row.source||!row.observedAt)throw new Error('Missing evidence provenance'); next.set(row.id,Object.freeze({...row}));}
 evidence=next;status.loaded=true;status.count=next.size;status.error=null;
}
function isAllowed(id){return typeof id==='string'&&!excluded.has(id);}
function project(row){const proof=evidence.get(row.id);const videoType=proof?.classification||'review';return {...row,videoType,shorts:videoType==='review'?null:videoType==='short',aspectEvidence:proof?{width:proof.width,height:proof.height,source:proof.source,observedAt:proof.observedAt}:null};}
function view(rows){return (Array.isArray(rows)?rows:[]).filter(row=>row&&isAllowed(row.id)).map(project);}
function counts(rows){return rows.reduce((a,v)=>{a.total++;a[v.videoType==='short'?'short':v.videoType==='long'?'long':'review']++;return a;},{total:0,short:0,long:0,review:0});}
function label(row){return row.videoType==='short'?'쇼츠':row.videoType==='long'?'롱폼':'검토 필요';}
const api={isAllowed,project,view,counts,label,classifyDimensions,setEvidence,status,ready:Promise.resolve()};
if(typeof document!=='undefined'){
 const url=new URL('./aspect-evidence.json',document.currentScript?.src||location.href);
 api.ready=fetch(url).then(r=>{if(!r.ok)throw new Error('Aspect evidence HTTP '+r.status);return r.json();}).then(setEvidence).catch(e=>{status.error=String(e.message);console.warn('화면비 근거를 읽지 못해 검토 필요로 표시합니다.');});
}
Object.defineProperty(root,'LorianoArchivePolicy',{value:Object.freeze(api),writable:false,configurable:false});
})(globalThis);

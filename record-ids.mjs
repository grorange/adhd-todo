export function stableId(value){
 let a=2166136261,b=3339675911;
 for(let i=0;i<value.length;i++){const unit=value.charCodeAt(i);a=Math.imul(a^unit,16777619)>>>0;b=Math.imul(b^unit,2246822519)>>>0;}
 return a.toString(16).padStart(8,'0')+b.toString(16).padStart(8,'0');
}
export function normalizeLogs(entries){
 const counts=new Map();
 return entries.map(entry=>{const key=JSON.stringify([entry.start,entry.stop,entry.activityId]),n=counts.get(key)||0;counts.set(key,n+1);return {...entry,id:entry.id||'log_'+stableId(key+':'+n)};});
}

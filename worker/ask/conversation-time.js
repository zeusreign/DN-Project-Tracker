(() => {
 'use strict';
 let preferred=globalThis.DNC_HOSTED_BOOT?.timeZone||null;
 function valid(zone){if(!zone)return null;try{return new Intl.DateTimeFormat('en-US',{timeZone:zone}).resolvedOptions().timeZone}catch{return null;}}
 function zone(){return valid(preferred)||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';}
 function instant(value){if(value===null||value===undefined||value==='')return null;const date=new Date(value);return Number.isFinite(date.getTime())?date:null;}
 function format(value){const date=instant(value);if(!date)return 'Start time not recorded';return new Intl.DateTimeFormat(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short',timeZone:zone()}).format(date)+' · '+zone();}
 function hour(){return Number(new Intl.DateTimeFormat('en-US',{hour:'2-digit',hourCycle:'h23',timeZone:zone()}).format(new Date()));}
 globalThis.DNC_TIME={zone,format,hour,setZone:value=>{preferred=valid(value)||null;}};
})();

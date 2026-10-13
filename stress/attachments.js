// Attachments: files and links on tasks and projects, kept in this browser or in the backup folder.
// Served from http://localhost so the folder picker can hand the page the origin-private file system.
const L = require('./lib');
const http=require('http'),fs=require('fs'),path=require('path'),os=require('os');
const BOARD=path.resolve(process.env.LAB_BOARD||path.join(__dirname,'../lab-board.html'));
const S=fs.mkdtempSync(path.join(os.tmpdir(),'lab-att-'));
fs.writeFileSync(S+'/gel.png',require('crypto').randomBytes(30000));fs.writeFileSync(S+'/protocol.pdf','%PDF-1.4 fake protocol');fs.writeFileSync(S+'/huge.bin',Buffer.alloc(27000000));
function listZip(buf){const out=[];let p=0;while(buf.readUInt32LE(p)===0x04034b50){const cs=buf.readUInt32LE(p+18),nl=buf.readUInt16LE(p+26),xl=buf.readUInt16LE(p+28);out.push(buf.slice(p+30,p+30+nl).toString());p+=30+nl+xl+cs}return out}
(async()=>{
  const srv=http.createServer((q,r)=>{r.setHeader('content-type','text/html; charset=utf-8');r.end(fs.readFileSync(BOARD))}).listen(0);
  const URL='http://localhost:'+srv.address().port+'/';
  const b=await L.getBrowser();
  const mk=async(folder)=>{const ctx=await b.newContext({viewport:{width:1400,height:950},acceptDownloads:true});
    await ctx.route(/unpkg\.com/, r => r.abort());
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r=>r.abort());
    if(folder)await ctx.addInitScript(()=>{window.showDirectoryPicker=async()=>navigator.storage.getDirectory()});
    else await ctx.addInitScript(()=>{window.showDirectoryPicker=undefined;window.showSaveFilePicker=undefined;try{if(!sessionStorage.s){sessionStorage.s=1;localStorage.setItem('labboard.prefs.v1',JSON.stringify({abDontAsk:true,abNoticeSeen:true}))}}catch(e){}});
    const p=await ctx.newPage();p._e=[];p.on('pageerror',e=>p._e.push(e.message));await p.goto(URL);await p.waitForTimeout(1000);return {ctx,p}};
  const idbKeys=(p)=>p.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('labboard',1);q.onsuccess=()=>r(q.result)});return await new Promise(r=>{const g=db.transaction('kv').objectStore('kv').getAllKeys();g.onsuccess=()=>r(g.result.filter(k=>String(k).startsWith('att:')).length)})});
  const R={};
  // ---- A. no folder: files kept in the browser
  {const {ctx,p}=await mk(false);
    if(!(await p.$eval('#overlay',o=>o.hidden)))await p.keyboard.press('Escape');
    await p.click('[data-act=load-sample]');
    await p.click('.card:has-text("Lentivirus")');
    R.hint=await p.textContent('.att-hint');
    await p.setInputFiles('[data-att=task] .att-input',[S+'/gel.png',S+'/protocol.pdf']);await p.waitForTimeout(400);
    await p.setInputFiles('[data-att=task] .att-input',[S+'/huge.bin']);await p.waitForTimeout(300);
    R.tooBig=await p.textContent('[data-att=task] .att-msg');
    await p.click('[data-m=att-link]');await p.fill('.att-url','https://lab.example.org/wiki/lentivirus-sop');await p.fill('.att-label','Lentivirus SOP');await p.click('[data-m=att-link-ok]');
    await p.click('[data-m=att-link]');await p.fill('.att-url','S:\\Lab\\CRISPR\\titers.xlsx');await p.keyboard.press('Enter');
    R.rows=await p.$$eval('[data-att=task] .att-row',r=>r.map(x=>x.querySelector('.att-name').textContent+' | '+x.querySelector('.att-meta').textContent));
    
    await p.click('[data-m=save]');await p.waitForTimeout(300);
    R.cardClip=await p.textContent('.card:has-text("Lentivirus") .att-n');R.idbAfterSave=await idbKeys(p);
    await p.click('.card:has-text("Lentivirus")');
    const [d]=await Promise.all([p.waitForEvent('download'),p.click('[data-att=task] .att-row:has-text("gel.png") [data-m=att-dl]')]);
    R.download={name:d.suggestedFilename(),same:fs.readFileSync(await d.path()).equals(fs.readFileSync(S+'/gel.png'))};
    await p.click('[data-close]');
    // add then cancel: the file is discarded
    await p.click('.card:has-text("Titrate")');await p.setInputFiles('[data-att=task] .att-input',[S+'/protocol.pdf']);await p.waitForTimeout(300);
    await p.click('.modal-foot [data-close]');await p.waitForTimeout(200);
    if(!(await p.$eval('#overlay',o=>o.hidden)))await p.click('.modal-foot [data-close]');
    R.idbAfterCancel=await idbKeys(p);
    // finishing a task keeps its files; deleting it removes them after the undo window
    await p.click('.card:has-text("Lentivirus")');await p.selectOption('#f-stage','st_done');await p.click('[data-m=save]');await p.waitForTimeout(400);
    R.idbAfterDone=await idbKeys(p);
    await p.click('.card:has-text("Lentivirus")');await p.click('[data-m=delete]');await p.click('[data-m=delete]');await p.waitForTimeout(300);
    R.idbRightAfterDelete=await idbKeys(p);
    await p.click('#toast [data-toast-act]');await p.waitForTimeout(31500);
    R.idbAfterUndoAndWait=await idbKeys(p);
    await p.click('.card:has-text("Lentivirus")');await p.click('[data-m=delete]');await p.click('[data-m=delete]');await p.waitForTimeout(31500);
    R.idbAfterDeleteAndWait=await idbKeys(p);
    R.errorsA=p._e;await ctx.close();}
  // ---- B. backup folder: files written under attachments/<board>/, zip backup and restore
  {const {ctx,p}=await mk(true);
    await p.click('[data-m=ab-choose]');await p.waitForTimeout(500);
    await p.click('[data-act=load-sample]');await p.waitForTimeout(300);
    await p.click('.card:has-text("Lentivirus")');
    await p.click('[data-m=att-link]');await p.fill('.att-url','https://lab.example.org/sop');await p.keyboard.press('Enter');
    await p.setInputFiles('[data-att=task] .att-input',[S+'/gel.png']);await p.waitForTimeout(400);
    await p.selectOption('#f-rep','1:week');await p.click('[data-m=save]');await p.waitForTimeout(300);
    R.opfs=await p.evaluate(async()=>{const out=[];async function walk(d,pre){for await(const [n,h] of d.entries()){if(h.kind==='directory')await walk(h,pre+n+'/');else out.push(pre+n)}}await walk(await navigator.storage.getDirectory(),'');return out.sort()});
    // repeat: next occurrence carries the link, not the file
    await p.click('.card:has-text("Lentivirus")');await p.selectOption('#f-stage','st_done');await p.click('[data-m=save]');await p.waitForTimeout(400);
    await p.click('.cell:not(.is-done) .card:has-text("Lentivirus")');R.nextOccurrence=await p.$$eval('[data-att=task] .att-row .att-name',r=>r.map(x=>x.textContent));await p.click('[data-close]');
    // project link + timeline chip
    await p.click('#btn-projects');await p.click('.prow[data-i="0"] [data-m=p-att]');await p.click('[data-m=att-link]');await p.fill('.att-url','https://drive.example.com/crispr-plan');await p.fill('.att-label','Screen plan');await p.keyboard.press('Enter');
    R.projClip=await p.textContent('.prow[data-i="0"] .pclip');
    
    await p.click('[data-m=apply]');await p.waitForTimeout(200);
    await p.click('#tab-timeline');await p.waitForTimeout(300);R.chip=await p.textContent('.tl-proj .att-chip');
    // zip backup, then restore it as a new board
    await p.click('#btn-backup');
    const [z]=await Promise.all([p.waitForEvent('download'),p.click('[data-m=dl-zip]')]);await z.saveAs(S+'/withfiles.zip');R.zipEntries=require('zlib')&&listZip(fs.readFileSync(S+'/withfiles.zip'));R.zipMsg=await p.textContent('#b-msg');
    await p.setInputFiles('#b-file',S+'/withfiles.zip');await p.waitForTimeout(500);R.zipSummary=await p.textContent('#dz-sum');
    await p.click('#b-restore-new');await p.waitForTimeout(2000);
    R.afterRestore=await p.textContent('#toast');
    R.opfsAfter=await p.evaluate(async()=>{const out=[];async function walk(d,pre){for await(const [n,h] of d.entries()){if(h.kind==='directory')await walk(h,pre+n+'/');else out.push(pre+n)}}await walk(await navigator.storage.getDirectory(),'');return out.sort()});
    R.errorsB=p._e;await ctx.close();}
  for(const k of Object.keys(R))console.log(JSON.stringify({test:'att:'+k,value:R[k]}));await L.close();srv.close();fs.rmSync(S,{recursive:true,force:true});
})();

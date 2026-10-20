const RAW_BASE = "https://raw.githubusercontent.com/analistacomercialrbn/dashboardlojas/main/supervisao-web";
const USERS_URL = "https://raw.githubusercontent.com/analistacomercialrbn/dashboardlojas/main/supervisao/usuarios.json";
const enc = new TextEncoder();
function json(data,status=200,extra={}){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store, max-age=0",...extra}})}
function hex(buf){return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join("")}
function b64u(bytes){let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")}
function unb64u(s){s=s.replace(/-/g,"+").replace(/_/g,"/");while(s.length%4)s+="=";const raw=atob(s),out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out}
async function loadUsers(){const r=await fetch(USERS_URL+"?t="+Date.now(),{headers:{"cache-control":"no-cache","pragma":"no-cache"}});if(!r.ok)throw new Error("Falha ao carregar usuários");return r.json()}
async function verifyPassword(password,u){if(!u||!u.senha_hash)return false;if(u.senha_algo==="pbkdf2_sha256"){const key=await crypto.subtle.importKey("raw",enc.encode(String(password)),"PBKDF2",false,["deriveBits"]);const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt:enc.encode(String(u.salt||"")),iterations:200000,hash:"SHA-256"},key,256);return hex(bits)===String(u.senha_hash).toLowerCase()}if(u.senha_algo==="sha256"){const d=await crypto.subtle.digest("SHA-256",enc.encode(String(password)));return hex(d)===String(u.senha_hash).toLowerCase()}return false}
async function sign(data,secret){const key=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return new Uint8Array(await crypto.subtle.sign("HMAC",key,enc.encode(data)))}
async function issue(login,secret){const payload=b64u(enc.encode(JSON.stringify({u:login,exp:Date.now()+43200000})));return payload+"."+b64u(await sign(payload,secret))}
async function session(req,secret){const c=req.headers.get("cookie")||"";const m=c.match(/(?:^|; )rbn_session=([^;]+)/);if(!m)return null;const parts=m[1].split(".");if(parts.length!==2)return null;const expected=await sign(parts[0],secret),actual=unb64u(parts[1]);if(expected.length!==actual.length)return null;let diff=0;for(let i=0;i<expected.length;i++)diff|=expected[i]^actual[i];if(diff)return null;try{const p=JSON.parse(new TextDecoder().decode(unb64u(parts[0])));if(!p.u||!p.exp||Date.now()>p.exp)return null;const us=await loadUsers(),u=us[String(p.u).toLowerCase()];if(!u||!u.ativo)return null;return {login:String(p.u).toLowerCase(),...u}}catch{return null}}
function safe(u){return {login:u.login,nome:u.nome,perfil:u.perfil,supervisor:u.supervisor||null,cod_rca:u.cod_rca||null}}
function mime(path){if(path.endsWith(".html"))return "text/html; charset=utf-8";if(path.endsWith(".css"))return "text/css; charset=utf-8";if(path.endsWith(".js"))return "application/javascript; charset=utf-8";return "text/plain; charset=utf-8"}
async function staticFile(path){if(path==="/"||path==="")path="/index.html";const allowed=new Set(["/index.html","/styles.css","/app.js","/data-worker.js"]);if(!allowed.has(path))return new Response("Not found",{status:404});const r=await fetch(RAW_BASE+path,{cf:{cacheTtl:20,cacheEverything:true}});if(!r.ok)return new Response("Arquivo indisponível",{status:502});const h=new Headers();h.set("content-type",mime(path));h.set("cache-control","no-store, max-age=0");h.set("x-content-type-options","nosniff");return new Response(r.body,{status:200,headers:h})}
const DATA_KEY = "supervisao/dataset/latest.ndjson.gz";
let REBUILDING = false;
function norm(v){return String(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toUpperCase()}
function num(v){if(v===null||v===undefined||v==="")return 0;if(typeof v==="number")return Number.isFinite(v)?v:0;let s=String(v).trim();if(!s)return 0;if(s.includes(",")&&s.includes("."))s=s.replace(/\./g,"").replace(",",".");else if(s.includes(","))s=s.replace(",",".");const n=Number(s.replace(/[^0-9.-]/g,""));return Number.isFinite(n)?n:0}
function code(v){const m=String(v??"").match(/^\s*(\d+)/);return m?Number(m[1]):null}
function dateValue(v){if(typeof v==="number"){const d=new Date(Date.UTC(1899,11,30)+Math.floor(v)*86400000);return Number.isNaN(d.getTime())?null:d}if(!v)return null;const s=String(v).trim();let m=s.match(/^(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);if(m)return new Date(+m[1],+m[2]-1,+m[3]);m=s.match(/^(\d{1,2})\/(-?\d{1,2})\/(\d{4})/);if(m)return new Date(+m[3],+m[2]-1,+m[1]);const d=new Date(s);return Number.isNaN(d.getTime())?null:d}
function monthKey(v){const d=dateValue(v);if(d)return String(d.getFullYear())+"-"+String(d.getMonth()+1).padStart(2,"0");const s=String(v??""),m=s.match(/(20\d{2})[^0-9]?(0?[1-9]|1[0-2])/);return m?m[1]+"-"+String(+m[2]).padStart(2,"0"):""}
function productLabel(v){const s=String(v??"").trim();const name=s.replace(/^\s*\d+\s*-\s*/,"").trim();return name||(code(v)!=null?"Produto "+code(v):"Sem descrição")}
function cellValue(c){return c&&typeof c==="object"&&Object.prototype.hasOwnProperty.call(c,"v")?c.v:c??null}
function xmlUnescape(s){
  return String(s??"").replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,"&");
}
function xmlAttrs(s){
  const out={};for(const m of String(s||"").matchAll(/([\w:.-]+)="([^"]*)"/g))out[m[1]]=xmlUnescape(m[2]);return out;
}
function textRuns(s){
  const out=[];for(const m of String(s||"").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g))out.push(xmlUnescape(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1")));
  return out.join("");
}
function zipEntries(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50){end=i;break}
  if(end<0)throw new Error("O arquivo do Drive não contém um ZIP XLSX válido.");
  const count=view.getUint16(end+10,true),offset=view.getUint32(end+16,true),entries=new Map();let p=offset;
  for(let n=0;n<count;n++){
    if(view.getUint32(p,true)!==0x02014b50)throw new Error("Estrutura ZIP XLSX inválida.");
    const method=view.getUint16(p+10,true),flags=view.getUint16(p+8,true),compressedSize=view.getUint32(p+20,true),nameLen=view.getUint16(p+28,true),extraLen=view.getUint16(p+30,true),commentLen=view.getUint16(p+32,true),localOffset=view.getUint32(p+42,true);
    const name=new TextDecoder().decode(bytes.subarray(p+46,p+46+nameLen));entries.set(name,{name,method,flags,compressedSize,localOffset});p+=46+nameLen+extraLen+commentLen;
  }
  return entries;
}
function entryBounds(bytes,e){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),p=e.localOffset;
  if(view.getUint32(p,true)!==0x04034b50)throw new Error("Cabeçalho ZIP XLSX inválido.");
  if(e.flags&1)throw new Error("A base do Drive está protegida por senha.");
  const nameLen=view.getUint16(p+26,true),extraLen=view.getUint16(p+28,true),start=p+30+nameLen+extraLen;
  return [start,start+e.compressedSize];
}
async function streamZipEntry(bytes,e,onChunk,chunkSize=32768){
  const [start,finish]=entryBounds(bytes,e);
  if(e.method===0){for(let p=start;p<finish;p+=chunkSize)onChunk(bytes.subarray(p,Math.min(finish,p+chunkSize)));return}
  if(e.method!==8)throw new Error("Método de compactação XLSX não suportado: "+e.method);
  const ds=new DecompressionStream("deflate-raw"),reader=ds.readable.getReader(),writer=ds.writable.getWriter();
  const reading=(async()=>{while(true){const {value,done}=await reader.read();if(done)break;onChunk(value)}})();
  try{
    for(let p=start;p<finish;p+=chunkSize)await writer.write(bytes.subarray(p,Math.min(finish,p+chunkSize)));
    await writer.close();await reading;
  }catch(e){try{await writer.abort(e)}catch{}throw e}
}
async function zipEntryText(bytes,e){
  let out="",decoder=new TextDecoder();
  await streamZipEntry(bytes,e,chunk=>{out+=decoder.decode(chunk,{stream:true})});
  return out+decoder.decode();
}
function normalizeZipPath(target){
  const parts=target.startsWith("/")?[]:["xl"];
  for(const part of target.replace(/^\//,"").split("/")){if(!part||part===".")continue;if(part==="..")parts.pop();else parts.push(part)}
  return parts.join("/");
}
function parseRowXml(rowXml,strings){
  const values=[];let next=0;
  for(const m of rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g)){
    const attrs=xmlAttrs(m[1]||m[3]),ref=String(attrs.r||"").match(/^([A-Z]+)/i);let col=next;
    if(ref){col=0;for(const ch of ref[1].toUpperCase())col=col*26+ch.charCodeAt(0)-64;col--}
    next=col+1;const body=m[2]||"",type=attrs.t||"",vm=body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/),raw=vm?xmlUnescape(vm[1]):null;
    let value=null;
    if(type==="s"&&raw!==null)value=strings[Number(raw)]??"";
    else if(type==="inlineStr")value=textRuns(body);
    else if(type==="str"&&raw!==null)value=raw;
    else if(type==="b"&&raw!==null)value=raw==="1";
    else if(type!=="e"&&raw!==null&&raw!==""){const n=Number(raw);value=Number.isFinite(n)?n:raw}
    values[col]=value;
  }
  return values;
}
class XlsxArchive{
  constructor(buffer){this.bytes=new Uint8Array(buffer);this.entries=zipEntries(this.bytes);this.shared=null;this.sharedPromise=null;this.sheetPaths=new Map();this.sheetNames=[]}
  async init(){
    const wb=this.entries.get("xl/workbook.xml"),rels=this.entries.get("xl/_rels/workbook.xml.rels");
    if(!wb||!rels)throw new Error("O arquivo XLSX não contém a estrutura de planilha esperada.");
    const relText=await zipEntryText(this.bytes,rels),relMap=new Map();
    for(const m of relText.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)){const a=xmlAttrs(m[1]);if(a.Id&&a.Target)relMap.set(a.Id,normalizeZipPath(a.Target))}
    const wbText=await zipEntryText(this.bytes,wb);
    for(const m of wbText.matchAll(/<sheet\b([^>]*)\/?\s*>/g)){const a=xmlAttrs(m[1]),path=relMap.get(a["r:id"]);if(a.name&&path)this.sheetPaths.set(a.name,path)}
    this.sheetNames=[...this.sheetPaths.keys()];return this;
  }
  async getSharedStrings(){
    if(this.shared)return this.shared;
    if(this.sharedPromise)return this.sharedPromise;
    this.sharedPromise=(async()=>{
      const e=this.entries.get("xl/sharedStrings.xml"),values=[];
      if(!e){this.shared=values;return values}
      let pending="",decoder=new TextDecoder();
      const consume=(text,final=false)=>{
        pending+=text;
        while(true){
          const start=pending.search(/<si\b/);if(start<0){pending=final?"":pending.slice(Math.max(0,pending.length-8));return}
          const finish=pending.indexOf("</si>",start);if(finish<0){if(start>0)pending=pending.slice(start);if(final)throw new Error("Tabela de textos compartilhados XLSX incompleta.");return}
          values.push(textRuns(pending.slice(start,finish+5)));pending=pending.slice(finish+5);
        }
      };
      await streamZipEntry(this.bytes,e,chunk=>consume(decoder.decode(chunk,{stream:true})));
      consume(decoder.decode(),true);this.shared=values;return values;
    })();
    return this.sharedPromise;
  }
  async readRows(name,onRow){
    const path=this.sheetPaths.get(name)||[...this.sheetPaths].find(([n])=>norm(n)===norm(name))?.[1],e=path&&this.entries.get(path);
    if(!e)throw new Error("A aba "+name+" não existe na planilha.");
    const strings=await this.getSharedStrings();let pending="",decoder=new TextDecoder();
    const consume=(text,final=false)=>{
      pending+=text;
      while(true){
        const start=pending.search(/<row\b/);if(start<0){pending=final?"":pending.slice(Math.max(0,pending.length-8));return}
        const tagEnd=pending.indexOf(">",start);if(tagEnd>0&&pending[tagEnd-1]==="/"){pending=pending.slice(tagEnd+1);continue}
        const finish=pending.indexOf("</row>",start);if(finish<0){if(start>0)pending=pending.slice(start);if(final)throw new Error("Uma linha XLSX terminou incompleta.");return}
        const rowXml=pending.slice(start,finish+6);pending=pending.slice(finish+6);onRow(parseRowXml(rowXml,strings));
      }
    };
    await streamZipEntry(this.bytes,e,chunk=>consume(decoder.decode(chunk,{stream:true})));
    consume(decoder.decode(),true);
  }
  async readObjects(name){
    const out=[];let headers=null;
    await this.readRows(name,row=>{
      if(!headers){headers=row.map(v=>String(v??"").trim());return}
      const obj={};let any=false;
      for(let j=0;j<headers.length;j++){if(!headers[j])continue;const v=row[j]??null;if(v!==null&&v!=="")any=true;obj[headers[j]]=v}
      if(any)out.push(obj);
    });
    return out;
  }
}

async function fetchDriveWorkbook(id,refresh=false){
  const u=new URL("https://drive.google.com/uc");u.searchParams.set("export","download");u.searchParams.set("id",id);if(refresh)u.searchParams.set("_cb",String(Date.now()));
  const r=await fetch(u.toString(),refresh?{redirect:"follow",headers:{"cache-control":"no-cache","pragma":"no-cache","user-agent":"Mozilla/5.0"}}:{redirect:"follow",cf:{cacheTtl:600,cacheEverything:true},headers:{"user-agent":"Mozilla/5.0"}});
  if(!r.ok)throw new Error("Falha ao baixar uma base comercial do Drive ("+r.status+").");
  const ct=r.headers.get("content-type")||"";if(ct.includes("text/html"))throw new Error("O Drive não disponibilizou a base para download.");
  return new XlsxArchive(await r.arrayBuffer()).init();
}
function buildNdjsonStream(archive,sheetName,metaRows,rcaRows,clientRows){
  const enc=new TextEncoder();let phase=0,index=0,salesReader=null,salesDecoder=null,salesPending="",salesStrings=null,headerSeen=false;
  const rcaMap=new Map(rcaRows.map(r=>[code(r.COD_RCA??r["Cod/Vend."]),{code:code(r.COD_RCA??r["Cod/Vend."]),name:String(r.RCA??r.VENDEDOR??"").trim(),supervisor:String(r.SUPERVISOR??"").trim(),active:norm(r.ATIVO??"S")==="S"}]).filter(([c,r])=>c!=null&&r.name));
  const rcaList=[...rcaMap.values()];
  const meta=metaRows.map(r=>{const codRca=code(r.COD_RCA??r["Cod/Vend."]),mk=monthKey(r.MES??r.MÊS??r.DATA),rr=rcaMap.get(codRca)||{};return {monthKey:mk,year:mk?Number(mk.slice(0,4)):null,month:mk?Number(mk.slice(5,7)):null,rca:codRca,rcaName:rr.name||String(r.RCA??""),supervisor:rr.supervisor||String(r.SUPERVISOR??""),department:String(r.DEPARTAMENTO??r.DEPTO??"").trim(),value:num(r.META)}}).filter(x=>x.year&&x.month&&x.rca!=null);
  const clients=clientRows.map(r=>{const c=code(r.CODCLI??r["Cod/Cliente"]??r.COD_CLIENTE);if(c==null)return null;return[c,{code:c,name:String(r.CLIENTE??r.NOME??r["Nome Cliente"]??c).trim(),rca:code(r.COD_RCA??r["Cod/Vend."])}]}).filter(Boolean);
  let headers=null,ix=null,latest=null,validCount=0;
  const encode=(type,value)=>JSON.stringify({type,value})+"\n";
  const writeSale=(row,write)=>{
    if(!headerSeen){headers=row.map(v=>String(cellValue(v)??"").trim());ix=new Map(headers.map((h,i)=>[h,i]));headerSeen=true;return}
    const val=name=>cellValue(row?.[ix.get(name)]);
    const date=dateValue(val("Data Faturamento"));if(!date||norm(val("Posição"))!=="FECHADO")return;
    validCount++;if(!latest||date>latest)latest=date;
    const codRca=code(val("Cod/Vend.")),rr=rcaMap.get(codRca)||{},prod=code(val("Cod/Produto")),v=num(val("Pedidos Enviados")),marginRaw=val("% Margem"),margin=marginRaw===null||marginRaw===undefined?null:num(marginRaw),m=String(date.getMonth()+1).padStart(2,"0");
    write(encode("sale",{date:date.toISOString(),year:date.getFullYear(),month:date.getMonth()+1,monthKey:String(date.getFullYear())+"-"+m,rca:codRca,rcaName:rr.name||String(codRca??""),supervisor:rr.supervisor||"",department:String(val(row,"DEPARTAMENTO")??"").trim(),client:code(val(row,"Cod/Cliente")),product:prod,productName:productLabel(val(row,"Cod/Produto")),order:String(val(row,"NUMPED")??"").trim(),city:String(val(row,"MUNICENT")??"").trim(),uf:norm(val(row,"ESTENT")),value:v,marginPct:Number.isFinite(margin)?margin:null}));
  };
  async function startSales(){
    const entry=archive.entries.get(archive.sheetPaths.get(sheetName));if(!entry)throw new Error("A aba de faturamento não está disponível.");
    if(entry.method!==0&&entry.method!==8)throw new Error("Método de compactação XLSX não suportado: "+entry.method);
    const [start,end]=entryBounds(archive.bytes,entry);let pos=start;
    const compressed=new ReadableStream({pull(controller){if(pos>=end){controller.close();return}const next=Math.min(end,pos+8192);controller.enqueue(archive.bytes.subarray(pos,next));pos=next}});
    salesDecoder=new TextDecoder();salesStrings=await archive.getSharedStrings();const xml=entry.method===0?compressed:compressed.pipeThrough(new DecompressionStream("deflate-raw"));salesReader=xml.getReader();
  }
  function consumeSales(text,final,write){
    salesPending+=text;
    while(true){
      const start=salesPending.search(/<row\b/);if(start<0){salesPending=final?"":salesPending.slice(Math.max(0,salesPending.length-8));break}
      const tagEnd=salesPending.indexOf(">",start);if(tagEnd>0&&salesPending[tagEnd-1]==="/"){salesPending=salesPending.slice(tagEnd+1);continue}
      const finish=salesPending.indexOf("</row>",start);if(finish<0){if(start>0)salesPending=salesPending.slice(start);if(final)throw new Error("Uma linha de faturamento terminou incompleta.");break}
      const rowXml=salesPending.slice(start,finish+6);salesPending=salesPending.slice(finish+6);writeSale(parseRowXml(rowXml,salesStrings),write);
    }
    if(final&&salesPending.trim()&&/<row\b/.test(salesPending))throw new Error("A última linha de faturamento está incompleta.");
  }
  return new ReadableStream({
    async pull(controller){
      let out="",budget=48*1024;const write=record=>{out+=record};
      while(out.length<budget){
        let record;
        if(phase===0){phase=1;index=0}
        if(phase===1&&index<rcaList.length)record=encode("rca",rcaList[index++]);
        else if(phase===1){phase=2;index=0;continue}
        else if(phase===2&&index<meta.length)record=encode("goal",meta[index++]);
        else if(phase===2){phase=3;index=0;continue}
        else if(phase===3&&index<clients.length)record=encode("client",clients[index++]);
        else if(phase===3){phase=4;index=0;continue}
        else if(phase===4){
          if(!salesReader)await startSales();
          const {value,done}=await salesReader.read();
          if(done){consumeSales(salesDecoder.decode(),true,write);if(!validCount||!latest)throw new Error("A base não contém vendas fechadas válidas.");phase=5;continue}
          consumeSales(salesDecoder.decode(value,{stream:true}),false,write);
          if(out.length>=budget)break;
          continue;
        }else if(phase===5){out+=JSON.stringify({type:"meta",value:{latest:latest.toISOString(),validCount}})+"\n";phase=6;break}
        else{if(out)controller.enqueue(enc.encode(out));controller.close();return}
        out+=record;
      }
      if(out)controller.enqueue(enc.encode(out));
    }
  });
}
async function rebuildDataset(env,refresh){
  const salesId=env.SALES_FILE_ID,auxId=env.AUX_FILE_ID;
  if(!salesId||!auxId)throw new Error("IDs das bases do Drive não estão configurados.");
  if(!env.DATA_CACHE)throw new Error("Armazenamento de dados não configurado.");
  let aux=await fetchDriveWorkbook(auxId,refresh);
  const rcaRows=await aux.readObjects("RCA"),clientRows=await aux.readObjects("CLIENTES"),metaRows=await aux.readObjects("METAS");
  aux=null;
  const vendas=await fetchDriveWorkbook(salesId,refresh);
  const salesSheet=vendas.sheetNames.find(n=>norm(n)==="SHEET1")||vendas.sheetNames[0];
  if(!salesSheet)throw new Error("A base de faturamento não possui uma aba legível.");
  const source=buildNdjsonStream(vendas,salesSheet,metaRows,rcaRows,clientRows);
  await env.DATA_CACHE.put(DATA_KEY,source.pipeThrough(new CompressionStream("gzip")),{httpMetadata:{contentType:"application/x-ndjson",contentEncoding:"gzip",cacheControl:"private, no-store"}});
  const stored=await env.DATA_CACHE.head(DATA_KEY);
  if(!stored)throw new Error("A base foi processada, mas o snapshot não foi encontrado no R2.");
  return {ok:true,rows:Number(stored.customMetadata?.validCount)||null,updatedAt:stored.uploaded?.toISOString?.()||new Date().toISOString()}
}
export default {
async scheduled(controller,env){
  if(!env.DATA_CACHE){console.error(JSON.stringify({event:"snapshot_refresh_failed",error:"storage_not_configured"}));return}
  if(REBUILDING){console.log(JSON.stringify({event:"snapshot_refresh_skipped",reason:"already_running"}));return}
  try{
    const current=await env.DATA_CACHE.head(DATA_KEY);
    const ageMs=current?Date.now()-current.uploaded.getTime():Infinity;
    if(ageMs<20*60*60*1000){console.log(JSON.stringify({event:"snapshot_refresh_skipped",ageMs}));return}
  }catch(error){console.error(JSON.stringify({event:"snapshot_refresh_failed",error:error?.message||String(error)}));throw error}
  REBUILDING=true;
  const started=Date.now();
  try{
    const result=await rebuildDataset(env,true);
    console.log(JSON.stringify({event:"snapshot_refresh_completed",durationMs:Date.now()-started,rows:result.rows,updatedAt:result.updatedAt}));
  }catch(error){
    console.error(JSON.stringify({event:"snapshot_refresh_failed",durationMs:Date.now()-started,error:error?.message||String(error)}));
    throw error;
  }finally{REBUILDING=false}
},
async fetch(req,env){const url=new URL(req.url),secret=env.SESSION_SECRET;if(!secret)return json({message:"Configuração de sessão ausente."},503);
if(url.pathname==="/api/diagcrypto"){try{const k=await crypto.subtle.importKey("raw",enc.encode("teste"),"PBKDF2",false,["deriveBits"]);const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt:enc.encode("salt"),iterations:1000,hash:"SHA-256"},k,256);return json({ok:true,len:bits.byteLength},200)}catch(e){return json({ok:false,error:String(e&&e.message?e.message:e)},500)}}
if(url.pathname==="/api/login"&&req.method==="POST"){try{const body=await req.json(),login=String(body.login||"").trim().toLowerCase();const us=await loadUsers(),u=us[login];if(!u)return json({message:"Usuário não encontrado."},401);if(!u.ativo)return json({message:"Usuário inativo."},401);let valid=false;try{valid=await verifyPassword(body.password||"",u)}catch(e){return json({message:"Falha interna na validação da senha: "+String(e&&e.message?e.message:e)},500)}if(!valid)return json({message:"Senha inválida."},401);const tok=await issue(login,secret);return json({ok:true,user:safe({login,...u})},200,{"set-cookie":"rbn_session="+tok+"; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200"})}catch{return json({message:"Não foi possível autenticar."},500)}}
if(url.pathname==="/api/logout"&&req.method==="POST")return json({ok:true},200,{"set-cookie":"rbn_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"});
if(url.pathname==="/api/session"){const u=await session(req,secret);return json(u?{authenticated:true,user:safe(u)}:{authenticated:false})}
if(url.pathname==="/api/dataset/info"){
  const u=await session(req,secret);if(!u)return json({message:"Sessão expirada."},401);
  const role=String(u.perfil||"").toUpperCase();if(role!=="ADMIN"&&role!=="GERENTE")return json({message:"A base comercial está liberada apenas para Admin e Gerente."},403);
  if(!env.DATA_CACHE)return json({message:"Armazenamento de dados não configurado."},503);
  const object=await env.DATA_CACHE.head(DATA_KEY);if(!object)return json({message:"Base processada ainda não existe."},404);
  return json({exists:true,updatedAt:object.uploaded.toISOString()});
}
if(url.pathname==="/api/dataset"){
  const u=await session(req,secret);if(!u)return json({message:"Sessão expirada."},401);
  const role=String(u.perfil||"").toUpperCase();if(role!=="ADMIN"&&role!=="GERENTE")return json({message:"A base comercial está liberada apenas para Admin e Gerente."},403);
  if(!env.DATA_CACHE)return json({message:"Armazenamento de dados não configurado."},503);
  const object=await env.DATA_CACHE.get(DATA_KEY);if(!object)return json({message:"Base processada ainda não existe."},404);
  const h=new Headers({"content-type":"application/x-ndjson; charset=utf-8","content-encoding":"gzip","cache-control":"private, no-store","x-content-type-options":"nosniff","x-dataset-updated-at":object.uploaded.toISOString()});
  return new Response(object.body,{status:200,headers:h});
}
if(url.pathname==="/api/rebuild"&&req.method==="POST"){
  const u=await session(req,secret);if(!u)return json({message:"Sessão expirada."},401);
  const role=String(u.perfil||"").toUpperCase();if(role!=="ADMIN"&&role!=="GERENTE")return json({message:"Atualização das bases liberada apenas para Admin e Gerente."},403);
  if(REBUILDING)return json({message:"Já existe uma atualização das bases em andamento."},409);
  REBUILDING=true;
  try{return json(await rebuildDataset(env,url.searchParams.get("refresh")==="1"))}
  catch(e){return json({message:e?.message||String(e)},502)}
  finally{REBUILDING=false}
}
if(url.pathname==="/api/file"){const u=await session(req,secret);if(!u)return json({message:"Sessão expirada."},401);const role=String(u.perfil||"").toUpperCase();if(role!=="ADMIN"&&role!=="GERENTE")return json({message:"A prévia web com base integral está liberada apenas para Admin e Gerente."},403);const kind=url.searchParams.get("kind"),id=kind==="vendas"?env.SALES_FILE_ID:kind==="aux"?env.AUX_FILE_ID:null;if(!id)return json({message:"Base inválida."},400);const drive=new URL("https://drive.google.com/uc");drive.searchParams.set("export","download");drive.searchParams.set("id",id);const refresh=url.searchParams.get("refresh")==="1";if(refresh)drive.searchParams.set("_cb",String(Date.now()));const rr=await fetch(drive.toString(),refresh?{redirect:"follow",headers:{"cache-control":"no-cache","pragma":"no-cache","user-agent":"Mozilla/5.0"}}:{redirect:"follow",cf:{cacheTtl:600,cacheEverything:true},headers:{"user-agent":"Mozilla/5.0"}});if(!rr.ok)return json({message:"Falha ao carregar a base do Drive."},502);const ct=rr.headers.get("content-type")||"";if(ct.includes("text/html"))return json({message:"A base do Drive não está disponível para download por link."},502);const h=new Headers();h.set("content-type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");h.set("cache-control",refresh?"private, no-store":"private, max-age=600");return new Response(rr.body,{status:200,headers:h})}
return staticFile(url.pathname)}};
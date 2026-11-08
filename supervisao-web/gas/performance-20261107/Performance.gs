function centralTiming_(operation) {
  const start = Date.now(), stages = {};
  let checkpoint = start;
  return {
    mark(stage) {
      const now = Date.now();
      stages[stage] = now - checkpoint;
      checkpoint = now;
    },
    finish(status) {
      console.log(JSON.stringify({central:operation, status, ms:Date.now()-start, stages}));
    }
  };
}

// Cada publicação tem chaves próprias. Leitores ignoram gerações incompletas.
function centralCacheRead_(cache, key, unpack = JSON.parse) {
  try {
    const meta = JSON.parse(cache.get(key) || 'null');
    if (!meta || !/^[0-9a-f]{32}$/.test(meta.id) || !Number.isInteger(meta.parts) || meta.parts < 1 || meta.parts > 80) return null;
    const keys = Array.from({length:meta.parts}, (_, i)=>key+'_'+meta.id+'_'+i);
    const chunks = cache.getAll(keys);
    if (!keys.every(k=>typeof chunks[k]==='string')) return null;
    const text = Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(keys.map(k=>chunks[k]).join('')))).getDataAsString('UTF-8');
    return unpack(text);
  } catch (error) {
    return null;
  }
}

function centralCacheWrite_(cache, key, text, seconds, details = {}) {
  try {
    const packed = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(text, 'application/json')).getBytes());
    const size = 90000, count = Math.ceil(packed.length/size);
    if (!count || count > 80) return;
    const id = Utilities.getUuid().replace(/-/g, ''), chunks = {};
    for (let i=0; i<count; i++) chunks[key+'_'+id+'_'+i] = packed.slice(i*size, (i+1)*size);
    cache.putAll(chunks, seconds);
    cache.put(key, JSON.stringify({...details,id,parts:count}), seconds);
  } catch (error) {
    console.warn('Cache temporário da Central indisponível.');
  }
}

// Limita o número de chamadas ao Sheets sem ler grandes intervalos vazios.
function centralRowBlocks_(numbers, limit = 8, gap = 24) {
  const rows = [...new Set(numbers)].sort((a,b)=>a-b);
  if (!rows.length) return [];
  const breaks = rows.slice(1).map((row,i)=>({row, distance:row-rows[i]}))
    .filter(x=>x.distance > gap).sort((a,b)=>b.distance-a.distance).slice(0,limit-1);
  const starts = new Set(breaks.map(x=>x.row)), blocks = [];
  for (const row of rows) {
    if (!blocks.length || starts.has(row)) blocks.push({first:row,last:row});
    else blocks[blocks.length-1].last = row;
  }
  return blocks;
}

function centralToday_(tz) {
  return Utilities.formatDate(new Date(), tz || 'America/Fortaleza', 'yyyy-MM-dd');
}

function centralCommercialPage_(user, payload) {
  const timing=centralTiming_('comercial.pagina');
  let status='erro';
  try{
    const result=datasetPage_(payload.offset,payload.limit);
    result.records=result.records.filter(row=>userAllowsRecord_(user,row));
    timing.mark('planilha');
    if(payload.compressed===true&&result.records.length){
      try{
        const json=JSON.stringify(result.records);
        const packed=Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(json,'application/json')).getBytes());
        if(packed.length<json.length){result.gzip=packed;delete result.records;}
      }catch(error){console.warn('Página comercial enviada no formato comum.');}
      timing.mark('resposta');
    }
    status='ok';
    return result;
  }finally{
    timing.finish(status);
  }
}

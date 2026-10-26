/**
 * Integração Força de Vendas RBN -> planilha anual EXISTENTE da Supervisão.
 * Cole este arquivo no MESMO projeto Apps Script do Dashboard (Code.gs).
 *
 * Propriedades do script:
 *   VENDAS_SYNC_URL    URL HTTPS publicada da rota /api/public/vendas-sync
 *   VENDAS_SYNC_SECRET segredo de 32+ caracteres igual ao do app
 *   SALES_SPREADSHEET_ID = 1Y2lBDn35U6_T5z2uwE35ZDVcNJDjQ4Z0QWSu499LdPE
 *
 * Execute instalarGatilhosVendasRbn() uma única vez, autorizando permissões.
 * A sincronização atualiza somente as abas 2024, 2025 e 2026.
 * Não modifica o Excel BASE_VENDAS_SUPERVISAO.xlsx.
 *
 * SEGURANÇA: nunca apagar Qt Pedida, Vl Lucro ou Vl Desconto quando o app
 * exportar null. Ao reimportar, o destino é reconciliado com o banco,
 * removendo itens ausentes SOMENTE no período substituído, com trava
 * de segurança contra exclusões em massa.
 */

var VENDAS_RBN_CFG = {
  anos: ['2024', '2025', '2026'],
  colunas: ['ESTENT','MUNICENT','DEPARTAMENTO','SECAO','Cod/Fornecedor',
    'Cod/Produto','RAMO','Cod/Cliente','NUMPED','Numero Nota Fiscal',
    'Posição','Qt Pedida','Pedidos Enviados','Vl Lucro','Vl Desconto',
    'Data Pedido','Data Faturamento','Ano','Mês_Ano','Cod/Vend.'],
  maxItens: 30000,
  tamanhoLeitura: 4000,
  tamanhoEscrita: 2000,
  limiteExclusoes: 0.05
};

function instalarGatilhosVendasRbn() {
  var funcs = ['sincronizarVendasRbn','atualizarCacheVendasRbn'];
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (funcs.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sincronizarVendasRbn').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('atualizarCacheVendasRbn').timeBased().everyHours(1).create();
  return {ok:true, gatilhos:funcs};
}

function rbnConfig_() {
  var p = PropertiesService.getScriptProperties();
  var url = String(p.getProperty('VENDAS_SYNC_URL') || '').replace(/\/$/, '');
  var secret = String(p.getProperty('VENDAS_SYNC_SECRET') || '');
  var sheetId = p.getProperty('SALES_SPREADSHEET_ID') ||
    '1Y2lBDn35U6_T5z2uwE35ZDVcNJDjQ4Z0QWSu499LdPE';
  if (!/^https:\/\/[^/]+\/api\/public\/vendas-sync$/.test(url)) {
    throw new Error('Configure VENDAS_SYNC_URL com a URL HTTPS completa da rota vendas-sync.');
  }
  if (secret.length < 32) throw new Error('Configure VENDAS_SYNC_SECRET com pelo menos 32 caracteres.');
  return {url:url,secret:secret,sheetId:sheetId};
}

function rbnApi_(cfg, query, body) {
  var url = cfg.url + (query ? '?' + query : '');
  var opts = {muteHttpExceptions:true,headers:{'x-sync-secret':cfg.secret}};
  if (body) {
    opts.method = 'post';
    opts.contentType = 'application/json';
    opts.payload = JSON.stringify(body);
  }
  var response = UrlFetchApp.fetch(url, opts);
  var status = response.getResponseCode(), data;
  try { data = JSON.parse(response.getContentText()); }
  catch (err) { throw new Error('Resposta inválida do app (HTTP ' + status + ').'); }
  if (status < 200 || status >= 300 || data.error) {
    throw new Error('Integração HTTP ' + status + ': ' + String(data.error || 'falha').slice(0,250));
  }
  return data;
}

function rbnIso_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, 'America/Fortaleza', 'yyyy-MM-dd');
  }
  var s = String(v == null ? '' : v).trim(), m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return m[1]+'-'+m[2]+'-'+m[3];
  if ((m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/))) {
    return m[3]+'-'+('0'+m[2]).slice(-2)+'-'+('0'+m[1]).slice(-2);
  }
  return '';
}
function rbnCodigo_(v) {
  var s = String(v == null ? '' : v).trim(), m = s.match(/^(\d+)/);
  return m ? String(Number(m[1])) : s.toUpperCase().replace(/\s+/g,' ');
}
function rbnProduto_(v) {
  var s = String(v == null ? '' : v).trim(), m = s.match(/^(\d+)\s*-/);
  if (m) return String(Number(m[1]));
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ');
}
function rbnChave_(row) {
  var pedido = rbnCodigo_(row[8]), produto = rbnProduto_(row[5]),
      cliente = rbnCodigo_(row[7]), data = rbnIso_(row[15]);
  return pedido + '|' + produto + '|' + cliente + '|' + data;
}
function rbnReferencia_(row) {
  return rbnIso_(row[16]) || rbnIso_(row[15]);
}
function rbnNoPeriodo_(ref, inicio, fim) {
  return !!ref && ref >= inicio && ref <= fim;
}
function rbnMesclar_(nova, antiga) {
  var out = nova.slice();
  // Os campos históricos não são perdidos se não vierem na exportação.
  [11,13,14].forEach(function(i) {
    if (out[i] === null || out[i] === undefined) out[i] = antiga[i];
  });
  return out.map(function(v) { return v == null ? '' : v; });
}
function rbnNormalizarNova_(row) {
  return row.map(function(v) { return v == null ? '' : v; });
}
function rbnMesmaLinha_(a,b) {
  return a.every(function(v,i) {
    var w=b[i];
    if ([15,16].indexOf(i)!==-1) return rbnIso_(v) === rbnIso_(w);
    return String(v == null ? '' : v).trim() === String(w == null ? '' : w).trim();
  });
}

function sincronizarVendasRbn() {
  var cfg = rbnConfig_();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return {ok:false, motivo:'Outra rotina da Supervisão está em execução.'};
  var job = null;
  try {
    var jobs = rbnApi_(cfg,'acao=jobs').jobs || [];
    // Evita tentativas infinitas: após três erros, revisar antes de reprocessar.
    job = jobs.filter(function(j) { return Number(j.tentativas || 0) < 3; })[0];
    if (!job) return {ok:true, pendentes:0};
    rbnApi_(cfg,'',{acao:'iniciar',id:job.id});
    var result = rbnExecutarJob_(cfg,job);
    rbnApi_(cfg,'',{acao:'concluir',id:job.id,linhas:result.exportadas});
    PropertiesService.getScriptProperties().setProperty('VENDAS_RBN_CACHE_PENDENTE','1');
    PropertiesService.getScriptProperties().setProperty('VENDAS_RBN_ULTIMA_SYNC',JSON.stringify(result));
    return {ok:true,resultado:result};
  } catch (err) {
    if (job) {
      try { rbnApi_(cfg,'',{acao:'erro',id:job.id,mensagem:String(err).slice(0,1500)}); }
      catch (reportErr) { console.error('Falha ao registrar erro da sincronização',reportErr); }
    }
    console.error(err && err.stack ? err.stack : err);
    throw err;
  } finally { lock.releaseLock(); }
}

function rbnExecutarJob_(cfg,job) {
  var started = Date.now(), incoming = new Map(), cursor = 0, total = 0;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(job.periodo_inicio) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(job.periodo_fim)) {
    throw new Error('Período inválido na tarefa.');
  }
  var inicio = job.periodo_inicio, fim = job.periodo_fim;
  do {
    var p = rbnApi_(cfg,'acao=exportar&inicio='+encodeURIComponent(inicio)+
      '&fim='+encodeURIComponent(fim)+'&cursor='+cursor+'&limite=2000');
    if (!Array.isArray(p.linhas)) throw new Error('Página de exportação sem linhas.');
    p.linhas.forEach(function(item) {
      var row = item.valores;
      if (!Array.isArray(row) || row.length !== 20) throw new Error('Exportação fora do padrão de 20 colunas.');
      if (VENDAS_RBN_CFG.anos.indexOf(String(item.ano))===-1 ||
          String(item.ano) !== rbnIso_(row[15]).slice(0,4)) {
        throw new Error('Ano/Data Pedido inválido na exportação.');
      }
      if (!rbnNoPeriodo_(item.data_referencia,inicio,fim)) {
        throw new Error('Venda exportada fora do período.');
      }
      var key = rbnChave_(row);
      if (incoming.has(key)) throw new Error('Duas vendas exportadas com a mesma chave: '+key);
      incoming.set(key,{ano:String(item.ano),valores:row});
    });
    total += p.linhas.length;
    if (total > VENDAS_RBN_CFG.maxItens) {
      throw new Error('Período excede '+VENDAS_RBN_CFG.maxItens+' itens; dividir em meses antes de sincronizar.');
    }
    if (p.proximo_cursor != null && p.proximo_cursor <= cursor) {
      throw new Error('Cursor da exportação não avançou.');
    }
    cursor = p.proximo_cursor;
  } while (cursor != null);
  if (incoming.size !== total) throw new Error('Contagem divergente na exportação.');
  if (Date.now()-started > 210000) throw new Error('Tempo insuficiente para gravar; nenhuma linha alterada.');

  var ss = SpreadsheetApp.openById(cfg.sheetId);
  var sheets = {}, matches = new Map(), stale = {}, antigoPeriodo = 0;
  VENDAS_RBN_CFG.anos.forEach(function(year) {
    var sheet = ss.getSheetByName(year);
    if (!sheet) throw new Error('A aba '+year+' não existe na planilha anual.');
    var header = sheet.getRange(1,1,1,20).getDisplayValues()[0];
    if (header.join('|') !== VENDAS_RBN_CFG.colunas.join('|')) {
      throw new Error('Cabeçalho divergente na aba '+year+'.');
    }
    sheets[year] = sheet;
    stale[year] = new Set();
    var last = sheet.getLastRow();
    for (var first=2;first<=last;first+=VENDAS_RBN_CFG.tamanhoLeitura) {
      var count=Math.min(VENDAS_RBN_CFG.tamanhoLeitura,last-first+1);
      var block=sheet.getRange(first,1,count,20).getValues();
      block.forEach(function(row,i) {
        var n=first+i, key=rbnChave_(row), ref=rbnReferencia_(row);
        if (rbnNoPeriodo_(ref,inicio,fim)) {
          antigoPeriodo++;
          if (!incoming.has(key)) stale[year].add(n);
        }
        if (incoming.has(key)) {
          if (!matches.has(key)) matches.set(key,[]);
          matches.get(key).push({ano:year,row:n,valores:row});
        }
      });
    }
  });
  var staleCount = VENDAS_RBN_CFG.anos.reduce(function(sum,y){return sum+stale[y].size;},0);
  var maxStale = Math.max(100,Math.floor(antigoPeriodo*VENDAS_RBN_CFG.limiteExclusoes));
  if (staleCount>maxStale) {
    throw new Error('Trava de segurança: '+staleCount+' linhas antigas ausentes da importação ('+
      antigoPeriodo+' no período). Limite: '+maxStale+'. Revisar antes de apagar.');
  }
  var update = {}, append = {}, remove = {};
  VENDAS_RBN_CFG.anos.forEach(function(y) {
    update[y]=[];append[y]=[];remove[y]=stale[y];
  });
  incoming.forEach(function(item,key) {
    var found=matches.get(key)||[];
    var selected=found.filter(function(x){return x.ano===item.ano;})[0]||found[0];
    var merged=selected?rbnMesclar_(item.valores,selected.valores):rbnNormalizarNova_(item.valores);
    if (selected && selected.ano===item.ano) {
      if (!rbnMesmaLinha_(merged,selected.valores)) {
        update[item.ano].push({row:selected.row,valores:merged});
      }
    } else {
      append[item.ano].push(merged);
      if (selected) remove[selected.ano].add(selected.row);
    }
    found.forEach(function(x) {
      if (x!==selected) remove[x.ano].add(x.row);
    });
  });
  // Preflight completo antes de alterar a planilha.
  if (Date.now()-started>240000) throw new Error('Tempo limite no pré-processamento; nenhuma linha alterada.');
  var summary={id:job.id,inicio:inicio,fim:fim,exportadas:total,
    atualizadas:0,novas:0,removidas:0,concluidaEm:null};
  VENDAS_RBN_CFG.anos.forEach(function(y) {
    var sheet=sheets[y], changes=update[y].sort(function(a,b){return a.row-b.row;});
    // Gravar atualizações existentes em blocos contíguos.
    for (var i=0;i<changes.length;) {
      var run=[changes[i].valores], startRow=changes[i].row; i++;
      while(i<changes.length && changes[i].row===startRow+run.length &&
            run.length<VENDAS_RBN_CFG.tamanhoEscrita) {run.push(changes[i].valores);i++;}
      sheet.getRange(startRow,1,run.length,20).setValues(run);
      summary.atualizadas+=run.length;
    }
    var adds=append[y];
    if (adds.length) {
      var last=sheet.getLastRow(), max=sheet.getMaxRows();
      if (last+adds.length>max) sheet.insertRowsAfter(max,last+adds.length-max);
      for(var a=0;a<adds.length;a+=VENDAS_RBN_CFG.tamanhoEscrita) {
        var batch=adds.slice(a,a+VENDAS_RBN_CFG.tamanhoEscrita);
        sheet.getRange(last+1+a,1,batch.length,20).setValues(batch);
        summary.novas+=batch.length;
      }
    }
    // Excluir de baixo para cima, agrupando sequências de linhas.
    var nums=Array.from(remove[y]).sort(function(a,b){return b-a;});
    for(var d=0;d<nums.length;) {
      var high=nums[d],low=high;d++;
      while(d<nums.length && nums[d]===low-1){low=nums[d];d++;}
      sheet.deleteRows(low,high-low+1);
      summary.removidas+=high-low+1;
    }
  });
  SpreadsheetApp.flush();
  summary.concluidaEm=new Date().toISOString();
  return summary;
}

function atualizarCacheVendasRbn() {
  var props=PropertiesService.getScriptProperties();
  if (props.getProperty('VENDAS_RBN_CACHE_PENDENTE')!=='1') return {ok:true,atualizar:false};
  // A função existente refreshDataset_ já usa LockService para evitar concorrência.
  var result=refreshDataset_();
  if (result && result.ok) {
    props.deleteProperty('VENDAS_RBN_CACHE_PENDENTE');
    return {ok:true,atualizar:true,resultado:result};
  }
  throw new Error('Não foi possível atualizar o cache da Supervisão.');
}

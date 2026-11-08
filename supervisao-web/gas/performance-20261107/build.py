"""Prepare the update from the Code.gs currently saved in Apps Script."""

import argparse
import re
from pathlib import Path


HERE = Path(__file__).resolve().parent
SUFFIX_FILES = ('Formation.gs', 'Fleet.gs', 'Routing.gs', 'Performance.gs', 'FormationProjection.gs', 'Logistics.gs', 'Transport.gs')
OLD_HTML = 'https://raw.githubusercontent.com/analistacomercialrbn/dashboardlojas/19ad1e579ac517f20bd004ca2cd9cbf457f39853/supervisao-web/gas/formation-save-fix-20261107.html'
OLD_JS = 'https://cdn.jsdelivr.net/gh/analistacomercialrbn/dashboardlojas@2905b03fc0040a140ffd7fe0dc863db89e06a81c/supervisao-web/gas/formation-save-fix-20261107.js'


def exact(text, old, new):
    if text.count(old) != 1:
        raise ValueError(f'Trecho esperado uma vez no código ativo: {old[:100]!r}')
    return text.replace(old, new, 1)


def function(text, name, edit):
    pattern = re.compile(rf'^function {re.escape(name)}\([^\n]*\)\s*\{{.*?^\}}\n', re.M | re.S)
    matches = list(pattern.finditer(text))
    if len(matches) != 1:
        raise ValueError(f'Função esperada uma vez no código ativo: {name}')
    match = matches[0]
    return text[:match.start()] + edit(match.group()) + text[match.end():]


def change_normalizer(body):
    inline = ",today=Utilities.formatDate(new Date(),tz||'America/Fortaleza','yyyy-MM-dd')"
    if inline in body:
        body = exact(body, inline, '')
        body = exact(body, 'function logRecords_(values,kind,tz,regionValues){',
                     "function logRecords_(values,kind,tz,regionValues){\n const today=kind==='transport'?centralToday_(tz):'';")
    else:
        body = exact(body, "const today=kind==='transport'?Utilities.formatDate(new Date(),tz||'America/Fortaleza','yyyy-MM-dd'):'';",
                     "const today=kind==='transport'?centralToday_(tz):'';")
    body = exact(body, 'const names=(values[header]||[]).map(logNorm_),idx=n=>names.indexOf(logNorm_(n));', '''const indices=new Map(), names=new Map(), dates=new Map();
 (values[header]||[]).forEach((value,i)=>{const key=logNorm_(value);if(!indices.has(key))indices.set(key,i);});
 const idx=name=>{if(!names.has(name))names.set(name,indices.get(logNorm_(name))??-1);return names.get(name);};
 const date=value=>{
  if(!(value instanceof Date))return logDate_(value,tz);
  const key=value.getTime();
  if(!dates.has(key))dates.set(key,logDate_(value,tz));
  return dates.get(key);
 };''')
    return exact(body, 'D=(...ks)=>logDate_(get(r,...ks),tz);', 'D=(...ks)=>date(get(r,...ks));')


def change_logistics(body):
    start = body.index(' const id=kind===\'transport\'?ids.indicators:ids.operations,cache=')
    if 'return {ok:true,meta,rows};' not in body[start:]:
        raise ValueError('Final da leitura logística não identificado')
    return body[:start] + " return centralLogisticsRead_(user,p,kind,kind==='transport'?ids.indicators:ids.operations);\n}\n"


def change_auxiliary(body):
    body = exact(body, 'function formExpAux_(){', 'function formExpAux_(journalOnly=false){')
    return exact(body, 'Object.keys(FORM_EXP_SCHEMA).forEach(name=>', "(journalOnly?['HISTORICO_MOVIMENTACOES']:Object.keys(FORM_EXP_SCHEMA)).forEach(name=>")


def backend(active, html_url, suffix):
    offset = active.index('function formDirectClientNames_(){')
    prefix = active[:offset]
    prefix = exact(prefix, OLD_HTML, html_url)
    prefix = function(prefix, 'doGet', lambda _: '''function doGet() {
  const timing=centralTiming_('central.interface');
  let status='erro';
  try{
    const cache=CacheService.getScriptCache(),key='CENTRAL_UI_'+digestHex_(UI_BUNDLE_URL).slice(0,24);
    let html=cache.get(key);
    if(!html){
      const response=UrlFetchApp.fetch(UI_BUNDLE_URL,{muteHttpExceptions:true});
      if(response.getResponseCode()!==200)throw new Error('Não foi possível carregar a interface do dashboard.');
      html=response.getContentText();
      try{cache.put(key,html,21600);}catch(error){}
      status='origem';
    }else status='cache';
    timing.mark('interface');
    return HtmlService.createHtmlOutput(html).setTitle('Central Rebanho · Comercial e Logística').addMetaTag('viewport','width=device-width, initial-scale=1, viewport-fit=cover');
  }finally{
    timing.finish(status);
  }
}
''')
    prefix = exact(prefix,
                   "if (action === 'page') {const out=datasetPage_(payload.offset,payload.limit);out.records=out.records.filter(row=>userAllowsRecord_(user,row));return out;}",
                   "if (action === 'page') return centralCommercialPage_(user,payload);")
    prefix = function(prefix, 'logRecords_', change_normalizer)
    prefix = function(prefix, 'logisticsApi_', change_logistics)
    prefix = exact(prefix, 'function transportEdit_(user,p,id){return deliveryApi_(user,p,id,false);}',
                   'function transportEdit_(user,p,id){return centralTransportEdit_(user,p,id,false);}')
    prefix = exact(prefix, 'function transportBatch_(user,p,id){return deliveryApi_(user,p,id,true);}',
                   'function transportBatch_(user,p,id){return centralTransportEdit_(user,p,id,true);}')
    prefix = function(prefix, 'formExpAux_', change_auxiliary)
    prefix = exact(prefix, "requireInstalledClock_(event,'atualizarCacheVendasRbn');atualizarCacheVendasRbn_();",
                   "requireInstalledClock_(event,'atualizarCacheVendasRbn');formProjectionRecover_();atualizarCacheVendasRbn_();")
    return prefix + suffix.lstrip()


def interface(html, app_url):
    html = exact(html, '<script src="'+OLD_JS+'">', '<script defer src="'+app_url+'">')
    html = exact(html, '<script src="https://cdn.jsdelivr.net/npm/chart.js', '<script defer src="https://cdn.jsdelivr.net/npm/chart.js')
    html = exact(html, '  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>\n', '')
    html = exact(html, 'async function fetchServerDataset(force){', 'async function fetchServerDataset(force,knownInfo=null){')
    html = exact(html, "  }else{\n    SERVER_INFO=await fetchServerDatasetInfo();", "  }else{\n    SERVER_INFO=knownInfo||await fetchServerDatasetInfo();")
    html = exact(html, '  let received=0,expected=Number(SERVER_INFO.recordCount)||0;', '''  const pendingOpenOrders=serverRequest('openOrders').catch(()=>null);
  let received=0,expected=Number(SERVER_INFO.recordCount)||0;
  let compressed=typeof DecompressionStream==='function'&&typeof Response==='function'&&typeof Blob==='function';''')
    html = exact(html, "const page=await serverRequest('page',{offset,limit:pageSize});",
                 "const page=await serverRequest('page',{offset,limit:pageSize,compressed});")
    html = exact(html, "if(!page?.ok)throw new Error(page?.message||'Falha ao ler uma página do cache.');\n          return page;", '''if(!page?.ok)throw new Error(page?.message||'Falha ao ler uma página do cache.');
          if(page.gzip){
            try{
              const bytes=Uint8Array.from(atob(page.gzip),value=>value.charCodeAt(0));
              const decoded=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
              page.records=await new Response(decoded).json();
              delete page.gzip;
            }catch(error){compressed=false;throw error;}
          }
          return page;''')
    html = exact(html, 'try{await fetchOpenOrders();}catch(error){if(!OPEN_ORDERS.length)',
                 'try{await fetchOpenOrders(await pendingOpenOrders);}catch(error){if(!OPEN_ORDERS.length)')
    html = exact(html, "async function fetchOpenOrders(){\n  const result=await serverRequest('openOrders');",
                 "async function fetchOpenOrders(result=undefined){\n  if(result===undefined)result=await serverRequest('openOrders');")
    html = exact(html, 'async function init(){\n  try{\n    if(!FORCE_REFRESH){', 'async function init(){\n  try{\n    let info=null;\n    if(!FORCE_REFRESH){')
    html = exact(html, '      let info=null;\n      try{info=', '      try{info=')
    html = exact(html, 'await fetchServerDataset(FORCE_REFRESH);', 'await fetchServerDataset(FORCE_REFRESH,info);')
    return html


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--active', type=Path, help='Export of the current Apps Script Code.gs')
    parser.add_argument('--old-suffix', type=Path, help='Pinned v88 suffix for a safe version check')
    parser.add_argument('--html-url', default=OLD_HTML)
    parser.add_argument('--app-html', type=Path)
    parser.add_argument('--app-url', default=OLD_JS)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    suffix = '\n'.join((HERE / file).read_text().rstrip() for file in SUFFIX_FILES) + '\n'
    (args.out / 'backend.gs').write_text(suffix)
    if args.active:
        active = args.active.read_text()
        if args.old_suffix:
            offset = active.index('function formDirectClientNames_(){')
            if active[offset:].strip() != args.old_suffix.read_text().strip():
                raise ValueError('O código ativo diverge da versão 88. Revise antes de substituir.')
        (args.out / 'Code.gs').write_text(backend(active, args.html_url, suffix))
    if args.app_html:
        (args.out / 'app.html').write_text(interface(args.app_html.read_text(), args.app_url))


if __name__ == '__main__':
    main()

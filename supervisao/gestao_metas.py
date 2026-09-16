import base64
import copy
import json
from datetime import datetime
from pathlib import Path

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import requests
import streamlit as st

REPO = 'analistacomercialrbn/dashboardlojas'
BRANCH = 'main'
STORE_REPO_PATH = 'supervisao/metas_planejamento.json'
STORE_LOCAL = Path(__file__).with_name('metas_planejamento.json')

MESES = {1:'Janeiro',2:'Fevereiro',3:'Março',4:'Abril',5:'Maio',6:'Junho',7:'Julho',8:'Agosto',9:'Setembro',10:'Outubro',11:'Novembro',12:'Dezembro'}
TIPOS = {'Mensal':1,'Bimestral':2,'Trimestral':3,'Semestral':6,'Anual':12,'Personalizado':0}
CRITERIOS = ['Participação histórica','Crescimento sobre ano anterior','Recuperação','Expectativa comercial','Alteração de território','Entrada ou saída de cliente','Potencial identificado','Outro']
STATUS_LABEL = {'RASCUNHO':'Em elaboração','DISTRIBUIDO':'Distribuído aos supervisores','EM_PREENCHIMENTO':'Em preenchimento','ENVIADO':'Enviado','EM_ANALISE':'Em análise','AJUSTE_SOLICITADO':'Ajuste solicitado','APROVADO':'Aprovado'}


def _token():
    try:
        return str(st.secrets.get('GITHUB_TOKEN') or st.secrets.get('GH_TOKEN') or '')
    except Exception:
        return ''


def _headers():
    h={'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}
    if _token(): h['Authorization']=f'Bearer {_token()}'
    return h


def _load_store():
    api=f'https://api.github.com/repos/{REPO}/contents/{STORE_REPO_PATH}'
    try:
        r=requests.get(api,headers=_headers(),params={'ref':BRANCH},timeout=20); r.raise_for_status()
        store=json.loads(base64.b64decode(r.json()['content']).decode('utf-8'))
    except Exception:
        try: store=json.loads(STORE_LOCAL.read_text(encoding='utf-8'))
        except Exception: store={}
    if not isinstance(store,dict): store={}
    store.setdefault('cycles',{})
    store.setdefault('plans',{})
    return store


def _save_store(store):
    if not _token(): return False,'GITHUB_TOKEN não configurado nos Secrets do Streamlit.'
    api=f'https://api.github.com/repos/{REPO}/contents/{STORE_REPO_PATH}'
    try:
        atual=requests.get(api,headers=_headers(),params={'ref':BRANCH},timeout=20); atual.raise_for_status()
        texto=json.dumps(store,ensure_ascii=False,indent=2,sort_keys=True)+'\n'
        payload={'message':'Atualiza Gestão de Metas pelo dashboard','content':base64.b64encode(texto.encode()).decode(),'sha':atual.json()['sha'],'branch':BRANCH}
        resp=requests.put(api,headers=_headers(),json=payload,timeout=30); resp.raise_for_status()
        try: STORE_LOCAL.write_text(texto,encoding='utf-8')
        except Exception: pass
        return True,'Planejamento salvo.'
    except Exception as exc:
        return False,f'Não foi possível salvar: {exc}'


def _now(): return datetime.now().astimezone().isoformat(timespec='seconds')
def _uname(u): return str(u.get('nome') or u.get('login') or 'Usuário')
def _num(v):
    try: return float(v or 0)
    except Exception: return 0.0


def _cycle_key(ano,meses): return f"{int(ano)}|{','.join(map(str,meses))}"
def _period_label(ano,meses): return ' + '.join(MESES[m] for m in meses)+f'/{ano}'


def _months_for(tipo,inicio,custom):
    if tipo=='Personalizado': return sorted(custom)
    n=TIPOS[tipo]
    return [((inicio-1+i)%12)+1 for i in range(n) if inicio-1+i<12]


def _period_mask(df,ano,meses):
    return df['DATA_FAT'].notna() & df['DATA_FAT'].dt.year.eq(int(ano)) & df['DATA_FAT'].dt.month.isin(meses)


def _latest_complete_month(vendas):
    d=vendas.loc[vendas['FATURADO'],'DATA_FAT'].dropna()
    if d.empty: return None
    mx=d.max().normalize(); end=mx.to_period('M').end_time.normalize()
    p=mx.to_period('M') if mx>=end else mx.to_period('M')-1
    return p


def _recent_period(vendas,n):
    last=_latest_complete_month(vendas)
    if last is None: return []
    return [last-(n-1-i) for i in range(n)]


def _period_values(vendas, periods, sup=None, dep=None, cods=None):
    x=vendas[vendas['FATURADO']].copy()
    if sup is not None: x=x[x['SUPERVISOR'].astype(str).eq(str(sup))]
    if dep is not None: x=x[x['DEPARTAMENTO'].astype(str).eq(str(dep))]
    if cods is not None: x=x[x['COD_RCA'].isin(cods)]
    if not periods: return x.iloc[0:0]
    pis=x['DATA_FAT'].dt.to_period('M')
    return x[pis.isin(periods)].copy()


def _empty_cycle(ano,meses,tipo,meta,u):
    return {'ano':int(ano),'meses':[int(m) for m in meses],'tipo':tipo,'meta_empresa':float(meta),'status':'RASCUNHO','criterio_sugestao':'Média 50/50','supervisores':{},'eventos':[],'versoes':[],'criado_em':_now(),'criado_por':_uname(u),'atualizado_em':_now()}


def _event(c,acao,u,obs=''):
    c.setdefault('eventos',[]).append({'data_hora':_now(),'usuario':_uname(u),'acao':acao,'status':c.get('status','RASCUNHO'),'observacao':obs})


def _snapshot(c):
    s=copy.deepcopy(c); s.pop('eventos',None); s.pop('versoes',None); s['snapshot_em']=_now(); return s


def _weighted_share(a,b,mode):
    if mode=='Últimos meses': return a
    if mode=='Mesmo período A-1': return b
    return (a+b)/2


def _fmt_periods(periods):
    if not periods: return '—'
    return ' + '.join(f'{MESES[p.month]}/{p.year}' for p in periods)


def _supervisor_history(vendas,ativos,ano,meses):
    n=len(meses)
    recent=_recent_period(vendas,n)
    prior=[pd.Period(f'{int(ano)-1}-{m:02d}',freq='M') for m in meses]
    rows=[]
    for sup in sorted(ativos['SUPERVISOR'].dropna().astype(str).unique()):
        cods=set(ativos.loc[ativos['SUPERVISOR'].astype(str).eq(sup),'COD_RCA'].dropna())
        vr=_period_values(vendas,recent,cods=cods)['VALOR'].sum()
        vp=_period_values(vendas,prior,cods=cods)['VALOR'].sum()
        rows.append({'Supervisor':sup,'Últimos meses':float(vr),'Mesmo período A-1':float(vp)})
    df=pd.DataFrame(rows)
    if df.empty: return df,recent,prior
    for col in ['Últimos meses','Mesmo período A-1']:
        total=df[col].sum(); df[f'Part. {col}']=df[col]/total*100 if total else 0
    df['Crescimento recente x A-1']=df.apply(lambda r:(r['Últimos meses']/r['Mesmo período A-1']-1)*100 if r['Mesmo período A-1'] else pd.NA,axis=1)
    return df,recent,prior


def _department_history(vendas,sup,ano,meses):
    n=len(meses); recent=_recent_period(vendas,n); prior=[pd.Period(f'{int(ano)-1}-{m:02d}',freq='M') for m in meses]
    vr=_period_values(vendas,recent,sup=sup).groupby('DEPARTAMENTO',as_index=False)['VALOR'].sum().rename(columns={'VALOR':'Últimos meses'})
    vp=_period_values(vendas,prior,sup=sup).groupby('DEPARTAMENTO',as_index=False)['VALOR'].sum().rename(columns={'VALOR':'Mesmo período A-1'})
    df=vr.merge(vp,on='DEPARTAMENTO',how='outer').fillna(0)
    for col in ['Últimos meses','Mesmo período A-1']:
        total=df[col].sum(); df[f'Part. {col}']=df[col]/total*100 if total else 0
    df['Crescimento recente x A-1']=df.apply(lambda r:(r['Últimos meses']/r['Mesmo período A-1']-1)*100 if r['Mesmo período A-1'] else pd.NA,axis=1)
    return df,recent,prior


def _rca_history(vendas,ativos,sup,ano,meses):
    n=len(meses); recent=_recent_period(vendas,n); prior=[pd.Period(f'{int(ano)-1}-{m:02d}',freq='M') for m in meses]
    esc=ativos[ativos['SUPERVISOR'].astype(str).eq(str(sup))][['COD_RCA','RCA']].drop_duplicates('COD_RCA')
    vr=_period_values(vendas,recent,sup=sup).groupby('COD_RCA',as_index=False)['VALOR'].sum().rename(columns={'VALOR':'Últimos meses'})
    vp=_period_values(vendas,prior,sup=sup).groupby('COD_RCA',as_index=False)['VALOR'].sum().rename(columns={'VALOR':'Mesmo período A-1'})
    df=esc.merge(vr,on='COD_RCA',how='left').merge(vp,on='COD_RCA',how='left').fillna({'Últimos meses':0,'Mesmo período A-1':0})
    for col in ['Últimos meses','Mesmo período A-1']:
        total=df[col].sum(); df[f'Part. {col}']=df[col]/total*100 if total else 0
    df['Crescimento recente x A-1']=df.apply(lambda r:(r['Últimos meses']/r['Mesmo período A-1']-1)*100 if r['Mesmo período A-1'] else pd.NA,axis=1)
    return df,recent,prior


def _history_chart(df,category,title):
    if df.empty: return
    plot=df.melt(id_vars=[category],value_vars=['Últimos meses','Mesmo período A-1'],var_name='Período',value_name='Faturamento')
    fig=px.bar(plot,x=category,y='Faturamento',color='Período',barmode='group',title=title)
    fig.update_layout(height=410,margin=dict(l=10,r=10,t=50,b=10),yaxis_tickprefix='R$ ',yaxis_tickformat='.2s',legend_orientation='h')
    st.plotly_chart(fig,use_container_width=True)


def _monthly_chart(vendas,sup=None,dep=None):
    x=vendas[vendas['FATURADO']].copy()
    if sup: x=x[x['SUPERVISOR'].astype(str).eq(str(sup))]
    if dep: x=x[x['DEPARTAMENTO'].astype(str).eq(str(dep))]
    if x.empty: return
    x['MES']=x['DATA_FAT'].dt.to_period('M').astype(str)
    g=x.groupby('MES',as_index=False)['VALOR'].sum().tail(18)
    fig=px.line(g,x='MES',y='VALOR',markers=True,title='Evolução mensal do faturamento')
    fig.update_layout(height=360,margin=dict(l=10,r=10,t=50,b=10),yaxis_tickprefix='R$ ',yaxis_tickformat='.2s')
    st.plotly_chart(fig,use_container_width=True)


def render_gestao_metas(vendas,metas,ativos,usuario,brl,brl_compacto,pct,kpi):
    perfil=str(usuario.get('perfil') or '')
    st.subheader('Gestão de Metas')
    st.caption('Da meta global da empresa até Supervisor → Departamento → RCA, usando o histórico como referência e mantendo a decisão manual.')

    store=_load_store()
    anos_hist=sorted(vendas.loc[vendas['FATURADO'],'DATA_FAT'].dropna().dt.year.astype(int).unique().tolist(),reverse=True)
    ano_default=max(2026,max(anos_hist) if anos_hist else 2026)

    a,b,c=st.columns([1,1,2])
    ano=a.selectbox('Ano da meta',sorted(set(anos_hist+[ano_default,ano_default+1]),reverse=True),index=0,key='gm2_ano')
    tipo=b.selectbox('Tipo de ciclo',list(TIPOS.keys()),index=2,key='gm2_tipo')
    if tipo=='Personalizado':
        custom=c.multiselect('Meses do ciclo',list(MESES.values()),default=['Outubro','Novembro','Dezembro'],key='gm2_custom')
        meses=sorted([m for m,n in MESES.items() if n in custom])
    else:
        inicio_nome=c.selectbox('Mês inicial',list(MESES.values()),index=9 if tipo=='Trimestral' else 0,key='gm2_inicio')
        inicio=next(m for m,n in MESES.items() if n==inicio_nome)
        meses=_months_for(tipo,inicio,[])
    if not meses:
        st.warning('Selecione pelo menos um mês.'); return

    key=_cycle_key(ano,meses)
    existing=store.get('cycles',{}).get(key)
    cycle=copy.deepcopy(existing or _empty_cycle(ano,meses,tipo,0,usuario))
    hist_sup,recent_periods,prior_periods=_supervisor_history(vendas,ativos,ano,meses)
    st.info(f"Ciclo: **{_period_label(ano,meses)}**  •  comparação recente: **{_fmt_periods(recent_periods)}**  •  sazonalidade: **{_fmt_periods(prior_periods)}**")

    tabs=st.tabs(['1. Meta da Empresa','2. Análise dos Supervisores','3. Distribuição por Supervisor','4. Departamentos','5. RCAs','6. Aprovação e Histórico'])

    with tabs[0]:
        st.markdown('### Meta global da empresa')
        if perfil!='ADMIN':
            st.caption('A definição da meta global é exclusiva do administrador. Você visualiza o ciclo liberado para seu escopo.')
        meta_global=st.number_input('Meta total do ciclo',min_value=0.0,value=float(cycle.get('meta_empresa',0)),step=10000.0,format='%.2f',disabled=perfil!='ADMIN',key=f'gm2_meta_{key}')
        cycle['meta_empresa']=float(meta_global)
        k1,k2,k3,k4=st.columns(4)
        k1.markdown(kpi('Meta da empresa',brl_compacto(meta_global),brl(meta_global)),unsafe_allow_html=True)
        k2.markdown(kpi('Faturamento recente',brl_compacto(hist_sup['Últimos meses'].sum() if not hist_sup.empty else 0),_fmt_periods(recent_periods)),unsafe_allow_html=True)
        k3.markdown(kpi('Mesmo período A-1',brl_compacto(hist_sup['Mesmo período A-1'].sum() if not hist_sup.empty else 0),_fmt_periods(prior_periods)),unsafe_allow_html=True)
        base_prior=hist_sup['Mesmo período A-1'].sum() if not hist_sup.empty else 0
        crescimento=(meta_global/base_prior-1)*100 if base_prior else pd.NA
        k4.markdown(kpi('Crescimento pretendido',pct(crescimento),'Meta x mesmo período A-1'),unsafe_allow_html=True)
        st.markdown('#### Distribuição temporal da meta')
        mensal=cycle.setdefault('meta_mensal',{})
        if not mensal:
            for m in meses: mensal[str(m)]=meta_global/len(meses) if meses else 0
        rows=pd.DataFrame([{'Mês':MESES[m],'Meta':_num(mensal.get(str(m)))} for m in meses])
        ed=st.data_editor(rows,use_container_width=True,hide_index=True,disabled=['Mês'] if perfil=='ADMIN' else list(rows.columns),column_config={'Meta':st.column_config.NumberColumn(format='R$ %.2f')},key=f'gm2_month_{key}')
        soma=float(ed['Meta'].sum())
        st.caption(f'Soma mensal: {brl(soma)} • Diferença para a meta global: {brl(meta_global-soma)}')
        if perfil=='ADMIN' and st.button('Salvar ciclo e meta global',use_container_width=True,key=f'gm2_save_global_{key}'):
            for _,r in ed.iterrows(): mensal[str(next(m for m,n in MESES.items() if n==r.Mês))]=float(r.Meta)
            cycle['tipo']=tipo; cycle['atualizado_em']=_now(); _event(cycle,'SALVAR_META_GLOBAL',usuario)
            store['cycles'][key]=cycle
            ok,msg=_save_store(store); (st.success if ok else st.error)(msg)
            if ok: st.rerun()

    with tabs[1]:
        st.markdown('### Análise histórica dos supervisores')
        if hist_sup.empty:
            st.info('Sem histórico disponível para o escopo.')
        else:
            filtro=st.multiselect('Filtrar supervisor',hist_sup['Supervisor'].tolist(),default=[],placeholder='Todos',key=f'gm2_sup_filter_{key}')
            ana=hist_sup[hist_sup['Supervisor'].isin(filtro)].copy() if filtro else hist_sup.copy()
            _history_chart(ana,'Supervisor','Faturamento por supervisor — comparação de períodos')
            tbl=ana.copy()
            st.dataframe(tbl,use_container_width=True,hide_index=True,column_config={'Últimos meses':st.column_config.NumberColumn(format='R$ %.2f'),'Mesmo período A-1':st.column_config.NumberColumn(format='R$ %.2f'),'Part. Últimos meses':st.column_config.NumberColumn(format='%.2f%%'),'Part. Mesmo período A-1':st.column_config.NumberColumn(format='%.2f%%'),'Crescimento recente x A-1':st.column_config.NumberColumn(format='%.2f%%')})
            sup_det=st.selectbox('Ver evolução de um supervisor',['Todos']+ana['Supervisor'].tolist(),key=f'gm2_sup_det_{key}')
            _monthly_chart(vendas,None if sup_det=='Todos' else sup_det)

    with tabs[2]:
        st.markdown('### Distribuição da meta por supervisor')
        if perfil!='ADMIN': st.caption('A distribuição macro é definida pelo administrador.')
        modo=st.radio('Base da sugestão',['Média 50/50','Últimos meses','Mesmo período A-1'],horizontal=True,index=['Média 50/50','Últimos meses','Mesmo período A-1'].index(cycle.get('criterio_sugestao','Média 50/50')) if cycle.get('criterio_sugestao') in ['Média 50/50','Últimos meses','Mesmo período A-1'] else 0,disabled=perfil!='ADMIN',key=f'gm2_mode_{key}')
        cycle['criterio_sugestao']=modo
        if not hist_sup.empty:
            hs=hist_sup.copy()
            hs['_w']=hs.apply(lambda r:_weighted_share(r['Part. Últimos meses'],r['Part. Mesmo período A-1'],modo),axis=1)
            if hs['_w'].sum(): hs['_w']=hs['_w']/hs['_w'].sum()*100
            supstore=cycle.setdefault('supervisores',{})
            for _,r in hs.iterrows():
                rec=supstore.setdefault(str(r.Supervisor),{})
                rec['sugerida']=float(cycle.get('meta_empresa',0))*float(r['_w'])/100
                rec.setdefault('proposta',rec['sugerida']); rec.setdefault('criterio','Participação histórica'); rec.setdefault('justificativa',''); rec.setdefault('departamentos',{}); rec.setdefault('rcas',{}); rec.setdefault('status','EM_PREENCHIMENTO')
            quadro=pd.DataFrame([{'Supervisor':r.Supervisor,'Hist. recente':r['Últimos meses'],'Hist. A-1':r['Mesmo período A-1'],'Participação ref. %':r['_w'],'Meta sugerida':supstore[str(r.Supervisor)]['sugerida'],'Meta definida':_num(supstore[str(r.Supervisor)].get('proposta'))} for _,r in hs.iterrows()])
            editable=[] if perfil=='ADMIN' else list(quadro.columns)
            if perfil=='ADMIN': editable=[c for c in quadro.columns if c!='Meta definida']
            ed=st.data_editor(quadro,use_container_width=True,hide_index=True,disabled=editable,column_config={'Hist. recente':st.column_config.NumberColumn(format='R$ %.2f'),'Hist. A-1':st.column_config.NumberColumn(format='R$ %.2f'),'Participação ref. %':st.column_config.NumberColumn(format='%.2f%%'),'Meta sugerida':st.column_config.NumberColumn(format='R$ %.2f'),'Meta definida':st.column_config.NumberColumn(format='R$ %.2f')},key=f'gm2_sup_editor_{key}')
            total=float(ed['Meta definida'].sum()); dif=_num(cycle.get('meta_empresa'))-total
            c1,c2,c3=st.columns(3); c1.metric('Meta empresa',brl(cycle.get('meta_empresa',0))); c2.metric('Distribuída',brl(total)); c3.metric('Diferença',brl(dif))
            if abs(dif)<=0.02: st.success('Distribuição por supervisor fechada.')
            else: st.warning(f'Ainda faltam {brl(dif)} para fechar a meta global.')
            if perfil=='ADMIN' and st.button('Gerar automaticamente pelo histórico',use_container_width=True,key=f'gm2_auto_sup_{key}'):
                for _,r in hs.iterrows(): supstore[str(r.Supervisor)]['proposta']=float(cycle.get('meta_empresa',0))*float(r['_w'])/100
                cycle['atualizado_em']=_now(); _event(cycle,'GERAR_SUPERVISORES_AUTOMATICO',usuario,modo); store['cycles'][key]=cycle
                ok,msg=_save_store(store); (st.success if ok else st.error)(msg)
                if ok: st.rerun()
            if perfil=='ADMIN' and st.button('Salvar distribuição por supervisor',use_container_width=True,key=f'gm2_save_sup_{key}'):
                for _,r in ed.iterrows(): supstore[str(r.Supervisor)]['proposta']=float(r['Meta definida'])
                cycle['status']='DISTRIBUIDO' if abs(dif)<=0.02 else 'RASCUNHO'; cycle['atualizado_em']=_now(); _event(cycle,'SALVAR_DISTRIBUICAO_SUPERVISOR',usuario); store['cycles'][key]=cycle
                ok,msg=_save_store(store); (st.success if ok else st.error)(msg)
                if ok: st.rerun()

    with tabs[3]:
        st.markdown('### Análise e distribuição por departamento')
        sups=sorted(cycle.get('supervisores',{}).keys()) or sorted(ativos['SUPERVISOR'].dropna().astype(str).unique())
        if perfil=='SUPERVISOR':
            vinculados=sorted(ativos['SUPERVISOR'].dropna().astype(str).unique()); sups=[s for s in sups if s in vinculados]
        if not sups: st.info('Nenhuma supervisão disponível.')
        else:
            sup=st.selectbox('Supervisor',sups,key=f'gm2_dep_sup_{key}')
            suprec=cycle.setdefault('supervisores',{}).setdefault(sup,{'proposta':0,'departamentos':{},'rcas':{},'status':'EM_PREENCHIMENTO'})
            meta_sup=_num(suprec.get('proposta'))
            dh,recent_d,prior_d=_department_history(vendas,sup,ano,meses)
            k1,k2,k3=st.columns(3); k1.markdown(kpi('Meta do supervisor',brl_compacto(meta_sup),brl(meta_sup)),unsafe_allow_html=True); k2.markdown(kpi('Histórico recente',brl_compacto(dh['Últimos meses'].sum() if not dh.empty else 0),_fmt_periods(recent_d)),unsafe_allow_html=True); k3.markdown(kpi('Mesmo período A-1',brl_compacto(dh['Mesmo período A-1'].sum() if not dh.empty else 0),_fmt_periods(prior_d)),unsafe_allow_html=True)
            if not dh.empty:
                _history_chart(dh,'DEPARTAMENTO','Departamentos — comparação de períodos')
                dep_filter=st.selectbox('Ver evolução de departamento',['Todos']+sorted(dh['DEPARTAMENTO'].astype(str).tolist()),key=f'gm2_dep_det_{key}')
                _monthly_chart(vendas,sup,None if dep_filter=='Todos' else dep_filter)
                mode_dep=st.radio('Base para sugestão do departamento',['Média 50/50','Últimos meses','Mesmo período A-1'],horizontal=True,key=f'gm2_dep_mode_{key}')
                dh['_w']=dh.apply(lambda r:_weighted_share(r['Part. Últimos meses'],r['Part. Mesmo período A-1'],mode_dep),axis=1)
                if dh['_w'].sum(): dh['_w']=dh['_w']/dh['_w'].sum()*100
                ds=suprec.setdefault('departamentos',{})
                for _,r in dh.iterrows():
                    d=ds.setdefault(str(r.DEPARTAMENTO),{}); d['sugerida']=meta_sup*float(r['_w'])/100; d.setdefault('proposta',d['sugerida']); d.setdefault('mensal',{})
                ddf=pd.DataFrame([{'Departamento':r.DEPARTAMENTO,'Hist. recente':r['Últimos meses'],'Hist. A-1':r['Mesmo período A-1'],'Participação ref. %':r['_w'],'Meta sugerida':ds[str(r.DEPARTAMENTO)]['sugerida'],'Meta proposta':_num(ds[str(r.DEPARTAMENTO)].get('proposta'))} for _,r in dh.iterrows()])
                ded=st.data_editor(ddf,use_container_width=True,hide_index=True,disabled=[c for c in ddf.columns if c!='Meta proposta'],column_config={'Hist. recente':st.column_config.NumberColumn(format='R$ %.2f'),'Hist. A-1':st.column_config.NumberColumn(format='R$ %.2f'),'Participação ref. %':st.column_config.NumberColumn(format='%.2f%%'),'Meta sugerida':st.column_config.NumberColumn(format='R$ %.2f'),'Meta proposta':st.column_config.NumberColumn(format='R$ %.2f')},key=f'gm2_dep_edit_{key}_{sup}')
                total=float(ded['Meta proposta'].sum()); dif=meta_sup-total
                st.caption(f'Distribuído nos departamentos: {brl(total)} • Diferença: {brl(dif)}')
                if st.button('Gerar departamentos automaticamente',use_container_width=True,key=f'gm2_auto_dep_{key}_{sup}'):
                    for _,r in dh.iterrows(): ds[str(r.DEPARTAMENTO)]['proposta']=meta_sup*float(r['_w'])/100
                    cycle['atualizado_em']=_now(); _event(cycle,'GERAR_DEPARTAMENTOS_AUTOMATICO',usuario,sup); store['cycles'][key]=cycle
                    ok,msg=_save_store(store); (st.success if ok else st.error)(msg)
                    if ok: st.rerun()
                if st.button('Salvar departamentos',use_container_width=True,key=f'gm2_save_dep_{key}_{sup}'):
                    for _,r in ded.iterrows(): ds[str(r.Departamento)]['proposta']=float(r['Meta proposta'])
                    cycle['atualizado_em']=_now(); _event(cycle,'SALVAR_DEPARTAMENTOS',usuario,sup); store['cycles'][key]=cycle
                    ok,msg=_save_store(store); (st.success if ok else st.error)(msg)
                    if ok: st.rerun()

    with tabs[4]:
        st.markdown('### Distribuição da meta do supervisor entre RCAs')
        sups=sorted(cycle.get('supervisores',{}).keys())
        if perfil=='SUPERVISOR':
            vis=set(ativos['SUPERVISOR'].dropna().astype(str)); sups=[s for s in sups if s in vis]
        if not sups: st.info('Primeiro distribua a meta entre os supervisores.')
        else:
            sup=st.selectbox('Supervisor para distribuir RCAs',sups,key=f'gm2_rca_sup_{key}')
            suprec=cycle['supervisores'][sup]; meta_sup=_num(suprec.get('proposta'))
            rh,recent_r,prior_r=_rca_history(vendas,ativos,sup,ano,meses)
            if rh.empty: st.info('Sem RCAs no escopo.')
            else:
                _history_chart(rh.rename(columns={'RCA':'RCA Nome'}),'RCA Nome','RCAs — comparação de períodos')
                mode_r=st.radio('Base para sugestão dos RCAs',['Média 50/50','Últimos meses','Mesmo período A-1'],horizontal=True,key=f'gm2_rca_mode_{key}')
                rh['_w']=rh.apply(lambda r:_weighted_share(r['Part. Últimos meses'],r['Part. Mesmo período A-1'],mode_r),axis=1)
                if rh['_w'].sum(): rh['_w']=rh['_w']/rh['_w'].sum()*100
                rs=suprec.setdefault('rcas',{})
                for _,r in rh.iterrows():
                    rr=rs.setdefault(str(int(r.COD_RCA)),{}); rr['rca']=str(r.RCA); rr['sugerida']=meta_sup*float(r['_w'])/100; rr.setdefault('proposta',rr['sugerida']); rr.setdefault('criterio','Participação histórica'); rr.setdefault('justificativa','')
                rdf=pd.DataFrame([{'COD_RCA':int(r.COD_RCA),'RCA':r.RCA,'Hist. recente':r['Últimos meses'],'Hist. A-1':r['Mesmo período A-1'],'Participação ref. %':r['_w'],'Meta sugerida':rs[str(int(r.COD_RCA))]['sugerida'],'Meta proposta':_num(rs[str(int(r.COD_RCA))].get('proposta'))} for _,r in rh.iterrows()])
                red=st.data_editor(rdf,use_container_width=True,hide_index=True,disabled=[c for c in rdf.columns if c!='Meta proposta'],column_config={'Hist. recente':st.column_config.NumberColumn(format='R$ %.2f'),'Hist. A-1':st.column_config.NumberColumn(format='R$ %.2f'),'Participação ref. %':st.column_config.NumberColumn(format='%.2f%%'),'Meta sugerida':st.column_config.NumberColumn(format='R$ %.2f'),'Meta proposta':st.column_config.NumberColumn(format='R$ %.2f')},key=f'gm2_rca_edit_{key}_{sup}')
                total=float(red['Meta proposta'].sum()); dif=meta_sup-total
                st.caption(f'Meta supervisor: {brl(meta_sup)} • Distribuída aos RCAs: {brl(total)} • Diferença: {brl(dif)}')
                escolhido=st.selectbox('Justificativa do RCA',[f"{int(r.COD_RCA)} - {r.RCA}" for _,r in rh.iterrows()],key=f'gm2_rca_just_sel_{key}_{sup}')
                codsel=escolhido.split(' - ',1)[0]; rr=rs[codsel]
                c1,c2=st.columns([1,2]); crit=c1.selectbox('Critério',CRITERIOS,index=CRITERIOS.index(rr.get('criterio')) if rr.get('criterio') in CRITERIOS else 0,key=f'gm2_rca_crit_{key}_{sup}_{codsel}'); just=c2.text_area('Justificativa',value=rr.get('justificativa',''),key=f'gm2_rca_just_{key}_{sup}_{codsel}')
                rr['criterio']=crit; rr['justificativa']=just
                if st.button('Gerar RCAs automaticamente',use_container_width=True,key=f'gm2_auto_rca_{key}_{sup}'):
                    for _,r in rh.iterrows(): rs[str(int(r.COD_RCA))]['proposta']=meta_sup*float(r['_w'])/100
                    cycle['atualizado_em']=_now(); _event(cycle,'GERAR_RCAS_AUTOMATICO',usuario,sup); store['cycles'][key]=cycle
                    ok,msg=_save_store(store); (st.success if ok else st.error)(msg)
                    if ok: st.rerun()
                if st.button('Salvar distribuição dos RCAs',use_container_width=True,key=f'gm2_save_rca_{key}_{sup}'):
                    for _,r in red.iterrows(): rs[str(int(r.COD_RCA))]['proposta']=float(r['Meta proposta'])
                    cycle['atualizado_em']=_now(); _event(cycle,'SALVAR_RCAS',usuario,sup); store['cycles'][key]=cycle
                    ok,msg=_save_store(store); (st.success if ok else st.error)(msg)
                    if ok: st.rerun()

    with tabs[5]:
        st.markdown('### Validação, aprovação e histórico')
        sup_rows=[]
        for s,r in cycle.get('supervisores',{}).items():
            dep_total=sum(_num(x.get('proposta')) for x in r.get('departamentos',{}).values())
            rca_total=sum(_num(x.get('proposta')) for x in r.get('rcas',{}).values())
            meta_s=_num(r.get('proposta'))
            sup_rows.append({'Supervisor':s,'Meta definida':meta_s,'Departamentos':dep_total,'RCAs':rca_total,'Dif. departamentos':meta_s-dep_total,'Dif. RCAs':meta_s-rca_total,'Status':STATUS_LABEL.get(r.get('status'),r.get('status'))})
        if sup_rows:
            st.dataframe(pd.DataFrame(sup_rows),use_container_width=True,hide_index=True,column_config={c:st.column_config.NumberColumn(format='R$ %.2f') for c in ['Meta definida','Departamentos','RCAs','Dif. departamentos','Dif. RCAs']})
        total_sup=sum(_num(r.get('proposta')) for r in cycle.get('supervisores',{}).values())
        valid_global=abs(total_sup-_num(cycle.get('meta_empresa')))<=0.02
        valid_deps=all(abs(_num(r.get('proposta'))-sum(_num(x.get('proposta')) for x in r.get('departamentos',{}).values()))<=0.02 for r in cycle.get('supervisores',{}).values()) if cycle.get('supervisores') else False
        valid_rcas=all(abs(_num(r.get('proposta'))-sum(_num(x.get('proposta')) for x in r.get('rcas',{}).values()))<=0.02 for r in cycle.get('supervisores',{}).values()) if cycle.get('supervisores') else False
        v1,v2,v3=st.columns(3); v1.success('✓ Supervisores fechados') if valid_global else v1.warning('Supervisores não fecham'); v2.success('✓ Departamentos fechados') if valid_deps else v2.warning('Departamentos não fecham'); v3.success('✓ RCAs fechados') if valid_rcas else v3.warning('RCAs não fecham')
        if perfil in ('ADMIN','GERENTE'):
            b1,b2,b3=st.columns(3)
            if b1.button('Colocar em análise',use_container_width=True,key=f'gm2_review_{key}'):
                cycle['status']='EM_ANALISE'; _event(cycle,'COLOCAR_EM_ANALISE',usuario); store['cycles'][key]=cycle; ok,msg=_save_store(store); (st.success if ok else st.error)(msg); st.rerun() if ok else None
            if b2.button('Solicitar ajuste',use_container_width=True,key=f'gm2_adjust_{key}'):
                cycle['status']='AJUSTE_SOLICITADO'; _event(cycle,'SOLICITAR_AJUSTE',usuario); store['cycles'][key]=cycle; ok,msg=_save_store(store); (st.success if ok else st.error)(msg); st.rerun() if ok else None
            if b3.button('Aprovar ciclo',use_container_width=True,disabled=not(valid_global and valid_deps and valid_rcas),key=f'gm2_approve_{key}'):
                cycle['status']='APROVADO'; cycle.setdefault('versoes',[]).append(_snapshot(cycle)); _event(cycle,'APROVAR_CICLO',usuario); store['cycles'][key]=cycle; ok,msg=_save_store(store); (st.success if ok else st.error)(msg); st.rerun() if ok else None
        st.markdown('#### Histórico de alterações')
        if cycle.get('eventos'): st.dataframe(pd.DataFrame(cycle['eventos']).sort_values('data_hora',ascending=False),use_container_width=True,hide_index=True)
        else: st.info('Ainda não há alterações registradas neste ciclo.')

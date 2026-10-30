import copy

import pandas as pd
import streamlit as st

import gestao_metas as gm


def _safe(v):
    try:
        return float(v or 0)
    except Exception:
        return 0.0


def _month_targets(cycle, meses):
    mensal = cycle.setdefault('meta_mensal', {})
    total = _safe(cycle.get('meta_empresa'))
    if not mensal and meses:
        for m in meses:
            mensal[str(m)] = total / len(meses)
    return {m: _safe(mensal.get(str(m))) for m in meses}


def _supervisor_weights(vendas, ativos, ano, meses, modo='Média 50/50'):
    hist, _, _ = gm._supervisor_history(vendas, ativos, ano, meses)
    if hist.empty:
        sups = sorted(ativos['SUPERVISOR'].dropna().astype(str).unique())
        if not sups:
            return pd.DataFrame(columns=['Supervisor', '_w'])
        return pd.DataFrame({'Supervisor': sups, '_w': [100 / len(sups)] * len(sups)})
    x = hist.copy()
    x['_w'] = x.apply(lambda r: gm._weighted_share(r['Part. Últimos meses'], r['Part. Mesmo período A-1'], modo), axis=1)
    if x['_w'].sum():
        x['_w'] = x['_w'] / x['_w'].sum() * 100
    return x


def _department_weights(vendas, sup, ano, mes, modo='Média 50/50'):
    hist, _, _ = gm._department_history(vendas, sup, ano, [mes])
    if hist.empty:
        return hist
    hist['_w'] = hist.apply(lambda r: gm._weighted_share(r['Part. Últimos meses'], r['Part. Mesmo período A-1'], modo), axis=1)
    if hist['_w'].sum():
        hist['_w'] = hist['_w'] / hist['_w'].sum() * 100
    return hist


def _rca_department_history(vendas, ativos, sup, dep, ano, mes):
    esc = ativos[ativos['SUPERVISOR'].astype(str).eq(str(sup))][['COD_RCA','RCA']].drop_duplicates('COD_RCA')
    recent = gm._recent_period(vendas, 1)
    prior = [pd.Period(f'{int(ano)-1}-{int(mes):02d}', freq='M')]
    vr = gm._period_values(vendas, recent, sup=sup, dep=dep).groupby('COD_RCA', as_index=False)['VALOR'].sum().rename(columns={'VALOR':'Último mês fechado'})
    vp = gm._period_values(vendas, prior, sup=sup, dep=dep).groupby('COD_RCA', as_index=False)['VALOR'].sum().rename(columns={'VALOR':'Mesmo mês A-1'})
    df = esc.merge(vr, on='COD_RCA', how='left').merge(vp, on='COD_RCA', how='left').fillna({'Último mês fechado':0,'Mesmo mês A-1':0})
    if df.empty:
        return df
    for col in ['Último mês fechado','Mesmo mês A-1']:
        total = df[col].sum()
        df[f'Part. {col}'] = df[col] / total * 100 if total else 0
    df['_w'] = (df['Part. Último mês fechado'] + df['Part. Mesmo mês A-1']) / 2
    if df['_w'].sum():
        df['_w'] = df['_w'] / df['_w'].sum() * 100
    else:
        df['_w'] = 100 / len(df)
    return df


def _refresh_rollups(cycle, meses):
    for srec in (cycle.get('supervisores') or {}).values():
        srec['proposta'] = sum(_safe((srec.get('mensal') or {}).get(str(m))) for m in meses)
        for drec in (srec.get('departamentos') or {}).values():
            drec['proposta'] = sum(_safe((drec.get('mensal') or {}).get(str(m))) for m in meses)
        for rrec in (srec.get('rcas') or {}).values():
            mensal = {str(m):0.0 for m in meses}
            for drec in (rrec.get('departamentos') or {}).values():
                for m in meses:
                    mensal[str(m)] += _safe((drec.get('mensal') or {}).get(str(m)))
            rrec['mensal'] = mensal
            rrec['proposta'] = sum(mensal.values())


def _status_month(cycle, mes):
    alvo = _safe((cycle.get('meta_mensal') or {}).get(str(mes)))
    sups = cycle.get('supervisores') or {}
    sup_sum = sum(_safe((r.get('mensal') or {}).get(str(mes))) for r in sups.values())
    sup_ok = bool(sups) and abs(sup_sum - alvo) <= 0.02
    dep_ok = sup_ok
    rca_ok = dep_ok
    for srec in sups.values():
        sm = _safe((srec.get('mensal') or {}).get(str(mes)))
        deps = srec.get('departamentos') or {}
        dsum = sum(_safe((d.get('mensal') or {}).get(str(mes))) for d in deps.values())
        if not deps or abs(dsum - sm) > 0.02:
            dep_ok = False
        for dep, drec in deps.items():
            dm = _safe((drec.get('mensal') or {}).get(str(mes)))
            rsum = 0.0
            tem = False
            for rrec in (srec.get('rcas') or {}).values():
                rd = (rrec.get('departamentos') or {}).get(dep) or {}
                if rd:
                    tem = True
                rsum += _safe((rd.get('mensal') or {}).get(str(mes)))
            if dm > 0 and (not tem or abs(rsum-dm) > 0.02):
                rca_ok = False
    return alvo, sup_ok, dep_ok, rca_ok


def _header(cycle, ano, tipo, meses, brl):
    total = _safe(cycle.get('meta_empresa'))
    st.markdown(
        f"""
        <div style='border:1px solid #e5e8ef;border-radius:16px;padding:14px 16px;background:#fff;margin-bottom:10px'>
          <div style='font-size:11px;font-weight:800;color:#7a8091;letter-spacing:.08em'>PLANEJAMENTO DE METAS</div>
          <div style='display:flex;justify-content:space-between;gap:20px;align-items:end;flex-wrap:wrap'>
            <div><div style='font-size:21px;font-weight:850;color:#1e2655'>{ano} • {tipo}</div><div style='font-size:12px;color:#777e8d'>{' • '.join(gm.MESES[m] for m in meses)}</div></div>
            <div style='text-align:right'><div style='font-size:11px;color:#8a90a0'>META DO CICLO</div><div style='font-size:22px;font-weight:850;color:#1e2655'>{brl(total)}</div></div>
          </div>
        </div>
        """, unsafe_allow_html=True
    )


def render_gestao_metas_mensal(vendas, metas, ativos, usuario, brl, brl_compacto, pct, kpi):
    perfil = str(usuario.get('perfil') or '')
    store = gm._load_store()
    anos_hist = sorted(vendas.loc[vendas['FATURADO'],'DATA_FAT'].dropna().dt.year.astype(int).unique().tolist(), reverse=True)
    ano_default = max(2026, max(anos_hist) if anos_hist else 2026)

    st.subheader('Gestão de Metas')
    st.caption('A meta passa a fechar mês a mês em toda a hierarquia: Empresa → Supervisor → Departamento → RCA.')

    a,b,c = st.columns([1,1,2])
    ano = a.selectbox('Ano da meta', sorted(set(anos_hist+[ano_default,ano_default+1]), reverse=True), index=0, key='gm3_ano')
    tipo = b.selectbox('Tipo de ciclo', list(gm.TIPOS.keys()), index=2, key='gm3_tipo')
    if tipo == 'Personalizado':
        custom = c.multiselect('Meses do ciclo', list(gm.MESES.values()), default=['Outubro','Novembro','Dezembro'], key='gm3_custom')
        meses = sorted([m for m,n in gm.MESES.items() if n in custom])
    else:
        inicio_nome = c.selectbox('Mês inicial', list(gm.MESES.values()), index=9 if tipo=='Trimestral' else 0, key='gm3_inicio')
        inicio = next(m for m,n in gm.MESES.items() if n == inicio_nome)
        meses = gm._months_for(tipo, inicio, [])
    if not meses:
        st.warning('Selecione pelo menos um mês.')
        return

    key = gm._cycle_key(ano, meses)
    existing = store.get('cycles', {}).get(key)
    cycle = copy.deepcopy(existing or gm._empty_cycle(ano, meses, tipo, 0, usuario))
    cycle['tipo'] = tipo
    _refresh_rollups(cycle, meses)
    _header(cycle, ano, tipo, meses, brl)

    tabs = st.tabs(['🎯 Meta global','👥 Supervisores','🧩 Departamentos','🧑‍💼 RCAs','✅ Aprovação'])

    with tabs[0]:
        st.markdown('### 1. Meta global e meta mensal da empresa')
        meta_global = st.number_input('Meta total do ciclo', min_value=0.0, value=_safe(cycle.get('meta_empresa')), step=10000.0, format='%.2f', disabled=perfil!='ADMIN', key=f'gm3_meta_{key}')
        cycle['meta_empresa'] = float(meta_global)
        mt = _month_targets(cycle, meses)
        if sum(mt.values()) == 0 and meta_global > 0:
            mt = {m: meta_global/len(meses) for m in meses}
        rows = pd.DataFrame([{'Mês':gm.MESES[m], 'Meta mensal':mt[m]} for m in meses])
        ed = st.data_editor(rows, use_container_width=True, hide_index=True, disabled=['Mês'] if perfil=='ADMIN' else list(rows.columns), column_config={'Meta mensal':st.column_config.NumberColumn(format='R$ %.2f', step=10000.0)}, key=f'gm3_global_months_{key}')
        soma = float(pd.to_numeric(ed['Meta mensal'], errors='coerce').fillna(0).sum())
        c1,c2,c3 = st.columns(3)
        c1.metric('Meta do ciclo', brl(meta_global)); c2.metric('Soma dos meses', brl(soma)); c3.metric('Diferença', brl(meta_global-soma))
        if perfil=='ADMIN' and st.button('Salvar meta global e meses', use_container_width=True, disabled=abs(meta_global-soma)>0.02, key=f'gm3_save_global_{key}'):
            cycle['meta_mensal'] = {str(next(m for m,n in gm.MESES.items() if n==r['Mês'])):float(r['Meta mensal']) for _,r in ed.iterrows()}
            cycle['atualizado_em'] = gm._now(); gm._event(cycle,'SALVAR_META_GLOBAL_MENSAL',usuario)
            store.setdefault('cycles',{})[key] = cycle
            ok,msg = gm._save_store(store); (st.success if ok else st.error)(msg)
            if ok: st.rerun()

    with tabs[1]:
        st.markdown('### 2. Supervisores — total do ciclo e mês a mês')
        st.caption('O administrador fecha simultaneamente o total de cada supervisor e cada coluna mensal da empresa.')
        modo = st.radio('Base da sugestão',['Média 50/50','Últimos meses','Mesmo período A-1'], horizontal=True, key=f'gm3_sup_mode_{key}', disabled=perfil!='ADMIN')
        sw = _supervisor_weights(vendas, ativos, ano, meses, modo)
        targets = _month_targets(cycle, meses)
        supstore = cycle.setdefault('supervisores', {})
        rows=[]
        for _,r in sw.iterrows():
            sup = str(r['Supervisor']); w = _safe(r['_w'])/100
            rec = supstore.setdefault(sup, {'departamentos':{},'rcas':{},'status':'EM_PREENCHIMENTO'})
            mensal = rec.setdefault('mensal', {})
            for m in meses:
                mensal.setdefault(str(m), targets[m]*w)
            row={'Supervisor':sup, 'Participação ref. %':w*100}
            for m in meses: row[gm.MESES[m]] = _safe(mensal.get(str(m)))
            row['Total ciclo'] = sum(row[gm.MESES[m]] for m in meses)
            rows.append(row)
        sdf = pd.DataFrame(rows)
        if sdf.empty:
            st.info('Sem supervisores disponíveis.')
        else:
            disabled = ['Supervisor','Participação ref. %','Total ciclo'] if perfil=='ADMIN' else list(sdf.columns)
            sed = st.data_editor(sdf, use_container_width=True, hide_index=True, disabled=disabled, column_config={**{gm.MESES[m]:st.column_config.NumberColumn(format='R$ %.2f', step=10000.0) for m in meses}, 'Total ciclo':st.column_config.NumberColumn(format='R$ %.2f'), 'Participação ref. %':st.column_config.NumberColumn(format='%.2f%%')}, key=f'gm3_sup_matrix_{key}')
            checks=[]
            for m in meses:
                soma_m = float(pd.to_numeric(sed[gm.MESES[m]], errors='coerce').fillna(0).sum())
                checks.append((m, soma_m, targets[m], abs(soma_m-targets[m])<=0.02))
            st.markdown('#### Fechamento mensal')
            cols=st.columns(len(meses))
            for col,(m,soma_m,alvo,okm) in zip(cols,checks):
                col.metric(gm.MESES[m], brl(soma_m), f"Alvo {brl(alvo)}")
                col.success('Fechado') if okm else col.warning('Ajustar')
            all_ok = all(x[3] for x in checks)
            if perfil=='ADMIN' and st.button('Salvar matriz mensal dos supervisores', use_container_width=True, disabled=not all_ok, key=f'gm3_save_sup_{key}'):
                for _,r in sed.iterrows():
                    rec = supstore[str(r['Supervisor'])]
                    rec['mensal'] = {str(m):float(r[gm.MESES[m]]) for m in meses}
                    rec['proposta'] = sum(rec['mensal'].values())
                cycle['status']='DISTRIBUIDO'; cycle['atualizado_em']=gm._now(); gm._event(cycle,'SALVAR_SUPERVISORES_MENSAL',usuario)
                store['cycles'][key]=cycle
                ok,msg=gm._save_store(store); (st.success if ok else st.error)(msg)
                if ok: st.rerun()

    with tabs[2]:
        st.markdown('### 3. Departamentos — o supervisor trabalha mês a mês')
        sups = sorted((cycle.get('supervisores') or {}).keys())
        if perfil=='SUPERVISOR':
            vis=set(ativos['SUPERVISOR'].dropna().astype(str)); sups=[s for s in sups if s in vis]
        if not sups:
            st.info('Primeiro salve a matriz mensal dos supervisores.')
        else:
            c1,c2=st.columns(2)
            sup=c1.selectbox('Supervisor', sups, key=f'gm3_dep_sup_{key}')
            mes_nome=c2.selectbox('Mês para planejar', [gm.MESES[m] for m in meses], key=f'gm3_dep_mes_{key}')
            mes=next(m for m,n in gm.MESES.items() if n==mes_nome)
            srec=cycle['supervisores'][sup]
            meta_mes=_safe((srec.get('mensal') or {}).get(str(mes)))
            st.metric(f'Meta de {sup} em {mes_nome}', brl(meta_mes))
            modo=st.radio('Base da sugestão do departamento',['Média 50/50','Últimos meses','Mesmo período A-1'], horizontal=True, key=f'gm3_dep_mode_{key}_{sup}_{mes}')
            dh=_department_weights(vendas,sup,ano,mes,modo)
            ds=srec.setdefault('departamentos',{})
            rows=[]
            for _,r in dh.iterrows():
                dep=str(r['DEPARTAMENTO']); w=_safe(r['_w'])/100
                d=ds.setdefault(dep, {'mensal':{}})
                d['mensal'].setdefault(str(mes), meta_mes*w)
                rows.append({'Departamento':dep,'Participação ref. %':w*100,'Meta sugerida':meta_mes*w,'Meta do mês':_safe(d['mensal'].get(str(mes)))})
            ddf=pd.DataFrame(rows)
            if ddf.empty:
                st.info('Sem departamentos com histórico no escopo.')
            else:
                ded=st.data_editor(ddf,use_container_width=True,hide_index=True,disabled=[c for c in ddf.columns if c!='Meta do mês'],column_config={'Participação ref. %':st.column_config.NumberColumn(format='%.2f%%'),'Meta sugerida':st.column_config.NumberColumn(format='R$ %.2f'),'Meta do mês':st.column_config.NumberColumn(format='R$ %.2f',step=10000.0)},key=f'gm3_dep_edit_{key}_{sup}_{mes}')
                total=float(pd.to_numeric(ded['Meta do mês'],errors='coerce').fillna(0).sum()); dif=meta_mes-total
                a,b=st.columns(2); a.metric('Distribuído',brl(total)); b.metric('Diferença',brl(dif))
                if st.button('Salvar departamentos deste mês',use_container_width=True,disabled=abs(dif)>0.02,key=f'gm3_save_dep_{key}_{sup}_{mes}'):
                    for _,r in ded.iterrows():
                        d=ds[str(r['Departamento'])]; d.setdefault('mensal',{})[str(mes)]=float(r['Meta do mês']); d['proposta']=sum(_safe(d['mensal'].get(str(m))) for m in meses)
                    cycle['atualizado_em']=gm._now(); gm._event(cycle,'SALVAR_DEPARTAMENTOS_MES',usuario,f'{sup} | {mes_nome}')
                    store['cycles'][key]=cycle; ok,msg=gm._save_store(store); (st.success if ok else st.error)(msg)
                    if ok: st.rerun()

    with tabs[3]:
        st.markdown('### 4. RCAs — por departamento e por mês')
        sups=sorted((cycle.get('supervisores') or {}).keys())
        if perfil=='SUPERVISOR':
            vis=set(ativos['SUPERVISOR'].dropna().astype(str)); sups=[s for s in sups if s in vis]
        if not sups:
            st.info('Primeiro distribua a meta por supervisor e departamento.')
        else:
            c1,c2=st.columns(2)
            sup=c1.selectbox('Supervisor',sups,key=f'gm3_rca_sup_{key}')
            mes_nome=c2.selectbox('Mês', [gm.MESES[m] for m in meses], key=f'gm3_rca_mes_{key}')
            mes=next(m for m,n in gm.MESES.items() if n==mes_nome)
            srec=cycle['supervisores'][sup]
            deps=[d for d,r in (srec.get('departamentos') or {}).items() if _safe((r.get('mensal') or {}).get(str(mes)))>0]
            if not deps:
                st.info('Primeiro distribua os departamentos deste mês.')
            else:
                dep=st.selectbox('Departamento',sorted(deps),key=f'gm3_rca_dep_{key}_{sup}_{mes}')
                alvo=_safe((srec['departamentos'][dep].get('mensal') or {}).get(str(mes)))
                st.metric(f'{dep} • {mes_nome}', brl(alvo), f'Meta do departamento em {mes_nome}')
                rh=_rca_department_history(vendas,ativos,sup,dep,ano,mes)
                rs=srec.setdefault('rcas',{})
                rows=[]
                for _,r in rh.iterrows():
                    cod=str(int(r['COD_RCA'])); nome=str(r['RCA']); w=_safe(r['_w'])/100
                    rr=rs.setdefault(cod, {'rca':nome,'criterio':'Participação histórica','justificativa':'','departamentos':{}})
                    rd=rr.setdefault('departamentos',{}).setdefault(dep,{'mensal':{}})
                    rd['mensal'].setdefault(str(mes),alvo*w)
                    rows.append({'COD_RCA':int(cod),'RCA':nome,'Participação ref. %':w*100,'Meta sugerida':alvo*w,'Meta do mês':_safe(rd['mensal'].get(str(mes)))})
                rdf=pd.DataFrame(rows)
                red=st.data_editor(rdf,use_container_width=True,hide_index=True,disabled=[c for c in rdf.columns if c!='Meta do mês'],column_config={'Participação ref. %':st.column_config.NumberColumn(format='%.2f%%'),'Meta sugerida':st.column_config.NumberColumn(format='R$ %.2f'),'Meta do mês':st.column_config.NumberColumn(format='R$ %.2f',step=10000.0)},key=f'gm3_rca_edit_{key}_{sup}_{mes}_{dep}')
                total=float(pd.to_numeric(red['Meta do mês'],errors='coerce').fillna(0).sum()); dif=alvo-total
                a,b=st.columns(2); a.metric('Distribuído aos RCAs',brl(total)); b.metric('Diferença',brl(dif))
                if st.button('Salvar RCAs deste departamento/mês',use_container_width=True,disabled=abs(dif)>0.02,key=f'gm3_save_rca_{key}_{sup}_{mes}_{dep}'):
                    for _,r in red.iterrows():
                        rr=rs[str(int(r['COD_RCA']))]
                        rr.setdefault('departamentos',{}).setdefault(dep,{'mensal':{}})['mensal'][str(mes)]=float(r['Meta do mês'])
                    _refresh_rollups(cycle,meses)
                    cycle['atualizado_em']=gm._now(); gm._event(cycle,'SALVAR_RCAS_DEPARTAMENTO_MES',usuario,f'{sup} | {dep} | {mes_nome}')
                    store['cycles'][key]=cycle; ok,msg=gm._save_store(store); (st.success if ok else st.error)(msg)
                    if ok: st.rerun()

    with tabs[4]:
        st.markdown('### 5. Aprovação — fechamento por mês e por hierarquia')
        rows=[]
        for m in meses:
            alvo,sok,dok,rok=_status_month(cycle,m)
            rows.append({'Mês':gm.MESES[m],'Meta empresa':alvo,'Supervisores':'✓' if sok else 'Pendente','Departamentos':'✓' if dok else 'Pendente','RCAs':'✓' if rok else 'Pendente','Fechado':sok and dok and rok})
        adf=pd.DataFrame(rows)
        st.dataframe(adf,use_container_width=True,hide_index=True,column_config={'Meta empresa':st.column_config.NumberColumn(format='R$ %.2f')})
        fechado = bool(rows) and all(r['Fechado'] for r in rows)
        if fechado:
            st.success('Todos os meses fecham da empresa até RCA. O ciclo está pronto para aprovação.')
        else:
            st.warning('Ainda existem meses com diferença entre os níveis. A aprovação fica bloqueada até o fechamento completo.')
        # resumo de RCA no ciclo
        resumo=[]
        for sup,srec in (cycle.get('supervisores') or {}).items():
            for cod,rr in (srec.get('rcas') or {}).items():
                total=_safe(rr.get('proposta'))
                resumo.append({'Supervisor':sup,'COD_RCA':cod,'RCA':rr.get('rca',''),'Meta do ciclo':total,'Participação no supervisor %':(total/_safe(srec.get('proposta'))*100) if _safe(srec.get('proposta')) else 0})
        if resumo:
            with st.expander('Ver consolidação dos RCAs no ciclo',expanded=False):
                st.dataframe(pd.DataFrame(resumo),use_container_width=True,hide_index=True,column_config={'Meta do ciclo':st.column_config.NumberColumn(format='R$ %.2f'),'Participação no supervisor %':st.column_config.NumberColumn(format='%.2f%%')})
        if perfil in ('ADMIN','GERENTE'):
            c1,c2,c3=st.columns(3)
            if c1.button('Enviar para análise',use_container_width=True,key=f'gm3_review_{key}'):
                cycle['status']='EM_ANALISE'; gm._event(cycle,'COLOCAR_EM_ANALISE',usuario); store['cycles'][key]=cycle; ok,msg=gm._save_store(store); (st.success if ok else st.error)(msg); st.rerun() if ok else None
            if c2.button('Solicitar ajuste',use_container_width=True,key=f'gm3_adjust_{key}'):
                cycle['status']='AJUSTE_SOLICITADO'; gm._event(cycle,'SOLICITAR_AJUSTE',usuario); store['cycles'][key]=cycle; ok,msg=gm._save_store(store); (st.success if ok else st.error)(msg); st.rerun() if ok else None
            if c3.button('✓ Aprovar e fechar ciclo',use_container_width=True,disabled=not fechado,key=f'gm3_approve_{key}'):
                cycle['status']='APROVADO'; cycle.setdefault('versoes',[]).append(gm._snapshot(cycle)); gm._event(cycle,'APROVAR_CICLO',usuario); store['cycles'][key]=cycle; ok,msg=gm._save_store(store); (st.success if ok else st.error)(msg); st.rerun() if ok else None


def aplicar_gestao_mensal_v2():
    if not hasattr(gm, '_render_gestao_metas_legacy'):
        gm._render_gestao_metas_legacy = gm.render_gestao_metas
    gm.render_gestao_metas = render_gestao_metas_mensal

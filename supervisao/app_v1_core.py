from pathlib import Path

_app = Path(__file__).with_name('app_v2.py')
source = _app.read_text(encoding='utf-8')

# A base de vendas muda ao longo do mês: preservar cache_data com TTL do app_v2.
# O GeoJSON é estável e pode continuar como recurso em memória.
source = source.replace("@st.cache_data(ttl=86400, show_spinner=False)", "@st.cache_resource(show_spinner=False)")
source = source.replace("BASE_VENDAS_VERSAO = 'Produto (16)'", "BASE_VENDAS_VERSAO = 'BASE_VENDAS_SUPERVISAO'")

# Filtro temporal global: Ano -> Mês, ambos com opção Todos.
source = source.replace(
"""ativos = rcas[rcas['ATIVO'].eq('S')].copy()
meses = sorted(set(vendas.loc[vendas.FATURADO,'MES_FAT'].dropna().astype(str)) | set(metas.MES.dropna().astype(str)), reverse=True)
mes = st.sidebar.selectbox('Mês de análise', meses, index=meses.index('2026-08') if '2026-08' in meses else 0, format_func=mes_nome)

sups = sorted(ativos.SUPERVISOR.dropna().unique())
ss = st.sidebar.multiselect('Supervisor', sups, default=[], placeholder='Todos os supervisores')
ss_eff = ss or sups
ro = sorted(ativos.loc[ativos.SUPERVISOR.isin(ss_eff),'RCA'].dropna().unique())
rs = st.sidebar.multiselect('RCA', ro, default=[], placeholder='Todos os RCAs')
rs_eff = rs or ro

deps = sorted(set(vendas.loc[vendas.MES_FAT.eq(mes),'DEPARTAMENTO'].dropna().astype(str)) | set(metas.loc[metas.MES.eq(mes),'DEPARTAMENTO'].dropna().astype(str)))
ds = st.sidebar.multiselect('Departamento', deps, default=[], placeholder='Todos os departamentos')
ds_eff = ds or deps
st.sidebar.caption('Seleções vazias significam “Todos”.')

cods = set(ativos.loc[ativos.SUPERVISOR.isin(ss_eff) & ativos.RCA.isin(rs_eff),'COD_RCA'].dropna())
fat = vendas[vendas.FATURADO & vendas.MES_FAT.eq(mes) & vendas.COD_RCA.isin(cods) & vendas.DEPARTAMENTO.astype(str).isin(ds_eff)].copy()
meta = metas[metas.MES.eq(mes) & metas.COD_RCA.isin(cods) & metas.DEPARTAMENTO.astype(str).isin(ds_eff)].copy()
meta = meta.merge(ativos[['COD_RCA','RCA','SUPERVISOR']].drop_duplicates('COD_RCA'), on='COD_RCA', how='left')
""",
"""ativos = rcas[rcas['ATIVO'].eq('S')].copy()

vendas['ANO_FAT'] = vendas['DATA_FAT'].dt.year.astype('Int64')
metas['ANO'] = pd.to_numeric(metas['MES'].astype(str).str[:4], errors='coerce').astype('Int64')
metas['MES_NUM'] = pd.to_numeric(metas['MES'].astype(str).str[5:7], errors='coerce').astype('Int64')

anos_disp = sorted(set(vendas.loc[vendas.FATURADO,'ANO_FAT'].dropna().astype(int)) | set(metas['ANO'].dropna().astype(int)), reverse=True)
ano_opts = ['Todos'] + [str(x) for x in anos_disp]

# Ao abrir o dashboard, iniciar sempre no mês corrente.
_agora_filtro = pd.Timestamp.now(tz='America/Fortaleza')
_ano_atual_filtro = int(_agora_filtro.year)
_mes_atual_filtro = int(_agora_filtro.month)

_ano_padrao = str(_ano_atual_filtro) if _ano_atual_filtro in anos_disp else (str(anos_disp[0]) if anos_disp else 'Todos')
if 'filtro_ano_analise' not in st.session_state:
    st.session_state['filtro_ano_analise'] = _ano_padrao
ano_sel = st.sidebar.selectbox(
    'Ano de análise',
    ano_opts,
    key='filtro_ano_analise'
)

meses_nome = {
    'Janeiro':1, 'Fevereiro':2, 'Março':3, 'Abril':4, 'Maio':5, 'Junho':6,
    'Julho':7, 'Agosto':8, 'Setembro':9, 'Outubro':10, 'Novembro':11, 'Dezembro':12
}
mes_opts = list(meses_nome.keys())
_mes_por_numero = {v:k for k,v in meses_nome.items()}

if 'filtro_mes_analise' not in st.session_state:
    if ano_sel == str(_ano_atual_filtro):
        st.session_state['filtro_mes_analise'] = [_mes_por_numero[_mes_atual_filtro]]
    else:
        _meses_disp_ano = sorted(
            set(vendas.loc[
                vendas.FATURADO & vendas['DATA_FAT'].dt.year.eq(int(ano_sel)),
                'DATA_FAT'
            ].dropna().dt.month.astype(int))
            | set(metas.loc[metas['ANO'].eq(int(ano_sel)), 'MES_NUM'].dropna().astype(int))
        )
        st.session_state['filtro_mes_analise'] = (
            [_mes_por_numero[_meses_disp_ano[-1]]] if _meses_disp_ano else []
        )

mes_sel = st.sidebar.multiselect(
    'Mês de análise',
    mes_opts,
    key='filtro_mes_analise',
    placeholder='Todos os meses'
)
mes_nums = {meses_nome[m] for m in mes_sel}

def periodo_mask_datas(serie):
    m = serie.notna()
    if ano_sel != 'Todos':
        m &= serie.dt.year.eq(int(ano_sel))
    if mes_nums:
        m &= serie.dt.month.isin(mes_nums)
    return m

def periodo_mask_metas(df):
    m = pd.Series(True, index=df.index)
    if ano_sel != 'Todos':
        m &= df['ANO'].eq(int(ano_sel))
    if mes_nums:
        m &= df['MES_NUM'].isin(mes_nums)
    return m

if ano_sel == 'Todos' and not mes_sel:
    periodo_label = 'Todo o histórico'
elif ano_sel != 'Todos' and not mes_sel:
    periodo_label = f'Ano {ano_sel}'
elif ano_sel == 'Todos':
    periodo_label = ' + '.join(mes_sel) + ' • todos os anos'
else:
    periodo_label = ' + '.join(mes_sel) + f'/{ano_sel}'

sups = sorted(ativos.SUPERVISOR.dropna().unique())
ss = st.sidebar.multiselect('Supervisor', sups, default=[], placeholder='Todos os supervisores')
ss_eff = ss or sups
ro = sorted(ativos.loc[ativos.SUPERVISOR.isin(ss_eff),'RCA'].dropna().unique())
rs = st.sidebar.multiselect('RCA', ro, default=[], placeholder='Todos os RCAs')
rs_eff = rs or ro

mask_v_periodo = vendas.FATURADO & periodo_mask_datas(vendas['DATA_FAT'])
mask_m_periodo = periodo_mask_metas(metas)
deps = sorted(set(vendas.loc[mask_v_periodo,'DEPARTAMENTO'].dropna().astype(str)) | set(metas.loc[mask_m_periodo,'DEPARTAMENTO'].dropna().astype(str)))
ds = st.sidebar.multiselect('Departamento', deps, default=[], placeholder='Todos os departamentos')
ds_eff = ds or deps
st.sidebar.caption('Seleções vazias significam “Todos”.')

cods = set(ativos.loc[ativos.SUPERVISOR.isin(ss_eff) & ativos.RCA.isin(rs_eff),'COD_RCA'].dropna())
fat = vendas[mask_v_periodo & vendas.COD_RCA.isin(cods) & vendas.DEPARTAMENTO.astype(str).isin(ds_eff)].copy()
meta = metas[mask_m_periodo & metas.COD_RCA.isin(cods) & metas.DEPARTAMENTO.astype(str).isin(ds_eff)].copy()
meta = meta.merge(ativos[['COD_RCA','RCA','SUPERVISOR']].drop_duplicates('COD_RCA'), on='COD_RCA', how='left')
"""
)

# Clientes novos e inativos respeitam o período selecionado.
source = source.replace(
"""hist = vendas[vendas.FATURADO & vendas.CODCLI.notna()].copy()
primeira = hist.groupby('CODCLI',as_index=False)['DATA_FAT'].min().rename(columns={'DATA_FAT':'PRIMEIRA_COMPRA'})
novos_mes = fat[['COD_RCA','CODCLI']].drop_duplicates().merge(primeira,on='CODCLI',how='left')
novos_mes['NOVO'] = novos_mes['PRIMEIRA_COMPRA'].dt.to_period('M').astype('string').eq(mes)
nr = novos_mes.groupby('COD_RCA')['NOVO'].sum().rename('NOVOS').reset_index()

fim = pd.Period(mes).end_time.normalize()
vida = hist.groupby('CODCLI',as_index=False).DATA_FAT.max().rename(columns={'DATA_FAT':'ULTIMA'})
""",
"""hist = vendas[vendas.FATURADO & vendas.CODCLI.notna()].copy()
primeira = hist.groupby('CODCLI',as_index=False)['DATA_FAT'].min().rename(columns={'DATA_FAT':'PRIMEIRA_COMPRA'})
novos_mes = fat[['COD_RCA','CODCLI']].drop_duplicates().merge(primeira,on='CODCLI',how='left')
novos_mes['NOVO'] = periodo_mask_datas(novos_mes['PRIMEIRA_COMPRA'])
nr = novos_mes.groupby('COD_RCA')['NOVO'].sum().rename('NOVOS').reset_index()

hist_periodo = hist[periodo_mask_datas(hist['DATA_FAT'])]
fim = hist_periodo['DATA_FAT'].max() if not hist_periodo.empty else hist['DATA_FAT'].max()
vida = hist[hist['DATA_FAT'].le(fim)].groupby('CODCLI',as_index=False).DATA_FAT.max().rename(columns={'DATA_FAT':'ULTIMA'})
"""
)

source = source.replace("'Clientes únicos no mês'", "f'Clientes únicos • {periodo_label}'")
source = source.replace("'Primeira compra encontrada em 2026'", "f'Primeira compra • {periodo_label}'")
source = source.replace("'Clientes que compraram no mês'", "f'Clientes que compraram • {periodo_label}'")
source = source.replace("st.caption(f'Fonte de vendas: {BASE_VENDAS_VERSAO} • Competência definida pela Data de Faturamento.')", "st.caption(f'Fonte de vendas: {BASE_VENDAS_VERSAO} • Período: {periodo_label} • Competência definida pela Data de Faturamento.')")

prefix, _rest = source.split("\nelif pagina_dashboard == 'Cidades':\n", 1)

aba4 = r'''
elif pagina_dashboard == 'Cidades':
    st.subheader('Cobertura municipal — Nordeste')
    st.markdown("<div class='section-note'>A cidade é definida pela praça da própria venda (MUNICENT) e o estado por ESTENT. Os filtros de ano, mês, supervisor, RCA e departamento atualizam automaticamente o mapa e os indicadores.</div>", unsafe_allow_html=True)

    if fat.empty:
        st.info('Sem faturamento para o recorte selecionado.')
    elif not {'MUNICENT','ESTENT'}.issubset(fat.columns):
        st.warning('A base de vendas não contém as colunas MUNICENT e ESTENT necessárias para o mapa.')
    else:
        from difflib import SequenceMatcher
        import re

        nomes_uf = {
            'Nordeste': None,
            'Alagoas (AL)': 'AL', 'Bahia (BA)': 'BA', 'Ceará (CE)': 'CE',
            'Maranhão (MA)': 'MA', 'Paraíba (PB)': 'PB', 'Pernambuco (PE)': 'PE',
            'Piauí (PI)': 'PI', 'Rio Grande do Norte (RN)': 'RN', 'Sergipe (SE)': 'SE',
        }
        estado_label = st.selectbox('Filtrar por estado', list(nomes_uf.keys()), index=0, key='estado_mapa')
        estado_uf = nomes_uf[estado_label]

        loc = fat.copy()
        loc['UF'] = loc['ESTENT'].astype(str).str.upper().str.strip()
        loc['CIDADE'] = loc['MUNICENT'].astype(str).str.strip()
        loc = loc[loc.UF.isin(NE_CODES)].copy()
        if estado_uf:
            loc = loc[loc.UF.eq(estado_uf)].copy()

        geojson_all = load_nordeste_geojson()
        all_features = geojson_all['features']

        def cidade_solto(v):
            s = norm(v)
            s = re.sub(r'[^A-Z0-9 ]+', ' ', s)
            toks = [t for t in s.split() if t not in {'DO','DA','DE','DOS','DAS'}]
            return ' '.join(toks)

        oficiais = {}
        for ft in all_features:
            pr = ft.get('properties', {})
            uf = str(pr.get('uf','')).upper().strip()
            nome = pr.get('name','')
            if uf and nome:
                oficiais.setdefault(uf, []).append({'nome':nome,'norm':norm(nome),'solto':cidade_solto(nome),'key':pr.get('key', f'{uf}|{norm(nome)}')})

        def resolver_cidade(uf, cidade):
            uf = str(uf or '').upper().strip(); bruto = norm(cidade)

            # Alias conhecido na base comercial:
            # PINRETAMA é Pindoretama/CE. Sem esta correção parte do
            # faturamento ficava fora do município no mapa.
            aliases = {
                ('CE', 'PINRETAMA'): 'PINDORETAMA',
            }
            bruto = aliases.get((uf, bruto), bruto)
            solto = cidade_solto(bruto)
            cands = oficiais.get(uf, [])
            if not bruto or not cands: return f'{uf}|{bruto}', cidade, 'sem_correspondencia'
            ex = [c for c in cands if c['norm'] == bruto]
            if len(ex) == 1: return ex[0]['key'], ex[0]['nome'], 'exato'
            ex2 = [c for c in cands if c['solto'] == solto]
            if len(ex2) == 1: return ex2[0]['key'], ex2[0]['nome'], 'sem_artigos'
            pref = [c for c in cands if min(len(solto), len(c['solto'])) >= 8 and (c['solto'].startswith(solto) or solto.startswith(c['solto']))]
            if len(pref) == 1: return pref[0]['key'], pref[0]['nome'], 'truncado'
            scores = sorted(((SequenceMatcher(None, solto, c['solto']).ratio(), c) for c in cands), key=lambda x:x[0], reverse=True)
            if scores:
                melhor,cand=scores[0]; segundo=scores[1][0] if len(scores)>1 else 0
                if melhor>=0.88 and (melhor-segundo>=0.04 or melhor>=0.95): return cand['key'], cand['nome'], 'aproximado'
            return f'{uf}|{bruto}', cidade, 'sem_correspondencia'

        pares = loc[['UF','CIDADE']].drop_duplicates().copy()
        resolvidos = pares.apply(lambda x: resolver_cidade(x['UF'], x['CIDADE']), axis=1)
        pares['KEY']=[x[0] for x in resolvidos]; pares['CIDADE_OFICIAL']=[x[1] for x in resolvidos]; pares['MATCH_CIDADE']=[x[2] for x in resolvidos]
        loc=loc.merge(pares,on=['UF','CIDADE'],how='left'); loc['CIDADE_ORIGINAL']=loc['CIDADE']; loc['CIDADE']=loc['CIDADE_OFICIAL'].fillna(loc['CIDADE'])

        city = loc.groupby(['KEY','CIDADE','UF'], dropna=False).agg(FATURAMENTO=('VALOR','sum'),CLIENTES=('CODCLI','nunique'),PEDIDOS=('NUMPED','nunique'),PRODUTOS=('CODPROD','nunique')).reset_index()
        cmix = loc.groupby(['KEY','CODCLI']).CODPROD.nunique().rename('MIXCLI').reset_index(); cmix=cmix.groupby('KEY').MIXCLI.mean().rename('MIX').reset_index(); city=city.merge(cmix,on='KEY',how='left')

        features=all_features
        if estado_uf: features=[ft for ft in features if ft.get('properties',{}).get('uf')==estado_uf]
        geojson={'type':'FeatureCollection','features':features}
        munis=pd.DataFrame([{'KEY':ft['properties']['key'],'CIDADE_MAPA':ft['properties'].get('name',''),'UF_MAPA':ft['properties'].get('uf','')} for ft in features])

        # Validação de integridade: nenhuma praça com faturamento pode ficar
        # fora do GeoJSON sem que o usuário seja avisado.
        chaves_mapa = set(munis['KEY'].dropna().astype(str))
        inconsistencias_mapa = city[
            city['FATURAMENTO'].abs().gt(0)
            & ~city['KEY'].astype(str).isin(chaves_mapa)
        ].copy()
        if not inconsistencias_mapa.empty:
            nomes_inconsistentes = ', '.join(
                inconsistencias_mapa.sort_values('FATURAMENTO', ascending=False)
                .apply(lambda x: f"{x['CIDADE']} - {x['UF']}", axis=1)
                .head(8)
                .tolist()
            )
            st.warning(
                f"Validação do mapa: {len(inconsistencias_mapa)} praça(s) com faturamento "
                f"não foram vinculadas a um município. Revise: {nomes_inconsistentes}."
            )

        mapa=munis.merge(city,on='KEY',how='left'); mapa['CIDADE']=mapa['CIDADE'].fillna(mapa['CIDADE_MAPA']); mapa['UF']=mapa['UF'].fillna(mapa['UF_MAPA'])
        for c in ['FATURAMENTO','CLIENTES','PEDIDOS','PRODUTOS','MIX']: mapa[c]=pd.to_numeric(mapa[c],errors='coerce').fillna(0)

        vendidos=city[city.FATURAMENTO.gt(0)].copy(); maior=vendidos.loc[vendidos.FATURAMENTO.idxmax(),'CIDADE'] if len(vendidos) else '—'; titulo_regiao=estado_label if estado_uf else 'Nordeste'
        z1,z2,z3,z4,z5=st.columns(5)
        z1.markdown(kpi('Cidades atendidas',nint(vendidos.shape[0]),periodo_label),unsafe_allow_html=True)
        z2.markdown(kpi('Clientes',nint(loc.CODCLI.nunique()),'Positivados no mapa'),unsafe_allow_html=True)
        z3.markdown(kpi('Produtos distintos',nint(loc.CODPROD.nunique()),'Códigos vendidos'),unsafe_allow_html=True)
        z4.markdown(kpi('Maior cidade',maior,'Por faturamento'),unsafe_allow_html=True)
        z5.markdown(kpi(f'Faturamento {estado_uf or "Nordeste"}',brl_compacto(city.FATURAMENTO.sum()),periodo_label),unsafe_allow_html=True)

        metrica_mapa = st.radio(
            'Colorir mapa por',
            ['Faturamento','Clientes','Produtos'],
            horizontal=True,
            label_visibility='collapsed',
            key=f'metrica_mapa_{estado_uf or "ne"}'
        )
        mapa_sem=mapa[mapa.FATURAMENTO.le(0)].copy(); mapa_com=mapa[mapa.FATURAMENTO.gt(0)].copy(); fig=go.Figure()
        if not mapa_sem.empty:
            custom_sem=mapa_sem[['CIDADE','UF','FATURAMENTO','CLIENTES','PEDIDOS','PRODUTOS','MIX']].to_numpy(); fig.add_trace(go.Choropleth(geojson=geojson,locations=mapa_sem.KEY,z=[0]*len(mapa_sem),featureidkey='properties.key',zmin=0,zmax=1,colorscale=[[0,'#E7DDD1'],[1,'#E7DDD1']],showscale=False,marker_line_color='#AFA8A0',marker_line_width=.65 if estado_uf else .4,customdata=custom_sem,hovertemplate='<b>%{customdata[0]} - %{customdata[1]}</b><br><b>Sem faturamento no período</b><extra></extra>',name='Sem faturamento'))
        if not mapa_com.empty:
            campo_mapa = {'Faturamento':'FATURAMENTO','Clientes':'CLIENTES','Produtos':'PRODUTOS'}[metrica_mapa]
            titulo_cor = {'Faturamento':'Faturamento (R$)','Clientes':'Clientes','Produtos':'Produtos'}[metrica_mapa]
            zvals = mapa_com[campo_mapa]
            zmax=max(float(zvals.quantile(.95)),1.0)
            custom_com=mapa_com[['CIDADE','UF','FATURAMENTO','CLIENTES','PEDIDOS','PRODUTOS','MIX']].to_numpy()
            fig.add_trace(go.Choropleth(geojson=geojson,locations=mapa_com.KEY,z=zvals,featureidkey='properties.key',zmin=0,zmax=zmax,colorscale=[[0.00,'#E6EAF6'],[0.18,'#D3DAEE'],[0.40,'#A8B4D9'],[0.65,'#7080B7'],[0.82,'#42548D'],[1.00,NAVY]],marker_line_color='#8994B6',marker_line_width=.65 if estado_uf else .4,customdata=custom_com,colorbar=dict(title=titulo_cor,thickness=12,len=.34,orientation='h',x=.72,y=.01,xanchor='center',yanchor='bottom'),hovertemplate='<b>%{customdata[0]} - %{customdata[1]}</b><br>Faturamento: R$ %{customdata[2]:,.2f}<br>Clientes: %{customdata[3]:.0f}<br>Pedidos: %{customdata[4]:.0f}<br>Produtos: %{customdata[5]:.0f}<br>Mix: %{customdata[6]:.2f}<extra></extra>',name=metrica_mapa))

        fig.update_geos(fitbounds='locations',visible=False,projection_type='mercator',bgcolor='rgba(0,0,0,0)'); fig.update_layout(height=980,margin=dict(l=0,r=0,t=0,b=0),paper_bgcolor='rgba(0,0,0,0)',dragmode=False,showlegend=True,legend=dict(orientation='h',x=.01,y=.01,xanchor='left',yanchor='bottom',bgcolor='rgba(255,255,255,.88)',bordercolor='#E1E3EA',borderwidth=1))

        selected_key=None; col_map,col_det=st.columns([1.45,1],gap='large')
        with col_map:
            try:
                ev=st.plotly_chart(fig,use_container_width=True,on_select='rerun',selection_mode='points',key=f'mapa_{estado_uf or "ne"}_{ano_sel}_{"_".join(mes_sel) if mes_sel else "todos"}'); sel=getattr(ev,'selection',None); pts=getattr(sel,'points',None) if sel is not None else None
                if pts and isinstance(pts[0],dict): selected_key=pts[0].get('location')
            except Exception:
                st.plotly_chart(fig,use_container_width=True,key=f'mapa_fb_{estado_uf or "ne"}_{ano_sel}_{"_".join(mes_sel) if mes_sel else "todos"}')

        labels_df=city[['KEY','CIDADE','UF','FATURAMENTO']].copy()
        labels_df['LABEL']=labels_df.CIDADE.astype(str)+' - '+labels_df.UF.astype(str)
        labels_df=labels_df.sort_values(['UF','CIDADE'])
        labels=['Todos'] + labels_df.LABEL.tolist()
        key_to_label=dict(zip(labels_df.KEY,labels_df.LABEL))
        default_label=key_to_label.get(selected_key,'Todos')

        with col_det:
            st.markdown("<div style='font-size:12px;color:#737A8C;margin-bottom:2px;'>Cidade selecionada</div>",unsafe_allow_html=True)
            idx=labels.index(default_label) if default_label in labels else 0
            choice=st.selectbox(
                'Cidade',
                labels,
                index=idx,
                label_visibility='collapsed',
                key=f'cidade_{estado_uf or "ne"}_{ano_sel}_{"_".join(mes_sel) if mes_sel else "todos"}_{selected_key or "manual"}'
            )
            if choice:
                _todas_cidades = choice == 'Todos'
                if _todas_cidades:
                    key='TODOS'
                    d=loc.copy()
                    titulo_contexto = 'Visão geral da área selecionada'
                else:
                    row=labels_df.loc[labels_df.LABEL.eq(choice)].iloc[0]
                    key=row.KEY
                    d=loc[loc.KEY.eq(key)].copy()
                    titulo_contexto = f"{row.CIDADE} - {row.UF}"

                dcli=d.groupby('CODCLI').agg(
                    PRODUTOS=('CODPROD','nunique'),
                    FATURAMENTO=('VALOR','sum'),
                    PEDIDOS=('NUMPED','nunique')
                ).reset_index()
                st.markdown(
                    f"<div style='font-size:22px;font-weight:800;color:{NAVY};margin:4px 0 12px 0;'>{titulo_contexto}</div>",
                    unsafe_allow_html=True
                )
                part=d.VALOR.sum()/city.FATURAMENTO.sum()*100 if city.FATURAMENTO.sum() else 0
                a1,a2,a3=st.columns(3)
                a1.markdown(kpi('Faturamento',brl_compacto(d.VALOR.sum()),brl(d.VALOR.sum())),unsafe_allow_html=True)
                a2.markdown(kpi('Clientes positivados',nint(d.CODCLI.nunique()),periodo_label),unsafe_allow_html=True)
                a3.markdown(kpi('Produtos distintos',nint(d.CODPROD.nunique()),'Códigos vendidos'),unsafe_allow_html=True)
                b1,b2,b3=st.columns(3)
                b1.markdown(kpi('Pedidos',nint(d.NUMPED.nunique()),periodo_label),unsafe_allow_html=True)
                b2.markdown(kpi('Mix médio',dec(dcli.PRODUTOS.mean()),'Produtos/cliente'),unsafe_allow_html=True)
                b3.markdown(kpi('Participação',pct(part),titulo_regiao),unsafe_allow_html=True)

                # Pontos de atenção contextuais: mudam conforme período, RCA,
                # supervisor, departamento e cidade selecionados.
                st.markdown('### Pontos críticos do recorte')

                _contexto_partes = []
                if len(rs) == 1:
                    _contexto_partes.append(f"RCA {rs[0]}")
                elif len(ss) == 1:
                    _contexto_partes.append(f"Supervisão {ss[0]}")
                if len(ds) == 1:
                    _contexto_partes.append(str(ds[0]))
                if not _todas_cidades:
                    _contexto_partes.append(titulo_contexto)
                _contexto_label = ' • '.join(_contexto_partes) if _contexto_partes else 'Recorte geral'

                # Histórico do mesmo escopo para comparações temporais.
                hist_att = vendas[
                    vendas['FATURADO']
                    & vendas['COD_RCA'].isin(cods)
                    & vendas['DEPARTAMENTO'].astype(str).isin(ds_eff)
                ].copy()
                hist_att['UF'] = hist_att['ESTENT'].astype(str).str.upper().str.strip()
                hist_att['CIDADE'] = hist_att['MUNICENT'].astype(str).str.strip()
                hist_att = hist_att[hist_att['UF'].isin(NE_CODES)].copy()
                if estado_uf:
                    hist_att = hist_att[hist_att['UF'].eq(estado_uf)].copy()

                if not hist_att.empty:
                    pares_att = hist_att[['UF','CIDADE']].drop_duplicates().copy()
                    res_att = pares_att.apply(lambda x: resolver_cidade(x['UF'], x['CIDADE']), axis=1)
                    pares_att['KEY'] = [x[0] for x in res_att]
                    hist_att = hist_att.merge(pares_att[['UF','CIDADE','KEY']],on=['UF','CIDADE'],how='left')

                hist_att_area = hist_att.copy()
                if not _todas_cidades and not hist_att.empty:
                    hist_att = hist_att[hist_att['KEY'].eq(key)].copy()

                _insights_city = []

                # 1) Monta o período de referência equivalente ao recorte atual.
                _fat_atual_ctx = float(d['VALOR'].sum())
                _ref_label = None
                _ref_mask_ctx = None
                _ref_mask_area = None

                if ano_sel != 'Todos' and len(mes_sel) == 1:
                    _mes_num = meses_nome[mes_sel[0]]
                    _inicio_atual = pd.Timestamp(int(ano_sel), int(_mes_num), 1)
                    _inicio_ref = _inicio_atual - pd.DateOffset(months=1)
                    _fim_ref = _inicio_ref + pd.offsets.MonthEnd(0)
                    _ref_mask_ctx = hist_att['DATA_FAT'].between(_inicio_ref,_fim_ref,inclusive='both') if not hist_att.empty else pd.Series(False,index=hist_att.index)
                    _ref_mask_area = hist_att_area['DATA_FAT'].between(_inicio_ref,_fim_ref,inclusive='both') if not hist_att_area.empty else pd.Series(False,index=hist_att_area.index)
                    _ref_label = 'mês anterior'

                elif ano_sel != 'Todos' and not mes_sel:
                    _max_atual = d['DATA_FAT'].max()
                    if pd.notna(_max_atual):
                        _inicio_ref = pd.Timestamp(int(ano_sel)-1,1,1)
                        _fim_ref = pd.Timestamp(int(ano_sel)-1,int(_max_atual.month),int(_max_atual.day))
                        _ref_mask_ctx = hist_att['DATA_FAT'].between(_inicio_ref,_fim_ref,inclusive='both') if not hist_att.empty else pd.Series(False,index=hist_att.index)
                        _ref_mask_area = hist_att_area['DATA_FAT'].between(_inicio_ref,_fim_ref,inclusive='both') if not hist_att_area.empty else pd.Series(False,index=hist_att_area.index)
                        _ref_label = f'mesmo período de {int(ano_sel)-1}'

                elif ano_sel != 'Todos' and mes_sel:
                    _mes_nums_sel = {meses_nome[m] for m in mes_sel}
                    _ref_mask_ctx = (
                        hist_att['DATA_FAT'].dt.year.eq(int(ano_sel)-1)
                        & hist_att['DATA_FAT'].dt.month.isin(_mes_nums_sel)
                    ) if not hist_att.empty else pd.Series(False,index=hist_att.index)
                    _ref_mask_area = (
                        hist_att_area['DATA_FAT'].dt.year.eq(int(ano_sel)-1)
                        & hist_att_area['DATA_FAT'].dt.month.isin(_mes_nums_sel)
                    ) if not hist_att_area.empty else pd.Series(False,index=hist_att_area.index)
                    _ref_label = f'mesmos meses de {int(ano_sel)-1}'

                hist_ref_ctx = (
                    hist_att.loc[_ref_mask_ctx].copy()
                    if _ref_mask_ctx is not None and not hist_att.empty
                    else hist_att.iloc[0:0].copy()
                )
                hist_ref_area = (
                    hist_att_area.loc[_ref_mask_area].copy()
                    if _ref_mask_area is not None and not hist_att_area.empty
                    else hist_att_area.iloc[0:0].copy()
                )

                # 2) Queda geral do recorte — só aparece quando for negativa.
                _fat_ref_ctx = float(hist_ref_ctx['VALOR'].sum()) if not hist_ref_ctx.empty else 0.0
                if _fat_ref_ctx > 0:
                    _var_ctx = (_fat_atual_ctx/_fat_ref_ctx - 1)*100
                    if _var_ctx < 0:
                        _insights_city.append({
                            'classe':'critical' if _var_ctx <= -10 else 'attention',
                            'nivel':'Crítico' if _var_ctx <= -10 else 'Atenção',
                            'kicker':'Queda do faturamento',
                            'valor':pct(_var_ctx),
                            'texto':f"versus {_ref_label}",
                            'rodape':_contexto_label,
                            'prioridade':1,
                        })

                # 3) Produto que perdeu força: olha primeiro os produtos que eram
                # relevantes no período de referência e identifica a maior queda.
                if not hist_ref_ctx.empty:
                    _prod_ref = (
                        hist_ref_ctx.groupby('CODPROD',as_index=False)
                        .agg(PRODUTO=('PRODUTO_NOME','first'), REF=('VALOR','sum'))
                        .sort_values('REF',ascending=False)
                    )
                    _prod_atual = (
                        d.groupby('CODPROD',as_index=False)
                        .agg(ATUAL=('VALOR','sum'))
                    )
                    _prod_queda = _prod_ref.head(15).merge(_prod_atual,on='CODPROD',how='left').fillna({'ATUAL':0})
                    _prod_queda = _prod_queda[_prod_queda['REF'].gt(0)].copy()
                    if not _prod_queda.empty:
                        _prod_queda['VAR'] = (_prod_queda['ATUAL']/_prod_queda['REF']-1)*100
                        _pq = _prod_queda.sort_values(['VAR','REF'],ascending=[True,False]).iloc[0]
                        if float(_pq['VAR']) < 0:
                            _insights_city.append({
                                'classe':'critical' if float(_pq['VAR']) <= -25 else 'attention',
                                'nivel':'Crítico' if float(_pq['VAR']) <= -25 else 'Atenção',
                                'kicker':'Produto em queda',
                                'valor':pct(float(_pq['VAR'])),
                                'texto':str(_pq['PRODUTO']),
                                'rodape':f"{brl_compacto(_pq['REF'])} → {brl_compacto(_pq['ATUAL'])} • {_ref_label}",
                                'prioridade':1,
                            })

                # 4) Quando a visão estiver em "Todos", evidencia a cidade de menor
                # faturamento e também a cidade com a maior queda contra a referência.
                if _todas_cidades:
                    _city_atual = (
                        d.groupby(['KEY','CIDADE','UF'],as_index=False)['VALOR']
                        .sum()
                        .rename(columns={'VALOR':'ATUAL'})
                    )

                    _city_vendas = _city_atual[_city_atual['ATUAL'].gt(0)].copy()
                    if len(_city_vendas) > 1:
                        _cmin = _city_vendas.sort_values('ATUAL').iloc[0]
                        _med_city = float(_city_vendas['ATUAL'].median())
                        _abaixo_med = (float(_cmin['ATUAL'])/_med_city-1)*100 if _med_city else 0
                        _insights_city.append({
                            'classe':'attention',
                            'nivel':'Atenção',
                            'kicker':'Menor faturamento por cidade',
                            'valor':brl_compacto(_cmin['ATUAL']),
                            'texto':f"{_cmin['CIDADE']} - {_cmin['UF']}",
                            'rodape':f"{pct(abs(_abaixo_med))} abaixo da mediana das cidades com venda" if _abaixo_med < 0 else 'Menor faturamento do recorte',
                            'prioridade':2,
                        })

                    if not hist_ref_area.empty:
                        _city_ref = (
                            hist_ref_area.groupby('KEY',as_index=False)['VALOR']
                            .sum()
                            .rename(columns={'VALOR':'REF'})
                        )
                        _city_cmp = _city_atual.merge(_city_ref,on='KEY',how='outer').fillna({'ATUAL':0,'REF':0})
                        _city_cmp = _city_cmp[_city_cmp['REF'].gt(0)].copy()
                        if not _city_cmp.empty:
                            _city_cmp['VAR'] = (_city_cmp['ATUAL']/_city_cmp['REF']-1)*100
                            _cq = _city_cmp.sort_values(['VAR','REF'],ascending=[True,False]).iloc[0]
                            if float(_cq['VAR']) < 0:
                                _insights_city.append({
                                    'classe':'critical' if float(_cq['VAR']) <= -25 else 'attention',
                                    'nivel':'Crítico' if float(_cq['VAR']) <= -25 else 'Atenção',
                                    'kicker':'Cidade com maior queda',
                                    'valor':pct(float(_cq['VAR'])),
                                    'texto':f"{_cq['CIDADE']} - {_cq['UF']}",
                                    'rodape':f"{brl_compacto(_cq['REF'])} → {brl_compacto(_cq['ATUAL'])} • {_ref_label}",
                                    'prioridade':1,
                                })

                # 5) Riscos de concentração: só entram se ultrapassarem limites
                # realmente relevantes, para manter o foco em pontos críticos.
                _prod_ctx = d.groupby('CODPROD',as_index=False).agg(
                    PRODUTO=('PRODUTO_NOME','first'),
                    FATURAMENTO=('VALOR','sum')
                ).sort_values('FATURAMENTO',ascending=False)

                if not _prod_ctx.empty and _fat_atual_ctx > 0:
                    _pctx = _prod_ctx.iloc[0]
                    _part_prod = float(_pctx['FATURAMENTO'])/_fat_atual_ctx*100
                    if _part_prod >= 40:
                        _insights_city.append({
                            'classe':'critical' if _part_prod >= 55 else 'attention',
                            'nivel':'Crítico' if _part_prod >= 55 else 'Atenção',
                            'kicker':'Concentração em um produto',
                            'valor':pct(_part_prod),
                            'texto':str(_pctx['PRODUTO']),
                            'rodape':f"{brl_compacto(_pctx['FATURAMENTO'])} do faturamento do recorte",
                            'prioridade':2,
                        })

                if not _todas_cidades:
                    _cli_ctx = d.groupby('CODCLI',as_index=False)['VALOR'].sum().sort_values('VALOR',ascending=False)
                    if not _cli_ctx.empty and _fat_atual_ctx > 0:
                        _clctx = _cli_ctx.iloc[0]
                        _part_cli = float(_clctx['VALOR'])/_fat_atual_ctx*100
                        if _part_cli >= 50:
                            _insights_city.append({
                                'classe':'critical' if _part_cli >= 70 else 'attention',
                                'nivel':'Crítico' if _part_cli >= 70 else 'Atenção',
                                'kicker':'Concentração no maior cliente',
                                'valor':pct(_part_cli),
                                'texto':'Participação do maior cliente da cidade',
                                'rodape':f"{brl_compacto(_clctx['VALOR'])} no período",
                                'prioridade':2,
                            })

                # Ordena os alertas para mostrar primeiro perdas e quedas.
                _insights_city = sorted(
                    _insights_city,
                    key=lambda x: (
                        0 if x.get('classe') == 'critical' else 1,
                        x.get('prioridade',9)
                    )
                )

                if _insights_city:
                    _cols_ins = st.columns(min(4,len(_insights_city)),gap='medium')
                    for _ii,_ins in enumerate(_insights_city[:4]):
                        with _cols_ins[_ii]:
                            st.markdown(
                                f"""
                                <div class="insight-card {_ins['classe']}" style="min-height:175px;">
                                  <div class="insight-badge">● {_ins['nivel']}</div>
                                  <div class="insight-kicker">{_ins['kicker']}</div>
                                  <div class="insight-value">{_ins['valor']}</div>
                                  <div class="insight-secondary">{_ins['texto']}</div>
                                  <div class="insight-foot">{_ins['rodape']}</div>
                                </div>
                                """,
                                unsafe_allow_html=True
                            )
                else:
                    st.success('Nenhum ponto crítico forte foi identificado automaticamente neste recorte.')

                st.markdown('### Evolução mensal do faturamento')
                meses_pt = {1:'Jan',2:'Fev',3:'Mar',4:'Abr',5:'Mai',6:'Jun',7:'Jul',8:'Ago',9:'Set',10:'Out',11:'Nov',12:'Dez'}
                evo_cidade = (
                    d.assign(MES_EVO=d['DATA_FAT'].dt.to_period('M'))
                    .groupby('MES_EVO',as_index=False)
                    .agg(
                        FATURAMENTO=('VALOR','sum'),
                        CLIENTES=('CODCLI','nunique'),
                        PEDIDOS=('NUMPED','nunique'),
                        PRODUTOS=('CODPROD','nunique')
                    )
                    .sort_values('MES_EVO')
                )
                if not evo_cidade.empty:
                    evo_cidade['MES_LABEL'] = evo_cidade['MES_EVO'].map(
                        lambda p: f"{meses_pt[int(p.month)]}/{int(p.year)}"
                    )
                    fig_evo = go.Figure()
                    fig_evo.add_trace(go.Scatter(
                        x=evo_cidade['MES_LABEL'],
                        y=evo_cidade['FATURAMENTO'],
                        mode='lines+markers',
                        line=dict(color=NAVY,width=3),
                        marker=dict(size=8,color=NAVY,line=dict(color='white',width=2)),
                        fill='tozeroy',
                        fillcolor='rgba(30,38,85,.08)',
                        customdata=evo_cidade[['CLIENTES','PEDIDOS','PRODUTOS']].to_numpy(),
                        hovertemplate=(
                            '<b>%{x}</b><br>'
                            'Faturamento: R$ %{y:,.2f}<br>'
                            'Clientes: %{customdata[0]:.0f}<br>'
                            'Pedidos: %{customdata[1]:.0f}<br>'
                            'Produtos: %{customdata[2]:.0f}'
                            '<extra></extra>'
                        )
                    ))
                    fig_evo.update_layout(
                        title='Faturamento mês a mês',
                        showlegend=False,
                        xaxis_title='',
                        yaxis_title='',
                    )
                    fig_evo.update_yaxes(tickprefix='R$ ',tickformat='.2s')
                    st.plotly_chart(
                        chart_layout(fig_evo,320,'h'),
                        use_container_width=True,
                        key=f'cidade_evolucao_{key}',
                        config={'displayModeBar':False,'responsive':True,'scrollZoom':False}
                    )

                # Exibe todo o detalhamento da cidade em uma única página.
                # Removemos os botões RCAs / Departamentos / Produtos / Clientes
                # para evitar esconder informações importantes atrás de filtros.

                st.markdown('### Desempenho comercial da área' if _todas_cidades else '### Desempenho comercial da cidade')

                col_rca, col_dep = st.columns(2, gap='large')

                with col_rca:
                    rc=d.groupby('RCA',as_index=False).agg(
                        FATURAMENTO=('VALOR','sum'),
                        PRODUTOS=('CODPROD','nunique'),
                        CLIENTES=('CODCLI','nunique')
                    ).sort_values('FATURAMENTO')

                    fig_rca=px.bar(
                        rc,
                        x='FATURAMENTO',
                        y='RCA',
                        orientation='h',
                        title='Faturamento por RCA',
                        text=rc.FATURAMENTO.map(brl_compacto),
                        custom_data=['PRODUTOS','CLIENTES']
                    )
                    fig_rca.update_traces(
                        marker_color=NAVY,
                        textposition='outside',
                        hovertemplate=(
                            '<b>%{y}</b><br>'
                            'Faturamento: R$ %{x:,.2f}<br>'
                            'Produtos: %{customdata[0]:.0f}<br>'
                            'Clientes: %{customdata[1]:.0f}'
                            '<extra></extra>'
                        )
                    )
                    fig_rca.update_xaxes(tickprefix='R$ ',tickformat='.2s')
                    plot_crossfilter(
                        chart_layout(fig_rca,max(330,28*len(rc)+100),'v'),
                        f'cidade_rca_{key}',
                        'xf_rca',
                        'y'
                    )

                with col_dep:
                    dp=d.groupby('DEPARTAMENTO',as_index=False).agg(
                        FATURAMENTO=('VALOR','sum'),
                        PRODUTOS=('CODPROD','nunique'),
                        CLIENTES=('CODCLI','nunique')
                    ).sort_values('FATURAMENTO')

                    fig_dep=px.bar(
                        dp,
                        x='FATURAMENTO',
                        y='DEPARTAMENTO',
                        orientation='h',
                        title='Faturamento por departamento',
                        text=dp.FATURAMENTO.map(brl_compacto),
                        custom_data=['PRODUTOS','CLIENTES']
                    )
                    fig_dep.update_traces(
                        marker_color=NAVY_2,
                        textposition='outside',
                        hovertemplate=(
                            '<b>%{y}</b><br>'
                            'Faturamento: R$ %{x:,.2f}<br>'
                            'Produtos: %{customdata[0]:.0f}<br>'
                            'Clientes: %{customdata[1]:.0f}'
                            '<extra></extra>'
                        )
                    )
                    fig_dep.update_xaxes(tickprefix='R$ ',tickformat='.2s')
                    st.plotly_chart(
                        chart_layout(fig_dep,max(330,30*len(dp)+100),'v'),
                        use_container_width=True,
                        key=f'cidade_dep_{key}',
                        config={'displayModeBar':False,'responsive':True,'scrollZoom':False}
                    )

                st.markdown('### Produtos da área' if _todas_cidades else '### Produtos da cidade')

                pr=d.groupby('CODPROD',as_index=False).agg(
                    PRODUTO=('PRODUTO_NOME','first'),
                    FATURAMENTO=('VALOR','sum'),
                    CLIENTES=('CODCLI','nunique'),
                    PEDIDOS=('NUMPED','nunique')
                ).sort_values('FATURAMENTO',ascending=False).head(15)

                pr=pr.sort_values('FATURAMENTO')

                fig_prod=px.bar(
                    pr,
                    x='FATURAMENTO',
                    y='PRODUTO',
                    orientation='h',
                    title='Top produtos por faturamento',
                    text=pr.FATURAMENTO.map(brl_compacto),
                    custom_data=['CLIENTES','PEDIDOS']
                )
                fig_prod.update_traces(
                    marker_color=NAVY,
                    textposition='outside',
                    hovertemplate=(
                        '<b>%{y}</b><br>'
                        'Faturamento: R$ %{x:,.2f}<br>'
                        'Clientes: %{customdata[0]:.0f}<br>'
                        'Pedidos: %{customdata[1]:.0f}'
                        '<extra></extra>'
                    )
                )
                fig_prod.update_xaxes(tickprefix='R$ ',tickformat='.2s')
                st.plotly_chart(
                    chart_layout(fig_prod,max(390,29*len(pr)+100),'v'),
                    use_container_width=True,
                    key=f'cidade_prod_{key}',
                    config={'displayModeBar':False,'responsive':True,'scrollZoom':False}
                )

                st.markdown('### Principais clientes da área' if _todas_cidades else '### Principais clientes da cidade')

                nomes=(
                    clientes[['CODCLI','CLIENTE']].drop_duplicates('CODCLI')
                    if 'CLIENTE' in clientes.columns
                    else pd.DataFrame(columns=['CODCLI','CLIENTE'])
                )
                detail=dcli.merge(nomes,on='CODCLI',how='left').sort_values(
                    'FATURAMENTO',ascending=False
                ).head(20)

                st.dataframe(
                    pd.DataFrame({
                        'Cliente': (
                            detail['CLIENTE'].fillna(detail.CODCLI.astype(str))
                            if 'CLIENTE' in detail.columns
                            else detail.CODCLI.astype(str)
                        ),
                        'Faturamento':detail.FATURAMENTO.map(brl),
                        'Pedidos':detail.PEDIDOS.map(nint),
                        'Produtos':detail.PRODUTOS.map(nint)
                    }),
                    use_container_width=True,
                    hide_index=True,
                    height=min(520,38+35*len(detail))
                )

            else:
                st.info('Nenhuma cidade com faturamento no recorte atual.')
'''

source = prefix + '\n' + aba4
exec(compile(source, str(_app), 'exec'), globals(), globals())

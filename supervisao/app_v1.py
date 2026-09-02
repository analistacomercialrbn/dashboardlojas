from pathlib import Path

_app = Path(__file__).with_name('app_v2.py')
source = _app.read_text(encoding='utf-8')

prefix, rest = source.split('\nwith aba4:\n', 1)
_, suffix = rest.split('\nst.divider()\n', 1)

aba4 = r'''
with aba4:
    st.subheader('Cobertura municipal — Nordeste')
    st.markdown("<div class='section-note'>Selecione um estado para ampliar o mapa. Os filtros laterais de mês, supervisor, RCA e departamento também atualizam automaticamente o mapa e os indicadores.</div>", unsafe_allow_html=True)

    if fat.empty:
        st.info('Sem faturamento para o recorte selecionado.')
    elif not {'CIDADE','UF'}.issubset(clientes.columns):
        st.warning('A base de clientes não contém as colunas CIDADE e UF necessárias para o mapa.')
    else:
        nomes_uf = {
            'Nordeste': None,
            'Alagoas (AL)': 'AL',
            'Bahia (BA)': 'BA',
            'Ceará (CE)': 'CE',
            'Maranhão (MA)': 'MA',
            'Paraíba (PB)': 'PB',
            'Pernambuco (PE)': 'PE',
            'Piauí (PI)': 'PI',
            'Rio Grande do Norte (RN)': 'RN',
            'Sergipe (SE)': 'SE',
        }

        estado_label = st.selectbox('Filtrar por estado', list(nomes_uf.keys()), index=0, key='estado_mapa')
        estado_uf = nomes_uf[estado_label]

        cli_cols = ['CODCLI','CIDADE','UF'] + (['CLIENTE'] if 'CLIENTE' in clientes.columns else [])
        cli_geo = clientes[cli_cols].drop_duplicates('CODCLI').copy()
        cli_geo['UF'] = cli_geo['UF'].astype(str).str.upper().str.strip()
        loc = fat.merge(cli_geo, on='CODCLI', how='left')
        loc = loc[loc.UF.isin(NE_CODES)].copy()
        if estado_uf:
            loc = loc[loc.UF.eq(estado_uf)].copy()

        loc['CIDADE_N'] = loc.CIDADE.map(norm)
        loc['KEY'] = loc.UF + '|' + loc.CIDADE_N

        city = loc.groupby(['KEY','CIDADE','UF'], dropna=False).agg(
            FATURAMENTO=('VALOR','sum'),
            CLIENTES=('CODCLI','nunique'),
            PEDIDOS=('NUMPED','nunique')
        ).reset_index()
        cmix = loc.groupby(['KEY','CODCLI']).CODPROD.nunique().rename('MIXCLI').reset_index()
        cmix = cmix.groupby('KEY').MIXCLI.mean().rename('MIX').reset_index()
        city = city.merge(cmix, on='KEY', how='left')

        geojson_all = load_nordeste_geojson()
        features = geojson_all['features']
        if estado_uf:
            features = [ft for ft in features if ft.get('properties',{}).get('uf') == estado_uf]
        geojson = {'type':'FeatureCollection','features':features}

        munis = pd.DataFrame([{
            'KEY': ft['properties']['key'],
            'CIDADE_MAPA': ft['properties'].get('name',''),
            'UF_MAPA': ft['properties'].get('uf','')
        } for ft in features])

        mapa = munis.merge(city, on='KEY', how='left')
        mapa['CIDADE'] = mapa['CIDADE'].fillna(mapa['CIDADE_MAPA'])
        mapa['UF'] = mapa['UF'].fillna(mapa['UF_MAPA'])
        for c in ['FATURAMENTO','CLIENTES','PEDIDOS','MIX']:
            mapa[c] = pd.to_numeric(mapa[c], errors='coerce').fillna(0)

        vendidos = city[city.FATURAMENTO.gt(0)].copy()
        maior = vendidos.loc[vendidos.FATURAMENTO.idxmax(),'CIDADE'] if len(vendidos) else '—'
        titulo_regiao = estado_label if estado_uf else 'Nordeste'

        z1,z2,z3,z4 = st.columns(4)
        z1.markdown(kpi('Cidades positivadas', nint(vendidos.shape[0]), 'Com faturamento no mês'), unsafe_allow_html=True)
        z2.markdown(kpi('Municípios no mapa', nint(mapa.shape[0]), titulo_regiao), unsafe_allow_html=True)
        z3.markdown(kpi('Maior cidade', maior, 'Por faturamento'), unsafe_allow_html=True)
        z4.markdown(kpi(f'Faturamento {estado_uf or "Nordeste"}', brl_compacto(city.FATURAMENTO.sum()), 'Recorte atual'), unsafe_allow_html=True)

        mapa_sem = mapa[mapa.FATURAMENTO.le(0)].copy()
        mapa_com = mapa[mapa.FATURAMENTO.gt(0)].copy()

        fig = go.Figure()

        if not mapa_sem.empty:
            custom_sem = mapa_sem[['CIDADE','UF','FATURAMENTO','CLIENTES','PEDIDOS','MIX']].to_numpy()
            fig.add_trace(go.Choropleth(
                geojson=geojson,
                locations=mapa_sem.KEY,
                z=[0] * len(mapa_sem),
                featureidkey='properties.key',
                zmin=0,
                zmax=1,
                colorscale=[[0,'#E7DDD1'],[1,'#E7DDD1']],
                showscale=False,
                marker_line_color='#AFA8A0',
                marker_line_width=.65 if estado_uf else .4,
                customdata=custom_sem,
                hovertemplate='<b>%{customdata[0]} - %{customdata[1]}</b><br><b>Sem faturamento no período</b><extra></extra>',
                name='Sem faturamento'
            ))

        if not mapa_com.empty:
            zmax = float(mapa_com.FATURAMENTO.quantile(.95)) if len(mapa_com) else 1.0
            zmax = max(zmax, 1.0)
            custom_com = mapa_com[['CIDADE','UF','FATURAMENTO','CLIENTES','PEDIDOS','MIX']].to_numpy()
            fig.add_trace(go.Choropleth(
                geojson=geojson,
                locations=mapa_com.KEY,
                z=mapa_com.FATURAMENTO,
                featureidkey='properties.key',
                zmin=0,
                zmax=zmax,
                colorscale=[
                    [0.00,'#E6EAF6'],
                    [0.18,'#D3DAEE'],
                    [0.40,'#A8B4D9'],
                    [0.65,'#7080B7'],
                    [0.82,'#42548D'],
                    [1.00,NAVY]
                ],
                marker_line_color='#8994B6',
                marker_line_width=.65 if estado_uf else .4,
                customdata=custom_com,
                colorbar=dict(title='Faturamento (R$)', thickness=12, len=.34, orientation='h', x=.72, y=.01, xanchor='center', yanchor='bottom'),
                hovertemplate='<b>%{customdata[0]} - %{customdata[1]}</b><br>Faturamento: R$ %{customdata[2]:,.2f}<br>Clientes: %{customdata[3]:.0f}<br>Pedidos: %{customdata[4]:.0f}<br>Mix: %{customdata[5]:.2f}<extra></extra>',
                name='Com faturamento'
            ))

        fig.update_geos(fitbounds='locations', visible=False, projection_type='mercator', bgcolor='rgba(0,0,0,0)')
        fig.update_layout(
            height=980,
            margin=dict(l=0,r=0,t=0,b=0),
            paper_bgcolor='rgba(0,0,0,0)',
            dragmode=False,
            showlegend=True,
            legend=dict(
                orientation='h',
                x=.01,
                y=.01,
                xanchor='left',
                yanchor='bottom',
                bgcolor='rgba(255,255,255,.88)',
                bordercolor='#E1E3EA',
                borderwidth=1
            )
        )

        selected_key = None
        col_map, col_det = st.columns([1.45, 1], gap='large')

        with col_map:
            try:
                ev = st.plotly_chart(fig, use_container_width=True, on_select='rerun', selection_mode='points', key=f'mapa_{estado_uf or "ne"}')
                sel = getattr(ev, 'selection', None)
                pts = getattr(sel, 'points', None) if sel is not None else None
                if pts and isinstance(pts[0], dict):
                    selected_key = pts[0].get('location')
            except Exception:
                st.plotly_chart(fig, use_container_width=True, key=f'mapa_fb_{estado_uf or "ne"}')

        labels_df = city[['KEY','CIDADE','UF','FATURAMENTO']].copy()
        labels_df['LABEL'] = labels_df.CIDADE.astype(str) + ' - ' + labels_df.UF.astype(str)
        labels_df = labels_df.sort_values(['UF','CIDADE'])
        labels = labels_df.LABEL.tolist()
        key_to_label = dict(zip(labels_df.KEY, labels_df.LABEL))
        default_label = key_to_label.get(selected_key, labels[0] if labels else None)

        with col_det:
            st.markdown("<div style='font-size:12px;color:#737A8C;margin-bottom:2px;'>Cidade selecionada</div>", unsafe_allow_html=True)
            idx = labels.index(default_label) if default_label in labels else 0
            choice = st.selectbox('Cidade', labels, index=idx if labels else None, label_visibility='collapsed', key=f'cidade_{estado_uf or "ne"}')

            if choice:
                row = labels_df.loc[labels_df.LABEL.eq(choice)].iloc[0]
                key = row.KEY
                d = loc[loc.KEY.eq(key)].copy()
                dcli = d.groupby('CODCLI').agg(PRODUTOS=('CODPROD','nunique'), FATURAMENTO=('VALOR','sum'), PEDIDOS=('NUMPED','nunique')).reset_index()

                st.markdown(f"<div style='font-size:22px;font-weight:800;color:{NAVY};margin:4px 0 12px 0;'>{row.CIDADE} - {row.UF}</div>", unsafe_allow_html=True)

                a1,a2,a3 = st.columns(3)
                a1.markdown(kpi('Faturamento', brl_compacto(d.VALOR.sum()), brl(d.VALOR.sum())), unsafe_allow_html=True)
                a2.markdown(kpi('Clientes positivados', nint(d.CODCLI.nunique()), 'Clientes'), unsafe_allow_html=True)
                a3.markdown(kpi('Pedidos', nint(d.NUMPED.nunique()), 'Faturados'), unsafe_allow_html=True)
                b1,b2,b3 = st.columns(3)
                b1.markdown(kpi('Ticket médio', brl_compacto(d.VALOR.sum()/d.NUMPED.nunique() if d.NUMPED.nunique() else 0), 'Por pedido'), unsafe_allow_html=True)
                b2.markdown(kpi('Mix médio', dec(dcli.PRODUTOS.mean()), 'Produtos/cliente'), unsafe_allow_html=True)
                part = d.VALOR.sum()/city.FATURAMENTO.sum()*100 if city.FATURAMENTO.sum() else 0
                b3.markdown(kpi('Participação', pct(part), titulo_regiao), unsafe_allow_html=True)

                st.markdown('**Faturamento por RCA na cidade**')
                rc = d.groupby('RCA', as_index=False).VALOR.sum().sort_values('VALOR', ascending=False)
                rc['% Cidade'] = rc.VALOR.div(rc.VALOR.sum()).mul(100)
                rc_show = pd.DataFrame({'RCA':rc.RCA, 'Faturamento (R$)':rc.VALOR.map(brl), '% Cidade':rc['% Cidade'].map(pct)})
                st.dataframe(rc_show, use_container_width=True, hide_index=True, height=min(220, 38 + 35*len(rc_show)))

                st.markdown('**Faturamento por departamento na cidade**')
                dp = d.groupby('DEPARTAMENTO', as_index=False).VALOR.sum().sort_values('VALOR', ascending=False)
                dp['% Cidade'] = dp.VALOR.div(dp.VALOR.sum()).mul(100)
                dp_show = pd.DataFrame({'Departamento':dp.DEPARTAMENTO, 'Faturamento (R$)':dp.VALOR.map(brl), '% Cidade':dp['% Cidade'].map(pct)})
                st.dataframe(dp_show, use_container_width=True, hide_index=True, height=min(260, 38 + 35*len(dp_show)))

                st.markdown('**Principais clientes da cidade**')
                nomes = clientes[['CODCLI','CLIENTE']].drop_duplicates('CODCLI') if 'CLIENTE' in clientes.columns else pd.DataFrame(columns=['CODCLI','CLIENTE'])
                detail = dcli.merge(nomes, on='CODCLI', how='left').sort_values('FATURAMENTO', ascending=False).head(12)
                detail_show = pd.DataFrame({
                    'Cliente': detail['CLIENTE'].fillna(detail.CODCLI.astype(str)) if 'CLIENTE' in detail.columns else detail.CODCLI.astype(str),
                    'Faturamento (R$)': detail.FATURAMENTO.map(brl),
                    'Pedidos': detail.PEDIDOS.map(nint),
                    'Mix': detail.PRODUTOS.map(dec),
                })
                st.dataframe(detail_show, use_container_width=True, hide_index=True, height=min(340, 38 + 35*len(detail_show)))
            else:
                st.info('Nenhuma cidade com faturamento no recorte atual.')
'''

source = prefix + '\n' + aba4 + '\nst.divider()\n' + suffix
exec(compile(source, str(_app), 'exec'), globals(), globals())

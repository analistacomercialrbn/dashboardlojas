from io import BytesIO
import unicodedata
import pandas as pd
import plotly.graph_objects as go
import requests
import streamlit as st

st.set_page_config(page_title='Cidades • Supervisão', page_icon='🗺️', layout='wide')

VENDAS_ID='1ioeKNG2P5HLZpmCTxUa3FaCfI1pfHuyC'
AUX_ID='1h3XtB-2aMSMGhr5Ws7P-6nijKZc3zeqI'
NAVY='#1E2655'; NAVY2='#2D396F'; BG='#F6F7FB'; MUTED='#737A8C'

st.markdown(f'''<style>
[data-testid="stAppViewContainer"]{{background:{BG};}}
[data-testid="stSidebar"]{{background:white;}}
h1,h2,h3{{color:{NAVY};}}
.card{{background:white;border:1px solid #E6E8EF;border-radius:16px;padding:15px 17px;min-height:100px;box-shadow:0 4px 14px rgba(30,38,85,.06)}}
.lbl{{font-size:11px;color:{MUTED};font-weight:700;text-transform:uppercase;letter-spacing:.05em}}
.val{{font-size:24px;color:{NAVY};font-weight:800;margin-top:6px}}
</style>''',unsafe_allow_html=True)

def drive_bytes(fid):
    r=requests.get(f'https://drive.google.com/uc?export=download&id={fid}',timeout=180)
    r.raise_for_status(); return BytesIO(r.content)

def cod(s):
    return pd.to_numeric(s.astype(str).str.extract(r'^\s*(\d+)',expand=False),errors='coerce').astype('Int64')

def dt(s):
    if pd.api.types.is_datetime64_any_dtype(s): return pd.to_datetime(s,errors='coerce')
    n=pd.to_numeric(s,errors='coerce')
    return pd.to_datetime(s.astype(str),dayfirst=True,errors='coerce').fillna(pd.to_datetime(n,unit='D',origin='1899-12-30',errors='coerce'))

def norm(x):
    if pd.isna(x): return ''
    x=unicodedata.normalize('NFKD',str(x))
    return ''.join(c for c in x if not unicodedata.combining(c)).upper().strip()

def brl(v): return f'R$ {float(v):,.2f}'.replace(',','X').replace('.',',').replace('X','.')
def brlc(v):
    v=float(v or 0)
    if v>=1_000_000:return f'R$ {v/1_000_000:.2f} mi'.replace('.',',')
    if v>=1_000:return f'R$ {v/1_000:.1f} mil'.replace('.',',')
    return brl(v)
def nint(v):return f'{int(round(float(v or 0))):,}'.replace(',','.')
def dec(v):return f'{float(v or 0):.2f}'.replace('.',',')
def card(label,value):return f"<div class='card'><div class='lbl'>{label}</div><div class='val'>{value}</div></div>"

def ler_vendas(buf):
    prev=pd.read_excel(buf,sheet_name='Sheet1',header=None,nrows=8); h=0
    for i,row in prev.iterrows():
        vals=set(row.astype(str).str.strip())
        if 'Data Faturamento' in vals and 'Pedidos Enviados' in vals: h=i; break
    buf.seek(0); return pd.read_excel(buf,sheet_name='Sheet1',header=h)

@st.cache_data(ttl=60,show_spinner='Carregando cidades...')
def load():
    v=ler_vendas(drive_bytes(VENDAS_ID))
    aux=drive_bytes(AUX_ID)
    cli=pd.read_excel(aux,sheet_name='CLIENTES'); aux.seek(0)
    rca=pd.read_excel(aux,sheet_name='RCA')
    v['CODCLI']=cod(v['Cod/Cliente']); v['COD_RCA']=cod(v['Cod/Vend.']); v['CODPROD']=cod(v['Cod/Produto'])
    v['DATA_FAT']=dt(v['Data Faturamento']); v['MES']=v['DATA_FAT'].dt.to_period('M').astype('string')
    v['VALOR']=pd.to_numeric(v['Pedidos Enviados'],errors='coerce').fillna(0)
    v=v[v['DATA_FAT'].notna() & v['Posição'].astype(str).str.strip().str.upper().eq('FECHADO')].copy()
    cli['CODCLI']=pd.to_numeric(cli['CODCLI'],errors='coerce').astype('Int64')
    rca['COD_RCA']=pd.to_numeric(rca['COD_RCA'],errors='coerce').astype('Int64')
    h=rca[['COD_RCA','RCA','SUPERVISOR']].drop_duplicates('COD_RCA')
    v=v.merge(h,on='COD_RCA',how='left')
    return v,cli

v,cli=load()
st.title('🗺️ Detalhe por Cidade')
st.caption('Mapa comercial isolado do dashboard principal para manter as demais páginas estáveis.')

meses=sorted(v.MES.dropna().unique(),reverse=True)
mes=st.sidebar.selectbox('Mês',meses,index=meses.index('2026-08') if '2026-08' in meses else 0)
sups=sorted(v.SUPERVISOR.dropna().unique()); ss=st.sidebar.multiselect('Supervisor',sups,placeholder='Todos')
rcas=sorted(v[v.SUPERVISOR.isin(ss or sups)].RCA.dropna().unique()); rr=st.sidebar.multiselect('RCA',rcas,placeholder='Todos')
rec=v[(v.MES==mes)&v.SUPERVISOR.isin(ss or sups)&v.RCA.isin(rr or rcas)].copy()

city_col=next((c for c in cli.columns if norm(c) in {'CIDADE','MUNICIPIO'}),None)
uf_col=next((c for c in cli.columns if norm(c) in {'UF','ESTADO','SIGLA_UF'}),None)
if not city_col or not uf_col:
    st.error('Não encontrei cidade/UF na base CLIENTES.'); st.stop()
loc=rec.merge(cli[['CODCLI',city_col,uf_col]].drop_duplicates('CODCLI').rename(columns={city_col:'CIDADE',uf_col:'UF'}),on='CODCLI',how='left')
loc=loc[loc.CIDADE.notna()&loc.UF.notna()].copy()

# Coordenadas por geocodificação leve via arquivo local quando disponível; fallback por centroides aproximados das capitais/áreas principais.
coords={
('FORTALEZA','CE'):(-3.7319,-38.5267),('SOBRAL','CE'):(-3.6891,-40.3482),('JUAZEIRO DO NORTE','CE'):(-7.2131,-39.3153),('CRATO','CE'):(-7.2344,-39.4092),('QUIXADA','CE'):(-4.9708,-39.0153),('LIMOEIRO DO NORTE','CE'):(-5.1439,-38.0989),('RUSSAS','CE'):(-4.9403,-37.9758),('MARACANAU','CE'):(-3.8767,-38.6256),('CAUCAIA','CE'):(-3.7361,-38.6531),('IGUATU','CE'):(-6.3594,-39.2989),('TIANGUA','CE'):(-3.7322,-40.9917),('ITAPIPOCA','CE'):(-3.4944,-39.5786),
('TERESINA','PI'):(-5.0892,-42.8019),('PARNAIBA','PI'):(-2.9055,-41.7754),('PICOS','PI'):(-7.0769,-41.4667),('FLORIANO','PI'):(-6.7718,-43.0241),
('NATAL','RN'):(-5.7945,-35.2110),('MOSSORO','RN'):(-5.1878,-37.3441),('RIACHUELO','RN'):(-5.8194,-35.8472),
('SAO LUIS','MA'):(-2.5307,-44.3068),('IMPERATRIZ','MA'):(-5.5185,-47.4777),('CAXIAS','MA'):(-4.8650,-43.3610)
}

def keyrow(r): return (norm(r.CIDADE),norm(r.UF))
loc['KEY']=loc.apply(keyrow,axis=1)
city=loc.groupby(['CIDADE','UF','KEY']).agg(FATURAMENTO=('VALOR','sum'),CLIENTES=('CODCLI','nunique'),PEDIDOS=('NUMPED','nunique')).reset_index()
pc=loc.groupby(['CIDADE','UF','KEY','CODCLI']).CODPROD.nunique().rename('PRODUTOS').reset_index()
mix=pc.groupby(['CIDADE','UF','KEY']).PRODUTOS.mean().rename('MIX').reset_index(); city=city.merge(mix,on=['CIDADE','UF','KEY'],how='left')
city['LAT']=city.KEY.map(lambda k: coords.get(k,(None,None))[0]); city['LON']=city.KEY.map(lambda k: coords.get(k,(None,None))[1])
mapped=city.dropna(subset=['LAT','LON']).copy()

c1,c2,c3,c4=st.columns(4)
c1.markdown(card('Cidades positivadas',nint(len(city))),unsafe_allow_html=True)
c2.markdown(card('Faturamento',brlc(city.FATURAMENTO.sum())),unsafe_allow_html=True)
c3.markdown(card('Clientes',nint(loc.CODCLI.nunique())),unsafe_allow_html=True)
c4.markdown(card('Cidades mapeadas',nint(len(mapped))),unsafe_allow_html=True)

selected=None
if not mapped.empty:
    mapped['LABEL']=mapped.CIDADE.astype(str)+' - '+mapped.UF.astype(str)
    sizes=10+35*(mapped.FATURAMENTO/mapped.FATURAMENTO.max()).pow(.5)
    fig=go.Figure(go.Scattergeo(
        lat=mapped.LAT,lon=mapped.LON,text=mapped.LABEL,
        customdata=mapped[['LABEL','FATURAMENTO','CLIENTES','PEDIDOS','MIX']].values,
        mode='markers',marker=dict(size=sizes,color=NAVY,opacity=.78,line=dict(width=1,color='white')),
        hovertemplate='<b>%{customdata[0]}</b><br>Faturamento: R$ %{customdata[1]:,.2f}<br>Clientes: %{customdata[2]}<br>Pedidos: %{customdata[3]}<br>Mix: %{customdata[4]:.2f}<extra></extra>'
    ))
    fig.update_geos(scope='south america',fitbounds='locations',showland=True,landcolor='#EEF0F6',showcountries=True,countrycolor='#C9CEDD',showocean=True,oceancolor='#F8FAFD')
    fig.update_layout(height=560,margin=dict(l=0,r=0,t=10,b=0),paper_bgcolor='rgba(0,0,0,0)')
    try:
        ev=st.plotly_chart(fig,use_container_width=True,on_select='rerun',selection_mode='points',key='cidade_geo')
        pts=getattr(getattr(ev,'selection',None),'points',None)
        if pts:
            cd=pts[0].get('customdata'); selected=cd[0] if cd else None
    except Exception:
        st.plotly_chart(fig,use_container_width=True)
else:
    st.info('Nenhuma das cidades do recorte atual possui coordenadas disponíveis no mapa ainda.')

labels=sorted((city.CIDADE.astype(str)+' - '+city.UF.astype(str)).unique())
idx=labels.index(selected) if selected in labels else 0
choice=st.selectbox('Cidade para detalhar',labels,index=idx if labels else None)
if choice:
    cname,cuf=choice.rsplit(' - ',1)
    d=loc[(loc.CIDADE.astype(str)==cname)&(loc.UF.astype(str)==cuf)].copy()
    dcli=d.groupby('CODCLI').agg(PRODUTOS=('CODPROD','nunique'),FATURAMENTO=('VALOR','sum'),PEDIDOS=('NUMPED','nunique')).reset_index()
    a,b,c,d1,e=st.columns(5)
    a.markdown(card('Faturamento',brlc(d.VALOR.sum())),unsafe_allow_html=True)
    b.markdown(card('Clientes',nint(d.CODCLI.nunique())),unsafe_allow_html=True)
    c.markdown(card('Pedidos',nint(d.NUMPED.nunique())),unsafe_allow_html=True)
    d1.markdown(card('Ticket médio',brlc(d.VALOR.sum()/d.NUMPED.nunique() if d.NUMPED.nunique() else 0)),unsafe_allow_html=True)
    e.markdown(card('Mix médio',dec(dcli.PRODUTOS.mean())),unsafe_allow_html=True)

    l,r=st.columns(2)
    with l:
        x=d.groupby('RCA',as_index=False).VALOR.sum().sort_values('VALOR')
        fg=go.Figure(go.Bar(x=x.VALOR,y=x.RCA,orientation='h',marker_color=NAVY))
        fg.update_layout(title=f'Faturamento por RCA — {cname}',height=380,margin=dict(l=10,r=10,t=45,b=10),paper_bgcolor='rgba(0,0,0,0)',plot_bgcolor='rgba(0,0,0,0)')
        st.plotly_chart(fg,use_container_width=True)
    with r:
        x=d.groupby('DEPARTAMENTO',as_index=False).VALOR.sum().sort_values('VALOR')
        fg=go.Figure(go.Bar(x=x.VALOR,y=x.DEPARTAMENTO,orientation='h',marker_color=NAVY2))
        fg.update_layout(title=f'Departamentos — {cname}',height=380,margin=dict(l=10,r=10,t=45,b=10),paper_bgcolor='rgba(0,0,0,0)',plot_bgcolor='rgba(0,0,0,0)')
        st.plotly_chart(fg,use_container_width=True)

    det=dcli.sort_values('FATURAMENTO',ascending=False).copy()
    det['Faturamento']=det.FATURAMENTO.map(brl); det['Mix produtos']=det.PRODUTOS.map(nint); det['Pedidos']=det.PEDIDOS.map(nint)
    st.subheader('Clientes da cidade')
    st.dataframe(det[['CODCLI','Faturamento','Mix produtos','Pedidos']].rename(columns={'CODCLI':'Código cliente'}),use_container_width=True,hide_index=True)

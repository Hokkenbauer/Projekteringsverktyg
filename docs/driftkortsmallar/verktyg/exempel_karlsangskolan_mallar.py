"""Exempel (gällande metod): Karlsängskolan 2025033 – flödesbilder på Ritbordets mallar (Ritmall 1.1) med symboler ur symbolbiblioteket
och I/O-streck som i HECO:s driftkort. PB = komponenter per beteckning."""
import sys, os; sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from mallverk import Mall
from rit3 import Sida

def varme(PB):
    """VP01–VP03, FJV (prefab VVX1/VVB1), VS02, VV/VVC och KV – mall N&N 25."""
    m=Mall(34)
    m.bort(1690,5640,1980,5676)                 # mellersta växlaren (finns inte i Karlsängskolan)
    m.byt('VS01','VS02'); m.byt('BVP01','VP01'); m.byt('BVP02','VP02'); m.byt('BVP03','VP03'); m.byt('Borrhål','KB01 borrhål')
    m.byt('Ink.Fjv','FJV (VP01)'); m.byt('Ink.Kv','KV01')
    s=Sida('Värme',  'AS001',PB); s.mall(m)
    ys,yr=5598.0,5621.8; yvv,yvc,ykv=5695.0,5718.8,5736.3; yfs,yfr=5694.8,5718.8
    # VS02 (från VP via ackumulator och från FJV-växlaren)
    s.sym('sym_pump',1805,ys,'VS01-PV601',pos='n',skala=.75)
    s.sym('sym_serviceswitch',1820,5584,'VS01-SO01',etikett='SO01',pos='w',skala=.28,pa_ror=False)
    s.sym('sym_sensor',1835,ys,'VS01-GT101',pos='n',skala=.7)
    s.sym('sym_sensor',1858,yr,'VS01-GT401',pos='n',skala=.7)
    s.sym('sym_expansionsmall',1880,yr,None,skala=.45); s.sym('sym_sensor',1892,yr,'VS01-GP601',pos='n',skala=.6)
    s.sym('sym_indication',1915,5632,'VS01-AL201',etikett='AL201 avgasare',pos='e',skala=.5,pa_ror=False)
    s.sym('sym_meter',1940,yr,'VS01-VMM02',etikett='VMM02 (LB)',pos='n',skala=.6)
    s.sym('sym_valve',1735,5597.99,'VS01-STV601',pos='n',skala=.7)
    s.sym('sym_meter',1700,5581.3,'VS01-VMM01',etikett='VMM01 (VP)',pos='n',skala=.6)
    x,y=s.T(1600,5568); s.text(x,y,'VS01 från VP01–VP03 till ackumulator VS02-ACK1',storlek=7.5)
    # fjärrvärme
    s.sym('sym_sensor',1645,yfs,'FJV01-GT401',pos='n',skala=.7)
    s.sym('sym_sensor',1660,yfr,'FJV01-GT402',pos='n',skala=.7)
    s.sym('sym_meter',1680,yfr,'FJV01-VMM01',pos='s',skala=.6)
    s.sym('sym_valve',1708,yfr,'VV01-STV201',pos='n',skala=.7)
    # tappvarmvatten
    s.sym('sym_sensor',1790,yvv,'VV01-GT101',pos='n',skala=.7)
    s.sym('sym_pump',1825,yvc,'VVC01-PCV201',pos='s',skala=.7,spegel=True)
    s.sym('sym_serviceswitch',1880,5728,'VVC01-SO01',etikett='SO01',pos='e',skala=.25,pa_ror=False)
    s.sym('sym_sensor',1848,yvc,'VVC01-GT401',pos='n',skala=.7)
    s.sym('sym_meter',1870,yvc,'VVC01-MF001',pos='s',skala=.6)
    # kallvatten
    for x,b in ((1652,'KV01-MF01'),(1672,'KV01-MF02'),(1690,'KV01-MF03')): s.sym('sym_meter',x,ykv,b,etikett=b[5:],pos='s',skala=.6)
    s.sym('sym_valve',1720,ykv,'KV01-SV801',pos='s',skala=.7)
    return s

def kyla(PB):
    """KB01 borrhål → KB11-VVX01 → KB11 komfortkyla – mall Örebroporten 29."""
    m=Mall(143)
    m.bort(5150,6125,5222,6162); m.bort(5418,6085,5510,6260); m.bort_text('Universitet','KP01-EXP01','KP01-AL01','KA01','KA02'); m.byt('KP01-VVX1','KB11-VVX01')
    s=Sida('Kyla','AS001',PB); s.mall(m)
    ys,yr=6136.2,6160.1
    x,y=s.T(5112,6128); s.text(x,y,'KB01 borrhål',storlek=8.5)
    x,y=s.T(5300,6128); s.text(x,y,'KB11 komfortkyla',storlek=8.5)
    x,y=s.T(5428,6130); s.text(x,y,'LB01–LB03 kylbatterier',storlek=7.5)
    x,y=s.T(5428,6190); s.text(x,y,'FLK, kylbafflar',storlek=7.5)
    # KB01
    s.sym('sym_pump',5162,ys,'KB01-PK501',pos='n',skala=.75)
    s.sym('sym_pump',5188,ys,'KB01-PK502',pos='n',skala=.75)
    s.sym('sym_sensor',5212,ys,'KB01-GT101',pos='n',skala=.7)
    s.sym('sym_sensor',5150,yr,'KB01-GP601',pos='n',skala=.7)
    s.sym('sym_sensor',5175,yr,'KB01-GT401',pos='n',skala=.7)
    s.sym('sym_valve',5222,yr,'KB11-STV201',pos='s',skala=.7)
    # KB11
    s.sym('sym_pump',5292,ys,'KB11-PK501',pos='n',skala=.75)
    s.sym('sym_serviceswitch',5335,6122,'KB11-SO01',etikett='SO01',pos='e',skala=.28,pa_ror=False)
    s.sym('sym_sensor',5385,ys,'KB11-GT101',pos='n',skala=.7)
    s.sym('sym_sensor',5282,yr,'KB11-GP601',pos='n',skala=.7)
    s.sym('sym_sensor',5300,yr,'KB11-GT401',pos='s',skala=.7) if False else s.sym('sym_sensor',5372,yr,'KB11-GT401',pos='n',skala=.7)
    a=s.T(5313,6171); b=s.T(5326,6184); x,y=s.T(5328,6181); s.text(x,y,'AL01 avgasare',storlek=8)
    s.io_punkt('KB11-AL01',(a[0],a[1],b[0],b[1]),'ner')
    x,y=s.T(5258,6195); s.text(x,y,'EXP1',storlek=7.5)
    return s

def shunt(PB):
    """VS31 golvvärme och VS21 radiatorer/luftridåer – mall Futurum 13."""
    m=Mall(99)
    m.bort(4160,2610,4180,2690)                     # mallens egna ventiltecken
    m.byt('VS11 Golvvärme','VS31 Golvvärme'); m.byt('VS13 Radiatorer','VS21 Radiatorer')
    s=Sida('Shunt','AS001',PB); s.mall(m)
    x,y=s.T(4030,2592); s.text(x,y,'Från VS02',storlek=8.5)
    x,y=s.T(4240,2708); s.text(x,y,'VS41/VS42 markvärme, LB-batterier',storlek=7.5)
    for sys,yf,yr in (('VS31',2607.5,2631.5),('VS21',2665,2688.5)):
        s.sym('sym_valve3wm',4171,yr,f'{sys}-STV201',pos='s',skala=.75)
        dx=0 if sys=='VS31' else -14
        s.sym('sym_pump',4210+dx,yf,f'{sys}-PV601',pos='n',skala=.8)
        s.sym('sym_sensor',4240+dx,yf,f'{sys}-GT101',pos='n',skala=.7)
        s.sym('sym_sensor',4262+dx,yr,f'{sys}-GT401',pos='n',skala=.7)
    return s

def generella(PB):
    s=Sida('Generella','AS001',PB)
    s.sym('sym_sensorout',70,90,'AS001-GT301',etikett='GT301',pos='n',skala=.9,mall=False,pa_ror=False,io_stil='hoger')
    x=130
    for i in range(1,7):
        s.sym('sym_meter',x,150,f'AS001-ME00{i}',etikett=f'ME00{i}',pos='n',skala=.8,mall=False,pa_ror=False); s.vtext(x+4,136-12,PB[f'AS001-ME00{i}']['beskrivning'],7.5); x+=34
    s.text(345,250,'Fukt i träkonstruktion',storlek=8)
    for i in range(1,5):
        s.sym('sym_sensor',350+(i-1)*34,280,f'AS001-GM40{i}',etikett=f'GM40{i}',pos='n',skala=.8,mall=False)
    x=505
    larm=[('AS001-CBR','Utlöst centralt brandlarm','CBR'),('AS001-NS001','Nödstopp aggregat','NS001'),('AS001-IL01','Pålarmad byggnad','IL01'),
          ('AS001-IL02','Beredskapsdrift','IL02')]+[(f'AS001-SL{i}',PB[f'AS001-SL{i}']['beskrivning'],f'SL{i}') for i in range(1,11)]
    for bet,t,k in larm: s.larm(x,t,k,bet); x+=25
    for i in range(1,5): s.larm(x,f'Utebelysning kanal {i} (astrour)',f'BEL{i}',f'AS001-BEL{i}','DU'); x+=25
    # kommunikation
    x+=14
    s.vtext(x+3,AS_Y_-60,'Modbus RTU GW1–GW8 (VAV-rum)',8); s.vtext(x+29,AS_Y_-60,'Modbus TCP LB01–LB03',8); s.vtext(x+55,AS_Y_-60,'ANSLUTNING TILL STADSNÄT',8)
    for xx in (x,x+26,x+52): s.koppling([(xx,AS_Y_-58),(xx,AS_Y_-44)])
    s.ruta(x+10,AS_Y_-36,'MOXA ×8',8); s.ruta(x+58,AS_Y_-36,'PLC',8)
    return s
from rit3 import AS_Y as AS_Y_

def lra(PB):
    """LRA101 luftridå (typ) i entré – mall Örebroporten 01, ett rum."""
    m=Mall(115)
    m.bort(5223,300,5420,440); m.bort_text('Vindfång','CS0')
    m.bort(5196,337,5209,351); m.bort(5174,390,5187,404)        # mallens ventil och givare
    m.beskar(5150,300,5240,432)
    s=Sida('LRA','AS001',PB); s.mall(m,ruta=(300,40,820,AS_Y_-40))
    T=s.T
    a=T(5166,322.9); b=T(5202.7,344.6); x,y=T(5166,318); s.text(x,y,'LRA101',storlek=9)
    s.io_punkt('LRA101',(a[0],a[1],a[0]+(b[0]-a[0])*0.45,b[1]),'ner')
    s.sym('sym_valve',5200.5,360,'LRA101-STV201',pos='e',skala=.7,rot=90)
    s.sym('sym_sensor',5192.9,365,'LRA101-GT801',etikett='GT801',pos='w',skala=.6,rot=-90,io_stil='vanster')
    s.sym('sym_sensorroom',5180,398,'LRA101-GT101',etikett='LRA101-GT101',pos='n',skala=.9,pa_ror=False)
    s.sym('sym_switch',5212,402,'LRA101-QA401',etikett='QA401 dörr',pos='n',skala=.6,pa_ror=False)
    x,y=T(5166,424); s.text(x,y,'Entré (typ) – antal luftridåer enligt VE',storlek=8)
    x,y=T(5186,380); s.text(x,y,'VS21',storlek=7.5)
    return s

def flk(PB):
    """Fläktluftkylare UC 1090, elcentral 1255 och storkök 4664 – mall Örebroporten 02."""
    m=Mall(116)
    m.bort_text('Teknikrum','Projektorrum','CS06')
    s=Sida('FLK','AS001',PB); s.mall(m,ruta=(40,40,760,AS_Y_-40))
    T=s.T
    enh={'FLK101':((5191.8,496.2,5220.6,513.5),5218.9,'Undercentral 1090',(5182,544)),
         '1255-FLK101':((5313.3,496.2,5342.4,513.5),5340.6,'Elcentral 1255',(5350,544)),
         '4664-FLK101':((5192.6,556.6,5221.4,573.9),5219.7,'Storkök 4664',(5182,612)),
         '4664-FLK102':((5312.1,556.2,5341.2,573.9),5339.2,'Storkök 4664',(5350,612))}
    for bet,(bb,xr,rum,(lx,ly)) in enh.items():
        a=T(bb[0],bb[1]); b=T(bb[2],bb[3]); x,y=T(bb[0],bb[1]-2); s.text(x,y,bet,storlek=8.5)
        s.io_punkt(bet,(a[0],a[1],b[0],b[1]),'hoger')
        x,y=T(lx,ly); s.text(x,y,rum,storlek=8)
    s.sym('sym_valve',5218.9,524,'FLK101-STV201',etikett='STV201',pos='w',skala=.65,rot=90,io_stil='vanster')
    s.sym('sym_valve',5340.6,524,'1255-STV201',etikett='STV201',pos='e',skala=.65,rot=90)
    s.sym('sym_valve',5219.7,585,'4664-STV201',etikett='STV201',pos='w',skala=.65,rot=90,io_stil='vanster')
    s.sym('sym_sensorroom',5250,530,'FLK101-GT101',etikett='GT101',pos='n',skala=.9,pa_ror=False)
    s.sym('sym_sensorroom',5372,530,'1255-GT101',etikett='GT101',pos='n',skala=.9,pa_ror=False)
    s.sym('sym_sensorroom',5250,592,'4664-GT101',etikett='GT101',pos='n',skala=.9,pa_ror=False)
    s.sym('sym_fansmall',5275,592,'4664-CF101',etikett='CF101',pos='n',skala=.6,pa_ror=False)
    s.sym('sym_sensorfan',5275,592,'4664-GP601',etikett='GP601',pos='s',skala=.55,pa_ror=False,io_stil='vanster')
    # kyl- och frysrum i köket
    s.ram(790,120,1075,300,'Kyl- och frysrum, storkök')
    for i,nr in enumerate(('1038','1050','1052','1054')):
        x=820+i*68; s.ram(x-24,160,x+40,260,f"{'Frys' if nr=='1054' else 'Kyl'} {nr}")
        s.sym('sym_sensorroom',x,205,f'{nr}-GT101',etikett='GT101',pos='n',skala=.9,mall=False,pa_ror=False)
    x,y=T(5180,488); s.text(x,y,'KB11 komfortkyla',storlek=8)
    return s

FLAKTAR=[dict(f='KF111',rum='Städcentral 1066'),dict(f='1041-KF101',rum='Miljörum 1041'),
   dict(f='KF106',rum='Fläktrum 1 1175',extra=('sym_sensor','1175-GM301','GM301 gaslarm')),dict(f='KF104',rum='Teknik 1079',extra=('sym_clock','1079-TK101','TK101')),
   dict(f='KF105',rum='Smedja 1078'),dict(f='KF108',rum='Prep 1'),dict(f='KF112',rum='Virke 1076'),dict(f='KF113',rum='Keramik 1155',extra=('sym_clock','1155-TK101','TK101')),
   dict(f='KF109',rum='Pumphus 2KB2',extra=('sym_sensorroom','2KB2-GT101','GT101')),dict(f='KF110',rum='Miljöhus 2KB1',extra=('sym_sensorroom','2KB1-GT101','GT101')),
   dict(f='KF103',rum='El-/telerum 1089',gp='KF103-GP601',st='KF103-ST201',extra=('sym_sensorroom','KF103-GT101','GT101')),
   dict(f='KF101',rum='Undercentral 1090',gp='KF101-GP601',st='KF101-ST201'),dict(f=None,rum='Kemi/fysik – dragskåp (typ)',gp='DS01-GP601')]

def flaktsida(PB,block):
    """Frånluftsfläktar, fyra rum per blad – mall N&N 24 (två rum) placerad två gånger."""
    s=Sida('KF','AS001',PB)
    for h in range(0,len(block),2):
        par=block[h:h+2]
        m=Mall(33); m.bort_text('Soprum')
        if len(par)==1: m.bort(1810,5340,1900,5565)
        X0=40+(h//2)*521
        T=s.mall(m,ruta=(X0,50,X0+521,AS_Y_-40))
        for j,b in enumerate(par):
            xd=(1720.6,1852.4)[j]; rx0=(1690.0,1822.0)[j]
            x,y=T(rx0+2,5511); s.text(x,y,b['rum'],storlek=8)
            if b['f']:
                s.sym('sym_fansmall',xd,5405,b['f'],etikett=b['f'].replace('1041-',''),pos='e',skala=.6,rot=-90,T=T,pa_ror=False,io_stil='hoger')
                if PB[b['f']]['signaler'] and sum(1 for g in PB[b['f']]['signaler'] if g['typ']=='DI')>=2:
                    x,y=T(xd+8,5425); s.text(x,y,'DI 2: laddning',storlek=7)
            if b.get('gp'):
                s.sym('sym_sensorfan',xd,5405 if b['f'] else 5420,b['gp'],etikett=b['gp'].split('-',1)[1] if b['f'] else b['gp'],pos='w',skala=.5,rot=-90,T=T,pa_ror=False,io_stil='vanster')
            if b.get('st'):
                s.sym('sym_damper',xd,5375,b['st'],etikett='ST201',pos='e',skala=.5,rot=90,T=T,pa_ror=False)
            if b.get('extra'):
                sid,bet,et=b['extra']
                s.sym(sid,xd-18,5490,bet,etikett=et,pos='n',skala=.8,T=T,pa_ror=False)
    return s

def flaktsidor(PB):
    return [(f'KF Frånluftsfläktar {i//4+1}',flaktsida(PB,FLAKTAR[i:i+4])) for i in range(0,len(FLAKTAR),4)]

def lb(PB,nr):
    """Prefabricerat LB-aggregat – mall Örebroporten 09 (aggregat i streckad ram, värme- och kylbatteri)."""
    sys=f'LB0{nr}'
    m=Mall(123); m.bort(5418,1715,5490,1850); m.bort_text('Universitet')
    s=Sida(sys,'AS001',PB,rubrik=f'Alla objekt föregås av prefix {sys} om ej annat anges.'); T=s.mall(m,ruta=(40,50,1082,AS_Y_-110))
    yf,yt=1758.3,1798.2
    o=dict(T=T,pa_ror=True,io=False)
    s.sym('sym_damper',5156,yf,None,etikett='ST202',pos='n',skala=.55,**o); s.sym('sym_damper',5156,yt,None,etikett='ST201',pos='n',skala=.55,**o)
    s.sym('sym_sensor',5170,yf,None,etikett='GT403',pos='n',skala=.6,**o); s.sym('sym_sensor',5170,yt,None,etikett='GT402',pos='n',skala=.6,**o)
    s.sym('sym_fan',5188,yf,None,etikett='FF301',pos='n',skala=.5,spegel=True,**o)
    s.sym('sym_sensorfilter',5193.6,yt-8,None,etikett='GP801',pos='n',skala=.4,pa_ror=False,T=T,io=False)
    s.sym('sym_sensorfilter',5261,yf-8,None,etikett='GP802',pos='n',skala=.4,pa_ror=False,T=T,io=False)
    s.sym('sym_sensor',5240,yf,None,etikett='GT401',pos='n',skala=.6,**o)
    s.sym('sym_sensor',5236,yt,None,etikett='GT404',pos='n',skala=.6,**o)
    s.sym('sym_fan',5258,yt,None,etikett='TF301',pos='n',skala=.5,**o)
    x,y=T(5150,1838); s.text(x,y,'Prefabricerat aggregat med egen styrning – ingen I/O från HECO',storlek=7.5)
    if nr==1: x,y=T(5200,1726); s.text(x,y,'MSV001 motströmsväxlare',storlek=7)
    s.sym('sym_sensor',5330,yt,None,etikett='GT801',pos='n',skala=.6,**o)
    s.sym('sym_sensor',5394,yt,None,etikett='GT101',pos='n',skala=.6,**o)
    if nr==3: s.sym('sym_sensor',5350,yt,None,etikett='GT102',pos='n',skala=.6,**o)
    s.sym('sym_sensor',5412,yf,None,etikett='GP102',pos='n',skala=.6,**o); s.sym('sym_sensor',5412,yt,None,etikett='GP101',pos='n',skala=.6,**o)
    x,y=T(5300,1840); s.text(x,y,'PVK601, STV201 (värme)',storlek=7); x,y=T(5372,1840); s.text(x,y,'STV202 (kyla)',storlek=7)
    if nr==2: x,y=T(5300,1848); s.text(x,y,'ME001 energimätare',storlek=7)
    betj={'LB01':'Kök, hemkunskap','LB02':'Grupprum, klassrum m.fl.','LB03':'Grupprum, slöjd, aula m.fl.'}[sys]
    x,y=T(5300,1752); s.text(x,y,'Frånluft '+betj,storlek=7.5); x,y=T(5392,1808); s.text(x,y,'Tilluft',storlek=7.5)
    # internstyrning
    a=T(5215,1842.3); xi=a[0]
    s.koppling([(xi,a[1]),(xi,AS_Y_-70)])
    l,t,r,b=s.ruta(xi,AS_Y_-62,'Internstyr',9)
    l2,t2,r2,b2=s.ruta(xi-170,AS_Y_-34,'Centralt Brandlarm',8); s.koppling([(r2,AS_Y_-34),(xi-12,AS_Y_-34),(xi-12,b)])
    s.vtext(xi+12,AS_Y_-8,'Modbus TCP/IP',7)
    s.io_punkt(sys,(l,t,r,b),'ner')
    if nr==1:
        s.ram(700,AS_Y_-90,880,AS_Y_-30,'Kök, hemkunskap')
        s.sym('sym_switch',740,AS_Y_-70,None,etikett='NB01 kåpa',pos='e',skala=.55,mall=False,pa_ror=False)
        s.sym('sym_switch',810,AS_Y_-70,None,etikett='NB02 disk',pos='e',skala=.55,mall=False,pa_ror=False)
        s.koppling([(740,AS_Y_-76),(740,AS_Y_-95),(r,AS_Y_-95),(r,t)]); s.koppling([(810,AS_Y_-76),(810,AS_Y_-95),(740,AS_Y_-95)])
    return s

def vav_sidor(PB):
    """VAV-rum, fyra rum per blad – mall Futurum 23."""
    import json
    vav=json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'exempeldata','karlsangskolan_vav_rum.json')))
    plan={}
    for r in vav: plan.setdefault(r['plan'].split(' (')[0],[]).append(r)
    ut=[]
    SX=(4102.1,4162.9,4223.8,4284.6); FX=(4122.1,4182.9,4243.7,4304.6); RX=(4085.7,4146.5,4207.3,4268.1)
    for p,rr in plan.items():
        sidor=[rr[i:i+4] for i in range(0,len(rr),4)]
        for si,grupp in enumerate(sidor,1):
            m=Mall(109)
            for j in range(len(grupp),4): m.bort(RX[j]-4,4920,RX[j]+57,5052)
            s=Sida('VAV','AS001',PB,rubrik=f'{p} – VAV-rum, blad {si} av {len(sidor)}. Alla objekt föregås av rumsnummer om ej annat anges.')
            T=s.mall(m)
            x,y=T(4060,4910); s.text(x,y,'LB02 / LB03',storlek=8)
            if si>1: x,y=T(4062,4930); s.text(x,y,f'Forts. blad {si-1}',storlek=7.5)
            if si<len(sidor): x,y=T(4312,4930); s.text(x,y,f'Forts. blad {si+1}',storlek=7.5)
            for j,r in enumerate(grupp):
                nr=r['nr']; o=dict(T=T,pa_ror=False,io=False)
                b1=s.sym('sym_dampersmall',SX[j],4957,None,etikett='ST401',pos='w',skala=.6,rot=90,**o)
                b2=s.sym('sym_dampersmall',FX[j],4957,None,etikett='ST402',pos='e',skala=.6,rot=90,**o)
                g1=s.sym('sym_narvaro',SX[j],5012,None,etikett='GN501',pos='n',skala=3,**o)
                g2=s.sym('sym_sensorroom',FX[j],5012,None,etikett='GT/GX501',pos='n',skala=.9,**o)
                cx=(T(SX[j],0)[0]+T(FX[j],0)[0])/2; cy=T(0,5032)[1]
                l,t,rr_,bo=s.ruta(cx,cy,'RC01',8)
                s.koppling([((g1[0]+g1[2])/2,g1[3]),((g1[0]+g1[2])/2,cy),(l,cy)]); s.koppling([((g2[0]+g2[2])/2,g2[3]),((g2[0]+g2[2])/2,cy),(rr_,cy)])
                s.koppling([(b1[0],(b1[1]+b1[3])/2),(b1[0]-6,(b1[1]+b1[3])/2),(b1[0]-6,cy+12),(cx-4,cy+12),(cx-4,bo)])
                s.koppling([(b2[2],(b2[1]+b2[3])/2),(b2[2]+6,(b2[1]+b2[3])/2),(b2[2]+6,cy+12),(cx+4,cy+12),(cx+4,bo)])
                s.io_punkt(f'{nr}-RC01',(cx-3,t,cx+3,bo),'ner')
                x,y=T(RX[j]+2,5046); s.text(x,y,f"{nr} {r['namn'].capitalize()}",storlek=7.5)
            ut.append((f'VAV {p} blad {si}/{len(sidor)}',s))
    return ut


def alla(PB):
    lista=[('AS001 Generella',generella(PB)),('VP01–VP03 VS01 VV01 Värme och tappvatten',varme(PB)),('KB01 KB11 Kyla',kyla(PB)),
           ('VS21 VS31 Radiatorer och golvvärme',shunt(PB)),('LRA101 Luftridåer',lra(PB)),('FLK Fläktluftkylare och kylrum',flk(PB))]
    lista+=flaktsidor(PB)
    lista+=[(f'LB0{n} Luftbehandling',lb(PB,n)) for n in (1,2,3)]
    lista+=vav_sidor(PB)
    return [(n,s.data()) for n,s in lista]

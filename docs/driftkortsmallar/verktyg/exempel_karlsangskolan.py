"""Exempel: Karlsängskolan (2025033) – alla flödesbilder byggda direkt från HECO:s historiska driftkort.
Används som mönster för nya projekt. PB = komponenter per beteckning, vav_rum.json = projektets VAV-rum."""
import sys, os; sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from pdfmall import Sida
HIST=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','historiska')
H1=os.path.join(HIST,'samling-1')+'/'
H2=os.path.join(HIST,'samling-2')+'/'

def byt(s,m):
    for a,b in m.items(): s.byt(a,b)

def vs01():
    s=Sida(H2+'DK2 VP01VS01VV01.pdf')
    # tas bort: VV01-MQ41 med givare, KV01-GT41, VVC01-MQ41-givarna, VV01-MF41 (storkök)
    s.bort_ruta(378,165,490,466)
    s.bort_ruta(605,175,681,305); s.bort_text('VVC01-MQ41-GT41','VVC01-MQ41-GT42')
    s.bort_ruta(705,150,760,345)
    byt(s,{'VP01-MQ41-GT41':'FJV01-GT401','VP01-MQ41-GT42':'FJV01-GT402','VP01-MQ41-MF41':'FJV01-VMM01','FJV':'FJV (VP01)',
           'VS01-SV11':'VS01-STV601','VV01-SV11':'VV01-STV201','VS01-GT11':'VS01-GT101','VS01-P1':'VS01-PV601','VS01-GT41':'VS01-GT401',
           'VS01-GP41':'VS01-GP601','VV01-GT11':'VV01-GT101','VVC01-P1':'VVC01-PCV201','VV01-GT41':'VVC01-GT401','VVC01-MQ41':'VVC01-MF001',
           'KV01-MF41':'KV01-MF01','KV01-MF42':'KV01-MF02','KV01-MF43':'KV01-MF03','KV01-SV91':'KV01-SV801','VS01':'VS02 / ACK1'})
    # nya energimätare på VS01 retur (kopia av mätarsymbolen)
    s.bort_ruta(680,262,695,276)
    s.flytta_text('VVC01-PCV201',-14); s.flytta_text('VS01-STV601',-12); s.flytta_text('VV01-STV201',-12)
    s.ny_io(302.5,332,'DI'); s.ny_io(677,252,'M-bus')                      # KV01-SV801 larm
    for x,t in ((754,'VS01-SO01 Serviceomk.'),(768,'VVC01-SO01 Serviceomk.')):
        s.ny_text(x,308,t,6.2,vert=True); s.ny_io(x-2,311,'DI')
    return s

def generella(PB):
    s=Sida(H1+'H1/DK1 Generella.pdf')
    # originalets larm (AUT, OMK, CBL, MQ51) tas bort och ritas om för AS001
    s.bort_ruta(236,270,365,425,behall_ror=False)
    s.byt('G-AL01-GT301','AS001-GT301'); 
    s.byt('Modbus RTU-linga','Modbus RTU GW1–GW8 (8 st MOXA MB3180)')
    # elmätare ME001–006 (kopior av MQxx) och fuktgivare GM401–404 (kopior av GTxx), flyttade åt vänster
    s.bort_ruta(125,150,200,470,behall_ror=False)
    for i in range(6):
        x=70+i*30; s.kopiera(136,169.7,151,184.4,x-143.4,0,roller=('flode','io'),inkl_bort=True)
        s.ny_text(x-11,162,f'ME00{i+1}',7.2); s.ny_io(x,184.3,'M-bus')
    for i in range(4):
        x=85+i*30; s.kopiera(172.8,174.9,184,196,x-178.3,70,inkl_bort=True)
        s.ny_text(x-11,240,f'GM40{i+1}',7.2); s.ny_io(x+6,247,'AI',knack=(x+5.5,247))
    s.ny_io(90,71,'AI',knack=(67,71))
    larm=[('AS001-CBR','Utlöst centralt brandlarm','CBR'),('AS001-NS001','Nödstopp aggregat','NS'),('AS001-IL01','Pålarmad byggnad','IL01'),
          ('AS001-IL02','Beredskapsdrift','IL02')]+[(f'AS001-SL{i}',PB[f'AS001-SL{i}']['beskrivning'],f'SL{i}') for i in range(1,11)]
    x=262
    for bet,t,k in larm: s.larm(x,t,k,'DI',storlek=7.2); x+=21
    for i in range(1,5): s.larm(x,f'Utebelysning kanal {i}',f'BEL{i}','DU',storlek=7.2); x+=21
    return s

def shunt(sys,last,golv=False):
    s=Sida(H1+'G/DK3 VS11.pdf')
    s.bort_ruta(285,170,352,470); s.bort_text('GT41','GT42','G-RAD01-MQ41')
    byt(s,{'G-RAD01-STV201':f'{sys}-STV201','G-RAD01-GT401':f'{sys}-GT401','G-RAD01-GT101':f'{sys}-GT101','G-RAD01-PV601':f'{sys}-PV601',
           'G-SG03-RAD01':f'{sys} shuntgrupp','Radiatorer hus G':last,'Hus G':f'{sys} {last}'})
    if golv:
        s.bort_ruta(660,200,725,260,behall_ror=False)
        s.importera(Sida(H2+'DK2 VS11.pdf'),666,280,730,318,-4,-66)
    return s

def lb(PB,nr):
    sys=f'LB0{nr}'
    s=Sida(H2+'DK4 LB02.pdf')
    # frekvensomformarsymboler (ingår inte i komponentlistan), OVK, GM21/AL06 tas bort
    for r in ((198,118,220,140),(300,180,326,212),(370,196,392,216)): s.bort_ruta(*r,behall_ror=False)
    s.bort_text('FO01','F1','F2','AL06','AL06 sida 3','GM21','OVK','LB02')
    s.bort_ruta(88,365,125,430); s.bort_ruta(695,140,750,312); s.bort_ruta(744,292,770,304)
    byt(s,{'ST22':'ST202','ST21':'ST201','GT42':'GT403','GT41':'GT402','FF01':'FF301','GF42':'GF402','GP61':'GP801','GP62':'GP802',
           'TF01':'TF301','GF41':'GF401','GT11':'GT401','GP12':'GP102','GP11':'GP101','GT21':'GT101','P1':'PVK601','SV31':'STV201','GT81':'GT801',
           'Alla objekt föregås av prefix LB02 om ej annat anges.':f'Alla objekt föregås av prefix {sys} om ej annat anges.'})
    # GT404 efter värmeväxlaren (kopia av givaren GT41)
    s.kopiera(160,158,173,180,180,0); s.ny_text(340,156,'GT404',5.76)
    if nr==3:
        s.kopiera(668,158,684,180,-40,0); s.ny_text(628,156,'GT102',5.76)
    s.ny_text(612,238,'STV202 (kyla)',5.76)
    betj={'LB01':'Kök, hemkunskap','LB02':'Grupprum, klassrum m.fl.','LB03':'Grupprum, slöjd, aula m.fl.'}[sys]
    s.ny_text(650,96,'Frånluft '+betj,5.76); s.ny_text(650,170,'Tilluft '+betj,5.76)
    s.ny_text(133,225,'Prefabricerat aggregat med egen styrning – ingen I/O från HECO',5.76)
    if nr==1:
        s.ny_rekt(590,325,730,368,streckad=True); s.ny_text(593,365,'Kök, hemkunskap',5.76)
        s.ny_text(612,345,'NB01 kåpa',5.76); s.ny_text(672,345,'NB02 disk',5.76)
        s.ny_rekt(622,332,628,338,farg='#808080',fyll='#dddddd'); s.ny_rekt(682,332,688,338,farg='#808080',fyll='#dddddd')
        s.ny_streck([(625,338),(625,318),(325,318),(325,306)]); s.ny_streck([(685,338),(685,318),(625,318)])
        s.ny_text(560,244,'MSV001 motströmsväxlare',5.76) if False else None
    return s

KTD=None
def ktd():
    global KTD
    if KTD is None: KTD=Sida(H1+'G/DK2 LB01_1.pdf')
    return KTD

def flaktar(PB,sidnr,block):
    """Frånluftsfläktar som DK3 FF101: ett streckat rum per fläkt, fyra per blad."""
    s=Sida(H1+'AS01/DK3 FF101.pdf')
    s.bort_ruta(330,60,520,470,roller=('io',))
    s.bort_text('FF101','FF101-GP601','FF01-GT501','Undercentral')
    s.bort_ruta(380,178,400,231,behall_ror=False); s.bort_exakt((394.2,181.6,420.4,201.1),(394.2,205.5,420.2,224.7))      # GP601-givaren med bygel
    s.bort_ruta(408,284,433,312,behall_ror=False)      # rumsgivaren GT501
    for i,b in enumerate(block):
        dx=(40+i*190)-337; fx=420+dx
        s.kopiera(330,95,510,335,dx,0)
        s.ny_text(fx+7,190,b['flakt'].replace('1041-',''),7.2)
        s.ny_text(337+dx+3,325,b['rum'],7.2)
        sig=[g['typ'] for g in PB[b['flakt']]['signaler']] if b['flakt'] in PB else []
        if 'DU' in sig: s.ny_io(fx+30,203,'DU',knack=(fx+15,203))
        if sig.count('DI')>=1: s.ny_io(fx+38,210,'DI',knack=(fx+13,210))
        if sig.count('DI')>=2: s.ny_io(fx+46,217,'DI',knack=(fx+10,217)); s.ny_text(fx+48,226,'Laddning',5.76)
        if b.get('gp'):
            s.kopiera(380,178,420.5,231,dx,0,inkl_bort=True); s.ny_text(347+dx,201+4,b['gp'],7.2) if False else s.ny_text(345+dx,198,b['gp'].split('-')[-1],7.2)
            s.ny_io(385+dx,213,'DI')
        if b.get('st'):
            s.importera(ktd(),295,146.5,332.5,160.5,fx-306.8,140-153.6); s.ny_text(fx+16,133,'ST201',7.2)
            s.ny_io(fx+26,140,'DU',knack=(fx+26,140)) if False else s.ny_io(fx+50,140,'DU',knack=(fx+25,140))
        if b.get('givare'):
            bet,etik,typ=b['givare']
            s.kopiera(408,284,433,312,dx-55,0,inkl_bort=True); s.ny_text(fx-75,282,etik,7.2); s.ny_io(fx-55,303,typ)
        if b.get('timer'):
            s.ny_rekt(fx-73,288,fx-37,298); s.ny_text(fx-70,296,b['timer'],6.5); s.ny_io(fx-55,298,'DI')
    s.bort_ruta(330,60,520,470,bara_original=True,behall_ror=False)
    return s

def flaktsidor(PB):
    B=[dict(flakt='KF111',rum='Städcentral 1066'),dict(flakt='1041-KF101',rum='Miljörum 1041'),
       dict(flakt='KF106',rum='Fläktrum 1 1175',givare=('1175-GM301','1175-GM301 gaslarm','DI')),dict(flakt='KF104',rum='Teknik 1079',timer='1079-TK101'),
       dict(flakt='KF105',rum='Smedja 1078'),dict(flakt='KF108',rum='Prep 1'),dict(flakt='KF112',rum='Virke 1076'),dict(flakt='KF113',rum='Keramik 1155',timer='1155-TK101'),
       dict(flakt='KF109',rum='Pumphus 2KB2',givare=('2KB2-GT101','2KB2-GT101','AI')),dict(flakt='KF110',rum='Miljöhus 2KB1',givare=('2KB1-GT101','2KB1-GT101','AI')),
       dict(flakt='KF103',rum='El-/telerum 1089',gp='KF103-GP601',st=True,givare=('KF103-GT101','KF103-GT101','AI')),
       dict(flakt='KF101',rum='Undercentral 1090',gp='KF101-GP601',st=True),
       dict(flakt='DS01',rum='Kemi/fysik – dragskåp (typ)',gp='DS01-GP601')]
    ut=[]
    for i in range(0,len(B),4):
        ut.append((f'KF Frånluftsfläktar {i//4+1}',flaktar(PB,i//4+1,B[i:i+4])))
    return ut

FF=None
def ff101():
    global FF
    if FF is None: FF=Sida(H1+'AS01/DK3 FF101.pdf')
    return FF
ORANGE=lambda c: c[0]>0.9 and 0.45<c[1]<0.75 and c[2]<0.2
ROD=lambda c: c[0]>0.85 and c[1]<0.3 and c[2]<0.3
KBBLA=(0.0,0.0,1.0)

def rumsgivare(s,x,y,etikett,typ='AI',storlek=7.2):
    """Rumsgivare kopierad från DK3 FF101 (spetsen vid y)."""
    s.importera(ff101(),408,284,433,312,x-420,y-292)
    s.ny_text(x-len(etikett)*storlek*0.3,y-12,etikett,storlek); s.ny_io(x,y+11,typ)

def flv(): return Sida(H2+'DK5 FLV.pdf')
def ta_bort_flv11(s):
    s.bort_ruta(280,62,400,460,behall_ror=False,behall_svart=True)
def ta_bort_givare_gt41(s,dx):
    s.bort_ruta(84+dx,180,147+dx,200,behall_ror=False); s.bort_ruta(84+dx,186,90+dx,460,behall_svart=True)
def till_kyla(s,enheter):
    s.farga(0,0,842,370,ORANGE,KBBLA)
    for ux in enheter:     # värmesymbolens + blir ett blått −
        s.bort_exakt((ux+162.6-162.6,226.7,ux,235.8))
        s.farga(ux-6,225,ux+6,237,ROD,KBBLA)

def lra(PB):
    s=flv(); ta_bort_flv11(s); s.bort_ruta(540,62,720,460,behall_ror=False)
    s.ersatt_ror((70.0,69.2,645.4,71.4),70,69.2,183.9,71.4); s.ersatt_ror((70.0,123.5,606.0,125.6),70,123.5,143.7,125.6)
    byt(s,{'FLV10-GT41':'LRA101-GT801','FLV10-SV21':'LRA101-STV201','FLV10':'LRA101','VS11':'VS01','Matsal':'Entré (typ)','1021':'Luftridåer'})
    s.ny_io(104,252,'DU',knack=(132,252)); s.ny_io(110,258,'DI',knack=(132,258))
    rumsgivare(s,260,262,'LRA101-GT101')
    s.ny_rekt(318,256,358,266); s.ny_text(321,264,'QA401 dörr',6.5); s.ny_io(338,266,'DI')
    return s

def flk(PB):
    s=flv(); ta_bort_flv11(s); till_kyla(s,(162.6,625.2))
    for dx in (0,463): ta_bort_givare_gt41(s,dx)
    s.bort_ruta(95,240,101,460,behall_svart=True)           # FLV10:s Au-streck (FLK101 har DU/DI)
    s.bort_text('FLV10-GT41')
    s.byt_inom('FLV10','FLK101',90,200); s.byt_inom('FLV10-SV21','FLK101-STV201',90,200)
    s.byt_inom('FLV10','1255-FLK101',540,700); s.byt_inom('FLV10-SV21','1255-STV201',540,700)
    byt(s,{'VS11':'KB11','Matsal':'Undercentral','1021':'1090','Kök':'Elcentral','1030':'1255'})
    s.ny_io(104,252,'DU',knack=(132,252)); s.ny_io(110,258,'DI',knack=(132,258))
    rumsgivare(s,260,262,'FLK101-GT101'); rumsgivare(s,680,262,'1255-GT101')
    return s

def kok(PB):
    s=flv(); till_kyla(s,(162.6,365.2,625.2))
    for dx in (0,203): ta_bort_givare_gt41(s,dx)
    s.bort_text('FLV10-GT41','FLV11-GT41')
    # andra ventilen (FLV11-SV21) finns inte – en gemensam STV201
    s.bort_ruta(284,186,352,216,behall_ror=False); s.bort_ruta(284,186,297,460,behall_svart=True); s.bort_text('FLV11-SV21')
    s.byt_inom('FLV10','4664-FLK101',90,200); s.byt_inom('FLV10-SV21','4664-STV201',90,200); s.byt('FLV11','4664-FLK102')
    # kylrummen i högra rummet
    s.bort_ruta(545,62,700,460,behall_ror=False,behall_svart=True)
    s.ersatt_ror((70.0,69.2,645.4,71.4),70,69.2,386.5,71.4); s.ersatt_ror((70.0,123.5,606.0,125.6),70,123.5,346.2,125.6)
    byt(s,{'VS11':'KB11','Matsal':'Storkök','1021':'4664','Kök':'Kyl- och frysrum','1030':'1038, 1050, 1052, 1054'})
    for i,nr in enumerate(('1038','1050','1052','1054')): rumsgivare(s,563+i*40,240,f'{nr}-GT101',storlek=6)
    s.importera(ff101(),380,178,436,231,-160,87); s.ny_text(268,281,'4664-CF101',7.2); s.ny_text(196,281,'GP601',7.2)
    s.ny_io(282,290,'DU',knack=(276,290)); s.ny_io(225,298,'DI')
    rumsgivare(s,430,300,'4664-GT101')
    return s

KB01F=(0.0,0.0,1.0); KB11F=(0.2,0.59,0.86)
MAGENTA=lambda c: c[0]>0.9 and c[1]<0.2 and c[2]>0.9

def kyla(PB):
    s=Sida(H2+'DK2 VP01VS01VV01.pdf')
    s.bort_ruta(0,150,842,376,behall_ror=False)              # allt under VS01 (tappvatten, kallvatten)
    for bb in ((197.2,88,199.2,216.2),(177.4,142.4,179.5,270.6)): s.bort_exakt(bb)
    s.bort_ruta(0,0,842,480,roller=('io',))                  # I/O ritas om nedan
    s.bort_ruta(72,130,94,152,behall_ror=True); s.bort_text('VP01-MQ41-MF41')
    # KB01-pumpar (kopior av VS01-P1) och KB01-GP601 (kopia av expansionskärl + GP41)
    for x in (160,235): s.kopiera(484,76,514,106,x-495.4,0)
    s.kopiera(578,100,604,142.4,243-600,0)
    s.farga(0,0,842,370,MAGENTA,KB01F); s.farga(0,0,300,370,ORANGE,KB01F); s.farga(300,0,842,370,ORANGE,KB11F)
    s.ersatt_ror((217.7,141.6,265.2,211.0),177.4,141.3,265.2,143.4)
    s.bort_ruta(520,408,530,425); s.bort_ruta(74,60,106,150,roller=('flode',))
    byt(s,{'VP01-MQ41-GT41':'KB01-GT101','VP01-MQ41-GT42':'KB01-GT401','VS01-SV11':'KB11-STV201','VS01-GT11':'KB11-GT101','VS01-P1':'KB11-PK501',
           'VS01-GT41':'KB11-GT401','VS01-GP41':'KB11-GP601','FJV':'KB01 borrhål','VS01':'KB11 komfortkyla'})
    s.ny_text(145,72,'KB01-PK501',8.65); s.ny_text(220,72,'KB01-PK502',8.65); s.ny_text(250,105,'KB01-GP601',8.65)
    for x in (160,235,495.4): s.ny_io(x,101,'DU'); s.ny_io(x+4,101,'DI',knack=(x,101))
    s.ny_io(118,75,'AI',knack=(112,75)); s.ny_io(124,128,'AI',knack=(112,128))
    s.ny_io(256,134,'AU',knack=(266,134)); s.ny_io(362,72,'AI',knack=(355,72))
    s.ny_io(540,128,'AI',knack=(546,128)); s.ny_io(604,110,'AI',knack=(598,110)); s.ny_io(247,110,'AI',knack=(241,110))
    s.larm(700,'KB11-AL01 Summalarm avgasare','AL01'); s.larm(722,'KB11-SO01 Serviceomkopplare','SO01')
    return s

def vav_sidor(PB):
    import json
    vav=json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'exempeldata','karlsangskolan_vav_rum.json')))
    plan={}
    for r in vav: plan.setdefault(r['plan'].split(' (')[0],[]).append(r)
    ut=[]
    D=241.4
    for p,rr in plan.items():
        sidor=[rr[i:i+3] for i in range(0,len(rr),3)]
        for si,grupp in enumerate(sidor,1):
            s=Sida(H1+'H1/DK2 LB01_4.pdf')
            s.bort_text('Placerad i 1102 Korridor','Placerad i 1108 Preprum','Placerad i 1114 Samtal/vila','Placerad i 1113 Mediarum','Placerad i 1117 Förråd')
            s.byt('Hus H plan 11',f'{p} – VAV-rum, blad {si} av {len(sidor)}')
            s.ny_text(40,50,'Alla objekt föregås av rumsnummer om ej annat anges.',7.2)
            s.byt('Blad 4',f'Forts. blad {si-1}' if si>1 else ''); s.byt('Blad 6',f'Forts. blad {si+1}' if si<len(sidor) else '')
            s.byt('RC101','RC01')
            namn=lambda r: f"{r['nr']} {r['namn'].capitalize()}"
            etik=[('1107 Klassrum / NO',None),('1109 Uppehållsrum,','1110 Bibliotek'),('1115 Lärarrum',None)]
            for j in range(3):
                a,b=etik[j]
                if j<len(grupp):
                    s.byt(a,namn(grupp[j]))
                    if b: s.bort_text(b)
                else:
                    s.bort_ruta(58+j*D,60,300+j*D,480,behall_ror=False)
                    s.bort_text(a); 
                    if b: s.bort_text(b)
            ut.append((f'VAV {p} blad {si}/{len(sidor)}',s))
    return ut

_KALLOR={}
def kalla(namn):
    if namn not in _KALLOR:
        _KALLOR[namn]=Sida({'vs':H2+'DK2 VP01VS01VV01.pdf','vv':H1+'G/DK4 VV.pdf','ff':H1+'AS01/DK3 FF101.pdf'}[namn])
    return _KALLOR[namn]
# symboler ur HECO:s bilder: (källa, ruta, ankarpunkt på röret)
SYMB={'givare':('vs',(344.9,67.8,355.8,88.0),(350.3,88)),'pump':('vs',(490.3,82.8,508.1,104.6),(495.4,88)),
      'matare':('vs',(153.1,300.1,167.6,314.6),(160.3,307.3)),'ventil':('vs',(258.4,131.3,275.6,145.6),(270,142.4)),
      'vvx':('vs',(304.4,82.5,340.2,148.1),(322.3,115.3)),'exp':('vs',(581.7,106.1,603.7,137.9),(587.7,142.4)),
      'pil_h':('vs',(36.0,83.9,48.8,91.9),(42.4,87.9)),'pil_v':('vs',(37.3,138.4,50.0,146.3),(43.6,142.4)),
      'tank':('vv',(321.6,150.8,377.1,242.0),(349.3,196.4))}
def satt(s,typ,x,y):
    k,bb,(ax,ay)=SYMB[typ]; s.importera(kalla(k),*bb,x-ax,y-ay)
def ror_h(s,x0,x1,y,farg,w=2.1): s.ny_rekt(min(x0,x1),y-w/2,max(x0,x1),y+w/2,farg='none',w=0,fyll=farg)
def ror_v(s,x,y0,y1,farg,w=2.1): s.ny_rekt(x-w/2,min(y0,y1),x+w/2,max(y0,y1),farg='none',w=0,fyll=farg)
ORG='#ff9505'; MAG='#ff00ff'; KBB='#0000ff'
def vp_sida(PB):
    """VP01–VP03 värmepumpar, VS01 till ackumulatortank VS02-ACK1, VS02 ut till förbrukarna (enligt W-50-8-200)."""
    s=Sida(H2+'DK2 VP01VS01VV01.pdf')
    s.bort_ruta(0,0,842,376,behall_ror=False); s.bort_ruta(0,0,842,480,roller=('io',))
    for e in s.texter():
        if e['roll']=='flode': e['roll']='bort'
    # värmepumpar
    yf,yr=165,228
    for i,(vp,typ,kw) in enumerate((('VP01','VPU1 MEGA XL','78 kW'),('VP02','VPU2 MEGA XL','78 kW'),('VP03','VPU3 MEGA L','55 kW'))):
        x=80+i*70
        s.ny_rekt(x-18,255,x+18,305,farg='#8f8f8f',w=0.72,fyll='#dddddc')
        s.ny_text(x-12,268,vp,8.65); s.ny_text(x-16,284,typ,5.2); s.ny_text(x-16,292,kw,5.2)
        ror_v(s,x-8,yf,255,ORG); ror_v(s,x+8,yr,255,ORG)
        ror_v(s,x-8,305,330,KBB); ror_v(s,x+8,305,345,KBB)
    s.ny_text(52,250,'BACnet/IP',5.76)
    ror_h(s,72,303,yf,ORG); ror_h(s,88,303,yr,ORG)
    ror_h(s,50,248,330,KBB); ror_h(s,50,248,345,KBB); satt(s,'pil_v',44,330); satt(s,'pil_h',44,345)
    s.ny_text(40,358,'KB01 borrhål (köldbärare)',5.76)
    # ackumulatortank
    satt(s,'tank',330,195); s.ny_text(305,140,'VS02-ACK1',8.65); s.ny_text(305,147,'50 °C',5.76)
    satt(s,'matare',260,yr); s.ny_text(238,246,'VS01-VMM01',8.65); s.ny_io(260,yr+7,'M-bus')
    s.ny_text(150,158,'VS01 från värmepumparna',5.76)
    # VS02 ut till förbrukarna
    ys2,yr2=160,232
    ror_h(s,357,790,ys2,ORG); ror_h(s,357,790,yr2,ORG); satt(s,'pil_h',800,ys2); satt(s,'pil_v',800,yr2)
    s.ny_text(690,152,'VS02 till VS21, VS31, VS41, VS42',5.76)
    s.ny_text(690,244,'VS02 från förbrukarna',5.76)
    # avgasare VS02-AG01
    ror_v(s,420,yr2,255,ORG,1.4); s.ny_rekt(408,255,432,272,farg='#000000',w=0.72); s.ny_text(410,266,'MAG61',6.5)
    s.ny_text(437,266,'VS01-AL201 (VS02-AG01)',7.2); s.ny_io(424,272,'DI')
    # gren till luftbehandlingens batterier med energimätare VS01-VMM02
    ror_v(s,560,ys2,55,ORG); ror_v(s,585,yr2,55,ORG)
    satt(s,'matare',585,95); s.ny_text(592,98,'VS01-VMM02',8.65); s.ny_io(598,102,'M-bus',knack=(589,102))
    s.ny_text(535,50,'LB01–LB03 värme-/kylbatterier',5.76)
    # fjärrvärme in på VS02 (prefab VVX1, se nästa bild)
    ror_v(s,690,ys2,290,ORG); ror_v(s,715,yr2,290,ORG)
    s.ny_rekt(670,290,735,330,farg='#000000',w=0.72,streckad=True); s.ny_text(673,305,'Prefab VVX1',6.5); s.ny_text(673,314,'fjärrvärme (VP01)',6.5); s.ny_text(673,323,'se bild VS01 VV01',5.76)
    s.ny_text(40,40,'Värmepumparna har inbyggd styrning (inkoppling, temperaturer, pumpar) och läses via BACnet. Enligt W-50-8-200.',5.76)
    return s

def alla(PB):
    """Alla flödesbilder för Karlsängskolan: (namn, Ritbord-data)."""
    lista=[('AS001 Generella',generella(PB)),('VP01–VP03 Värmepumpar och ackumulator',vp_sida(PB)),('VS01 VV01 Fjärrvärme, värme och tappvatten',vs01()),('KB01 KB11 Kyla',kyla(PB)),
           ('VS21 Radiatorer',shunt('VS21','Radiatorer / konvektorer')),('VS31 Golvvärme',shunt('VS31','Golvvärme',True)),
           ('LRA101 Luftridåer',lra(PB)),('FLK101 Undercentral och 1255 Elcentral',flk(PB)),('4664 Storkök kyla och kylrum',kok(PB))]
    lista+=flaktsidor(PB)
    lista+=[(f'LB0{n} Luftbehandling',lb(PB,n)) for n in (1,2,3)]
    lista+=vav_sidor(PB)
    return [(n,s.data('AS001',n)) for n,s in lista]

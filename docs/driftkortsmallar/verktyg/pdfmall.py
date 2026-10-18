"""Läser HECO:s historiska driftkortsbilder (PDF, vektor) och gör om dem till Ritbord-data.
Allt mäts i pt (PDF) och skalas till Ritbordets px (96/72). AS-linjen och I/O-raderna tas bort
(Ritbordets driftkortsmall ritar dem), I/O-strecken läggs i lagret I/O och resten i Flödesbild."""
import pymupdf, html, re
from ritbordbas import item, driftkortsmall, DOC, F
PT=96/72
AS=379.80; RADY=[421.86,432.24,442.59,452.94,463.29,473.67]
IOGRA=(0.50196,)
def _c(c): return None if c is None else '#%02x%02x%02x'%tuple(round(v*255) for v in c)
def _ror(d):
    for c in (d.get('color'),d.get('fill')):
        if c is not None and max(c)-min(c)>0.35: return True
    return False
def _ror(d):
    for c in (d.get('color'),d.get('fill')):
        if c is not None and max(c)-min(c)>0.35: return True
    return False
def _grey502(c): return c is not None and all(abs(v-0.50196)<0.004 for v in c)

class Sida:
    def __init__(s,pdf):
        p=pymupdf.open(pdf)[0]; s.el=[]; s.extra_io=[]; s.extra_io=[]
        for d in p.get_drawings():
            s.el.append({'k':'p','d':d,'bb':tuple(d['rect']),'id':len(s.el)})
        for b in p.get_text('rawdict')['blocks']:
            if b['type']!=0: continue
            for l in b['lines']:
                for sp in l['spans']:
                    t=''.join(ch['c'] for ch in sp['chars'])
                    if not t.strip(): continue
                    s.el.append({'k':'t','text':t,'x':sp['origin'][0],'y':sp['origin'][1],'size':sp['size'],
                                 'color':'#%06x'%sp['color'],'dir':l['dir'],'bb':tuple(sp['bbox']),'id':len(s.el)})
        s.klassa(); s.n_orig=len(s.el)
    def klassa(s):
        for e in s.el:
            x0,y0,x1,y1=e['bb']
            e['roll']='flode'
            if e['k']=='t':
                if y0>AS-16 and e['text'].strip() in ('Di','Ai','Du','Au','M-bus','Modbus','TCP/IP LAN','C/G') : e['roll']='mall'
                elif abs(e['y']-(AS-7))<6 and (x0<60 or x1>780): e['roll']='mall'        # AS-namn i kanterna
                continue
            d=e['d']
            if d['type']=='s' and _c(d['color']) in ('#ff0000',) and abs(y0-AS)<1.5 and abs(y1-AS)<1.5: e['roll']='mall'; continue
            if d['type']=='s' and _grey502(d['color']) and y1-y0<0.5 and x1-x0>300 and y0>AS+20: e['roll']='mall'; continue
            if d['type']=='s' and _grey502(d['color']) and all(it[0]=='l' and (abs(it[1].x-it[2].x)<0.3 or abs(it[1].y-it[2].y)<0.3) for it in d['items']): e['roll']='io'; continue
            if d['type'] in ('f','fs') and _c(d['fill'])=='#000000' and x1-x0<4.5 and y1-y0<4.5 and y0>AS-4: e['roll']='io'; continue
        # grå streck som inte når ner till AS-linjen är del av en symbol, inte I/O
        for g in _klustra([e for e in s.el if e['roll']=='io']):
            if max(e['bb'][3] for e in g)<AS-3:
                for e in g: e['roll']='flode'
    # ---------- redigering ----------
    def texter(s): return [e for e in s.el if e['k']=='t']
    def byt(s,gammal,ny):
        n=0
        for e in s.texter():
            if e['text']==gammal: e['text']=ny; n+=1
        assert n, f'text saknas: {gammal}'
    def bort_ruta(s,x0,y0,x1,y1,roller=('flode','io'),behall_ror=True,bara_original=False,typ=None,behall_svart=False):
        """Tar bort allt som ligger helt inom rutan (pt). Rör (mättade färger) behålls som standard."""
        n=0
        for e in s.el:
            a,b,c,d=e['bb']
            if e['roll'] in roller and a>=x0-0.01 and b>=y0-0.01 and c<=x1+0.01 and d<=y1+0.01:
                if bara_original and e['id']>=s.n_orig: continue
                if typ and (e['k']!='p' or 'd' not in e or e['d']['type']!=typ): continue
                if behall_svart and e['k']=='p' and 'd' in e and e['d']['type']=='s' and _c(e['d']['color'])=='#000000': continue
                if behall_ror and e['k']=='p' and _ror(e['d']): continue
                e['forra']=e['roll']; e['roll']='bort'; n+=1
        return n
    def bort_exakt(s,*bbs,tol=0.3):
        for e in s.el:
            if any(all(abs(u-v)<tol for u,v in zip(e['bb'],bb)) for bb in bbs): e['forra']=e['roll']; e['roll']='bort'
    def byt_inom(s,gammal,ny,x0,x1):
        n=0
        for e in s.texter():
            if e['text']==gammal and x0<=e['bb'][0]<=x1: e['text']=ny; n+=1
        assert n, f'text saknas: {gammal} inom {x0}-{x1}'
    def farga(s,x0,y0,x1,y1,villkor,ny):
        """Byter färg (rgb 0–1) på grafik i rutan där villkor(rgb) är sant."""
        for e in s.el:
            a,b,c,d=e['bb']
            if e['k']!='p' or 'd' not in e or not (a>=x0 and b>=y0 and c<=x1 and d<=y1): continue
            dd=dict(e['d'])
            for f in ('color','fill'):
                if dd.get(f) is not None and villkor(dd[f]): dd[f]=ny
            e['d']=dd
    def ersatt_ror(s,bb,x0,y0,x1,y1):
        """Kortar av ett rör (fylld rektangel) – det gamla tas bort och ritas om med nya mått."""
        for e in s.el:
            if e['k']=='p' and 'd' in e and all(abs(u-v)<0.3 for u,v in zip(e['bb'],bb)):
                e['roll']='bort'; f=e['d']['fill']
                s.ny_rekt(x0,y0,x1,y1,farg='none',w=0,fyll=_c(f)); return
        raise AssertionError(f'rör saknas {bb}')
    def kopiera(s,x0,y0,x1,y1,dx,dy,texter=False,roller=('flode',),inkl_bort=False):
        """Kopierar grafik (och ev. texter) inom rutan till ny plats. Returnerar de nya elementen."""
        import copy
        nya=[]
        for e in list(s.el):
            a,b,c,d=e['bb']
            if e['id']>=s.n_orig: continue
            if e['roll']=='bort' and not inkl_bort: continue
            r=e.get('forra','bort') if e['roll']=='bort' else e['roll']
            if r in roller and a>=x0 and b>=y0 and c<=x1 and d<=y1 and (texter or e['k']=='p'):
                n=copy.copy(e); n['roll']=r; n['dx']=e.get('dx',0)+dx; n['dy']=e.get('dy',0)+dy; n['bb']=(a+dx,b+dy,c+dx,d+dy); n['id']=len(s.el)
                s.el.append(n); nya.append(n)
        return nya
    def importera(s,annan,x0,y0,x1,y1,dx,dy,texter=False):
        """Kopierar grafik från en annan historisk bild (t.ex. en symbol som saknas i mallen)."""
        import copy
        for e in annan.el:
            a,b,c,d=e['bb']
            if e['roll'] in ('flode','io') and a>=x0 and b>=y0 and c<=x1 and d<=y1 and (texter or e['k']=='p'):
                n=copy.copy(e); n['roll']='flode'; n['dx']=e.get('dx',0)+dx; n['dy']=e.get('dy',0)+dy; n['bb']=(a+dx,b+dy,c+dx,d+dy); n['id']=len(s.el); s.el.append(n)
    def ny_text(s,x,y,text,size=8.65,vert=False,color='#000000'):
        s.el.append({'k':'t','text':text,'x':x,'y':y,'size':size,'color':color,'dir':(0,-1) if vert else (1,0),
                     'bb':(x-size,y-len(text)*size*.55,x,y) if vert else (x,y-size,x+len(text)*size*.55,y),'id':len(s.el),'roll':'flode'})
    def ny_streck(s,pts):
        """Grått streckat streck utan punkt i änden (t.ex. från givare till regulator), i I/O-lagret."""
        s.extra_io.append(('streck',pts,None,None))
    def ny_prick(s,x,y):
        s.extra_io.append(('prick',x,y,None))
    def ny_io(s,x,ytopp,typ,knack=None):
        """Nytt I/O-streck (pt) lodrätt ner till raden typ (DI/AI/DU/AU/M-bus/Modbus). knack=(x0,y0): vågrät bit först."""
        s.extra_io.append((x,ytopp,typ,knack))
    def flytta_text(s,text,dx,dy=0):
        for e in s.texter():
            if e['text']==text: e['dx']=e.get('dx',0)+dx; e['dy']=e.get('dy',0)+dy
    def bort_text(s,*txt):
        for e in s.texter():
            if e['text'] in txt: e['roll']='bort'
    def flytta(s,x0,y0,x1,y1,dx,dy):
        for e in s.el:
            a,b,c,d=e['bb']
            if e['roll']!='bort' and a>=x0 and b>=y0 and c<=x1 and d<=y1: e.setdefault('dx',0); e.setdefault('dy',0); e['dx']+=dx; e['dy']+=dy
    # ---------- utdata ----------
    def ny_svg(s,svg,bb):
        """Egen grafik i pt (t.ex. rektangel i samma stil som mallen)."""
        s.el.append({'k':'p','svg':svg,'bb':bb,'roll':'flode','id':len(s.el)})
    def ny_rekt(s,x0,y0,x1,y1,farg='#000000',w=0.72,streckad=False,fyll='none'):
        da=' stroke-dasharray="4.14 2.07"' if streckad else ''
        s.ny_svg(f'<rect x="{F(x0)}" y="{F(y0)}" width="{F(x1-x0)}" height="{F(y1-y0)}" fill="{fyll}" stroke="{farg}" stroke-width="{F(w)}"{da}></rect>',(x0,y0,x1,y1))
    def larm(s,x,txt,kort,typ='DI',ytext=372,storlek=8.65):
        """Larm/indikering som i DK1 Generella: lodrät text, streck, ruta med förkortning, I/O ner till raden."""
        s.ny_text(x+3,ytext-2,txt,storlek,vert=True)
        s.ny_streck([(x,ytext),(x,396.5)])
        w=max(len(kort)*4.6+5,15)
        s.ny_rekt(x-w/2,396.5,x+w/2,404.8)
        s.ny_text(x-w/2+2.5,403.3,kort,6.5)
        s.ny_io(x,404.8,typ)
    def _svg(s,e):
        if 'svg' in e: return e['svg']
        dx,dy=e.get('dx',0),e.get('dy',0)
        if e['k']=='t':
            rot=''
            if abs(e['dir'][0])<0.5:
                ang=-90 if e['dir'][1]<0 else 90
                rot=f' transform="rotate({ang} {F(e["x"]+dx)} {F(e["y"]+dy)})"'
            return (f'<text x="{F(e["x"]+dx)}" y="{F(e["y"]+dy)}" font-size="{F(e["size"])}" fill="{e["color"]}" '
                    f'font-family="Malgun Gothic, Segoe UI, Arial, sans-serif"{rot}>{html.escape(e["text"])}</text>')
        d=e['d']; parts=[]
        for it in d['items']:
            op=it[0]
            if op=='l': parts.append(f'M{F(it[1].x+dx)},{F(it[1].y+dy)}L{F(it[2].x+dx)},{F(it[2].y+dy)}')
            elif op=='c': parts.append(f'M{F(it[1].x+dx)},{F(it[1].y+dy)}C{F(it[2].x+dx)},{F(it[2].y+dy)} {F(it[3].x+dx)},{F(it[3].y+dy)} {F(it[4].x+dx)},{F(it[4].y+dy)}')
            elif op=='re': r=it[1]; parts.append(f'M{F(r.x0+dx)},{F(r.y0+dy)}H{F(r.x1+dx)}V{F(r.y1+dy)}H{F(r.x0+dx)}Z')
            elif op=='qu': q=it[1]; parts.append(f'M{F(q.ul.x+dx)},{F(q.ul.y+dy)}L{F(q.ur.x+dx)},{F(q.ur.y+dy)}L{F(q.lr.x+dx)},{F(q.lr.y+dy)}L{F(q.ll.x+dx)},{F(q.ll.y+dy)}Z')
        # sammanhängande delbanor: slå ihop M som börjar där förra slutade
        p=''.join(parts)
        p=re.sub(r'L([-\d.]+),([-\d.]+)M\1,\2',r'L\1,\2',p); p=re.sub(r'(C[-\d., ]+ ([-\d.]+),([-\d.]+))M\2,\3',r'\1',p)
        if d.get('closePath'): p+='Z'
        fill=_c(d['fill']) if d['type'] in ('f','fs') else 'none'
        st=_c(d['color']) if d['type'] in ('s','fs') else 'none'
        a=f'<path d="{p}" fill="{fill}"'
        if d['type'] in ('f','fs') and d.get('even_odd'): a+=' fill-rule="evenodd"'
        if st!='none':
            lc={0:'butt',1:'round',2:'square'}.get((d.get('lineCap') or (0,))[0],'butt'); lj={0:'miter',1:'round',2:'bevel'}.get(int(d.get('lineJoin') or 0),'miter')
            a+=f' stroke="{st}" stroke-width="{F(d["width"] or 0.1)}" stroke-linecap="{lc}" stroke-linejoin="{lj}"'
        return a+'></path>'
    def data(s,skap,namn,extra_flode='',extra_io=''):
        """Ritbord-data: hela flödesbilden som en mall-grupp (kan delas upp i Ritbordet), texterna som egna objekt."""
        k=PT; n=[0]
        def nid(p): n[0]+=1; return f'{p}_{n[0]}'
        flode=[e for e in s.el if e['roll']=='flode']
        grafik=''.join(s._svg(e) for e in flode if e['k']=='p')
        bb=[e['bb'] for e in flode if e['k']=='p'] or [(0,0,1,1)]
        x0=min(b[0] for b in bb); y0=min(b[1] for b in bb); x1=max(b[2] for b in bb); y1=max(b[3] for b in bb)
        items=[item(nid('mall'),f'Mall: {namn}',x0,y0,x1-x0,y1-y0,grafik,sx=k,sy=k,tx=(k-1)*x0,ty=(k-1)*y0)]
        # texter som egna objekt, i px
        for e in flode:
            if e['k']!='t': continue
            dx,dy=e.get('dx',0),e.get('dy',0)
            x,y,sz=(e['x']+dx)*k,(e['y']+dy)*k,e['size']*k
            vert=abs(e['dir'][0])<0.5
            bw=max(len(e['text'])*sz*0.55,4); bh=sz*1.2
            rot=f' transform="rotate({-90 if e["dir"][1]<0 else 90} {F(x)} {F(y)})"' if vert else ''
            bx,by,bw2,bh2=(x-sz,y-bw,bh,bw) if vert else (x,y-sz,bw,bh)
            if vert:
                items.append(item(nid('text'),'Text',bx,by,bw2,bh2,f'<text x="{F(x)}" y="{F(y)}" fill="{e["color"]}" font-size="{F(sz)}" font-family="Malgun Gothic, Segoe UI, Arial, sans-serif"{rot}>{html.escape(e["text"])}</text>'))
            else:
                items.append(item(nid('text'),'Text',bx,by,bw2,bh2,f'<tspan x="{F(x)}" dy="0">{html.escape(e["text"])}</tspan>',tagg='text',
                extra=f' x="{F(x)}" y="{F(y)}" fill="{e["color"]}" font-size="{F(sz)}" font-family="Malgun Gothic, Segoe UI, Arial, sans-serif" text-anchor="start" font-style="normal" font-weight="400"'))
        items.append(extra_flode)
        # I/O-streck: en grupp per sammanhängande streck
        io=[e for e in s.el if e['roll']=='io']
        grupper=_klustra(io)
        ioit=[]
        for g in grupper:
            bbs=[e['bb'] for e in g]
            a=min(b[0] for b in bbs); b_=min(b[1] for b in bbs); c=max(b[2] for b in bbs); d=max(b[3] for b in bbs)
            ioit.append(item(nid('io'),'I/O',a,b_,max(c-a,.5),max(d-b_,.5),''.join(s._svg(e) for e in g),sx=k,sy=k,tx=(k-1)*a,ty=(k-1)*b_))
        RY={'DI':RADY[0],'AI':RADY[1],'DU':RADY[2],'AU':RADY[3],'M-bus':RADY[4],'Modbus':RADY[5]}
        for x,yt,typ,kn in s.extra_io:
            if x=='streck':
                pts=yt; pp=' '.join(f'{F(a*k)},{F(b*k)}' for a,b in pts)
                inre=f'<polyline points="{pp}" stroke="#808080" stroke-width="{F(0.72*k)}" stroke-dasharray="{F(8.28*k)} {F(4.14*k)}" stroke-linejoin="miter" fill="none"></polyline>'
                for i in range(1,len(pts)):
                    (a1,b1),(a2,b2)=pts[i-1],pts[i]
                    if (b1-AS)*(b2-AS)<0: inre+=f'<circle cx="{F((a1+(a2-a1)*(AS-b1)/(b2-b1))*k)}" cy="{F(AS*k)}" r="{F(1.56*k)}" fill="#000000"></circle>'
                xs=[a*k for a,_ in pts]; ys=[b*k for _,b in pts]
                ioit.append(item(nid('io'),'I/O streck',min(xs)-2,min(ys)-2,max(xs)-min(xs)+4,max(ys)-min(ys)+4,inre)); continue
            if x=='prick':
                ioit.append(item(nid('io'),'Punkt',yt*k-2.1,typ*k-2.1,4.2,4.2,f'<circle cx="{F(yt*k)}" cy="{F(typ*k)}" r="{F(1.56*k)}" fill="#000000"></circle>')); continue
            ry=RY[typ]; pts=([(kn[0],kn[1]),(x,kn[1])] if kn else [(x,yt)])+[(x,ry)]
            pp=' '.join(f'{F(a*k)},{F(b*k)}' for a,b in pts)
            inre=(f'<polyline points="{pp}" stroke="#808080" stroke-width="{F(0.72*k)}" stroke-dasharray="{F(8.28*k)} {F(4.14*k)}" stroke-linejoin="miter" fill="none"></polyline>'
                  f'<circle cx="{F(x*k)}" cy="{F(ry*k)}" r="{F(1.56*k)}" fill="#000000"></circle>')
            if pts[0][1]<AS<ry and not (kn is None and abs(yt-AS)<0.01): inre+=f'<circle cx="{F(x*k)}" cy="{F(AS*k)}" r="{F(1.56*k)}" fill="#000000"></circle>'
            xs=[a*k for a,_ in pts]; ys=[b*k for _,b in pts]
            ioit.append(item(nid('io'),f'I/O {typ}',min(xs)-2,min(ys),max(xs)-min(xs)+4,max(ys)-min(ys)+2,inre))
        RY={'DI':RADY[0],'AI':RADY[1],'DU':RADY[2],'AU':RADY[3],'M-bus':RADY[4],'Modbus':RADY[5]}
        for x,yt,typ,kn in s.extra_io:
            if x=='streck':
                pts=yt; pp=' '.join(f'{F(a*k)},{F(b*k)}' for a,b in pts)
                inre=f'<polyline points="{pp}" stroke="#808080" stroke-width="{F(0.72*k)}" stroke-dasharray="{F(8.28*k)} {F(4.14*k)}" stroke-linejoin="miter" fill="none"></polyline>'
                for i in range(1,len(pts)):
                    (a1,b1),(a2,b2)=pts[i-1],pts[i]
                    if (b1-AS)*(b2-AS)<0: inre+=f'<circle cx="{F((a1+(a2-a1)*(AS-b1)/(b2-b1))*k)}" cy="{F(AS*k)}" r="{F(1.56*k)}" fill="#000000"></circle>'
                xs=[a*k for a,_ in pts]; ys=[b*k for _,b in pts]
                ioit.append(item(nid('io'),'I/O streck',min(xs)-2,min(ys)-2,max(xs)-min(xs)+4,max(ys)-min(ys)+4,inre)); continue
            if x=='prick':
                ioit.append(item(nid('io'),'Punkt',yt*k-2.1,typ*k-2.1,4.2,4.2,f'<circle cx="{F(yt*k)}" cy="{F(typ*k)}" r="{F(1.56*k)}" fill="#000000"></circle>')); continue
            ry=RY[typ]; pts=([(kn[0],kn[1]),(x,kn[1])] if kn else [(x,yt)])+[(x,ry)]
            pp=' '.join(f'{F(a*k)},{F(b*k)}' for a,b in pts)
            inre=(f'<polyline points="{pp}" stroke="#808080" stroke-width="{F(0.72*k)}" stroke-dasharray="{F(8.28*k)} {F(4.14*k)}" stroke-linejoin="miter" fill="none"></polyline>'
                  f'<circle cx="{F(x*k)}" cy="{F(ry*k)}" r="{F(1.56*k)}" fill="#000000"></circle>')
            if pts[0][1]<AS<ry and not (kn is None and abs(yt-AS)<0.01): inre+=f'<circle cx="{F(x*k)}" cy="{F(AS*k)}" r="{F(1.56*k)}" fill="#000000"></circle>'
            xs=[a*k for a,_ in pts]; ys=[b*k for _,b in pts]
            ioit.append(item(nid('io'),f'I/O {typ}',min(xs)-2,min(ys),max(xs)-min(xs)+4,max(ys)-min(ys)+2,inre))
        ioit.append(extra_io)
        rader,fot=driftkortsmall(skap)
        st=(f'<g data-lid="lay_flode" data-lname="Flödesbild">{"".join(items)}</g>'
            f'<g data-lid="lay_iomall" data-lname="I/O-rader (mall)" data-mall="driftkort" data-io="mall" data-llock="1">{rader}</g>'
            f'<g data-lid="lay_io" data-lname="I/O" data-io="streck">{"".join(ioit)}</g>'
            f'<g data-lid="lay_sidfot" data-lname="Sidfot (följer inte med)" data-noexp="1" data-llock="1">{fot}</g>')
        return {'v':1,'doc':DOC,'stage':st,'idCounter':n[0]+1,'activeLayerId':'lay_flode'}

def _klustra(io,tol=5.0):
    """Slår ihop streckbitar och punkter som ligger nära varandra (ett I/O-streck per grupp)."""
    par=list(range(len(io)))
    def f(i):
        while par[i]!=i: par[i]=par[par[i]]; i=par[i]
        return i
    def nara(a,b):
        return not (a[0]>b[2]+tol or b[0]>a[2]+tol or a[1]>b[3]+tol or b[1]>a[3]+tol)
    # lodräta bitar på samma x hör ihop; vågräta knäckar kopplar ihop
    for i in range(len(io)):
        for j in range(i+1,len(io)):
            a,b=io[i]['bb'],io[j]['bb']
            sammax=abs((a[0]+a[2])/2-(b[0]+b[2])/2)<0.6 and (a[2]-a[0])<2 and (b[2]-b[0])<2
            if (sammax and nara(a,b)) or (nara(a,b) and ((a[2]-a[0])>2 or (b[2]-b[0])>2) and not ((a[2]-a[0])<5 and (a[3]-a[1])<5 and (b[2]-b[0])<5 and (b[3]-b[1])<5)):
                par[f(i)]=f(j)
    g={}
    for i,e in enumerate(io): g.setdefault(f(i),[]).append(e)
    return list(g.values())

def rapport(s):
    for e in s.texter():
        if e['roll']=='flode': print('T',[round(v) for v in e['bb']],e['text'])
    for g in _klustra([e for e in s.el if e['roll']=='io']):
        bbs=[e['bb'] for e in g]; a=min(b[0] for b in bbs); b_=min(b[1] for b in bbs); c=max(b[2] for b in bbs); d=max(b[3] for b in bbs)
        rad=[n for n,y in zip(['Di','Ai','Du','Au','Mb','Mod'],RADY) if any(abs(e['bb'][1]-y+1.5)<2.5 and e['d']['type']!='s' for e in g)]
        print('IO',[round(a,1),round(b_,1),round(c,1),round(d,1)],len(g),rad)

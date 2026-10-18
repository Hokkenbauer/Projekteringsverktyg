"""Flödesbilder byggda som i Ritbordet: driftkortsmall + grundmall (Ritmall 1.1) + symboler ur symbolbiblioteket + I/O-streck."""
import json, re, html
import os
HAR=os.path.dirname(os.path.abspath(__file__))
REPO=os.path.abspath(os.path.join(HAR,'..','..','..'))
MALLAR=json.load(open(os.path.join(REPO,'web','public','ritbord','mallar','ritmall-1.1.json')))
SYM={x['id']:x for x in json.load(open(os.path.join(HAR,'symboler.json')))}
PT=96/72
DOC={'w':round(841.89*PT,2),'h':round(595.28*PT,2)}
AS_Y=379.80*PT
RADER=[('Di',421.86,45.77,795.11),('Ai',432.24,45.98,794.81),('Du',442.59,45.98,794.81),('Au',452.94,45.98,794.81),('M-bus',463.29,63.20,777.62),('Modbus',473.67,70.01,770.81)]
RAD={'DI':421.86*PT,'AI':432.24*PT,'DU':442.59*PT,'AU':452.94*PT,'M-bus':463.29*PT,'Modbus RTU':473.67*PT,'Modbus TCP':473.67*PT}
STRECK=f'stroke="#808080" stroke-width="{0.72*96/72:.2f}" stroke-dasharray="{8.28*96/72:.2f} {4.14*96/72:.2f}" fill="none"'
YTA=(40,24,1082,AS_Y-36)          # flödesbildens yta (ovanför AS-raden)
F=lambda v: f'{v:.2f}'.rstrip('0').rstrip('.')

def item(gid,namn,bx,by,bw,bh,inre,tx=0,ty=0,sx=1,sy=1,lock=False,tagg='g',extra=''):
    t=f'translate({F(tx)} {F(ty)}) translate({F(bx)} {F(by)}) scale({F(sx)} {F(sy)}) translate({F(-bx)} {F(-by)})'
    return (f'<{tagg} id="{gid}" data-item="1" data-bx="{F(bx)}" data-by="{F(by)}" data-bw="{F(bw)}" data-bh="{F(bh)}" data-tx="{F(tx)}" data-ty="{F(ty)}" '
            f'data-sx="{F(sx)}" data-sy="{F(sy)}" transform="{t}"{" data-lock=\"1\"" if lock else ""} data-name="{html.escape(namn)}"{extra}>{inre}</{tagg}>')

def dk_text(x,y,t,anchor,fill='#000000'):
    return f'<text x="{F(x*PT)}" y="{F(y*PT)}" fill="{fill}" font-size="{F(8.9*PT)}" font-family="Arial, Helvetica, sans-serif" text-anchor="{anchor}">{html.escape(t)}</text>'

def driftkortsmall(skap):
    """Samma innehåll som Ritbordets rbDriftkortMall()."""
    g=(f'<line x1="{F(45.77*PT)}" y1="{F(AS_Y)}" x2="{F(795.11*PT)}" y2="{F(AS_Y)}" stroke="#ff0000" stroke-width="{F(0.72*PT)}" stroke-linecap="round" '
       f'stroke-dasharray="{F(20.7*PT)} {F(10.35*PT)}" stroke-dashoffset="{F(8.55*PT)}" fill="none"></line>'+dk_text(30.05,375.74,skap,'start')+dk_text(812.47,375.74,skap,'end'))
    for n,y,x1,x2 in RADER:
        g+=(f'<line x1="{F(x1*PT)}" y1="{F(y*PT)}" x2="{F(x2*PT)}" y2="{F(y*PT)}" stroke="#808080" stroke-width="{F(0.72*PT)}" stroke-linecap="round" fill="none"></line>'
            +dk_text(29.2,y+3.2,n,'start')+dk_text(811.55,y+3.2,n,'end'))
    rader=item('driftkort_rader',f'I/O-rader {skap}',45.77*PT-2,375.74*PT-12,785*PT,105*PT,g,lock=True)
    fot=item('sidfot_1','Sidfot',0,506*PT,DOC['w'],DOC['h']-506*PT,
             f'<rect x="0" y="{F(506*PT)}" width="{F(DOC["w"])}" height="{F(DOC["h"]-506*PT)}" fill="#808080" fill-opacity="0.12" stroke="none"></rect>'
             +dk_text(841.89/2,536,'Här hamnar sidfoten från Word-mallen','middle','#808080'),lock=True)
    return rader,fot

def panel_till_ram(svg):
    """Mallarnas grå rundade bakgrundspaneler blir streckade ramar som i HECO:s driftkort."""
    def f(m):
        t=m.group(0)
        w=re.search(r'width="([\d.]+)"',t); h=re.search(r'height="([\d.]+)"',t)
        if not (w and h and float(w.group(1))>40 and float(h.group(1))>40): return t
        t=re.sub(r'style="[^"]*"','style="fill:none;stroke:#000000;stroke-width:0.5;stroke-dasharray:2.6,1.5"',t)
        return re.sub(r'\s(rx|ry)="[^"]*"','',t)
    return re.sub(r'<rect[^>]*fill:#e5e5e5[^>]*>',f,svg)

class Bild:
    def __init__(s,namn,skap,perBet,prefix=None,rubrik=None):
        s.namn=namn; s.skap=skap; s.perBet=perBet; s.items=[]; s.io=[]; s.n=0; s.punkter=[]
        s.prefix=prefix
        s.rubrik=rubrik if rubrik is not None else (f'Alla objekt föregås av prefix {prefix} om ej annat anges.' if prefix else '')
        s.k=1; s.ox=0; s.oy=0
    def id(s,p): s.n+=1; return f'{p}_{s.n}'
    # ---- grundmall ----
    def mall(s,idx,ersatt=None,ruta=None,kopior=1,dx=0):
        t=MALLAR[idx]; x,y,w,h=map(float,t['vb'].split()); svg=t['svg']
        for a,b in (ersatt or {}).items(): svg=svg.replace(f'>{a}</tspan>',f'>{html.escape(b)}</tspan>')
        svg=panel_till_ram(svg)
        X0,Y0,X1,Y1=ruta or YTA
        ww=w*kopior+dx*(kopior-1)
        k=min((X1-X0)/ww,(Y1-Y0)/h); s.k=k
        s.ox=X0+((X1-X0)-ww*k)/2-x*k; s.oy=Y0+((Y1-Y0)-h*k)/2-y*k
        for i in range(kopior):
            sv=svg if i==0 else svg
            tx=s.ox+i*(w+dx)*k + x*k - x; ty=s.oy + y*k - y
            # som placeTemplate: bx/by = mallens vb, skala k runt (bx,by)
            s.items.append(item(s.id('mall'),f'Mall: {t["name"]}',x,y,w,h,sv,tx=s.ox+i*(w+dx)*k+x*k-x,ty=s.oy+y*k-y,sx=k,sy=k))
        s.mw=w; s.mdx=dx; s.mx=x
    def T(s,x,y,kopia=0): return (s.ox+(x+kopia*(s.mw+s.mdx))*s.k, s.oy+y*s.k)
    # ---- egen linje i mallens stil ----
    def linje(s,pts,farg,bredd=4,namn='Rör',pil=False):
        p=' '.join(f'{F(a)},{F(b)}' for a,b in pts)
        xs=[a for a,_ in pts]; ys=[b for _,b in pts]
        s.items.append(item(s.id('linje'),namn,min(xs),min(ys)-bredd/2,max(xs)-min(xs)+.001,max(ys)-min(ys)+bredd,
            f'<polyline points="{p}" stroke="{farg}" stroke-width="{bredd}" fill="none" stroke-linejoin="miter"></polyline>'))
    def rum(s,x,y,w,h,txt,pos='nv',storlek=8):
        """Streckad ram (rum, aggregat, shuntgrupp). Text nere till vänster (nv) eller uppe till vänster (ov)."""
        s.items.append(item(s.id('ram'),f'Ram {txt.splitlines()[0] if txt else ""}',x,y,w,h,
            f'<rect x="{F(x)}" y="{F(y)}" width="{F(w)}" height="{F(h)}" fill="none" stroke="#000000" stroke-width="1.2" stroke-dasharray="7 4"></rect>'))
        rader=txt.splitlines() if txt else []
        if pos=='nv':
            for i,t in enumerate(rader): s.text(x+4,y+h-5-(len(rader)-1-i)*(storlek+1.5),t,'start',storlek)
        else:
            for i,t in enumerate(rader): s.text(x+4,y+storlek+5+i*(storlek+1.5),t,'start',storlek)
    def ruta(s,x,y,txt,storlek=9,namn=None):
        """Liten textruta (Internstyr, AUT, MOXA …) centrerad på (x,y). Returnerar (vänster, topp, höger, botten)."""
        w=len(txt)*storlek*0.58+8; h=storlek+6
        s.items.append(item(s.id('ruta'),namn or f'Ruta {txt}',x-w/2,y-h/2,w,h,
            f'<rect x="{F(x-w/2)}" y="{F(y-h/2)}" width="{F(w)}" height="{F(h)}" fill="#ffffff" stroke="#000000" stroke-width="1"></rect>'
            f'<text x="{F(x)}" y="{F(y+storlek*0.36)}" fill="#000000" font-size="{storlek}" font-family="Arial, Helvetica, sans-serif" text-anchor="middle">{html.escape(txt)}</text>'))
        return (x-w/2,y-h/2,x+w/2,y+h/2)
    def vtext(s,x,y,t,storlek=8):
        """Lodrät text som läses nerifrån och upp, slutar vid (x,y)."""
        bw=len(t)*storlek*0.55
        s.items.append(item(s.id('vtext'),'Text',x-storlek,y-bw,storlek*1.2,bw,
            f'<text x="{F(x)}" y="{F(y)}" transform="rotate(-90 {F(x)} {F(y)})" fill="#000000" font-size="{storlek}" font-family="Arial, Helvetica, sans-serif" text-anchor="start">{html.escape(t)}</text>'))
    def koppling(s,pts,namn='Kopplingslinje'):
        """Grå streckad linje som inte är I/O (t.ex. givare till rumsregulator)."""
        xs=[a for a,_ in pts]; ys=[b for _,b in pts]; p=' '.join(f'{F(a)},{F(b)}' for a,b in pts)
        s.items.append(item(s.id('koppl'),namn,min(xs),min(ys),max(xs)-min(xs)+.001,max(ys)-min(ys)+.001,f'<polyline points="{p}" {STRECK}></polyline>'))
    def prick(s,x,y):
        s.items.append(item(s.id('prick'),'Punkt',x-2.1,y-2.1,4.2,4.2,f'<circle cx="{F(x)}" cy="{F(y)}" r="2.08" fill="#000000"></circle>'))
    def etikett_for(s,bet):
        if not bet: return bet
        if s.prefix and bet.upper().startswith(s.prefix.upper()+'-'): return bet[len(s.prefix)+1:]
        return bet
    def text(s,x,y,t,anchor='middle',storlek=8,vikt='400'):
        bw=len(t)*storlek*0.55; bx=x-(bw/2 if anchor=='middle' else (bw if anchor=='end' else 0))
        s.items.append(item(s.id('text'),'Text',bx,y-storlek,bw,storlek*1.2,f'<tspan x="{F(x)}" dy="0">{html.escape(t)}</tspan>',tagg='text',
            extra=f' x="{F(x)}" y="{F(y)}" fill="#000000" font-size="{storlek}" font-family="Arial, Helvetica, sans-serif" text-anchor="{anchor}" font-style="normal" font-weight="{vikt}"'))
    # ---- symbol ur biblioteket, centrerad på punkten (som i Ritbordet) ----
    def sym(s,sid,x,y,bet=None,etikett=None,pos='n',skala=1.0,rot=0,spegel=False,io=True,ioy=None):
        sy=SYM[sid]; _,_,w,h=map(float,sy['vb'].split())
        inre=sy['svg']
        if rot or spegel:
            tr=(f'rotate({rot} {F(w/2)} {F(h/2)})' if rot else '')+(f' matrix(-1 0 0 1 {F(w)} 0)' if spegel else '')
            inre=f'<g transform="{tr.strip()}">{inre}</g>'
        bw,bh=(h,w) if rot in (90,-90,270) else (w,h)
        bx=(w-bw)/2; by=(h-bh)/2
        tx=x-bx-bw*skala/2; ty=y-by-bh*skala/2
        s.items.append(item(s.id(sid),sy['name']+(f' {bet}' if bet else ''),bx,by,bw,bh,inre,tx=tx,ty=ty,sx=skala,sy=skala))
        hw,hh=bw*skala/2,bh*skala/2
        lab=etikett if etikett is not None else s.etikett_for(bet)
        if lab:
            if pos=='n': s.text(x,y-hh-3,lab)
            elif pos=='s': s.text(x,y+hh+9,lab)
            elif pos=='e': s.text(x+hw+4,y+4,lab,'start')
            elif pos=='w': s.text(x-hw-4,y+4,lab,'end')
        if bet and io: s.punkter.append((bet,x,(ioy if ioy is not None else y+hh)))
        return (x,y,hw,hh)
    # ---- I/O-streck från symbolen ner till raderna ----
    def io_punkt(s,bet,x,y): s.punkter.append((bet,x,y))
    def io_streck(s):
        klara=set()
        for bet,x,y in s.punkter:
            k=s.perBet.get(bet)
            if not k or k['anslutsTill']!=s.skap or bet in klara: continue
            klara.add(bet)
            sig=[g for g in k['signaler'] if g['typ'] in RAD]
            for j,g in enumerate(sig):
                xx=round(x-(len(sig)-1)*3+j*6,2); y0=round(y+2,2); ry=RAD[g['typ']]
                inre=(f'<polyline points="{F(xx)},{F(y0)} {F(xx)},{F(ry)}" stroke="#808080" stroke-width="{F(0.72*PT)}" stroke-dasharray="{F(8.28*PT)} {F(4.14*PT)}" stroke-linejoin="miter" fill="none"></polyline>'
                      f'<circle cx="{F(xx)}" cy="{F(ry)}" r="{F(1.56*PT)}" fill="#000000" stroke="none"></circle>')
                if y0<AS_Y<ry: inre+=f'<circle cx="{F(xx)}" cy="{F(AS_Y)}" r="{F(1.56*PT)}" fill="#000000" stroke="none"></circle>'
                s.io.append(item(s.id('io'),f"I/O {g['typ'].title() if len(g['typ'])==2 else g['typ'].split()[0]} {bet}",xx-2.08,y0,4.16,ry-y0+2.08,inre))
    def data(s):
        s.io_streck()
        rader,fot=driftkortsmall(s.skap)
        if s.rubrik: s.text(DOC['w']/2,30,s.rubrik,'middle',13)
        st=(f'<g data-lid="lay_flode" data-lname="Flödesbild">{"".join(s.items)}</g>'
            f'<g data-lid="lay_iomall" data-lname="I/O-rader (mall)" data-mall="driftkort" data-io="mall" data-llock="1">{rader}</g>'
            f'<g data-lid="lay_io" data-lname="I/O" data-io="streck">{"".join(s.io)}</g>'
            f'<g data-lid="lay_sidfot" data-lname="Sidfot (följer inte med)" data-noexp="1" data-llock="1">{fot}</g>')
        return {'v':1,'doc':DOC,'stage':st,'idCounter':s.n+1,'activeLayerId':'lay_flode'}, len(s.io)

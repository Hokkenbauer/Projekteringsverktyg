"""Flödesbild = Ritbordets mall (Ritmall 1.1) + symboler ur symbolbiblioteket + I/O-streck dragna som i HECO:s driftkort."""
import html, json
from ritbord2 import item, driftkortsmall, DOC, F, AS_Y, SYM, panel_till_ram
PT=96/72
RAD={'DI':421.86*PT,'AI':432.24*PT,'DU':442.59*PT,'AU':452.94*PT,'M-bus':463.29*PT,'Modbus RTU':473.67*PT,'Modbus TCP':473.67*PT}
STRECK=f'stroke="#808080" stroke-width="{F(0.72*PT)}" stroke-dasharray="{F(8.28*PT)} {F(4.14*PT)}" stroke-linejoin="miter" fill="none"'
FONT='Malgun Gothic, Segoe UI, Arial, sans-serif'
YTA=(40,40,1082,AS_Y-40)
# hur symbolen sitter på röret: förskjutning av symbolens mitt (i symbolens egna enheter) från röret
PA_ROR={'sym_sensor':(0,-11),'sym_valve':(0,-6.5),'sym_valve3wm':(0,-6),'sym_valve3w':(0,-6),'sym_pump':(0,0),'sym_meter':(0,0),
        'sym_damper':(0,-16),'sym_dampersmall':(0,-10),'sym_expansionsmall':(0,-24),'sym_fan':(0,0),'sym_fansmall':(0,0)}

class Sida:
    def __init__(s,namn,skap,PB,rubrik=''):
        s.namn=namn; s.skap=skap; s.PB=PB; s.items=[]; s.n=0; s.io=[]; s.lador=[]; s.rubrik=rubrik
        s.k=1; s.ox=0; s.oy=0
    def nid(s,p): s.n+=1; return f'{p}_{s.n}'
    # ---------- mall ----------
    def mall(s,m,ruta=YTA,kmax=None):
        X0,Y0,X1,Y1=ruta
        k=min((X1-X0)/m.w,(Y1-Y0)/m.h)
        if kmax: k=min(k,kmax)
        s.k=k
        s.ox=X0+((X1-X0)-m.w*k)/2-m.x*k; s.oy=Y0+((Y1-Y0)-m.h*k)/2-m.y*k
        svg=panel_till_ram(m.svg())
        s.items.append(item(s.nid('mall'),f'Mall: {m.namn}',m.x,m.y,m.w,m.h,svg,tx=s.ox+m.x*k-m.x,ty=s.oy+m.y*k-m.y,sx=k,sy=k))
        ox,oy=s.ox,s.oy
        return lambda x,y:(ox+x*k, oy+y*k)
    def T(s,x,y): return (s.ox+x*s.k, s.oy+y*s.k)
    # ---------- text och ramar (px) ----------
    def text(s,x,y,t,anchor='start',storlek=9.5,farg='#000000'):
        bw=len(t)*storlek*0.56; bx=x-(bw/2 if anchor=='middle' else (bw if anchor=='end' else 0))
        s.items.append(item(s.nid('text'),'Text',bx,y-storlek,bw,storlek*1.25,f'<tspan x="{F(x)}" dy="0">{html.escape(t)}</tspan>',tagg='text',
            extra=f' x="{F(x)}" y="{F(y)}" fill="{farg}" font-size="{F(storlek)}" font-family="{FONT}" text-anchor="{anchor}" font-style="normal" font-weight="400"'))
        s.texter=getattr(s,'texter',[]); s.texter.append((bx,y-storlek,bx+bw,y+2))
    def ram(s,x0,y0,x1,y1,txt='',pos='nv'):
        s.items.append(item(s.nid('ram'),'Ram',x0,y0,x1-x0,y1-y0,f'<rect x="{F(x0)}" y="{F(y0)}" width="{F(x1-x0)}" height="{F(y1-y0)}" fill="none" stroke="#000000" stroke-width="1" stroke-dasharray="6 3"></rect>'))
        if txt:
            r=txt.split('\n')
            for i,t in enumerate(r):
                if pos=='nv': s.text(x0+4,y1-5-(len(r)-1-i)*10,t,storlek=7.5)
                else: s.text(x0+4,y0+11+i*10,t,storlek=7.5)
    def ruta(s,x,y,txt,storlek=8):
        w=len(txt)*storlek*0.6+8; h=storlek+6
        s.items.append(item(s.nid('ruta'),f'Ruta {txt}',x-w/2,y-h/2,w,h,f'<rect x="{F(x-w/2)}" y="{F(y-h/2)}" width="{F(w)}" height="{F(h)}" fill="#ffffff" stroke="#000000" stroke-width="0.96"></rect>'
            f'<text x="{F(x)}" y="{F(y+storlek*0.36)}" fill="#000000" font-size="{storlek}" font-family="{FONT}" text-anchor="middle">{html.escape(txt)}</text>'))
        s.lador.append((x-w/2,y-h/2,x+w/2,y+h/2)); return (x-w/2,y-h/2,x+w/2,y+h/2)
    def vtext(s,x,y,t,storlek=8):
        bw=len(t)*storlek*0.56
        s.items.append(item(s.nid('vtext'),'Text',x-storlek,y-bw,storlek*1.25,bw,
            f'<text x="{F(x)}" y="{F(y)}" transform="rotate(-90 {F(x)} {F(y)})" fill="#000000" font-size="{storlek}" font-family="{FONT}">{html.escape(t)}</text>'))
        s.lador.append((x-storlek,y-bw,x+2,y))
    def koppling(s,pts):
        xs=[a for a,_ in pts]; ys=[b for _,b in pts]; p=' '.join(f'{F(a)},{F(b)}' for a,b in pts)
        s.items.append(item(s.nid('koppl'),'Kopplingslinje',min(xs),min(ys),max(xs)-min(xs)+.001,max(ys)-min(ys)+.001,f'<polyline points="{p}" {STRECK}></polyline>'))
    # ---------- symboler ----------
    def sym(s,sid,x,y,bet=None,etikett=None,pos='n',skala=0.8,rot=0,spegel=False,pa_ror=True,mall=True,io=None,io_stil=None,T=None):
        """Symbol ur symbolbiblioteket. (x,y) = punkt på röret i mallens koordinater (mall=True) eller px."""
        if mall: x,y=(T or s.T)(x,y)
        sy=SYM[sid]; _,_,w,h=map(float,sy['vb'].split())
        dx,dy=PA_ROR.get(sid,(0,0)) if pa_ror else (0,0)
        if rot in (90,-90): dx,dy=(-dy if rot==90 else dy),dx
        cx,cy=x+dx*skala,y+dy*skala
        inre=sy['svg']
        if rot or spegel:
            tr=(f'rotate({rot} {F(w/2)} {F(h/2)})' if rot else '')+(f' matrix(-1 0 0 1 {F(w)} 0)' if spegel else '')
            inre=f'<g transform="{tr.strip()}">{inre}</g>'
        bw,bh=(h,w) if rot in (90,-90) else (w,h)
        bx=(w-bw)/2; by=(h-bh)/2
        s.items.append(item(s.nid(sid),sy['name']+(f' {bet}' if bet else ''),bx,by,bw,bh,inre,tx=cx-bx-bw*skala/2,ty=cy-by-bh*skala/2,sx=skala,sy=skala))
        hw,hh=bw*skala/2,bh*skala/2
        box=(cx-hw,cy-hh,cx+hw,cy+hh); s.lador.append(box)
        lab=etikett if etikett is not None else bet
        if lab:
            if pos=='n': s.text(cx,cy-hh-3,lab,'middle',8.5)
            elif pos=='s': s.text(cx,cy+hh+10,lab,'middle',8.5)
            elif pos=='e': s.text(cx+hw+3,cy+3,lab,'start',8.5)
            elif pos=='w': s.text(cx-hw-3,cy+3,lab,'end',8.5)
            elif pos=='ne': s.text(cx+hw+1,cy-hh-1,lab,'start',8.5)
            elif pos=='nw': s.text(cx-hw-1,cy-hh-1,lab,'end',8.5)
        if bet and (io is None or io):
            stil=io_stil or {'sym_sensor':'hoger','sym_valve':'vanster','sym_valve3wm':'vanster','sym_valve3w':'vanster','sym_damper':'hoger','sym_dampersmall':'hoger'}.get(sid,'ner')
            s.io.append((bet,box,stil))
        return box
    # ---------- I/O-streck ----------
    def io_punkt(s,bet,box,stil='ner'): s.io.append((bet,box,stil))
    def _rutt(s):
        """Drar I/O-strecken som i HECO:s driftkort: kort vågrät bit vid symbolen, sedan rakt ner. Ett streck per signal,
        3 px mellan parallella streck, inga streck på samma x och inga streck genom andra symboler."""
        anv=[]; ut=[]
        def fritt(x,y0,egen):
            if any(abs(x-a)<3.2 for a in anv): return False
            for b in s.lador:
                if b is egen: continue
                if b[0]-1<x<b[2]+1 and b[3]>y0+1 and b[1]<AS_Y: return False
            return True
        for bet,box,stil in sorted(s.io,key=lambda t:(t[1][0]+t[1][2])/2):
            k=s.PB.get(bet)
            if not k or k['anslutsTill']!=s.skap: continue
            sig=[g for g in k['signaler'] if g['typ'] in RAD]
            if not sig: continue
            x0,y0,x1,y1=box; cx=(x0+x1)/2
            if stil=='hoger': start=(x1,y0+(y1-y0)*0.25); bas=x1+5; steg=3
            elif stil=='vanster': start=(x0,y0+4); bas=x0-5; steg=-3
            else: start=(cx,y1); bas=cx-(len(sig)-1)*1.5; steg=3
            for j,g in enumerate(sig):
                x=bas+j*steg
                n=0
                x00=x
                while not fritt(x,start[1],box) and n<4: x+=steg if stil!='ner' else 3; n+=1
                if n>=4 and not fritt(x,start[1],box): x=x00
                anv.append(x)
                pts=[start,(x,start[1])] if abs(x-start[0])>0.5 else [(x,start[1])]
                if stil=='ner' and abs(x-start[0])>0.5: pts=[(x,start[1])]
                ry=RAD[g['typ']]; pts.append((x,ry))
                pp=' '.join(f'{F(a)},{F(b)}' for a,b in pts)
                inre=f'<polyline points="{pp}" {STRECK}></polyline><circle cx="{F(x)}" cy="{F(ry)}" r="{F(1.56*PT)}" fill="#000000"></circle>'
                if pts[0][1]<AS_Y: inre+=f'<circle cx="{F(x)}" cy="{F(AS_Y)}" r="{F(1.56*PT)}" fill="#000000"></circle>'
                xs=[a for a,_ in pts]; ys=[b for _,b in pts]
                typ=g['typ'] if g['typ'] in ('M-bus',) else (g['typ'].split()[0] if ' ' in g['typ'] else g['typ'].title())
                ut.append(item(s.nid('io'),f'I/O {typ} {bet}',min(xs)-2,min(ys),max(xs)-min(xs)+4,max(ys)-min(ys)+2,inre))
        return ut
    def larm(s,x,txt,kort,bet,typ='DI',ytext=None):
        """Som DK1 Generella: lodrät text, streck ner genom AS-linjen till en ruta med förkortning, sedan till raden."""
        yt=ytext or AS_Y-14
        s.vtext(x+3,yt-3,txt,8)
        ry=RAD[typ]; by0=AS_Y+16; by1=by0+11
        w=max(len(kort)*5.6+6,20)
        inre=(f'<polyline points="{F(x)},{F(yt)} {F(x)},{F(by0)}" {STRECK}></polyline><circle cx="{F(x)}" cy="{F(AS_Y)}" r="{F(1.56*PT)}" fill="#000000"></circle>'
              f'<polyline points="{F(x)},{F(by1)} {F(x)},{F(ry)}" {STRECK}></polyline><circle cx="{F(x)}" cy="{F(ry)}" r="{F(1.56*PT)}" fill="#000000"></circle>')
        s.extra_io=getattr(s,'extra_io',[]); s.extra_io.append(item(s.nid('io'),f'I/O {typ.title()} {bet}',x-2,yt,4,ry-yt+2,inre))
        s.items.append(item(s.nid('ruta'),f'Ruta {kort}',x-w/2,by0,w,by1-by0,f'<rect x="{F(x-w/2)}" y="{F(by0)}" width="{F(w)}" height="{F(by1-by0)}" fill="#ffffff" stroke="#000000" stroke-width="0.96"></rect>'
            f'<text x="{F(x)}" y="{F(by1-2.5)}" fill="#000000" font-size="7.5" font-family="{FONT}" text-anchor="middle">{html.escape(kort)}</text>'))
    def data(s):
        io=s._rutt()+getattr(s,'extra_io',[])
        if s.rubrik: s.text(DOC['w']/2,26,s.rubrik,'middle',12)
        rader,fot=driftkortsmall(s.skap)
        st=(f'<g data-lid="lay_flode" data-lname="Flödesbild">{"".join(s.items)}</g>'
            f'<g data-lid="lay_iomall" data-lname="I/O-rader (mall)" data-mall="driftkort" data-io="mall" data-llock="1">{rader}</g>'
            f'<g data-lid="lay_io" data-lname="I/O" data-io="streck">{"".join(io)}</g>'
            f'<g data-lid="lay_sidfot" data-lname="Sidfot (följer inte med)" data-noexp="1" data-llock="1">{fot}</g>')
        return {'v':1,'doc':DOC,'stage':st,'idCounter':s.n+1,'activeLayerId':'lay_flode'}

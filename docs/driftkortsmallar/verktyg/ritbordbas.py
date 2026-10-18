"""Grunddelar för Ritbordets driftkort: objektformat och driftkortsmallen (AS-linje, I/O-rader, sidfot).
Samma värden som rbDriftkortMall() i web/public/ritbord/ritbord.html."""
import html
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


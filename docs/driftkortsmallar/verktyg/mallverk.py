"""Ritbordets mallar (Ritmall 1.1): läs, rensa och visa med rutnät i mallens egna koordinater."""
import json, re, io
from xml.dom import minidom
import svgelements, cairosvg
from PIL import Image, ImageDraw
from ritbord2 import MALLAR
NS='xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'

class Mall:
    def __init__(s,idx):
        t=MALLAR[idx]; s.idx=idx; s.namn=t['name']; s.vb=t['vb']
        s.x,s.y,s.w,s.h=map(float,t['vb'].split())
        d=minidom.parseString(f'<svg {NS}>{t["svg"]}</svg>')
        s.delar=[]
        for c in d.documentElement.childNodes:
            if c.nodeType!=1: continue
            xml=c.toxml()
            bb=_bbox(xml,t['vb'])
            if bb: bb=(float(bb[0])+s.x,float(bb[1])+s.y,float(bb[2])+s.x,float(bb[3])+s.y)
            s.delar.append({'xml':xml,'bb':bb,'text':_text(c)})
    def bort(s,x0,y0,x1,y1):
        for p in s.delar:
            b=p['bb']
            if b and b[0]>=x0 and b[1]>=y0 and b[2]<=x1 and b[3]<=y1: p['bort']=True
    def bort_text(s,*t):
        for p in s.delar:
            if p['text'] and any(x in p['text'] for x in t): p['bort']=True
    def byt(s,gammal,ny):
        for p in s.delar:
            if p['text'] and gammal in p['text']:
                p['xml']=p['xml'].replace(f'>{gammal}<',f'>{ny}<')
    def beskar(s,x0,y0,x1,y1):
        s.x,s.y,s.w,s.h=x0,y0,x1-x0,y1-y0; s.vb=f'{x0} {y0} {x1-x0} {y1-y0}'
    def svg(s): return ''.join(p['xml'] for p in s.delar if not p.get('bort'))
    def rutnat(s,ut,steg=10,bredd=1600):
        svg=re.sub(r'\s(xlink:href|xml:\w+|data-[\w-]+)="[^"]*"','',s.svg())
        png=cairosvg.svg2png(bytestring=f'<svg {NS} viewBox="{s.vb}" width="{s.w}" height="{s.h}"><rect x="{s.x}" y="{s.y}" width="{s.w}" height="{s.h}" fill="white"/>{svg}</svg>'.encode(),output_width=bredd)
        im=Image.open(io.BytesIO(png)).convert('RGB'); d=ImageDraw.Draw(im); k=bredd/s.w
        import math
        for gx in range(math.ceil(s.x/steg)*steg,int(s.x+s.w)+1,steg):
            X=(gx-s.x)*k; d.line([(X,0),(X,im.height)],fill=(120,200,255) if gx%50 else (0,100,255))
            if gx%50==0: d.text((X+2,2),str(gx),fill=(0,0,200))
        for gy in range(math.ceil(s.y/steg)*steg,int(s.y+s.h)+1,steg):
            Y=(gy-s.y)*k; d.line([(0,Y),(im.width,Y)],fill=(120,200,255) if gy%50 else (0,100,255))
            if gy%50==0: d.text((2,Y+2),str(gy),fill=(0,0,200))
        im.save(ut)

def _text(c):
    t=''.join(n.data for n in c.getElementsByTagName('tspan') for n in n.childNodes if n.nodeType==3) if c.getElementsByTagName('tspan') else ''
    if not t and c.tagName=='text': t=''.join(n.data for n in c.childNodes if n.nodeType==3)
    return t.strip()
def _bbox(xml,vb):
    try:
        e=svgelements.SVG.parse(io.StringIO(f'<svg {NS} viewBox="{vb}">{xml}</svg>'))
        bb=e.bbox()
        return tuple(bb) if bb else None
    except Exception: return None

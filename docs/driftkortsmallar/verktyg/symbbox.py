import sys; sys.path.insert(0,__import__('os').path.dirname(__import__('os').path.abspath(__file__)))
import pdfmall
def union(s,x0,y0,x1,y1,utan_ror=True):
    bb=[e['bb'] for e in s.el if e['k']=='p' and e['roll'] in('flode','io') and not (utan_ror and 'd' in e and pdfmall._ror(e['d']))
        and e['bb'][0]>=x0 and e['bb'][1]>=y0 and e['bb'][2]<=x1 and e['bb'][3]<=y1]
    if not bb: return None
    return tuple(round(v,1) for v in (min(b[0] for b in bb),min(b[1] for b in bb),max(b[2] for b in bb),max(b[3] for b in bb)))

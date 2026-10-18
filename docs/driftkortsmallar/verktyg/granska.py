"""Granskningsrender av Ritbord-data till PNG (bara för kontroll)."""
import re, cairosvg
def png(data, ut, bredd=1400):
    st=data['stage']; w,h=data['doc']['w'],data['doc']['h']
    st=re.sub(r'<g data-lid="lay_sidfot".*?</g></g>','',st,flags=re.S) if 'lay_sidfot' in st else st
    st=re.sub(r'\s(data-[\w-]+|xlink:href|xml:\w+)="[^"]*"','',st)
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}"><rect width="100%" height="100%" fill="white"/>{st}</svg>'
    cairosvg.svg2png(bytestring=svg.encode(),write_to=ut,output_width=bredd)

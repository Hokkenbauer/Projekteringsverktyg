import sys, pymupdf
from PIL import Image, ImageDraw
def rut(pdf, ut, zoom=2.2, x0=0,y0=0,x1=842,y1=480):
    p=pymupdf.open(pdf)[0]
    pix=p.get_pixmap(matrix=pymupdf.Matrix(zoom,zoom),clip=pymupdf.Rect(x0,y0,x1,y1))
    im=Image.frombytes('RGB',(pix.width,pix.height),pix.samples); d=ImageDraw.Draw(im)
    for x in range(int(x0)//20*20,int(x1)+1,20):
        X=(x-x0)*zoom; d.line([(X,0),(X,im.height)],fill=(0,170,255) if x%100 else (0,90,255),width=1)
        if x%40==0: d.text((X+2,2),str(x),fill=(0,0,255))
    for y in range(int(y0)//20*20,int(y1)+1,20):
        Y=(y-y0)*zoom; d.line([(0,Y),(im.width,Y)],fill=(0,170,255) if y%100 else (0,90,255),width=1)
        if y%40==0: d.text((2,Y+2),str(y),fill=(0,0,255))
    im.save(ut)
if __name__=='__main__':
    a=sys.argv; rut(a[1],a[2],float(a[3]),*map(float,a[4:8]))

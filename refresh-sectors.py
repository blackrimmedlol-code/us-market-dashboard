"""Batch-fetch the full Finviz industry universe; print compact ranks, never invent causes.
Usage: python refresh-sectors.py YYYY-MM-DD [output.json]
The date is a verified trading date supplied by the caller; inspect the SPY anchor.
"""
import json, re, sys, subprocess
from datetime import datetime
from zoneinfo import ZoneInfo
from html.parser import HTMLParser

URL = 'https://finviz.com/groups.ashx?g=industry&v=140&o=-change'
def fetch(url):
    return subprocess.check_output(['curl','-fLsS','--max-time','35','-A','Mozilla/5.0',url],text=True)
class Table(HTMLParser):
    def __init__(self):
        super().__init__(); self.rows=[]; self.row=[]; self.cell=None
    def handle_starttag(self,tag,attrs):
        if tag=='tr': self.row=[]
        if tag=='td': self.cell=[]
    def handle_data(self,s):
        if self.cell is not None: self.cell.append(s)
    def handle_endtag(self,tag):
        if tag=='td' and self.cell is not None: self.row.append(''.join(self.cell).strip()); self.cell=None
        if tag=='tr':
            if len(self.row)==12 and self.row[0].isdigit(): self.rows.append(self.row)
            self.row=[]
def collect(html):
    p=Table();p.feed(html)
    rows=[{'name':r[1],'changePct':float(r[10].replace('%','').replace(',',''))} for r in p.rows]
    if len(rows)<100 or len({r['name'] for r in rows})!=len(rows): raise ValueError('Incomplete/duplicate industry universe')
    return rows
if __name__=='__main__':
    date=sys.argv[1];datetime.strptime(date,'%Y-%m-%d')
    rows=collect(fetch(URL)); anchor=fetch('https://finviz.com/quote.ashx?t=SPY')
    plain=re.sub('<[^>]+>',' ',re.sub(r'<script\b[^>]*>.*?</script>','',anchor,flags=re.S));plain=re.sub(r'\s+',' ',plain)
    marker=re.search(r'Last Close.{0,180}',plain)
    if not marker or datetime.strptime(date,'%Y-%m-%d').strftime('%b %d').replace(' 0',' ') not in marker[0]: raise ValueError('SPY date anchor mismatch; do not relabel stale data')
    out={'marketDate':date,'fetchedAt':datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds'),'asOf':None,'status':'snapshot','universe':'Finviz 全部细分行业（提供方口径）','universeCount':len(rows),'sourceUrl':URL,'dateBasis':'同源 SPY 日期锚点：'+marker[0]+'；行业表未披露逐项行情时点。','rows':rows}
    for key,sign in [('gainers',1),('losers',-1)]:out[key]=sorted([r for r in rows if r['changePct']*sign>0],key=lambda r:(-sign*r['changePct'],r['name']))[:5]
    path=sys.argv[2] if len(sys.argv)>2 else 'sector-candidate.json'
    with open(path,'w') as f:json.dump(out,f,ensure_ascii=False,separators=(',',':'))
    print(json.dumps({k:v for k,v in out.items() if k!='rows'},ensure_ascii=False))

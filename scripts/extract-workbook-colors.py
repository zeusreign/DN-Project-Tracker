"""Read source styles only; emits reusable presentation metadata, never edits Excel.
Usage: python scripts/extract-workbook-colors.py WORKBOOK SEED_JSON OUTPUT_JS
"""
import json, sys, colorsys, xml.etree.ElementTree as ET
from pathlib import Path
import openpyxl
from openpyxl.styles.colors import COLOR_INDEX

book = openpyxl.load_workbook(sys.argv[1], data_only=True)
seeds = json.loads(Path(sys.argv[2]).read_text())
ns = {'a': 'http://schemas.openxmlformats.org/drawingml/2006/main'}
scheme = ET.fromstring(book.loaded_theme).find('a:themeElements/a:clrScheme', ns)
theme = {e.tag.split('}')[-1]: list(e)[0].attrib.get('lastClr', list(e)[0].attrib.get('val')) for e in scheme}
theme = [theme[k] for k in ['lt1','dk1','lt2','dk2','accent1','accent2','accent3','accent4','accent5','accent6','hlink','folHlink']]

def color(c):
    if c is None: return None
    if c.type == 'rgb': value = c.rgb[-6:]
    elif c.type == 'theme': value = theme[c.theme]
    elif c.type == 'indexed' and c.indexed < len(COLOR_INDEX): value = COLOR_INDEX[c.indexed][-6:]
    else: return None
    if c.tint:
        # Excel applies tint to HLS luminance (240-unit scale), not each RGB channel.
        h,l,s = colorsys.rgb_to_hls(*[int(value[i:i+2],16)/255 for i in (0,2,4)])
        l = l*(1+c.tint) if c.tint < 0 else l*(1-c.tint)+c.tint
        value = ''.join(f'{round(x*255):02X}' for x in colorsys.hls_to_rgb(h,l,s))
    return '#'+value.upper()

def style(c):
    result = {}
    if c.fill.patternType == 'solid':
        fill = color(c.fill.fgColor)
        if fill and fill != '#FFFFFF': result['fill'] = fill
    font = color(c.font.color)
    if font and font != '#000000': result['color'] = font
    return result

out = {'source':Path(sys.argv[1]).name,'rows':{},'sections':{},'totals':{}}
for p in seeds:
    sheet = book[p['source_sheet']]; offset = 0 if sheet.title == 'CORP' else 1
    size = 17 if p['project_type'] == 'Development' else 19
    out['rows'][p['source_key']] = [style(sheet.cell(p['source_row'],i+1+offset)) for i in range(size)]
for name in ['CORP','PATINA','GAMING','PARKS','SS','Design & Development']:
    sheet=book[name]; offset=0 if name=='CORP' else 1; size=17 if name=='Design & Development' else 19
    out['sections'][name]={}
    for row in range(2,sheet.max_row+1):
        c=sheet.cell(row,offset+1); st=style(c)
        if isinstance(c.value,str) and c.value.strip().upper()=='TOTAL':
            out['totals'][name]=[style(sheet.cell(row,i+1+offset)) for i in range(size)]
        elif c.value and st.get('fill') and all(sheet.cell(row,i+offset).value is None for i in (2,3,4)):
            out['sections'][name][str(c.value).strip()]=st
Path(sys.argv[3]).write_text('// Extracted from the supplied reference workbook; source formatting only.\nexport const WORKBOOK_REFERENCE_STYLES = '+json.dumps(out,indent=2)+';\n')
print('Extracted',len(out['rows']),'project styles and',sum(len(x) for x in out['sections'].values()),'section styles.')

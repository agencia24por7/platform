W, H = 1680, 1020
out = []

def esc(t): return t.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')

def box(x, y, w, h, label, sub=None, double=False, dash=False):
    st = ' stroke-dasharray="4 3"' if dash else ''
    out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="3" fill="#fff" stroke="#000" stroke-width="1.3"{st}/>')
    if double:
        out.append(f'<rect x="{x+4}" y="{y+4}" width="{w-8}" height="{h-8}" rx="2" fill="none" stroke="#000" stroke-width="1"/>')
    if sub:
        out.append(f'<text x="{x+w/2}" y="{y+h/2-4}" text-anchor="middle" font-size="13" font-weight="600">{esc(label)}</text>')
        out.append(f'<text x="{x+w/2}" y="{y+h/2+13}" text-anchor="middle" font-size="10.5">{esc(sub)}</text>')
    else:
        out.append(f'<text x="{x+w/2}" y="{y+h/2+4.5}" text-anchor="middle" font-size="13" font-weight="600">{esc(label)}</text>')

def box2(x, y, w, h, label, double=False):
    out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="3" fill="#fff" stroke="#000" stroke-width="1.3"/>')
    if double:
        out.append(f'<rect x="{x+4}" y="{y+4}" width="{w-8}" height="{h-8}" rx="2" fill="none" stroke="#000" stroke-width="1"/>')
    words = label.split(' ')
    lines = [label]
    if len(label) > 16 and len(words) > 1:
        best, cut = 1e9, 1
        for i in range(1, len(words)):
            a, b = ' '.join(words[:i]), ' '.join(words[i:])
            d = abs(len(a) - len(b))
            if d < best:
                best, cut = d, i
        lines = [' '.join(words[:cut]), ' '.join(words[cut:])]
    cy = y + h / 2 + (4.5 if len(lines) == 1 else -3)
    for i, ln in enumerate(lines):
        out.append(f'<text x="{x+w/2}" y="{cy + i*15}" text-anchor="middle" font-size="12.5" font-weight="600">{esc(ln)}</text>')

def line(x1, y1, x2, y2, head=True, dash=False):
    st = ' stroke-dasharray="4 3"' if dash else ''
    m = ' marker-end="url(#a)"' if head else ''
    out.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="#000" stroke-width="1"{st}{m}/>')

def poly(points, head=True, dash=False):
    st = ' stroke-dasharray="4 3"' if dash else ''
    m = ' marker-end="url(#a)"' if head else ''
    p = ' '.join(f'{x},{y}' for x, y in points)
    out.append(f'<polyline points="{p}" fill="none" stroke="#000" stroke-width="1"{st}{m}/>')

def cap(x, y, t):
    out.append(f'<text x="{x}" y="{y}" font-size="10" letter-spacing="1.6" font-weight="700">{esc(t.upper())}</text>')

def frame(x, y, w, h):
    out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="5" fill="none" stroke="#000" stroke-width="0.8" stroke-dasharray="2 4"/>')

# ---------- BANDA 1: acesso + hierarquia ----------
frame(40, 46, 700, 232)
cap(52, 40, 'acesso')
box(70, 120, 150, 50, 'users')
box(290, 108, 170, 74, 'members', 'N : N')
line(220, 145, 288, 145)
scopes = ['organization', 'portfolio', 'client', 'ad_account']
for i, s in enumerate(scopes):
    y = 68 + i * 52
    box(530, y, 180, 40, s)
    poly([(460, 145), (495, 145), (495, y + 20), (528, y + 20)])
for i in range(3):
    y1 = 68 + i * 52 + 40
    line(620, y1, 620, y1 + 12, head=True)

frame(770, 46, 870, 232)
cap(782, 40, 'hierarquia')
h1 = [('Organização', 800), ('Portfólio', 1010), ('Cliente', 1220), ('Conta de anúncios', 1430)]
for name, x in h1:
    box(x, 74, 190, 44, name)
for i in range(3):
    line(h1[i][1] + 190, 96, h1[i + 1][1] - 2, 96)
h2 = [('Campanha de marketing', 1010, 210), ('Campanha de plataforma', 1270, 210), ('Anúncio', 1530, 90)]
for name, x, w in h2:
    box(x, 190, w, 44, name)
line(1115, 118, 1115, 188)
line(1525, 118, 1525, 160)
poly([(1525, 160), (1375, 160), (1375, 188)])
line(1220, 212, 1268, 212)
line(1480, 212, 1528, 212)

# ---------- BANDA 2: pipeline ----------
frame(40, 320, 1600, 150)
cap(52, 314, 'pipeline')
stages = [('Briefing', 1), ('AI Orchestrator', 0), ('Market Research', 0), ('Strategy', 0),
          ('Aprovação', 1), ('Campaign Agent', 0), ('Policy & Execution', 0),
          ('Performance Agent', 0), ('Portfolio Intelligence', 0)]
sx, sw, gap = 70, 158, 20
for i, (name, human) in enumerate(stages):
    x = sx + i * (sw + gap)
    box2(x, 360, sw, 70, name, double=bool(human))
    if i:
        line(x - gap, 395, x - 2, 395)
poly([(1115, 234), (1115, 300), (110, 300), (110, 358)])
poly([(1548, 432), (1548, 452), (188, 452), (188, 434)])

# ---------- BANDA 3: serviços ----------
frame(40, 512, 1030, 218)
cap(52, 506, 'serviços')
box(70, 596, 200, 58, 'Frontend')
box(320, 596, 200, 58, 'API')
box(570, 540, 220, 58, 'Agent Service')
box(570, 652, 220, 58, 'Data & Integration')
box(850, 596, 190, 58, 'n8n')
box(70, 668, 200, 46, 'Secret Manager')
poly([(320, 640), (295, 640), (295, 691), (272, 691)])
line(270, 625, 318, 625)
poly([(520, 625), (545, 625), (545, 569), (568, 569)])
poly([(520, 625), (545, 625), (545, 681), (568, 681)])
poly([(790, 569), (820, 569), (820, 625), (848, 625)])
poly([(790, 681), (820, 681), (820, 625), (848, 625)], head=False)

frame(1100, 512, 540, 218)
cap(1112, 506, 'externo')
box(1130, 540, 230, 50, 'Meta Ads API')
box(1130, 600, 230, 50, 'Google Ads API')
box(1130, 660, 230, 50, 'Fonte confirmada')
box(1410, 600, 210, 50, 'Modelo de IA')
line(1040, 612, 1128, 568)
line(1040, 625, 1128, 625)
line(790, 685, 1128, 685)
poly([(680, 540), (680, 524), (1515, 524), (1515, 598)])

# ---------- BANDA 4: banco ----------
frame(40, 772, 1600, 200)
cap(52, 766, 'postgresql')
schemas = ['core', 'integrations', 'ads', 'metrics', 'agent', 'automation']
for i, s in enumerate(schemas):
    x = 80 + i * 258
    box(x, 850, 228, 62, s)
box(690, 790, 300, 36, 'row level security', dash=True)
poly([(420, 654), (420, 740), (190, 740), (190, 848)])
poly([(680, 710), (680, 740), (450, 740), (450, 848)])
poly([(945, 654), (945, 740), (1220, 740), (1220, 848)])
poly([(1150, 710), (1150, 752), (1480, 752), (1480, 848)], dash=True)
line(840, 826, 840, 848, head=False)

svg = f'''<svg viewBox="0 0 {W} {H}" width="100%" xmlns="http://www.w3.org/2000/svg">
<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
<path d="M 0 0 L 10 5 L 0 10 z" fill="#000"/></marker></defs>
<rect width="{W}" height="{H}" fill="#fff"/>
{chr(10).join(out)}
</svg>'''

html = f'''<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>tria — diagrama</title>
<style>
*{{box-sizing:border-box}}
html,body{{margin:0;background:#fff}}
body{{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#000;padding:24px}}
svg{{display:block;max-width:1680px;margin:0 auto;height:auto}}
text{{fill:#000}}
@media print{{body{{padding:0}}}}
</style>
</head>
<body>
{svg}
</body>
</html>'''
open('/Users/brunoabreu/orca/workspaces/platform/main/diagrama.html', 'w').write(html)
print('ok', len(html))

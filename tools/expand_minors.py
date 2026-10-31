"""1.0.5 cell expansion: turn the grey unaligned land into minor-nation cells.

Reads src/map.json (original) + Natural Earth borders/places, writes a new map.json
with new land zones APPENDED after every existing zone (old zone ids stay valid,
so old saves keep working).
Usage: python3 tools/expand_minors.py <map-before.json> <map-out.json> <natural-earth-vector/geojson/>
Needs numpy, scipy and opencv-python, plus Natural Earth (ne_10m_admin_0_countries, ne_10m_populated_places_simple).
Already applied to src/map.json (it refuses to run twice: see "minorsAdded").
"""
import json, math, sys
import numpy as np, cv2
from scipy import ndimage
from scipy.spatial import cKDTree

SRC = sys.argv[1]; OUT = sys.argv[2]; NE = sys.argv[3] if len(sys.argv) > 3 else 'natural-earth-vector/geojson/'
M = json.load(open(SRC))
assert 'minorsAdded' not in M
Z, C = M['zones'], M['countries']
NZ0 = len(Z)
DEG = math.pi / 180
projY = lambda lat: math.log(math.tan(math.pi / 4 + lat * DEG / 2)) / DEG
lonX = lambda lon: lon + 360 if lon < 0 else lon

R = 0.025
X0, X1 = 92.0, 210.0
Y0, Y1 = -55.0, 58.0
W, H = int(round((X1 - X0) / R)), int(round((Y1 - Y0) / R))
print('raster', W, H)
def topx(x, y): return (x - X0) / R, (Y1 - y) / R
def toworld(px, py): return X0 + px * R, Y1 - py * R
SH = 4  # fillPoly sub-pixel shift
def ring_pts(r):
    a = np.array(r, dtype=np.float64).reshape(-1, 2)
    p = np.empty_like(a); p[:, 0] = (a[:, 0] - X0) / R; p[:, 1] = (Y1 - a[:, 1]) / R
    return np.round(p * (1 << SH)).astype(np.int32)
def fill(img, rings, val):
    cv2.fillPoly(img, [ring_pts(r) for r in rings], val, lineType=cv2.LINE_8, shift=SH)

# ---------- 1. who owns each land pixel today (mirrors zoneAt) ----------
LMR = np.zeros((H, W), np.int32)            # landmass index + 1
for i, l in enumerate(M['landmasses']): fill(LMR, [l['r']], i + 1)
OWN = np.full((H, W), -1, np.int32)
for i, l in enumerate(M['landmasses']): OWN[LMR == i + 1] = l['o']
for p in reversed(M['politicals']):         # first political wins in zoneAt
    m = np.zeros((H, W), np.uint8); fill(m, [p['r']], 1)
    OWN[(m == 1) & (LMR == p['lm'] + 1)] = p['o']
ocean = LMR == 0

# ---------- 2. new countries; split the "Unaligned" grey by real borders ----------
CI = {c['code']: i for i, c in enumerate(C)}
XX = CI['XX']
NEW = [  # code, name, colour, pop in bounds (M), NE codes
    ('MM', 'Myanmar', '#93b04c', 54.0, ['MMR']),
    ('LA', 'Laos', '#d88a73', 7.6, ['LAO']),
    ('KH', 'Cambodia', '#c27bb0', 17.0, ['KHM']),
    ('MN', 'Mongolia', '#c8b47e', 2.9, ['MNG']),
    ('IN', 'India (Northeast)', '#e3a35b', 29.0, ['IND', 'BTN']),
    ('BD', 'Bangladesh', '#4fa36a', 2.5, ['BGD']),
]
MINOR_COL = {'BN': '#cfae55', 'TL': '#b9583f', 'SB': '#3e9a78', 'VU': '#a3743f', 'NC': '#7488d6', 'WS': '#b48ede',
             'TO': '#b84e4e', 'PW': '#52a9ab', 'RU': '#8c9db5'}
POP_FIX = {'RU': 3.8}
for code, name, col, pop, _ in NEW:
    CI[code] = len(C); C.append({'code': code, 'name': name, 'color': col, 'pop': pop, 'playable': True, 'minor': True})
for code, col in MINOR_COL.items():
    c = C[CI[code]]; c['color'] = col; c['playable'] = True; c['minor'] = True
    if code in POP_FIX: c['pop'] = POP_FIX[code]
C[CI['RU']]['name'] = 'Russia (Far East)'

ne = json.load(open(NE + 'ne_10m_admin_0_countries.geojson'))
NEC = np.full((H, W), -1, np.int32)
code_of_ne = {n: code for code, _, _, _, ns in NEW for n in ns}; code_of_ne['RUS'] = 'RU'
def proj_ring(ring):
    out = []
    for lon, lat in ring:
        lat = max(-84, min(84, lat)); out += [lonX(lon) if lon < -100 else lon, projY(lat)]
    return out
for f in ne['features']:
    a3 = f['properties']['ADM0_A3']
    if a3 not in code_of_ne: continue
    g = f['geometry']; polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
    rings = []
    for poly in polys:
        ring = poly[0]
        xs = [p[0] for p in ring]
        if max(xs) < 85 or min(xs) > 150: continue
        rings.append(proj_ring(ring))
    if rings: fill(NEC, rings, CI[code_of_ne[a3]])
grey = OWN == XX
assign = np.where(grey, NEC, -1)
known = assign >= 0
# grey pixels outside any minor's NE border (slivers): nearest assigned grey pixel
_, (iy, ix) = ndimage.distance_transform_edt(~known, return_indices=True)
OWN = np.where(grey, assign[iy, ix], OWN)
print('grey left', int((OWN == XX).sum()))

MINORS = [i for i, c in enumerate(C) if c.get('minor')]

# ---------- 3. seeds ----------
places = json.load(open(NE + 'ne_10m_populated_places_simple.geojson'))['features']
PL = []
for f in places:
    p = f['properties']; lon, lat = p['longitude'], p['latitude']
    if abs(lat) > 84: continue
    x, y = lonX(lon), projY(lat)
    if not (X0 <= x < X1 and Y0 <= y < Y1): continue
    px, py = topx(x, y); ix_, iy_ = int(px), int(py)
    PL.append(dict(n=p['nameascii'] if p['name'] != p['nameascii'] and '?' in p['name'] else p['name'], x=x, y=y, ix=ix_, iy=iy_,
                   pop=p['pop_max'] or 0, cap=p['featurecla'].startswith('Admin-0 capital'), a3=p['adm0_a3']))
# hand-placed seeds: capitals off the map or towns NE doesn't list
MANUAL = {
    'RU': [('Vladivostok', 131.886, 43.116, 600000, True)],
    'IN': [('Imphal', 93.938, 24.817, 600000, True)],
    'BD': [('Rangamati', 92.18, 22.65, 120000, True)],
    'MN': [('Ulaanbaatar', 106.917, 47.917, 1600000, True)],
    'MM': [('Naypyidaw', 96.13, 19.75, 1200000, True)],
    'SB': [('Honiara', 159.95, -9.44, 80000, True), ('Auki', 160.70, -8.77, 6000, False), ('Buala', 159.59, -8.14, 3000, False),
           ('Munda', 157.26, -8.33, 5000, False), ('Kirakira', 161.92, -10.45, 4000, False)],
    'VU': [('Port Vila', 168.32, -17.73, 50000, True), ('Luganville', 167.18, -15.51, 16000, False), ('Lakatoro', 167.41, -16.10, 2000, False)],
    'NC': [('Noumea', 166.44, -22.26, 100000, True), ('Kone', 164.86, -21.06, 8000, False)],
    'WS': [('Apia', -171.76, -13.83, 62000, True), ('Salelologa', -172.17, -13.73, 6000, False)],
    'TO': [("Nuku'alofa", -175.20, -21.14, 43000, True)],
    'PW': [('Ngerulmud', 134.62, 7.50, 12000, True)],
    'BN': [('Bandar Seri Begawan', 114.94, 4.89, 300000, True)],
    'TL': [('Dili', 125.58, -8.56, 240000, True), ('Baucau', 126.45, -8.47, 17000, False), ('Suai', 125.25, -9.31, 25000, False)],
    'LA': [], 'KH': [],
}
NAME_FIX = {'Phnom Penh': 'Phnom Penh', 'Vientiane': 'Vientiane'}
TARGET = {'MN': 1400}       # 'a' units per cell (0.05 deg projected pixels); default below
DEF_TARGET = 520
MAXN = {'MM': 16, 'MN': 9, 'RU': 9, 'IN': 7, 'BD': 1, 'LA': 6, 'KH': 5, 'TL': 3, 'BN': 1, 'SB': 5, 'VU': 3, 'NC': 2, 'WS': 2, 'TO': 1, 'PW': 1}
A3 = {'MM': 'MMR', 'LA': 'LAO', 'KH': 'KHM', 'MN': 'MNG', 'RU': 'RUS', 'IN': 'IND', 'BD': 'BGD', 'BN': 'BRN', 'TL': 'TLS', 'SB': 'SLB', 'VU': 'VUT', 'NC': 'NCL', 'WS': 'WSM', 'TO': 'TON', 'PW': 'PLW'}

MANUAL['IN'] += [('Itanagar', 93.62, 27.08, 60000, False), ('Kohima', 94.11, 25.67, 270000, False), ('Pasighat', 95.33, 28.07, 25000, False),
                 ('Dibrugarh', 94.91, 27.48, 160000, False), ('Tezpur', 92.80, 26.63, 100000, False), ('Aizawl', 92.72, 23.73, 300000, False), ('Silchar', 92.80, 24.83, 230000, False)]
MANUAL['BD'] += [('Zakiganj', 92.37, 24.87, 40000, False)]
MAXN.update({'MN': 12, 'BD': 2, 'IN': 8})
# Stray slivers: a piece of a minor that is cut off from its main body on the SAME landmass
# (Russian strips along the top map edge, north of Mongolia) would create fake land links.
# Hand them to the minor they touch, or leave them unaligned.
for ci in MINORS:
    mask = OWN == ci
    comp, nc = ndimage.label(mask, structure=np.ones((3, 3)))
    if nc < 2: continue
    sizes = ndimage.sum(mask, comp, range(1, nc + 1))
    keep = set()
    bylm = {}
    for k in range(nc):
        ys, xs = np.nonzero(comp == k + 1); li = int(np.bincount(LMR[ys, xs]).argmax())
        bylm.setdefault(li, []).append(k)
    for li, ks in bylm.items():
        ks.sort(key=lambda k: -sizes[k]); keep.add(ks[0])
        for k in ks[1:]:
            if sizes[k] >= 300: keep.add(k); continue
            piece = comp == k + 1
            ring = cv2.dilate(piece.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool) & ~piece
            nb = [o for o in np.unique(OWN[ring]) if o >= 0 and o != ci and C[o].get('minor')]
            OWN[piece] = nb[0] if nb else XX
            print('sliver', C[ci]['code'], int(sizes[k]), '->', C[nb[0]]['code'] if nb else 'XX')
    # big same-landmass pieces beyond the first (Russia's strips are big too): only keep if a named seed sits in them
    if C[ci]['code'] == 'RU':
        for li, ks in bylm.items():
            for k in ks[1:]:
                if k in keep and li == 1:  # asia landmass (index 0 -> raster value 1)
                    piece = comp == k + 1
                    ring = cv2.dilate(piece.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool) & ~piece
                    nb = [o for o in np.unique(OWN[ring]) if o >= 0 and o != ci and C[o].get('minor')]
                    OWN[piece] = nb[0] if nb else XX
                    print('strip', int(sizes[k]), '->', C[nb[0]]['code'] if nb else 'XX')

LAB = np.full((H, W), -1, np.int32)   # new cell id (0-based within new list) per pixel
cells = []                            # dicts
for ci in MINORS:
    code = C[ci]['code']
    mask = OWN == ci
    npx = int(mask.sum())
    if not npx: print('NO LAND', code); continue
    area_a = npx * (R * R / 0.0025)
    n = max(1, min(MAXN.get(code, 6), round(area_a / TARGET.get(code, DEF_TARGET))))
    comp, nc = ndimage.label(mask, structure=np.ones((3, 3)))
    sizes = ndimage.sum(mask, comp, range(1, nc + 1))
    seeds = []
    def add(nm, x, y, pop, cap, manual=False):
        px, py = topx(x, y); ix_, iy_ = int(px), int(py)
        if not (0 <= ix_ < W and 0 <= iy_ < H): return False
        if not mask[iy_, ix_]:
            # snap to nearest pixel of the country (manual seeds may sit a hair offshore)
            ys, xs = np.nonzero(mask[max(0, iy_ - 40):iy_ + 40, max(0, ix_ - 40):ix_ + 40])
            if not len(xs): return False
            k = np.argmin((ys + max(0, iy_ - 40) - iy_) ** 2 + (xs + max(0, ix_ - 40) - ix_) ** 2)
            iy_, ix_ = ys[k] + max(0, iy_ - 40), xs[k] + max(0, ix_ - 40)
            x, y = toworld(ix_ + .5, iy_ + .5)
        seeds.append(dict(n=nm, x=x, y=y, ix=ix_, iy=iy_, pop=pop, cap=cap)); return True
    for nm, lon, lat, pop, cap in MANUAL.get(code, []):
        add(nm, lonX(lon), projY(lat), pop, cap, True)
    cand = sorted([p for p in PL if p['a3'] == A3[code] and 0 <= p['iy'] < H and 0 <= p['ix'] < W and mask[p['iy'], p['ix']]],
                  key=lambda p: (-p['cap'], -p['pop']))
    spacing = math.sqrt(npx / max(n, 1)) * .62     # px
    for p in cand:
        if len(seeds) >= n: break
        if any(s['n'] == p['n'] for s in seeds): continue
        if p['cap'] and any(s['cap'] for s in seeds): p = dict(p, cap=False)
        if all((p['ix'] - s['ix']) ** 2 + (p['iy'] - s['iy']) ** 2 > spacing ** 2 for s in seeds):
            add(p['n'], p['x'], p['y'], p['pop'], p['cap'] and not any(s['cap'] for s in seeds))
    # every sizeable landmass piece needs a seed
    for k in np.argsort(-sizes):
        if sizes[k] < 250: break
        if any(comp[s['iy'], s['ix']] == k + 1 for s in seeds): continue
        ys, xs = np.nonzero(comp == k + 1); j = len(xs) // 2
        best = min([p for p in cand if comp[p['iy'], p['ix']] == k + 1], key=lambda p: -p['pop'], default=None)
        if best: add(best['n'], best['x'], best['y'], best['pop'], False)
        else:
            x, y = toworld(xs[j] + .5, ys[j] + .5); add(C[ci]['name'] + ' coast', x, y, 0, False)
    # fill the remaining with farthest-point seeds named after the nearest town
    allpts = np.column_stack(np.nonzero(mask))  # (iy, ix)
    while len(seeds) < n:
        sp = np.array([[s['iy'], s['ix']] for s in seeds])
        d, _ = cKDTree(sp).query(allpts)
        j = int(np.argmax(d)); iy_, ix_ = allpts[j]
        near = [p for p in cand if (p['ix'] - ix_) ** 2 + (p['iy'] - iy_) ** 2 < (spacing * .7) ** 2 and all(s['n'] != p['n'] for s in seeds)]
        if not near:
            un = [p for p in cand if all(s['n'] != p['n'] for s in seeds)]
            if un: near = [min(un, key=lambda p: (p['ix'] - ix_) ** 2 + (p['iy'] - iy_) ** 2)]
            if near and (near[0]['ix'] - ix_) ** 2 + (near[0]['iy'] - iy_) ** 2 < (spacing * 1.2) ** 2:
                p = near[0]; seeds.append(dict(n=p['n'], x=toworld(ix_ + .5, iy_ + .5)[0], y=toworld(ix_ + .5, iy_ + .5)[1], ix=ix_, iy=iy_, pop=p['pop'] * .3, cap=False)); continue
            near = []
        if near:
            p = max(near, key=lambda p: p['pop']); add(p['n'], p['x'], p['y'], p['pop'], False)
        else:
            x, y = toworld(ix_ + .5, iy_ + .5); add(f"{C[ci]['name'].split(' (')[0]} {len(seeds)}", x, y, 0, False)
    if not any(s['cap'] for s in seeds): max(seeds, key=lambda s: s['pop'])['cap'] = True
    # assign pixels: nearest seed of this country (same rule as zoneAt) -- within the same landmass piece when it has one
    sp = np.array([[s['iy'], s['ix']] for s in seeds])
    _, nearest = cKDTree(sp).query(allpts)
    lab = nearest.copy()
    scomp = np.array([comp[s['iy'], s['ix']] for s in seeds])
    pc = comp[allpts[:, 0], allpts[:, 1]]
    for k in np.unique(pc):
        own = np.nonzero(scomp == k)[0]
        if len(own) == 0 or len(own) == len(seeds): continue
        sel = pc == k
        _, nn = cKDTree(sp[own]).query(allpts[sel]); lab[sel] = own[nn]
    base = len(cells)
    LAB[allpts[:, 0], allpts[:, 1]] = lab + base
    for s in seeds: cells.append(dict(s, c=ci))
    print(code, 'px', npx, 'a', round(area_a), 'cells', len(seeds), [s['n'] + ('*' if s['cap'] else '') for s in seeds])

# ---------- 4. polygons ----------
def trace(mask01, dil):
    ys, xs = np.nonzero(mask01)
    y0, y1, x0, x1 = max(0, ys.min() - 4), ys.max() + 5, max(0, xs.min() - 4), xs.max() + 5
    sub = mask01[y0:y1, x0:x1].astype(np.uint8)
    if dil: sub = cv2.dilate(sub, np.ones((3, 3), np.uint8), iterations=dil)
    cs, _ = cv2.findContours(sub, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    out = []
    for c in sorted(cs, key=cv2.contourArea, reverse=True):
        if cv2.contourArea(c) < 6 and out: continue
        c = cv2.approxPolyDP(c, .7, True).reshape(-1, 2)
        if len(c) < 3: continue
        r = []
        for px, py in c:
            x, y = toworld(px + x0, py + y0); r += [round(x, 3), round(y, 3)]
        out.append(r)
    return out

NL = len(cells)
cellRings = []
for k in range(NL):
    rs = trace(LAB == k, 1)
    cellRings.append(rs[0])
# politicals for the new mainland nations (grey asia base) + Sakhalin stays a landmass
newPols = []
for ci in MINORS:
    m = OWN == ci
    if not m.any(): continue
    lms = np.unique(LMR[m]) - 1
    for li in lms:
        if M['landmasses'][li]['o'] == ci: continue          # whole island already theirs
        if any(p['o'] == ci and p['lm'] == li for p in M['politicals']): continue  # Brunei, Timor
        for r in trace(m & (LMR == li + 1), 2):
            newPols.append({'lm': int(li), 'o': ci, 'r': r, 'minor': True})

# ---------- 5. zone records ----------
sea_ids = [i for i, z in enumerate(Z) if z['k'] == 'S']
seaTree = cKDTree([[Z[i]['x'], Z[i]['y']] for i in sea_ids])
landTree = {}
for ci in range(len(C)):
    ids = [i for i, z in enumerate(Z) if z['k'] == 'L' and z['c'] == ci]
    if ids: landTree[ci] = (ids, cKDTree([[Z[i]['x'], Z[i]['y']] for i in ids]))

pxcount = np.bincount(LAB[LAB >= 0], minlength=NL)
newZ = []
for k, s in enumerate(cells):
    newZ.append({'k': 'L', 'c': s['c'], 's': 0, 'n': s['n'], 't': 'cap' if s['cap'] else 'prov', 'x': round(s['x'], 3), 'y': round(s['y'], 4),
                 'p': 0, 'a': int(round(pxcount[k] * R * R / 0.0025)), 'port': False, 'coast': False, 'mx': 1})
# population: half by town size, half by area, scaled to the country's in-bounds population
for ci in MINORS:
    ks = [k for k, s in enumerate(cells) if s['c'] == ci]
    if not ks: continue
    pops = np.array([max(cells[k]['pop'], 2000) for k in ks], float); ar = np.array([newZ[k]['a'] for k in ks], float)
    w = .5 * pops / pops.sum() + .5 * ar / ar.sum()
    for k, wi in zip(ks, w): newZ[k]['p'] = round(float(C[ci]['pop'] * wi), 2)
    # bigger towns become cities
    for k in ks:
        if newZ[k]['t'] == 'prov' and cells[k]['pop'] >= 250000: newZ[k]['t'] = 'city'

# ---------- 6. edges ----------
edges = {}
def addE(a, b, f, w=1):
    key = (min(a, b), max(a, b))
    if key in edges: edges[key][1] += w
    else: edges[key] = [f, w]
coastN = set()
for dy, dx in ((0, 1), (1, 0), (0, -1), (-1, 0)):
    a = LAB
    b = np.roll(np.roll(LAB, -dy, 0), -dx, 1); bo = np.roll(np.roll(OWN, -dy, 0), -dx, 1); boc = np.roll(np.roll(ocean, -dy, 0), -dx, 1)
    bl = np.roll(np.roll(LMR, -dy, 0), -dx, 1)
    sel = a >= 0
    # no wrap-around at the raster edge
    if dy == 1: sel[-1, :] = False
    if dy == -1: sel[0, :] = False
    if dx == 1: sel[:, -1] = False
    if dx == -1: sel[:, 0] = False
    # "ocean" past the map's own edge is not sea
    BX0, BY0, BX1, BY1 = M['bounds']
    gy = Y1 - (np.arange(H)[:, None] + dy + .5) * R; gx = X0 + (np.arange(W)[None, :] + dx + .5) * R
    inb = (gy < BY1 - 0.08) & (gy > BY0 + 0.08) & (gx > BX0 + 0.08) & (gx < BX1 - 0.08)
    boc = boc & inb
    # new-new
    m = sel & (b >= 0) & (b != a)
    for u, v in zip(a[m], b[m]): addE(NZ0 + int(u), NZ0 + int(v), 5)
    # new-ocean
    m = sel & boc
    ys, xs = np.nonzero(m)
    if len(xs):
        wx, wy = toworld(xs + dx + .5, ys + dy + .5)
        dd, nn = seaTree.query(np.column_stack([wx, wy]))
        for u, j, d0 in zip(a[m], nn, dd):
            if d0 > 3.5: continue
            addE(NZ0 + int(u), sea_ids[j], 6); coastN.add(int(u))
    # new-existing land (same landmass only, real land border)
    m = sel & (b < 0) & ~boc & (bo >= 0) & (bl == LMR)
    ys, xs = np.nonzero(m)
    if len(xs):
        wx, wy = toworld(xs + dx + .5, ys + dy + .5)
        for u, o, x, y in zip(a[m], bo[m], wx, wy):
            if o not in landTree or C[o].get('minor'): continue
            ids, tr = landTree[o]; _, j = tr.query([x, y]); addE(NZ0 + int(u), ids[j], 5)
newEdges = []
for (a, b), (f, w) in edges.items():
    if f == 5 and w < 2: continue
    newEdges.append([a, b, f, int(w)])
for k in coastN:
    newZ[k]['coast'] = True
    if newZ[k]['t'] != 'prov': newZ[k]['port'] = True
# isolated new cells (no land neighbour, no sea neighbour) would be unreachable
deg = {}
for a, b, f, w in newEdges:
    deg[a] = deg.get(a, 0) + 1; deg[b] = deg.get(b, 0) + 1
for k in range(NL):
    if not deg.get(NZ0 + k):
        print('ISOLATED', newZ[k]['n'])

# ---------- 7. write ----------
for k, z in enumerate(newZ): z['s'] = len(M['states'])  # placeholder, fixed below
stateOf = {}
for ci in MINORS:
    ks = [k for k in range(NL) if newZ[k]['c'] == ci]
    if not ks: continue
    capk = next(k for k in ks if newZ[k]['t'] == 'cap')
    stateOf[ci] = len(M['states']); M['states'].append({'country': C[ci]['code'], 'name': C[ci]['name'], 'capital': NZ0 + capk})
for z in newZ: z['s'] = stateOf[z['c']]
M['zones'] = Z + newZ
M['cells'] = M['cells'] + cellRings
M['edges'] = M['edges'] + newEdges
M['politicals'] = M['politicals'] + newPols
M['unalignedLabels'] = []
M['minorsAdded'] = {'from': NZ0, 'count': NL}
json.dump(M, open(OUT, 'w'), separators=(',', ':'), ensure_ascii=False)
print('new zones', NL, 'edges', len(newEdges), 'pols', len(newPols))

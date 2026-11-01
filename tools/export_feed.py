"""Write the public data feed (site/data/v1/meta.json and codex.json) from the built game.

Loads site/index.html in headless Chromium and calls the game's own exportFeed(), so every number in the
feed is read from the tables the game plays with. Fails loudly if the feed looks wrong, so a bad export
never reaches FORBID COMMAND or the website. Run by build.py; needs Python Playwright with Chromium.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "site", "data", "v1")


def main():
    from playwright.sync_api import sync_playwright
    page_path = os.path.join(ROOT, "site", "index.html")
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.route(re.compile(r"^https?://"), lambda r: r.abort())  # no network: the game is self-contained
        pg.goto("file://" + page_path)
        pg.wait_for_function("!!(window.__prw && window.__prw.exportFeed)", timeout=60000)
        feed = pg.evaluate("() => window.__prw.exportFeed()")
        b.close()
    if errs:
        sys.exit("export_feed: page errors: " + "; ".join(errs[:3]))
    meta, codex = feed["meta"], feed["codex"]
    tpl = open(os.path.join(ROOT, "src", "template.html"), encoding="utf-8").read()
    version = re.search(r'const VERSION = "([^"]+)"', tpl).group(1)
    checks = [
        (meta["version"] == version == codex["version"], "version mismatch"),
        (meta["patchNotes"] and meta["patchNotes"][0]["version"] == version, "latest patch notes are not for this version"),
        (sum(n["playable"] for n in codex["nations"]) == codex["rules"]["powers"] == 16, "expected 16 playable powers"),
        (sum(n["minor"] for n in codex["nations"]) == codex["rules"]["minorNations"], "minor nation count"),
        (len(codex["buildings"]) == 10 and all(len(x["levels"]) == x["maxLevel"] for x in codex["buildings"]), "buildings"),
        (all(u["funds"] > 0 and u["materials"] >= 1 and u["manpower"] > 0 for u in codex["units"]), "unit costs"),
        (all(n["capital"] for n in codex["nations"]), "every nation has a capital"),
        (abs(sum(n["victoryPointsPct"] for n in codex["nations"]) - 100) < 1, "victory points add up to 100%"),
    ]
    bad = [m for ok, m in checks if not ok]
    if bad:
        sys.exit("export_feed: " + ", ".join(bad))
    os.makedirs(OUT, exist_ok=True)
    for name, data in (("meta.json", meta), ("codex.json", codex)):
        with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
    print(f"wrote site/data/v1 (v{version}: {len(codex['nations'])} nations, {len(codex['units'])} units, {len(codex['buildings'])} buildings, {len(meta['patchNotes'])} patch notes)")


if __name__ == "__main__":
    main()

"""Build The Fractured Coasts: WW3 (formerly Pacific Rim WW3).

Reads src/template.html (the whole game, with the map left as a __MAP_DATA__ placeholder)
and src/map.json, and writes:
  site/index.html          the web build Netlify serves (full page with mobile web-app tags)
  dist/claude-artifact.html  the body-only version published as the Claude artifact
  site/data/v1/*.json      the public data feed (version, patch notes, nations, units, buildings), read
                           from the built game by tools/export_feed.py
Run: python3 build.py   (SKIP_FEED=1 skips the feed, e.g. without Playwright; never for a release)
"""
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
tpl = open(os.path.join(ROOT, "src", "template.html"), encoding="utf-8").read()
game = tpl.replace("__MAP_DATA__", open(os.path.join(ROOT, "src", "map.json"), encoding="utf-8").read())

HEAD = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#061120">
<meta name="description" content="The Fractured Coasts: WW3. Turn-based war and diplomacy across the Asia-Pacific. Sixteen powers, fifteen minor nations, one ocean.">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Fractured Coasts">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>html,body{margin:0;height:100%;background:#061120;overscroll-behavior:none}</style>
"""
os.makedirs(os.path.join(ROOT, "site"), exist_ok=True)
os.makedirs(os.path.join(ROOT, "dist"), exist_ok=True)
open(os.path.join(ROOT, "site", "index.html"), "w", encoding="utf-8").write(HEAD + game.replace('<meta charset="utf-8">\n', "", 1) + "\n</html>\n")
open(os.path.join(ROOT, "dist", "claude-artifact.html"), "w", encoding="utf-8").write(game)
# Cloudflare Pages reads these two files from the published folder (Netlify reads netlify.toml instead)
open(os.path.join(ROOT, "site", "_headers"), "w").write("""/*
  Cache-Control: public, max-age=0, must-revalidate
/data/*
  Access-Control-Allow-Origin: *
""")
open(os.path.join(ROOT, "site", "_redirects"), "w").write("/discord https://discord.gg/jv8T6Pxz3e 302\n")
# the old Netlify address becomes a "we've moved" page that carries saves across (switched on from 29 Nov 2026)
import re
site_url = re.search(r'const SITE_URL = "([^"]+)"', tpl).group(1)
os.makedirs(os.path.join(ROOT, "moved"), exist_ok=True)
moved = open(os.path.join(ROOT, "src", "moved.html"), encoding="utf-8").read().replace("__NEW_HOST__", site_url.split("//")[1].rstrip("/")).replace("__NEW__", site_url)
open(os.path.join(ROOT, "moved", "index.html"), "w", encoding="utf-8").write(moved)
print("built site/index.html, dist/claude-artifact.html and moved/index.html")
if os.environ.get("SKIP_FEED") != "1":
    import subprocess, sys
    subprocess.run([sys.executable, os.path.join(ROOT, "tools", "export_feed.py")], check=True)

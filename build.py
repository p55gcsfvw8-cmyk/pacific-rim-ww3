"""Build Pacific Rim WW3.

Reads src/template.html (the whole game, with the map left as a __MAP_DATA__ placeholder)
and src/map.json, and writes:
  site/index.html          the web build Netlify serves (full page with mobile web-app tags)
  dist/claude-artifact.html  the body-only version published as the Claude artifact
Run: python3 build.py
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
<meta name="description" content="Pacific Rim WW3: turn-based war and diplomacy across the Asia-Pacific. Sixteen nations, one ocean.">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Pacific Rim WW3">
<style>html,body{margin:0;height:100%;background:#061120;overscroll-behavior:none}</style>
"""
os.makedirs(os.path.join(ROOT, "site"), exist_ok=True)
os.makedirs(os.path.join(ROOT, "dist"), exist_ok=True)
open(os.path.join(ROOT, "site", "index.html"), "w", encoding="utf-8").write(HEAD + game.replace('<meta charset="utf-8">\n', "", 1) + "\n</html>\n")
open(os.path.join(ROOT, "dist", "claude-artifact.html"), "w", encoding="utf-8").write(game)
print("built site/index.html and dist/claude-artifact.html")

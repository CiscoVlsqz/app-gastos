"""
Arma la carpeta dist/ lista para subir a Cloudflare Pages / Netlify.

Uso:
    python web/build.py https://script.google.com/macros/s/XXXXX/exec

La URL /exec se puede pasar como argumento o dejar guardada en web/api-url.txt.
"""
import json
import pathlib
import shutil
import sys
import time

root = pathlib.Path(__file__).resolve().parent.parent
web = root / "web"
dist = root / "dist"

api_url = None
if len(sys.argv) > 1:
    api_url = sys.argv[1].strip()
elif (web / "api-url.txt").exists():
    api_url = (web / "api-url.txt").read_text(encoding="utf-8").strip()

if not api_url:
    sys.exit(
        "Falta la URL del backend.\n"
        "  python web/build.py https://script.google.com/macros/s/XXXXX/exec\n"
        "o guardala en web/api-url.txt"
    )

index = (root / "Index.html").read_text(encoding="utf-8")
stylesheet = (root / "Stylesheet.html").read_text(encoding="utf-8")
script = (root / "Script.html").read_text(encoding="utf-8")

index = index.replace("<?!= include('Stylesheet'); ?>", stylesheet)
index = index.replace("<?!= include('Script'); ?>", script)
index = index.replace('<base target="_top">\n  ', "")

pwa_head = (
    '<link rel="manifest" href="manifest.webmanifest">\n'
    '  <link rel="apple-touch-icon" href="apple-touch-icon.png">\n'
    '  <meta name="theme-color" content="#efefef" media="(prefers-color-scheme: light)">\n'
    '  <meta name="theme-color" content="#19191b" media="(prefers-color-scheme: dark)">\n'
    "</head>"
)
index = index.replace("</head>", pwa_head, 1)
index = index.replace("'__API_URL__'", json.dumps(api_url))

version = time.strftime("%Y%m%d%H%M%S")
sw = (web / "sw.js").read_text(encoding="utf-8").replace("__VERSION__", version)

if dist.exists():
    shutil.rmtree(dist)
dist.mkdir()
(dist / "index.html").write_text(index, encoding="utf-8")
(dist / "sw.js").write_text(sw, encoding="utf-8")
shutil.copy(web / "manifest.webmanifest", dist / "manifest.webmanifest")
for ico in ("icon-192.png", "icon-512.png", "apple-touch-icon.png"):
    shutil.copy(web / ico, dist / ico)

print("dist/ generado")
print("  version:", version)
print("  API:    ", api_url)

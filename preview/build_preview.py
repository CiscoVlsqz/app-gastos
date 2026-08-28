import pathlib

root = pathlib.Path(__file__).resolve().parent.parent
preview = root / "preview"

index = (root / "Index.html").read_text(encoding="utf-8")
stylesheet = (root / "Stylesheet.html").read_text(encoding="utf-8")
script = (root / "Script.html").read_text(encoding="utf-8")

index = index.replace("<?!= include('Stylesheet'); ?>", stylesheet)
index = index.replace(
    "<?!= include('Script'); ?>",
    '<script src="mock-api.js"></script>\n' + script,
)
index = index.replace('<base target="_top">\n  ', "")

(preview / "index.html").write_text(index, encoding="utf-8")
print("preview/index.html generado")

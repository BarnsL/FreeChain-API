"""Create a credential-free Kiro Crew release from a fresh build, with no dependencies."""
import hashlib
import json
import stat
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "dist" / "freechain-crew"
DIST = ROOT / "dist"
if APP.is_symlink() or APP.resolve() != APP:
    raise SystemExit("Release input must not be a linked directory.")
manifest = json.loads((APP / "app.json").read_text(encoding="utf-8"))
if not manifest.get("minKiroCrewVersion") or manifest.get("minCodexCrewVersion"):
    raise SystemExit("Only the Kiro Crew build may be released by this script.")
allowed = {"app.json", "README.md", "LICENSE", "Install-FreeChain.cmd", "install.sh"}
trees = {"backend", "bin", "assets", "skills", "ui", "engine"}
files = []
for file in sorted(APP.rglob("*")):
    relative = file.relative_to(APP)
    if file.is_symlink() or file.resolve() != file:
        raise SystemExit("Release input contains a link.")
    if any(part.startswith(".") or part in {"data", "logs", "node_modules", "installed.json"} for part in relative.parts):
        raise SystemExit("Release input contains private or generated runtime state.")
    if relative.parts[0] not in trees and str(relative) not in allowed:
        raise SystemExit(f"Unexpected release input: {relative}")
    if file.is_file():
        files.append(file)
version = manifest["version"]
if not all(part.isdigit() for part in version.split(".")) or len(version.split(".")) != 3:
    raise SystemExit("Invalid release version.")
archive = DIST / f"freechain-kiro-crew-{version}.zip"
with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as output:
    for file in files:
        name = "freechain-kiro-crew/" + file.relative_to(APP).as_posix()
        info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
        info.create_system = 3
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = (stat.S_IFREG | (0o755 if file.name == "install.sh" else 0o644)) << 16
        data = file.read_bytes()
        if file.suffix.lower() in {".json", ".md", ".mjs", ".js", ".css", ".html", ".svg", ".cmd", ".sh"} or file.name == "LICENSE":
            data = data.replace(b"\r\n", b"\n")
        output.writestr(info, data)
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(DIST / "SHA256SUMS.txt").write_text(f"{digest}  {archive.name}\n", encoding="utf-8")
print(f"Packaged {len(files)} files: {archive.name}\nSHA256 {digest}")

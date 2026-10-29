#!/usr/bin/env python3
"""Check that a CWS Proxy .deb has the Ubuntu layout this repo ships.

A layout-check package (version containing +layout) may contain ELF stubs.
A normal package must contain a real Node binary and a real native addon.
Neither package may contain key material.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import os
import sys
import tarfile

PACKAGE = "hk.ysk.cws.proxy"
ROOT = "usr/lib/hk.ysk.cws.proxy"
RULE = "usr/lib/udev/rules.d/99-cws-uhid.rules"
ELF_MACHINES = {"amd64": 62, "arm64": 183}
SECRET_MARKERS = (
    b"BEGIN PRIVATE KEY",
    b"BEGIN RSA PRIVATE KEY",
    b"BEGIN OPENSSH PRIVATE KEY",
    b"BEGIN CERTIFICATE",
)


def fail(message: str) -> None:
    sys.stderr.write("deb check failed: %s\n" % message)
    raise SystemExit(1)


def parse_ar(blob: bytes) -> list[tuple[str, bytes]]:
    if not blob.startswith(b"!<arch>\n"):
        fail("archive is not GNU ar (dpkg would reject a BSD ar from macOS)")
    pos = 8
    members: list[tuple[str, bytes]] = []
    while pos + 60 <= len(blob):
        header = blob[pos : pos + 60]
        if header[58:60] != b"`\n":
            fail("bad ar header magic at %d" % pos)
        name = header[0:16].decode("ascii").rstrip()
        if name.endswith("/"):
            name = name[:-1]
        size = int(header[48:58].decode("ascii").strip())
        payload = blob[pos + 60 : pos + 60 + size]
        if len(payload) != size:
            fail("truncated ar member %s" % name)
        members.append((name, payload))
        pos += 60 + size
        if size % 2:
            pos += 1
    names = [name for name, _payload in members]
    if names != ["debian-binary", "control.tar.gz", "data.tar.gz"]:
        fail("ar member order is %s" % names)
    return members


def gunzip(payload: bytes) -> bytes:
    return gzip.GzipFile(fileobj=io.BytesIO(payload)).read()


def read_tar(payload: bytes) -> dict[str, tuple[tarfile.TarInfo, bytes]]:
    files: dict[str, tuple[tarfile.TarInfo, bytes]] = {}
    with tarfile.open(fileobj=io.BytesIO(payload), mode="r:") as archive:
        for info in archive.getmembers():
            name = info.name[2:] if info.name.startswith("./") else info.name
            if name in ("", ".", "/"):
                continue
            if info.issym() or info.islnk():
                fail("package contains a link: %s" % name)
            extracted = b""
            if info.isfile():
                handle = archive.extractfile(info)
                if handle is None:
                    fail("missing file payload: %s" % name)
                extracted = handle.read()
            files[name] = (info, extracted)
    return files


def control_fields(text: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    current = ""
    for line in text.splitlines():
        if not line:
            continue
        if line.startswith(" ") or line.startswith("\t"):
            if not current:
                fail("control description line before a field")
            fields[current] = fields[current] + "\n" + line
            continue
        if ":" not in line:
            fail("control line has no field name: %s" % line)
        key, value = line.split(":", 1)
        current = key.strip()
        fields[current] = value.strip()
    return fields


def elf_machine(blob: bytes) -> int | None:
    if len(blob) < 20 or blob[:4] != b"\x7fELF" or blob[4] != 2 or blob[5] != 1:
        return None
    return int.from_bytes(blob[18:20], "little")


def mode_is_exec(info: tarfile.TarInfo) -> bool:
    return bool(info.mode & 0o111)


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify a hk.ysk.cws.proxy .deb")
    parser.add_argument("deb")
    parser.add_argument("--udev", required=True, help="source udev rule that must be byte-identical")
    args = parser.parse_args()
    blob = open(args.deb, "rb").read()
    members = dict(parse_ar(blob))
    if members["debian-binary"] != b"2.0\n":
        fail("debian-binary is not 2.0")
    control = read_tar(gunzip(members["control.tar.gz"]))
    data = read_tar(gunzip(members["data.tar.gz"]))
    if "control" not in control:
        fail("control.tar.gz has no control file")
    fields = control_fields(control["control"][1].decode("utf-8"))
    for key in ("Package", "Version", "Architecture", "Maintainer", "Depends", "Description"):
        if key not in fields:
            fail("control is missing %s" % key)
    if fields["Package"] != PACKAGE:
        fail("package name is %s" % fields["Package"])
    arch = fields["Architecture"]
    if arch not in ELF_MACHINES:
        fail("architecture is %s" % arch)
    layout = "+layout" in fields["Version"]
    depends = fields["Depends"]
    for token in ("udev", "bluez", "libdbus-1-3", "libc6"):
        if token not in depends:
            fail("Depends does not mention %s" % token)
    description = fields["Description"]
    if "not absolutely safe" not in description:
        fail("description does not say seeds are not absolutely safe")
    if layout and "Do not install" not in description:
        fail("layout-check description does not warn against install")
    if not layout and "layout check" in description.lower():
        fail("runnable package is described as a layout check")

    for script in ("postinst", "postrm"):
        if script not in control:
            fail("missing maintainer script %s" % script)
        info, payload = control[script]
        if not mode_is_exec(info):
            fail("%s is not executable" % script)
        text = payload.decode("utf-8")
        if "udevadm control --reload-rules" not in text:
            fail("%s does not reload udev rules" % script)
    postinst = control["postinst"][1].decode("utf-8")
    for snippet in (
        "plugdev",
        "groupadd --system plugdev",
        "/etc/modules-load.d/cws-proxy.conf",
        "modprobe uhid",
        "udevadm trigger --sysname-match=uhid",
        "not absolutely safe",
    ):
        if snippet not in postinst:
            fail("postinst is missing %s" % snippet)
    postrm = control["postrm"][1].decode("utf-8")
    if "/etc/modules-load.d/cws-proxy.conf" not in postrm:
        fail("postrm does not remove the uhid modules-load file")

    if "md5sums" not in control:
        fail("missing md5sums")
    for line in control["md5sums"][1].decode("utf-8").splitlines():
        digest, rel = line.split("  ", 1)
        if rel not in data or not data[rel][0].isfile():
            fail("md5sums lists a missing file: %s" % rel)
        got = hashlib.md5(data[rel][1]).hexdigest()
        if got != digest:
            fail("md5 mismatch for %s" % rel)

    required = [
        "usr/bin/cws-proxy",
        ROOT + "/node",
        ROOT + "/proxy/main.cjs",
        ROOT + "/proxy/package.json",
        ROOT + "/proxy/node_modules/@cws/native-proxy/index.js",
        ROOT + "/proxy/node_modules/@cws/native-proxy/package.json",
        ROOT + "/proxy/node_modules/@cws/native-proxy/native-proxy.linux-%s-gnu.node" % ("x64" if arch == "amd64" else "arm64"),
        ROOT + "/ui/index.html",
        ROOT + "/ui/styles.css",
        ROOT + "/ui/i18n.js",
        ROOT + "/ui/app.js",
        RULE,
        "usr/share/applications/hk.ysk.cws.proxy.desktop",
        "usr/share/doc/hk.ysk.cws.proxy/copyright",
        "usr/share/doc/hk.ysk.cws.proxy/README.Debian",
    ]
    for rel in required:
        if rel not in data:
            fail("missing %s" % rel)
    if layout and "usr/share/doc/hk.ysk.cws.proxy/LAYOUT-CHECK" not in data:
        fail("layout package is missing LAYOUT-CHECK")
    if not layout and "usr/share/doc/hk.ysk.cws.proxy/LAYOUT-CHECK" in data:
        fail("runnable package contains LAYOUT-CHECK")

    launcher = data["usr/bin/cws-proxy"][1].decode("utf-8")
    if "exec \"$ROOT/node\" \"$ROOT/proxy/main.cjs\"" not in launcher and "exec \"$ROOT/node\" \"$ROOT/proxy/main.cjs\" \"$@\"" not in launcher:
        fail("launcher does not exec the bundled node and main.cjs")
    if not mode_is_exec(data["usr/bin/cws-proxy"][0]):
        fail("usr/bin/cws-proxy is not executable")
    if not mode_is_exec(data[ROOT + "/node"][0]):
        fail("bundled node is not executable")

    source_rule = open(args.udev, "rb").read()
    if data[RULE][1] != source_rule:
        fail("installed udev rule is not byte-identical to %s" % args.udev)
    if b'KERNEL=="uhid"' not in source_rule or b'GROUP="plugdev"' not in source_rule or b'MODE="0660"' not in source_rule:
        fail("udev rule does not set plugdev mode 0660 on uhid")

    machine = ELF_MACHINES[arch]
    node_blob = data[ROOT + "/node"][1]
    addon_name = ROOT + "/proxy/node_modules/@cws/native-proxy/native-proxy.linux-%s-gnu.node" % (
        "x64" if arch == "amd64" else "arm64"
    )
    addon_blob = data[addon_name][1]
    if elf_machine(node_blob) != machine:
        fail("node binary is not an ELF for %s" % arch)
    if elf_machine(addon_blob) != machine:
        fail("native addon is not an ELF for %s" % arch)
    if layout:
        if len(node_blob) > 4096 or len(addon_blob) > 4096:
            fail("layout stubs are unexpectedly large")
    else:
        if len(node_blob) < 20_000_000:
            fail("node binary is too small to be the official runtime")
        if len(addon_blob) < 50_000:
            fail("native addon is too small to be a release build")

    joined = b"\n".join(
        payload
        for name, (_info, payload) in data.items()
        if name.endswith((".cjs", ".js", ".sh", ".html", ".css", ".desktop", ".rules"))
        or name.startswith("usr/share/doc/")
        or name == "usr/bin/cws-proxy"
    )
    for marker in SECRET_MARKERS:
        if marker in joined:
            fail("package text contains %s" % marker.decode("ascii"))
    for name in data:
        lower = name.lower()
        if lower.endswith((".pem", ".p12", ".key", ".mobileprovision", ".provisionprofile", ".jks", ".keystore", ".env")):
            fail("package contains a secret-like path: %s" % name)
        base = os.path.basename(lower)
        if "native-proxy.darwin" in base or base.endswith(".node") and "linux-" not in base:
            fail("package contains a non-Linux native addon: %s" % name)

    kind = "layout-check" if layout else "runnable"
    print("ok %s %s %s (%d bytes)" % (kind, fields["Package"], fields["Version"], len(blob)))
    print("architecture %s" % arch)
    print("udev %s" % RULE)


if __name__ == "__main__":
    main()

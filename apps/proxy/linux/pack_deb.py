#!/usr/bin/env python3
"""Write a Debian binary package (format 2.0) as a GNU ar archive.

Ubuntu's dpkg does not accept the BSD ar archives produced by macOS `ar`.
This script is the packer for hk.ysk.cws.proxy so the same command works on
Ubuntu and on a Mac layout check.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import os
import stat
import sys
import tarfile

SECRET_SUFFIXES = (
    ".pem",
    ".p12",
    ".key",
    ".mobileprovision",
    ".provisionprofile",
    ".jks",
    ".keystore",
    ".cer",
    ".p8",
)
SECRET_NAMES = ("id_rsa", "id_dsa", "id_ecdsa", "id_ed25519", "upload-keystore")


def fail(message: str) -> None:
    sys.stderr.write(message + "\n")
    raise SystemExit(1)


def reject_secrets(root: str) -> None:
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [name for name in dirnames if name != ".git"]
        for name in filenames:
            lower = name.lower()
            if lower == ".env" or lower.startswith(".env."):
                fail("refusing to pack secret-like file: %s" % os.path.join(dirpath, name))
            if lower in SECRET_NAMES or lower.startswith("upload-keystore"):
                fail("refusing to pack secret-like file: %s" % os.path.join(dirpath, name))
            for suffix in SECRET_SUFFIXES:
                if lower.endswith(suffix):
                    fail("refusing to pack secret-like file: %s" % os.path.join(dirpath, name))


def iter_files(root: str) -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for name in sorted(filenames):
            full = os.path.join(dirpath, name)
            if not os.path.isfile(full) or os.path.islink(full):
                fail("refusing to pack a non-regular file: %s" % full)
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            if rel.startswith("../") or "/../" in rel:
                fail("refusing to pack a path outside the stage: %s" % rel)
            found.append((rel, full))
    return found


def md5sums(root: str) -> str:
    lines: list[str] = []
    for rel, full in iter_files(root):
        digest = hashlib.md5(open(full, "rb").read()).hexdigest()
        lines.append("%s  %s" % (digest, rel))
    text = "\n".join(lines)
    if text:
        text += "\n"
    return text


def tar_gz(members: list[tuple[tarfile.TarInfo, bytes | None]], mtime: int) -> bytes:
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w", format=tarfile.GNU_FORMAT) as archive:
        for info, payload in members:
            info.mtime = mtime
            info.uid = 0
            info.gid = 0
            info.uname = "root"
            info.gname = "root"
            archive.addfile(info, io.BytesIO(payload) if payload is not None else None)
    compressed = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=compressed, mtime=mtime) as handle:
        handle.write(raw.getvalue())
    return compressed.getvalue()


def tree_members(root: str) -> list[tuple[tarfile.TarInfo, bytes | None]]:
    members: list[tuple[tarfile.TarInfo, bytes | None]] = []
    directories: list[str] = []
    for dirpath, dirnames, _filenames in os.walk(root):
        dirnames.sort()
        rel = os.path.relpath(dirpath, root).replace(os.sep, "/")
        if rel != ".":
            directories.append(rel)
    for rel in sorted(directories):
        info = tarfile.TarInfo(name="./" + rel)
        info.type = tarfile.DIRTYPE
        info.mode = 0o755
        members.append((info, None))
    for rel, full in iter_files(root):
        payload = open(full, "rb").read()
        info = tarfile.TarInfo(name="./" + rel)
        info.type = tarfile.REGTYPE
        info.mode = stat.S_IMODE(os.stat(full).st_mode)
        info.size = len(payload)
        members.append((info, payload))
    return members


def control_members(control_dir: str, sums: str) -> list[tuple[tarfile.TarInfo, bytes | None]]:
    wanted = ("control", "postinst", "prerm", "postrm")
    members: list[tuple[tarfile.TarInfo, bytes | None]] = []
    blobs: list[tuple[str, bytes, int]] = []
    for name in wanted:
        path = os.path.join(control_dir, name)
        if not os.path.isfile(path):
            if name == "control":
                fail("missing control file: %s" % path)
            continue
        payload = open(path, "rb").read()
        mode = stat.S_IMODE(os.stat(path).st_mode)
        blobs.append((name, payload, mode))
    blobs.append(("md5sums", sums.encode("utf-8"), 0o644))
    for name, payload, mode in blobs:
        info = tarfile.TarInfo(name="./" + name)
        info.type = tarfile.REGTYPE
        info.mode = mode
        info.size = len(payload)
        members.append((info, payload))
    return members


def ar_member(name: str, payload: bytes, mtime: int) -> bytes:
    if len(name) > 15:
        fail("ar member name too long: %s" % name)
    header = (
        "%-16s%-12d%-6d%-6d%-8o%-10d" % (name + "/", mtime, 0, 0, 0o100644, len(payload))
        + "`\n"
    )
    encoded = header.encode("ascii")
    if len(encoded) != 60:
        fail("ar header for %s is %d bytes" % (name, len(encoded)))
    pad = b"\n" if len(payload) % 2 else b""
    return encoded + payload + pad


def write_deb(stage: str, control_dir: str, output: str, mtime: int) -> None:
    reject_secrets(stage)
    reject_secrets(control_dir)
    for rel, full in iter_files(stage):
        if rel.endswith(".cjs") or rel.endswith(".js") or rel.endswith(".sh") or rel.endswith(".html"):
            text = open(full, "rb").read()
            if b"BEGIN PRIVATE KEY" in text or b"BEGIN RSA PRIVATE KEY" in text or b"BEGIN OPENSSH PRIVATE KEY" in text:
                fail("refusing to pack a private key block in %s" % rel)
    data = tar_gz(tree_members(stage), mtime)
    control = tar_gz(control_members(control_dir, md5sums(stage)), mtime)
    blob = b"!<arch>\n"
    blob += ar_member("debian-binary", b"2.0\n", mtime)
    blob += ar_member("control.tar.gz", control, mtime)
    blob += ar_member("data.tar.gz", data, mtime)
    parent = os.path.dirname(os.path.abspath(output))
    os.makedirs(parent, exist_ok=True)
    with open(output, "wb") as handle:
        handle.write(blob)


def main() -> None:
    parser = argparse.ArgumentParser(description="Pack a .deb from a stage directory")
    parser.add_argument("--stage", required=True)
    parser.add_argument("--control", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--mtime", type=int, default=1761696000)
    args = parser.parse_args()
    write_deb(args.stage, args.control, args.output, args.mtime)
    print(os.path.abspath(args.output))


if __name__ == "__main__":
    main()

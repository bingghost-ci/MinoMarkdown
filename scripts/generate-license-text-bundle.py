#!/usr/bin/env python3
"""Collect locally installed third-party license texts for release review."""

import csv
import hashlib
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "doc/evidence"
REGISTRY = Path.home() / ".cargo/registry/src"
PREFIXES = ("license", "licence", "copying", "notice")
INDEX = EVIDENCE / "third-party-license-file-index.tsv"
TEXTS = EVIDENCE / "third-party-license-texts.txt"


def inventory(name: str):
    with (EVIDENCE / name).open(encoding="utf-8", newline="") as source:
        return list(csv.DictReader(source, delimiter="\t"))


def package_dir(kind: str, row: dict[str, str]) -> Path | None:
    if kind == "npm":
        path = ROOT / "node_modules" / row["package"]
        return path if path.is_dir() else None
    matches = sorted(REGISTRY.glob(f"*/{row['package']}-{row['version']}"))
    return matches[0] if matches else None


def collect():
    lines = ["source\tpackage\tversion\tlicense-expression\tfile\tsha256\tstatus\n"]
    chunks = [
        "MinoMarkdown third-party license texts from locally installed sources\n"
        "Review artifact only: missing texts and the project license are not supplied here.\n\n".encode()
    ]
    counts = {"npm": [0, 0], "rust": [0, 0]}
    for kind, name in (
        ("npm", "dependency-licenses.tsv"),
        ("rust", "rust-dependency-licenses.tsv"),
    ):
        for row in inventory(name):
            counts[kind][0] += 1
            directory = package_dir(kind, row)
            files = [] if directory is None else sorted(
                item for item in directory.iterdir()
                if item.is_file() and item.name.lower().startswith(PREFIXES)
            )
            expression = row["license" if kind == "npm" else "license-expression"]
            if not files:
                lines.append(f"{kind}\t{row['package']}\t{row['version']}\t{expression}\t\t\tmissing\n")
                continue
            counts[kind][1] += 1
            for item in files:
                body = item.read_bytes()
                body.decode("utf-8")
                digest = hashlib.sha256(body).hexdigest()
                lines.append(f"{kind}\t{row['package']}\t{row['version']}\t{expression}\t{item.name}\t{digest}\tpresent\n")
                heading = f"===== {kind} {row['package']}@{row['version']} / {item.name} (SHA-256 {digest}) =====\n"
                chunks.extend((heading.encode("utf-8"), body, b"\n\n"))
    return "".join(lines).encode("utf-8"), b"".join(chunks), counts


def main():
    if sys.argv[1:] not in (["--write"], ["--verify"]):
        raise SystemExit("Usage: generate-license-text-bundle.py --write|--verify")
    index, texts, counts = collect()
    if sys.argv[1] == "--write":
        INDEX.write_bytes(index)
        TEXTS.write_bytes(texts)
    elif INDEX.read_bytes() != index or TEXTS.read_bytes() != texts:
        raise SystemExit("License text bundle differs from locally installed sources")
    print(f"npm: {counts['npm'][1]}/{counts['npm'][0]} packages with local text")
    print(f"rust: {counts['rust'][1]}/{counts['rust'][0]} packages with local text")
    print(f"index: {INDEX.relative_to(ROOT)}; texts: {TEXTS.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

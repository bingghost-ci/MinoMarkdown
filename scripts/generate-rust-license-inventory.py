#!/usr/bin/env python3
"""Record locked Rust dependency license metadata for the macOS arm64 build."""

import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_DIR = ROOT / "src-tauri"
OUTPUT = ROOT / "doc/evidence/rust-dependency-licenses.tsv"
TARGET = "aarch64-apple-darwin"


def main() -> None:
    metadata = json.loads(
        subprocess.check_output(
            [
                "cargo", "metadata", "--locked", "--offline", "--filter-platform",
                TARGET, "--format-version", "1",
            ],
            cwd=MANIFEST_DIR,
        )
    )
    resolved_ids = {node["id"] for node in metadata["resolve"]["nodes"]}
    packages = sorted(
        (package for package in metadata["packages"]
         if package["id"] in resolved_ids and package.get("source")),
        key=lambda package: (package["name"], package["version"]),
    )
    lines = ["package\tversion\tlicense-expression\tsource"]
    for package in packages:
        license_expression = package.get("license") or "UNKNOWN"
        source = "crates.io" if package["source"].startswith("registry+") else package["source"]
        fields = (package["name"], package["version"], license_expression, source)
        if any("\t" in field or "\n" in field for field in fields):
            raise ValueError("Package metadata contains a TSV delimiter")
        lines.append("\t".join(fields))
    OUTPUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    missing = sum(package.get("license") is None for package in packages)
    print(f"{TARGET}: {len(packages)} locked third-party packages, {missing} missing license fields -> {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

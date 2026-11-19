# Xiaolai SC (小赖字体)

The 38 `xiaolai-*.woff2` files (2024980 bytes in all) are Xiaolai SC Regular, version 3.11 (2020-12-04), copyright 2020 LXGW, derived from SetoFont by Nozomi Seto (瀬戸のぞみ), licensed under the SIL Open Font License 1.1 (see `LICENSE.txt`; the font's name table declares the license and names no Reserved Font Name). They are unicode-range subsets the Excalidraw project ships, each copied unchanged from <https://github.com/excalidraw/excalidraw> at commit `d732d4f3d50e6ac092ec6e86a4e04a40546a9395`, directory `packages/excalidraw/fonts/Xiaolai/` (downloaded 2026-11-19). Excalidraw cut them with cn-font-split 5.2.2 and records these changes to the original font: non-CJK code points removed, Hangul side bearings reduced to 40%, and badly centered CJK glyphs centered.

Each file was renamed from `Xiaolai-Regular-<md5>.woff2` to `xiaolai-<first 8 hex digits>.woff2`; `ranges.json` gives the unicode-range of each, taken from that directory's `index.ts`. `scripts/generate-font-table.mjs` reads it to register the family as `Mino Xiaolai`.

Excalidraw ships 209 subsets (12.1 MiB, 41,577 code points), cut so that common characters come first. Mino keeps the 38 that hold a GB 2312 character, CJK punctuation (U+3000–30FF) or a full-width form (U+FF00–FFEF): 8291 code points, which include all 6,763 GB 2312 Chinese characters. A rarer character is drawn in the system's Kaiti. Nothing inside a file was changed.

Mino draws the labels of hand-drawn diagrams in it (T115). It holds no Latin letters; those come from Excalifont.

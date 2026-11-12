# T100 文件读写路径

状态：automatedVerified。2026-11-12。计时办法见 [T91](T91-baseline.md)（Rust release 构建，5 次中位数，机器空闲时测）。

## 逐项结果

| 编号 | 改前 | 改后 | 结论 |
| --- | --- | --- | --- |
| P9-1 SHA-256 | 64 MiB 用时 118 ms（软件实现，约 540 MiB/s） | 25 ms（约 2.5 GiB/s），是改前的 21%（门槛 50%）；同一输入的摘要不变（`f77a9cd038060742…`） | 达标，保留 |
| P9-2 外部修改的轮询 | 文件已被外部修改、标签又有未保存内容时，每 3 秒重读并重哈希整个文件 | 授权记录里记下上次看到的“文件戳 + 哈希”，文件戳没变直接返回；`grant.revision` 不动，保存时照旧完整复查 | 达标，保留 |
| P9-3 UTF-8 解码 | 20 MiB 用时 18 ms | 17 ms，下降 6%（门槛 40%） | **无效，已撤回** |
| P9-4 导出时的图片解码 | 每张图片在进入快照时解码一次，写出时再解码一次 | 进入快照时得到的扩展名随快照保存，写出时不再解码 | 达标，保留 |
| P9-5 草稿预览 | 预览（不取图片）仍读取并哈希全部图片，只为报个数量 | 预览只读取并校验正文，数量取自清单；恢复照旧逐个校验图片 | 达标，保留 |
| P9-6 保存的编码与回传 | 文本编码两次；每次保存把全文作为 JSON 回传 | 预检时的编码结果直接用于写入（保存附件没有改动文本时）；`SaveResult.markdown` 只在文本被改写时返回，前端缺省时沿用发出的文本 | 保留（结构性；IPC 上的收益未测） |
| P9-7 文件栏列表 | 每个条目一次 `lstat`；排序时每次比较生成两个小写字符串 | 用目录项自带的类型（同样不跟随链接）；`sort_by_cached_key` | 保留（代码审阅 + 既有测试） |
| P9-8 快照的拷贝 | 取快照时在持锁状态下深拷贝全部正文与图片（最多约 100 MiB） | 快照以 `Arc` 共享；`read_snapshot` 在锁外拷贝一次交给暂存区，`export_snapshot_md` 不拷贝 | 保留 |

## P9-1 的做法

方案设想开 `sha2 0.10` 的 `asm` 特性，但它依赖的 `sha2-asm` 不在本地缓存里，离线取不到。改为升级到 `sha2 0.11.1`（本地缓存已有），它在 aarch64 上默认按运行时检测使用 ARMv8 SHA 指令。

- `Cargo.lock` 新增 7 个包：`sha2 0.11.1`、`digest 0.11.3`、`block-buffer 0.12.1`、`crypto-common 0.2.2`、`hybrid-array 0.4.15`、`const-oid 0.10.2`、`cpufeatures 0.3.1`，均为 MIT OR Apache-2.0，已由 `scripts/generate-rust-license-inventory.py` 记入 `rust-dependency-licenses.tsv`（285 个包，无缺失）。`sha2 0.10.9` 仍被其他依赖使用，留在锁文件里。
- 离线解析时 cargo 顺带把两个与本平台无关的包（`openssl-probe`、`schannel`）降了版本，因为它们原先锁定的版本从未下载过。这两处已手工改回原版本与校验值，`cargo check --locked --offline` 通过。
- 新版的摘要类型不再实现十六进制格式化，于是把全部 `format!("{:x}", Sha256::digest(..))` 改为 `fs::sha256_hex` / `fs::hex` 两个函数（原先有 5 份各自的写法，T103 的这一项因此提前完成）。
- **未处理**：打包时的许可文本合集（`scripts/generate-license-text-bundle.py`）是否需要这 7 个包的文本，留到 T104 运行 `./build.sh` 时确认。

## P9-3 为什么无效

解码的耗时主要在逐字符的文本检查（`is_text`）和 UTF-8 校验上，被去掉的那次拷贝与比较只是内存拷贝和内存比较，本来就很快。改动已撤回，`text_encoding.rs` 的运行时代码与提交 `0f53d30` 相同（只多了 T91 的计时测试）。

## 测试

Rust 新增 5 项（共 137 项通过、4 项忽略）：

- `fs::tests::hashes_as_the_reference_values_do`：空串、`abc`、1000 个 `a` 的标准摘要值。
- `documents::tests::a_changed_file_is_not_read_again_until_it_changes_again`：记下的哈希故意与文件内容不符，返回它即证明没有读文件；文件再变则重新读取；变回标签持有的内容则判为相同。
- `documents::tests::a_save_that_left_the_text_as_sent_does_not_send_it_back`：`markdown` 为空时序列化结果不含该字段。
- `snapshots::tests::snapshot_is_frozen_and_exported_with_local_image`（扩充）：进入快照时校验次数加 1，写出时不变；两次读取得到同一个共享对象。
- `drafts::tests::a_preview_reads_the_text_without_the_images_and_a_restore_still_checks_them`：把草稿里的图片文件写坏后，预览仍返回正文与数量，恢复返回 `CORRUPT_DRAFT`。

既有的 `unchanged_stat_skips_hashing…`、`external_change_and_delete_are_detected_from_content`、工作区列表与符号链接的测试未改，全部通过。

## 红线核对

- 冲突检测：保存路径上的 `disk_revision` 复查和 `atomic_write::commit` 内的两次复查都没有改；P9-2 记下的哈希只用于回答轮询。
- 编码无损：非 UTF-8 编码的往返校验未动；P9-6 复用的是同一文本、同一编码的编码结果。
- 符号链接：文件栏仍跳过符号链接（目录项类型与 `lstat` 一样描述链接本身）。
- 草稿恢复：仍对每个图片做哈希校验。

## 改动的文件

`src-tauri/Cargo.toml`、`Cargo.lock`、`src-tauri/src/fs/mod.rs`、`fs/atomic_write.rs`、`documents.rs`、`drafts.rs`、`snapshots.rs`、`workspace.rs`、`recent.rs`、`settings.rs`、`ai.rs`、`positions.rs`、`src/app/useDocumentWorkspace.ts`、`doc/evidence/rust-dependency-licenses.tsv`。

## 检查

`cargo check --locked --offline` PASS，无警告；`cargo test --lib` 137 项 PASS；`npm run typecheck` PASS；`npm run test` 540 项 PASS、1 项跳过。

## 实机 PENDING

打开 50 MiB 以上的 PDF 到首页出现的时间与改前对比；外部程序修改文件后的冲突提示照常出现，再次修改后提示更新；带新图片的文档保存后图片引用改写正确、未带新图片的文档保存后编辑器内容不变；文件栏列表顺序与改前一致。

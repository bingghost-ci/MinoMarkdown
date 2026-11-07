# T28 arm64 本地包

日期：2026-11-07。命令：`./start.sh --build-only`，PASS；只构建，未启动或安装应用。Node/Rust/Tauri CLI 架构检查均为 arm64。`npm run build` PASS；打包器生成 `src-tauri/target/release/bundle/macos/MinoMarkdown.app`，`lipo -archs` 为 `arm64`。

产物：`.app` 13,716 KiB；`dist-package/MinoMarkdown-0.1.0-macos-arm64-unsigned.zip` 5,232 KiB，`unzip -tq` PASS。主可执行文件 SHA-256：`b442d45122aeed20dbd920835f002f214d6800bf88325c066122273289ef2eea`；ZIP SHA-256：`90b206e02cb57e20f784ed6cfbfc2e6ce4ea74d06e242497ce140878a700a1f4`。锁文件 SHA-256：npm `b16d1e3ab76ab5cc1fea21eae65a39951c345e5837198db037e09f23ef88dc86`；Cargo `751786a354ef4e26c7af0299d0357303ffe429e2c307b82b2edbcc56b4c873a1`。

`Info.plist` 有 `.md`/`.markdown`、Editor、Alternate 文件关联。包由 `--no-sign` 构建，未做 Developer ID 签名、公证、安装位置启动、Finder 关联实际操作、离线运行或用户验收；不是对外发布包。维护/用户说明见根 `README.md`，依赖许可证清单见 `dependency-licenses.tsv`（仍需最终完整许可证审计）。

2026-11-07 图片引用修复后重新执行 `./start.sh --build-only`，PASS；旧哈希由以下当前值取代。当前 `.app` 13,708 KiB，ZIP 6,156 KiB；主可执行文件 SHA-256 `8a571ee851760af5565bc70c75270bca77a828c5fc16adcca4a6ca5b9fcd20d0`，ZIP SHA-256 `247e935d28a722705e277f6da6c0e12b289f92451e71154588630bc2fbdaf15f`。`unzip -tq` PASS，压缩包中的主可执行文件哈希与 `.app` 一致。仍未启动当前包。

依赖许可补充：`python3 scripts/generate-rust-license-inventory.py` 从 `Cargo.lock` 离线解析 macOS arm64 目标的 258 个第三方 Rust 包，生成 [rust-dependency-licenses.tsv](rust-dependency-licenses.tsv)，0 个缺少许可证元数据；现有 npm 表含 295 条。Rust 清单 SHA-256 `02540691eedcd8b80c41a3fded078e3f0d057826eb971470582f88d2b1f986bc`。这两张表不是必要 notices 或许可证原文的完整法律审计，对外分发前仍需检查随包字体、样式和上游许可文本。

图标补充：`src-tauri/icons/mino-markdown.svg` 为项目内绘制的矢量源，使用本地 Tauri CLI 生成 `icon.icns` 等尺寸，并写入 `tauri.conf.json`。重新运行 `./start.sh --build-only` PASS；当前 `.app` 的 `Info.plist` 指向 `icon.icns`，实际资源存在（51 KiB）。**当前产物** `.app` 13,696 KiB、ZIP 6,156 KiB；主可执行文件 SHA-256 `44a27b685f28496ff1921c2e3e8b3a5268c82f28c771190fd5ecc73db2248c8a`，图标 SHA-256 `27d9ff684608026410a3f036e34f364544230031eb701e3bb13ca5fb4f26f0d6`，ZIP SHA-256 `b104eda74c756d5d816b99b17e534868b53424ab62478e326ee4600a9371c23d`。`unzip -tq` PASS，ZIP 内可执行文件哈希与 `.app` 一致。此处哈希取代上文旧包哈希；当前包仍未启动、安装或公证。

2026-11-07 F04 引用式图片修复后的**当前产物**：`./start.sh --build-only` PASS，主可执行文件 `arm64`；`.app` 13,700 KiB，ZIP 6,156 KiB。主可执行文件 SHA-256 `3a8c6ac869282a61d81ab3e2d2de43e671cf089eae8b63c5dfb960dd9db885d1`；ZIP SHA-256 `5b968707b9ba3588d1a3184124a6a98beaa6d7dc3044ec211ba019e1a50d91a4`；`Cargo.lock` SHA-256 `ea75989209f41c0dd13772880580e889178119e1d0353458c510df309bec6d8f`。`unzip -tq` PASS，ZIP 内主可执行文件 SHA-256 与 `.app` 一致。Rust 许可表重新生成，仍为 258 条、无缺失许可字段。此前包哈希均为历史记录。当前包未启动、安装或公证。

2026-11-07 图片弹层与草稿图片恢复修复后的**当前包**：`.app` 13,700 KiB，ZIP 6,156 KiB；主可执行文件 SHA-256 `00be8f1e3484b78b528ec0cdfad06f2cbee1669486b5b6608d6372770f36e706`，ZIP SHA-256 `9008c6f3ea17ad22151fb15f34989fedf857af268e2c3b82f08fc2c79e6f73c5`。`./start.sh --build-only`、`lipo -archs`=`arm64`、`unzip -tq` 通过，ZIP 内主可执行文件哈希与 `.app` 一致。上文哈希为历史包；当前包未启动或安装。

2026-11-07 草稿读取入口追加修复后的**当前包**：`.app` 13,700 KiB，ZIP 6,156 KiB；主可执行文件 SHA-256 `dfd12c4372795f69b0a5b86364c7e89168e10c9f9a663c59ae37e14bd892441d`，ZIP SHA-256 `2cf2d19d7498245fc526f0db61cf509cb925537e7d8e799b31adbc1851402891`。`./start.sh --build-only`、`lipo -archs`=`arm64`、`unzip -tq` 通过，ZIP 内可执行文件哈希一致；上文哈希均属历史包。当前包未启动、安装或公证。

2026-11-07 图片目标语法补齐后的**当前包**：`.app` 13,700 KiB，ZIP 6,156 KiB；主可执行文件 SHA-256 `9bff089e0040152dc328f95703dea9c050fb0e78544f53e1f98eac92bb4f64c9`，ZIP SHA-256 `46772af676dd343021419c9c28f7eae389563ce64b1d4f441ac0a0830aa56c02`。`./start.sh --build-only`、`lipo -archs`=`arm64`、`unzip -tq` 通过，ZIP 内可执行文件哈希一致。上文哈希均为历史构建；当前包未启动、安装或公证。

2026-11-07 链接弹层选区修复后的**当前包**：`.app` 13,700 KiB，ZIP 6,156 KiB；主可执行文件 SHA-256 `5e80d8a3665bc618611d8836c4e48624e41c23a09dc82ea9d1bc7aa2d3b63506`，ZIP SHA-256 `00c0ac9af34d1f174013e908ef5eedd274be483b6988e015949383c85995f5cc`。`./start.sh --build-only`、`lipo -archs`=`arm64`、`unzip -tq` 通过，ZIP 内可执行文件哈希一致。上文哈希均为历史构建；当前包未启动、安装或公证。

2026-11-07 链接范围选择修正后的**当前包**：主可执行文件 SHA-256 `ed2d5b5ad594b6c4a0acb81f861d090cca746e5fd5fe7eb8241495bb5db942e8`，ZIP SHA-256 `9d42ccf9e8421ac6ade7b6f15f40cf715bfc663ac45210024594afa1fc66120d`。`./start.sh --build-only`、`lipo -archs`=`arm64`、`unzip -tq` 通过，ZIP 内可执行文件哈希一致。上文哈希均为历史构建；当前包未启动、安装或公证。

2026-11-07 F05 表格竖线转义修正后的**当前包**：`.app` 13,700 KiB，ZIP 6,156 KiB；主可执行文件 SHA-256 `e5f1728534d4fc4439a6d7c0a21f71be4016254fa5db97869a3eb53da97f99c3`，ZIP SHA-256 `21cbb91a116f0dcadbd83bc412b4b09a18a7bef38c1511f1e7b437d6846104f0`。`./start.sh --build-only`、`lipo -archs`=`arm64`、`unzip -tq` 通过，ZIP 内可执行文件哈希一致。上文哈希均属历史构建；当前包未启动、安装或公证。

2026-11-07 附件读取边界加固后的**当前包**：`.app` 13,692 KiB，ZIP 6,156 KiB；主可执行文件 SHA-256 `abfb1c53fea530cecabd3f213ccffdf1de08b153bf4b36c92bfe43187be50f8c`，ZIP SHA-256 `9a0d5406ca3c8d661f1b389e736c686b98e73469d1a18ef3006bc73263e0e78e`，`Cargo.lock` SHA-256 `2eaa08c568fc94e2d3d0ada36b12ae453ea168c83361114ea56d816fbe595dab`。`./start.sh --build-only`、`lipo -archs`=`arm64`、`unzip -tq` 通过，ZIP 内可执行文件哈希一致。Rust 许可索引重新生成，仍为 258 条且无缺失字段。上文哈希均属历史构建；当前包未启动、安装或公证。

2026-11-07 Markdown 读取链加固后的**当前包**：`.app` 13,696 KiB，ZIP 6,156 KiB；主可执行文件 SHA-256 `524358fa9729aade12b140b37d9c5f4739adc69d7721e369bbb80bead8a7ae1f`，ZIP SHA-256 `9ea45e38399204763addae353fb7d143759a5b2762f4182747decbc2bd49ea93`。`./start.sh --build-only`、`lipo -archs`=`arm64`、`unzip -tq` 通过，ZIP 内可执行文件哈希一致。上文哈希均属历史构建；当前包未启动、安装或公证。

2026-11-07 文件选择器授权入口修正后的**当前包**：`.app` 13,720 KiB，ZIP 6,156 KiB；主可执行文件 SHA-256 `d3f9f4dd9adb132f6b0bb4409f8c73f54560e3452f70bde0aa6c3f4e034dc9ac`，ZIP SHA-256 `2dbb54206eaf14225d1525c214585217b55b1f2d7dce587c2001317f5691a044`。`./start.sh --build-only`、`lipo -archs`=`arm64`、`unzip -tq` 通过，ZIP 内可执行文件哈希一致。上文哈希均属历史构建；当前包未启动、安装或公证。

2026-11-07 图片意图读取加固后的**当前包**：主可执行文件 SHA-256 `9f75440cb5306f4ed9b357182db740b02a8fa8b7876f7d48c0dcd91a25352334`，ZIP SHA-256 `096e940f4ca041587fb340c983113fecfd0e4b242425b68c21b2d24ecd16bd4d`。`./start.sh --build-only`、`lipo -archs`=`arm64`、`unzip -tq` 通过，ZIP 内可执行文件哈希一致。上文哈希均属历史构建；当前包未启动、安装或公证。

2026-11-07 保存链旧文件读取加固后的**当前包**：主可执行文件 SHA-256 `aace59d694a159b560b618936f85f1ab7b6325b7539bfb9c99187a377806a4af`，ZIP SHA-256 `d844f1d42fd0b0dde886b5e2c3b2b875d7b2aa7d013644649c2acb406a283599`。`./start.sh --build-only`、`lipo -archs`=`arm64`、`unzip -tq` 通过，ZIP 内可执行文件哈希一致。上文哈希均属历史构建；当前包未启动、安装或公证。

2026-11-07 原子提交目录句柄加固后的**当前包**：主可执行文件 SHA-256 `2644ee8ca7f5b109ccefcb0eadbec29c5d8413deca18c59b7fd0338234c9a586`，ZIP SHA-256 `68dbe90e405e537ed530301b5e8b2978f4436d7b0ab7ddc997460534f6a99e5b`。`./start.sh --build-only`、`lipo -archs`=`arm64`、`unzip -tq` 通过，ZIP 内可执行文件哈希一致。上文哈希均属历史构建；当前包未启动、安装或公证。

2026-11-07 附件目录句柄加固后的**当前包**：主可执行文件 SHA-256 `431c16c09a2dd7836ac5e09f728c26a628dbe99799e45de1a2abf17cbf6e338a`，ZIP SHA-256 `ccb4b20c5b5efbed4c65e4417c4840b9648139b7ec1b27bf8dbc31de7d38673e`。`./start.sh --build-only`、`lipo -archs`=`arm64`、`unzip -tq` 通过，ZIP 内可执行文件哈希一致。上文哈希均属历史构建；当前包未启动、安装或公证。

2026-11-07 HTML/源码 Markdown 导出排他提交后的**当前包**：主可执行文件 SHA-256 `0881bada2b03843f039960a7bbc26e4ba2b3dbca82dcaea8f948547e88d996d8`，ZIP SHA-256 `73be6431da96dd213535dc1a6bd8e27a33a2424c8b613a75c91f81db3d63e775`。`./start.sh --build-only`、`lipo -archs`=`arm64`、`unzip -tq` 通过，ZIP 内可执行文件哈希一致。上文哈希均属历史构建；当前包未启动、安装或公证。

2026-11-07 目录树新建/重命名加固后的**当前包**：主可执行文件 SHA-256 `27fe630d959749afa61f54b1f8e08aa8c73db65a24e28318a0c6f1dc401c1036`，ZIP SHA-256 `10f42add8f99fbb85b8538361bb6dec072dc90f136a0187e3a626094b6865892`。`./start.sh --build-only`、`lipo -archs`=`arm64`、`unzip -tq` 通过，ZIP 内可执行文件哈希一致。上文哈希均属历史构建；当前包未启动、安装或公证。

2026-11-07 废纸篓短期文件引用 URL 加固后的**当前包**：主可执行文件 SHA-256 `f259ded131f0118bcfb0e298d614366c227699626d80324efe501663322c8a53`，ZIP SHA-256 `db00a1f83cb4912cc83fbbbfd7c795313700f24f2f786bbbe03f541ad30ba0a6`。`./start.sh --build-only`、`lipo -archs`=`arm64`、`unzip -tq` 通过，ZIP 内可执行文件哈希一致。上文哈希均属历史构建；当前包未启动、安装或公证。

2026-11-07 应用数据限额读取加固后的**当前包**：主可执行文件 SHA-256 `5dbebe3eb4ecc31cdecb25b15a8e6a4dfb8180ac7f0c7469967d81d1007d7c33`，ZIP SHA-256 `767d1f5823c18edb2b7ad100a4e4cbf1958965eeeb1cec0ebc1b8f4cfb9d2a21`。`./start.sh --build-only`、`lipo -archs`=`arm64`、`unzip -tq` 通过，ZIP 内可执行文件哈希一致。上文哈希均属历史构建；当前包未启动、安装或公证。

2026-11-07 草稿快照目录句柄提交后的**当前包**：主可执行文件 SHA-256 `51b4b07a2eeb4e3b7e93f822d514bd891c3690ce59bd44db0cbb6eda73699de6`，ZIP SHA-256 `e37d2608a20135e2367e8131a5f49fbefd2bf72cc5fe8c8cd7a1661dfb293420`。`./start.sh --build-only`、`lipo -archs`=`arm64`、`unzip -tq` 通过，ZIP 内可执行文件哈希一致。上文哈希均属历史构建；当前包未启动、安装或公证。

2026-11-07 草稿读取/丢弃目录句柄加固后的**当前包**：主可执行文件 SHA-256 `fca2d32ea1e0272592f35ac47d354f3363a8edc0b66df53f9946b5a3232846fc`，ZIP SHA-256 `0f1336f476b9eae35c024005106864cefadfd5205928727c7e248b02ab0b009f`。首次构建本身成功，但外层 zsh 检查命令误用只读变量 `status` 而退出 1；改用 `rc` 后第二次 `./start.sh --build-only` 成功。`lipo -archs`=`arm64`、`unzip -tq` 及 ZIP 内主程序哈希一致。上文哈希均属历史构建；当前包未启动、安装或公证。

2026-11-07 应用数据目录创建加固后的**当前包**：主可执行文件 SHA-256 `59b40adcd07092382dc69cf8b9a6f0d80e522863fac18cc36654c3d4a242b833`，ZIP SHA-256 `81bcba13e8b936e12d7e33bb7ceda4519351d0b19d35c725ed7be0ee3e9fb559`。首次 `./start.sh --build-only` 有 Rust 未使用导入警告，移除后第二次构建通过。`lipo -archs`=`arm64`、`unzip -tq` 和 ZIP 内主程序哈希一致。上文哈希均属历史构建；当前包未启动、安装或公证。

2026-11-07 arm64 最低系统版本声明修正后的**当前包**：原 `Info.plist` 使用 Tauri 默认的 macOS 10.13，现 `tauri.conf.json > bundle > macOS > minimumSystemVersion` 显式设为 `12.0`；Tauri 官方[macOS 包文档](https://v2.tauri.app/distribute/macos-application-bundle/)说明默认值与配置项，[Apple Silicon 专用包示例](https://v2.tauri.app/distribute/app-store/)使用 12.0。`./start.sh --build-only` PASS，`plutil` 读取 `LSMinimumSystemVersion=12.0`，`lipo -archs=arm64`，`.md`/`.markdown` 文件关联、版本 0.1.0 和 icon.icns 仍在。当前 `.app` 13,736 KiB、ZIP 6,156 KiB；主程序 SHA-256 `74fc449abf5a7fc9019d55d50917eb29ec403308002c39f7071c8062019dc2b8`，ZIP SHA-256 `15584d32b182ec67450e76267470937a22d5a2b6da32c16c45c2b5b57b56cdd5`，`unzip -tq` 与 ZIP 内主程序哈希一致。12.0 是包声明，未在 macOS 12 实机验证；开发机为 macOS 27.0.1/M4 Max，包未启动、安装、签名或公证。上文包哈希均为历史记录。

2026-11-07 本地包 manifest：新增 `scripts/package-manifest.mjs` 和 `dist-package/manifest.json`，记录版本、arm64、最低系统声明、`.app`/ZIP/锁文件 SHA-256 与包体积；`verify` 核对 ZIP CRC 以及其中主程序、Info.plist、图标与 `.app` 一致。首次 `write` 因 Node `execFileSync` 默认缓冲区不足报 `ENOBUFS`，提高解压主程序的缓冲上限后第二次 `write`、第三次 `verify` PASS。manifest SHA-256 `48d4343dbb5441c2a70e09667fb9aa1dab1418500ff1664b3b08997c710ecf28`。未来重建 `.app`/ZIP 后重新运行 `node scripts/package-manifest.mjs write`，再运行 `verify`；此核验不代表完整安装或运行验收。

2026-11-07 manifest 覆盖复核：当前 `.app` 仅有 3 个常规文件（主程序、Info.plist、icon.icns）；ZIP 对应常规文件清单也正好相同。`scripts/package-manifest.mjs` 现在先比较完整常规文件清单，再逐个核对这 3 个文件的内容哈希；ZIP 内额外 AppleDouble 元数据条目不纳入常规文件集合。重新 `write`/`verify` 均 PASS，当前 manifest SHA-256 `461f6c1d7ba936ec3a6133af37b833b7e2ae3ce3cfc1565fa574cb4b313e965a`；主程序/ZIP 哈希未改变。此检查覆盖 bundle 的全部常规文件内容，但不证明安装后权限、扩展属性或运行行为。
2026-11-07 应用数据目录读取加固后的**当前包**：`./start.sh --build-only` PASS，主程序 arm64 SHA-256 `210faeb595e6291f1d850a510a4b0106ad75ca14c9cc92c32e44b10d11178797`。构建不会自动更新 `dist-package/` 的旧 ZIP，第一次 `node scripts/package-manifest.mjs write` 因 ZIP 与新 `.app` 不一致 FAIL；随后用 `ditto -c -k --sequesterRsrc --keepParent` 重新归档，`write` 和 `verify` PASS。当前 ZIP SHA-256 `ef5418ef89d82de867af90510a26039991b9082f9906e90a7a8acea7f5ce69d2`，manifest SHA-256 `ea29e44874ed1f04d8a4ce70fa3d9ff612f11e8602786f9d5d93c64cee26d951`。此前包哈希均为历史值；当前包未启动、安装、签名或公证。

2026-11-07 构建入口修正后的**当前包**：`start.sh` 在 `.app` 构建和 arm64 检查后自动用 `ditto` 更新 ZIP，并运行 manifest `write`/`verify`。`sh -n start.sh`、`./start.sh --build-only` PASS，脚本输出 `Verified dist-package/manifest.json`；主程序 SHA-256 仍为 `210faeb595e6291f1d850a510a4b0106ad75ca14c9cc92c32e44b10d11178797`，新 ZIP SHA-256 `2962a13ba9754993c7369062e6cf1b32d4f963f258aec1e1c81a56efb8c2047d`，manifest SHA-256 `a9774d57b9171fbd24c676404f7cddadf2670ef8c77ae436560cb4ac40825a90`。ZIP 哈希变化包含归档元数据；以 manifest 核对内容。未启动、安装或做原生验收。

2026-11-07 空白启动入口修正后的**当前包**：`npm run typecheck`、前端 58/58、`./start.sh --build-only` PASS，ZIP 与 manifest 自动核验通过。主程序 SHA-256 `88617d44c8f47b0f47fbb4819afd9b408d975105f9d2a7ee6ca5fddc30035e37`，ZIP `8e480c67d27087e92f146844ee96ec2adff884828a63d13e46eaa9001404e77f`，manifest `1e95944beca89ae96409775f74b31db583c4253d9adcefb67833276dc30c5c1f`。当前构建未启动、安装、签名或做原生验收。

2026-11-07 离开会话草稿清理修正后的**当前包**：`npm run typecheck` 第二次 PASS、前端 58/58、`./start.sh --build-only` 及自动 manifest 核验 PASS。主程序 SHA-256 `631d436eac777221dca1dbc7477b85f920186b9a5e054e8792466496f5f02e3d`，ZIP `39a45b09411c59562c324d0b0815bdcba6b778e0897dfe139d015d64f11f62f8`，manifest `f6ff7ddbe9e8732fae98d48009e8d657f907939fa5edb05b4c407b6ce0ad8c0c`。未启动或安装当前应用。

2026-11-07 废纸篓后草稿清理失败处理补充后的**当前包**：`./start.sh --build-only` 与自动 manifest 核验 PASS。主程序 SHA-256 `d133e112c02d5907ee67d21d8eb95644ca025381ed4d681fe6cbb4cae0da6ea7`，ZIP `060c24bf41ac121c45b705ecfa07b2e65dc5ed5f60d6fa9b3dd8666edc3e352a`，manifest `5230df7bb8c94f5fe66772eb7640103cb00f5417ce9a27295c3a9095b1f3504f`。当前包未启动、安装或做原生验收；此前哈希均为历史值。

2026-11-07 文档授权回收补充后的**当前包**：前端 58/58、Rust 49/49、`./start.sh --build-only` 与 manifest 核验 PASS；主程序 SHA-256 `ff568a89122c3db711ced5d205498629407ebd8dde4eff565285336b8360f847`，ZIP `60969cb4bf90bd7aedeb8e47e2313ec5cf183903527c65b6a718e5c376feee46`，manifest `8d3c98dff869449499a59b06dc3382289f776da97b105c504ca3381bd5e672f3`。未启动、安装或做原生验收；此前哈希均为历史值。

2026-11-07 繁忙期关闭检查补充后的**当前包**：`./start.sh --build-only` 与 manifest 核验 PASS；主程序 SHA-256 `74d11f4d8c0a6a66d73d6aa753791c60308f5c0c95d943cc6451ea84d7396ca2`，ZIP `234886a92ea3343c8e62c81ec08c921460b654432fc46dba74d3b2008af62eec`，manifest `fa91180e1b40838cb613cb1d7478f8e1059bcc3eb2a8c7d547507096fc6be6c2`。未启动、安装或做原生验收；此前哈希为历史值。

2026-11-07 验证面板仅开发模式后的**当前包**：`./start.sh --build-only` 与 manifest 核验 PASS，生产 JS 不含验证面板与样本引导字符串。主程序 SHA-256 `8b9f08e4f0f1be5047be3581385493b2f6641acc536dd42d14e30b8f2e70d13a`，ZIP `321e21f17b06e7d02c67d5635f8ec208c671da7bc9caaa4f855b07992f1bbbd9`，manifest `8794ed1cc8c46e3f77607a50456eeb7ced1b26b9d74ae7ef9903892b2f6ec78a`。未启动、安装或做原生验收；此前哈希为历史值。

2026-11-07 工作区刷新令牌复用后的**当前包**：Rust 49/49、`./start.sh --build-only` 与 manifest 核验 PASS；主程序 SHA-256 `66e5fcef66f2b5154ee7f393ea962ed7ec263796f7f77a34cbfb44efd3d64503`，ZIP `b051f53685226b871f1b988a03e00183b237db83e88bd695b547fdc2834f93aa`，manifest `84a823cd85d4c6d8551667cff43be92c146b7f3f0f3a186eca9f57681cd7284a`。未启动、安装或做原生验收；此前哈希为历史值。

2026-11-07 外部删除条目授权清理后的**当前包**：定向 1/1、Rust 49/49、`./start.sh --build-only` 与 manifest 核验 PASS；主程序 SHA-256 `bca3af4227fc23d13b15e4584276d86e31f4c8add11a6b8cdfb8187a7c66b3bf`，ZIP `6570d15c9fb9e594f681abd6ab74816f871284c6b3b0cd605efb80f7e013f1a7`，manifest `0dfe29f50c3f5eea6973febfc99c1532fa371039bcaf8a8fca538b1260a59505`。未启动、安装或做原生验收；此前哈希为历史值。

2026-11-07 子目录后代令牌清理后的**当前包**：定向 1/1、Rust 50/50、`./start.sh --build-only` 与 manifest 核验 PASS；主程序 SHA-256 `718c34d93d6d6b21f3d0af7a6f29a093350297a0d16ccc531b482a6828ae49dd`，ZIP `1c6b6454c1fe05e53b7208bb58dd4a95b6910339d60cacad271b5ebb40ef9053`，manifest `2eba9b0f4fae36cbae17e8d924006c67412e4f59ba29e31d1ec2943b489c5ec2`。未启动、安装或做原生验收；此前哈希为历史值。

2026-11-07 编辑器异步销毁收敛后的**当前包**：`npm run typecheck`、前端 58/58、`./start.sh --build-only`、自动 manifest 核验及 `lipo -archs`=`arm64` PASS。主程序 SHA-256 `fe4d3dc64fdaa242261636116acc2d736f525b679781bea12302fff6d47e9458`，ZIP `f3db73cb3396fc065494e2cec8e3532287d4ebb0b82ce90e57e522c658e92910`，manifest `744246047fea4336980803f04cfa5f54acf8c6cfaf3b4ccdcf278e96cd899103`。未启动或安装当前应用；上文包哈希均属历史构建。

2026-11-07 大文档体积边界补齐后的**当前包**：前端 59/59、Rust 50/50、类型检查、`./start.sh --build-only` 与自动 manifest 核验 PASS，`lipo -archs`=`arm64`。主程序 SHA-256 `ce4e563d3b41ca328abf0c92f1d4081418d3162547216524acbc6b9866d6f8df`，ZIP `f625eab84d362d9d7953d6390b023a42a025ef71c1ccd11b8a9b9b36f1e53cc9`，manifest `57b363a6849270058fb39f03daeca6c55368075e07a4e9fe0dbec297bc9b4f98`。`.app` 13,736 KiB、ZIP 6,156 KiB。未启动或安装当前应用；上文包哈希为历史值。

2026-11-07 超限文件外部打开指引后的**当前包**：`./start.sh --build-only`、manifest 与 `lipo -archs`=`arm64` PASS；本轮仅改 UI 错误文案，未重跑单测或启动应用。主程序 SHA-256 `d5fc01604c2831695a00d066eacf1f46e5bedd07f55c6a42cea61dc3ff2de98d`，ZIP `d94c7d4ed156b1a8c951265a74576b61fbe0ea9f3116ae82583cfd44dd94a084`，manifest `ad519d94c7cd98c9e7f2327f9ccc2a4e5927c193de37b93a75a978fbb184913b`。未启动或安装当前应用；上文包哈希为历史值。

2026-11-07 许可原文覆盖审查见 [T28-license-text-audit.md](T28-license-text-audit.md)：当前安装源包的 295 条 npm 依赖中 290 条有根目录许可原文，258 条 Rust 依赖中 243 条有；项目自身授权方式与最终包 notices 仍未定，不能据元数据清单称发布许可审计完成。本次仅审查本地源包和文档，没有重建当前应用。

2026-11-07 已把可取得的第三方原文生成[索引](third-party-license-file-index.tsv)与[文本合集](third-party-license-texts.txt)；生成脚本 `scripts/generate-license-text-bundle.py --write` 和独立 `--verify` 均 PASS。仍有 5 条 npm、15 条 Rust 源包缺原文，项目自身 LICENSE 未定，因此尚未把审查资料封装到本地应用或宣称可公开分发。当前应用包未变，哈希以最近一次构建记录为准。

2026-11-07 用户要求启动当前代码阶段产物进行集中测试：`./start.sh` PASS，完成 arm64 构建、ZIP 重归档和 manifest 核验，并调用系统 `open`；随后 `pgrep -x mino-markdown` 返回 PID 27258。主程序 SHA-256 `d5fc01604c2831695a00d066eacf1f46e5bedd07f55c6a42cea61dc3ff2de98d`，ZIP `326b7ca4263e289fafd5da8d30c55994f1c08900b3f3419d27d133c739c9d938`，manifest `3c527b46c128641511982e44170b416509107d17e902bd4d714bddc7501e75a1`。主程序与上一构建内容相同，ZIP 因重新归档元数据变化；进程存在仅证明应用已运行，界面、安装、功能与性能结论仍待用户实际测试。

2026-11-07 用户界面与文件夹拖入修复后的**当前包**：`npm run build`、前端 59/59、Rust 50/50、`./start.sh --build-only` 和 manifest 核验 PASS，主程序为 arm64。主程序 SHA-256 `ba1055a95c6da8c8fcf972c4a427f134e5c41424b101334f4a2506faa9524b24`，ZIP `69df684ba8b15ae324430fd881f560d955a805eb770fe20a6837368dc704d015`，manifest `5824a149e685d8c7aaf22fec314f045e41ca6eef774f55b8b5ce395ddef70cd3`。旧应用进程仍在运行；未强制结束或启动此新包，真实 UI 和 Finder 拖入尚待用户复测。上方哈希为历史包。

2026-11-07 清理旧构建与深色欢迎页修复后的**当前包**：`start.sh` 在构建前只删除本项目旧 `.app`、release 主程序、ZIP 和 manifest，保留依赖编译缓存；`./start.sh --build-only`、arm64 检查和 manifest 核验 PASS。主程序 SHA-256 `df69a29cc7f66071f1868796b64c8cf756ef0c57f22d347e14675ba7e46cebf3`，ZIP `20108823dc8b76d6c47f3ddb144175697c2cb3929d13c9df8081a06b3eb31bc0`，manifest `ad3261c5662979b5a374d258b27d57629cb85feb1ea279771fbfecb2ce9bf8fa`。当前正在运行的旧界面进程未被脚本结束；新版需退出旧窗口后再启动。上方哈希为历史包。

2026-11-07 欢迎页去重后的**当前包**：第二次 `./start.sh --build-only` 清理旧应用后完成 arm64 打包和 manifest 校验。主程序 SHA-256 `f14fd2412c33e4e04889e8fb8906fea4d07b180e9f6357c485810fc02eef6025`，ZIP `3bbe764fc5804dd756664e37a9434aad23557c86860d889e08eb8912cab583e5`，manifest `05c284f673bf0724ccf2c334c000f842e5db5f32fefa47a19aba903e1c413db8`。上方哈希为历史包；原生运行仍待新窗口确认。

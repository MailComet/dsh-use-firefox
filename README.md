# dsh-use-firefox

![dsh-use-firefox icon](extension/icons/icon-128.png)

让 DeepSeek Harness Desktop 直接操作你正在使用的 Firefox。

插件由两部分组成：

- **DSH 宿主插件**（`src/`、`lib/`、`client.js`）
- **Firefox MV3 扩展**（`extension/`）

两者通过只监听 `127.0.0.1` 的 token WebSocket 桥连接。扩展接管已经运行的 Firefox，不需要 `--remote-debugging-port`、不需要 BiDi，也不需要重启浏览器。

## 安装

前置条件：DSH 桌面端 `0.2.2-rc.5`（官方当前最新版；本插件按该版本构建，日常在该版本使用。DSH 仍在 developer preview，升级到更高版本前先看 release notes）。Firefox `>= 142`（manifest 最低版本；`142.0` 上验证过源码扩展可安装/启动；日常在 `160.0.1` 使用）。

### 1. 宿主插件（DSH 侧）

在 DSH 的 **设置 → 插件 → 添加插件** 里，安装源保持默认即可，地址粘贴稳定链接（始终指向最新版）：

```text
https://sxyz.dev/dl/dsh/dsh-use-firefox.tgz
```

装好后重启 DSH。新增的输入框 chip 逻辑在客户端启动时加载。

要固定版本时，用版本化地址（回滚、复现都靠它）：

```text
https://sxyz.dev/dl/dsh/dsh-use-firefox-0.4.8.tgz
```

GitHub Release 里有同样的资产（`releases/latest/download/dsh-use-firefox.tgz` 或按 tag 取版本化文件）。校验和：

```text
https://sxyz.dev/dl/dsh/SHA256SUMS
```

旧的 `https://sxyz.dev/dl/dsh-use-firefox.tgz` 保留为兼容别名，指向同一个文件；新安装请用上面的新地址。

通过 tarball 安装的插件没有“更新”按钮，升级时**用同一条稳定链接再添加一次**即可（`pnpm add` 会重新下载并替换，实测同一 URL 内容更新后能升到新版本）；只跑 `pnpm install` 可能受 lockfile 完整性约束，不要用那种方式升级。

桥默认监听 `127.0.0.1:39271`。首次运行会生成 token：

```text
~/.dsh/browser/ext-token
```

### 2. Firefox 扩展（浏览器侧）

**普通用户**：直接打开下面这条链接，Firefox 会弹出安装提示（AMO 已签名，可永久安装）：

```text
https://sxyz.dev/dl/firefox/dsh-use-firefox/dsh_use_firefox.xpi
```

如果浏览器拦了直接安装，就右键另存为 `.xpi`，再到 `about:addons` → 齿轮 → **Install Add-on From File**。

**自己签名**（仓库不保存 AMO 凭据）：

```sh
npx web-ext sign --source-dir extension --channel unlisted --artifacts-dir dist
```

**临时试用**（不签名）：`about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → 选 `extension/manifest.json`，Firefox 重启后失效。Release 里的 `dsh_use_firefox-<版本>.zip` 就是这种未签名包，也可以直接从下面下载：

```text
https://sxyz.dev/dl/firefox/dsh-use-firefox/dsh_use_firefox.zip
```

从 **v0.4.8** 起，扩展的 manifest 带 `update_url`；Firefox 会按它定期检查更新，发现更高版本就下载并升级，不需要你手动重装。更新清单和稳定包地址：

```text
https://sxyz.dev/dl/firefox/dsh-use-firefox/updates.json
https://sxyz.dev/dl/firefox/dsh-use-firefox/dsh_use_firefox.xpi        # 稳定名，永远指向最新
https://sxyz.dev/dl/firefox/dsh-use-firefox/dsh_use_firefox-<版本>.xpi
https://sxyz.dev/dl/firefox/dsh-use-firefox/dsh_use_firefox-<版本>.zip
```

校验和：

```text
https://sxyz.dev/dl/firefox/dsh-use-firefox/SHA256SUMS
```

更早装上、没有 `update_url` 的版本，必须手动装一次 v0.4.8 之后才会进入自动更新。

> 兼容说明：已安装的 v0.4.8 仍会请求旧清单地址 `https://sxyz.dev/dl/dsh-use-firefox/updates.json`。该地址保留为兼容别名，指向同一份清单，不影响升级；从下一版起 manifest 直接使用上面的新地址。

### 3. 之后怎么升级

| 部分 | 升级方式 |
| --- | --- |
| DSH 宿主插件 | 用同一条稳定地址再添加一次；没有更新按钮 |
| Firefox 扩展 | 按 `update_url` 定期检查，无需手动重装 |

点击 Firefox 工具栏上的 DSH Use FF 图标打开介绍弹窗；只有首次连接时，展开「首次连接」填入：

- 端口：`39271`（除非你改了宿主配置）
- token：`~/.dsh/browser/ext-token` 的内容
- 客户端名：例如 `daily`

点击 **保存并连接**。

## 功能

- Agent 自己打开的标签页会放进 Firefox 原生标签组 **DSH**。组外的个人标签页不会被 Agent 操作；用户把标签页拖进 DSH 组，视为交给 Agent。
- `browser_*` 工具：status、tabs、navigate、带 ref 的文本快照、click、type、press、scroll、wait、screenshot、annotate。
- 快照包含可见文本、表单状态、弹窗、验证码提示、iframe 和滚动容器信息。
- 页面注释：元素、文字选择、区域框选；确认后进入 DSH 输入框，消息由用户自己发送。
- 四种用户控制的模式：完全访问、自动检查、全部询问、只读取。Agent 不能改模式。
- 本地审计：`~/.dsh/browser/audit.jsonl`；截图在 `~/.dsh/browser/screenshots/`，注释截图在 `~/.dsh/browser/annotations/`。

## 注释

在 Firefox 网页上按 **Ctrl + Alt + A**（macOS 为 **MacCtrl + Alt + A**）开始注释；用 **Esc** 退出。连接、模式、注释方式和状态在 DSH → 插件 → dsh-use-firefox 中设置。

页面进入选择状态后：

- 点击元素，或按住鼠标框选区域；文字模式先选中文字。
- 目标元素旁边出现白色的「添加评论…」卡片。
- 左下角是删除，右下角是绿色确认；确认左侧的滑块按钮打开元素详情，展示 15 项计算样式。
- 没有语音输入按钮。
- 确认后，页面会截取元素/区域的裁剪图，把「网页注释 N」reference chip 放进 DSH 输入框，并在输入框上方显示截图缩略图和评论预览。
- 消息不会自动发送；发送时宿主才把页面、selector、评论、元素详情、选中文字和截图路径附加到模型上下文。
- 每页最多 20 条注释。清空草稿后预览卡自动消失。

输入框上方的注释卡在发送前可以修改评论或删除；发送后，历史消息里的注释卡变成只读的截图/评论/详情卡，点击可以查看当时的内容，但不能修改。新增、修改、删除会在 Firefox 与 DSH 之间同步。未发送注释按当前 DSH 对话独立编号 1..N；切换对话后另一对话从 1 开始。删除后自动重排，发送后网页标记清除，下一批从 1 重新编号。宿主重启时未发送的旧批次会归档，不混入新对话。模型需要看截图的视觉细节时，可以对上下文里的截图路径调用 `read_image`。

## 模式

| 模式 | 行为 |
| --- | --- |
| `full`（默认） | 不询问，浏览器操作直接执行；仍保留审计、急停和工作区边界。 |
| `auto` | 普通操作直接执行；提交、发送、支付、删除、密码/OTP、验证码和上传会询问。 |
| `ask` | 所有改变页面的操作都询问。 |
| `readonly` | 只读、截图、注释、列出/切换标签页；不导航、不点击、不输入、不上传、不执行 JS。只读模式可以直接读取、截图和列出 DSH 分组外的 Firefox 标签页。 |

模式由用户在 DSH 的插件详情页或输入框旁设置并持久化。Agent 没有修改模式的工具。

组外个人标签页上的注释会带上 `tabId` 和 `inDshGroup: false`，并明确提示模型不要仅仅为了核对注释而重开页面；只读模式下模型可以直接读取该 `tabId`。

## 安全与边界

- 桥只绑定 `127.0.0.1`，扩展必须在第一条 `hello` 帧里提交 64 位十六进制 token。
- 扩展拥有 `<all_urls>` 权限，因为它需要读取和操作用户指定的任意页面，并允许在个人标签页上注释；Agent 工具本身只操作 DSH 组。
- **完全访问是默认模式，没有逐动作审批。** 页面内容可能包含提示注入；请保持 DSH 组可见，必要时使用急停，或在银行、邮箱、支付等敏感站点切到 `auto` / `readonly`。
- Firefox 内部页、扩展商店和受保护页面不能被脚本操作。
- 上传、下载、网络面板和任意页面 JS 执行不在当前范围。
- 浏览器截图工具返回本地路径；注释截图会作为图片附件直接发送给模型，并附带 `<browser_annotation>` 证据。

## 发布

版本号在 `package.json` 和 `extension/manifest.json` 两处，必须一致。之后打 tag 推送，`.github/workflows/release.yml` 会完成剩下的全部步骤：

```sh
# 1. 改两处版本号
# 2. 提交、打 tag、推送
git commit -am "chore: release v0.4.8"
git tag v0.4.8
git push origin main --tags
```

工作流依次做这些事：

1. 校验两处版本号、tag，以及 manifest 的 `update_url` 与 `UPDATE_BASE_URL` 一致（不一致直接失败，避免把错版本签出去）；
2. `web-ext lint --self-hosted` —— 只有自发行（unlisted）渠道才允许 manifest 带 `update_url`；
3. 打包 `dsh_use_firefox-<版本>.zip` 和 npm tarball，同时保留版本化文件名和稳定名；
4. 用 AMO 凭据签名（`--channel=unlisted`）；
5. 建/更新 GitHub Release，上传签名 `.xpi`、稳定名 `dsh_use_firefox.xpi`、tarball 和 zip；
6. 重新生成 `updates.json`，连同签名 xpi、未签名 zip 和校验和 rsync 到 Firefox 扩展发布目录；
7. 如果配置了 DSH 宿主插件发布目录，再上传 tarball 和校验和；
8. 用 curl 验证公开地址返回 200。

### 一次性配置

- **AMO 凭据**：在 <https://addons.mozilla.org/en-US/developers/addon/api/key/> 生成 JWT issuer / secret（开发者账号需已开启两步验证），然后加到仓库 **Settings → Secrets and variables → Actions**：`AMO_JWT_ISSUER`、`AMO_JWT_SECRET`。
- **部署通道**：仓库 **Settings → Secrets and variables → Actions** 加 `DEPLOY_HOST`（服务器地址）、`DEPLOY_USER`（部署用户）、`DEPLOY_SSH_KEY`（部署私钥）、`DEPLOY_PATH`（Firefox 扩展发布目录，必填，对应 `https://sxyz.dev/dl/firefox/dsh-use-firefox/`）。不配 `DEPLOY_HOST` 时工作流会在部署步骤给出警告并跳过，不会失败。
- **DSH 宿主插件目录**：可选加 `DEPLOY_DSH_PATH`（对应 `https://sxyz.dev/dl/dsh/`）。不配时跳过 tarball 上传，GitHub Release 里仍然有。
- **不走 CI 时**：`scripts/publish-remote.sh [xpi路径]` 用本机 ssh 别名上传 xpi、zip、updates.json 和 SHA256SUMS；需要先设 `DSH_UPDATE_HOST` / `DSH_UPDATE_PATH`（Firefox 扩展发布目录）。
- 同一个版本号在 AMO 只能提交一次；重复提交会报 `version already exists`，此时把版本号加一再发。

只想验证构建、不想签名和发布时，在 Actions 里手动触发 `Release` 并勾上 `dry_run`。

## 开发

```sh
npm test
npm run build
npx web-ext lint --source-dir extension
```

宿主插件是纯 ESM；扩展是纯 MV3 JavaScript，不需要构建。

## 仓库结构

```text
client.js             DSH Web 客户端半：reference chip、输入框预览、队列轮询
src/                  宿主插件源码
lib/                  src 构建产物，随仓库提交
extension/            Firefox MV3 扩展
test/                 宿主与客户端测试
scripts/build.mjs     src → lib
cordis.patch.yml      DSH bundle 注册
```

## License

MIT
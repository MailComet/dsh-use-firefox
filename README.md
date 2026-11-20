# dsh-use-firefox

让 DeepSeek Harness Desktop 直接操作你正在使用的 Firefox。

插件由两部分组成：

- **DSH 宿主插件**（`src/`、`lib/`、`client.js`）
- **Firefox MV3 扩展**（`extension/`）

两者通过只监听 `127.0.0.1` 的 token WebSocket 桥连接。扩展接管已经运行的 Firefox，不需要 `--remote-debugging-port`、不需要 BiDi，也不需要重启浏览器。

## 安装

要求 DSH 桌面端 `>= 0.2.2-rc.1 < 0.3.0-0`（本版本实测于 `0.2.2-rc.5`）。

### 1. 宿主插件

在 DSH 的 **设置 → 插件 → 添加插件** 里，安装源保持默认（`repo.nju.edu.cn`），地址粘贴：

```text
https://github.com/MailComet/dsh-use-firefox/releases/latest/download/dsh-use-firefox.tgz
```

装好后重启 DSH。新增的输入框 chip 逻辑在客户端启动时加载。

需要固定版本时，用本页 Release 里的版本化资产：

```text
https://github.com/MailComet/dsh-use-firefox/releases/download/v0.2.0/dsh-use-firefox-0.2.0.tgz
```

通过 tarball 安装的插件没有“更新”按钮，升级时用新版本的地址重新安装即可。

桥默认监听 `127.0.0.1:39271`。首次运行会生成 token：

```text
~/.dsh/browser/ext-token
```

### 2. Firefox 扩展

Release 资产里的 `dsh_use_firefox-0.2.0.zip` 是未签名包，正式版 Firefox 不能直接安装。

**临时加载**：打开 `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → 选择仓库里的 `extension/manifest.json`。Firefox 重启后需要重新加载。

**正式安装**：用 AMO 未列出（unlisted）签名。仓库不保存你的 AMO 凭据：

```sh
cd dsh-use-firefox
npx web-ext sign --source-dir extension --channel unlisted --artifacts-dir dist
```

拿到生成的 `.xpi` 后，在 `about:addons` → 齿轮 → **Install Add-on From File** 安装。

打开扩展侧边栏，填入：

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

在扩展侧边栏选择元素/文字/区域，点击 **注释当前页面**。

页面进入选择状态后：

- 点击元素，或按住鼠标框选区域；文字模式先选中文字。
- 目标元素旁边出现白色的「添加评论…」卡片。
- 左下角是删除，右下角是绿色确认；确认左侧的滑块按钮打开元素详情，展示 15 项计算样式。
- 没有语音输入按钮。
- 确认后，页面会截取元素/区域的裁剪图，把「网页注释 N」reference chip 放进 DSH 输入框，并在输入框上方显示截图缩略图和评论预览。
- 消息不会自动发送；发送时宿主才把页面、selector、评论、元素详情、选中文字和截图路径附加到模型上下文。
- 每页最多 20 条注释。清空草稿后预览卡自动消失。

输入框里使用 DSH 原生 reference chip 样式，会显示为蓝字 `@ 网页注释 1`。

模型需要看截图的视觉细节时，可以对上下文里的截图路径调用 `read_image`。

## 模式

| 模式 | 行为 |
| --- | --- |
| `full`（默认） | 不询问，浏览器操作直接执行；仍保留审计、急停和工作区边界。 |
| `auto` | 普通操作直接执行；提交、发送、支付、删除、密码/OTP、验证码和上传会询问。 |
| `ask` | 所有改变页面的操作都询问。 |
| `readonly` | 只读、截图、注释、列出/切换标签页；不导航、不点击、不输入、不上传、不执行 JS。 |

模式由用户在扩展侧边栏设置并持久化。Agent 没有修改模式的工具。

## 安全与边界

- 桥只绑定 `127.0.0.1`，扩展必须在第一条 `hello` 帧里提交 64 位十六进制 token。
- 扩展拥有 `<all_urls>` 权限，因为它需要读取和操作用户指定的任意页面，并允许在个人标签页上注释；Agent 工具本身只操作 DSH 组。
- **完全访问是默认模式，没有逐动作审批。** 页面内容可能包含提示注入；请保持 DSH 组可见，必要时使用急停，或在银行、邮箱、支付等敏感站点切到 `auto` / `readonly`。
- Firefox 内部页、扩展商店和受保护页面不能被脚本操作。
- 上传、下载、网络面板和任意页面 JS 执行不在当前范围。
- 截图保存在本地。模型收到的是路径而不是像素；需要视觉判断时调用 `read_image`。

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
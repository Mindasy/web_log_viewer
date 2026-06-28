# 安装与使用

## 环境要求

- **操作系统**: Windows / macOS / Linux
- **浏览器**: Chrome 90+、Firefox 90+、Edge 90+、Safari 15+（需要支持 ES2020 和 IndexedDB）
- **无需** 任何后端服务、数据库或 Web 服务器

## 快速开始

Web Log Viewer 是一个纯静态网页，启动后通过浏览器直接访问即可。

### 方法一：直接打开（最简单）

```bash
git clone https://github.com/yourusername/web_log_viewer.git
cd web_log_viewer
open index.html
```

直接双击 `index.html` 即可在浏览器中打开使用。注意：由于浏览器安全策略，拖放上传在 `file://` 协议下可能受限，建议使用方法二。

### 方法二：Python HTTP 服务器（推荐）

项目提供了轻量级 HTTP 服务器：

```bash
# 启动服务器（默认端口 8765）
python3 server.py

# 浏览器访问
open http://localhost:8765
```

也可以手动启动：

```bash
# Python 3
cd web_log_viewer
python3 -m http.server 8765
open http://localhost:8765
```

### 方法三：Docker（可选）

如果环境中有 Docker，可以快速启动 Nginx 服务：

```bash
cd web_log_viewer
docker run -d -p 8765:80 -v $(pwd):/usr/share/nginx/html:ro nginx:alpine
open http://localhost:8765
```

## 快速上手

### 第一步：加载日志文件

1. 点击工具栏「📂 打开」按钮
2. 选择一个本地日志文件（支持 `.log`、`.txt`、`.zip`、`.tar.gz`、`.tgz`、`.tar`、`.gz`）

快捷方式：

- 直接拖放文件到浏览器窗口
- 点击「🔗 合并」加载多个文件

### 第二步：配置解析规则（可选）

如果是常见日志格式，选择「跳过」让工具自动检测。

如果需要自定义解析规则：

- **预设格式** — 选择内置格式（Log4j、Bracket Log 等）
- **智能识别** — 自动分词，手动调整字段分配
- **手动正则** — 使用命名捕获组编写自己的正则表达式

### 第三步：浏览和分析

- 点击表格行查看详情
- 使用搜索框进行全文搜索
- 点击级别标签过滤日志级别
- 右键列头隐藏不需要的列

## 测试数据

项目提供了测试数据生成脚本：

```bash
# 生成 bracket log 格式的大批量样本（ZIP 文件）
python3 scripts/generate_samples.py

# 生成各种压缩格式的测试文件（zip/tar.gz/tgz/tar/gz）
python3 scripts/generate_archives.py
```

生成的文件位于 `example/` 目录，可直接用于测试。

## 常见问题

### Q: 日志文件太大怎么办？

- 建议将大文件打包成 ZIP 再加载（通常可缩小 90%+ 体积）
- 超过 200MB 的纯文本文件会弹出警告
- 解压后超过 1GB 的压缩包会自动拒绝

### Q: 自定义正则如何编写？

使用 JavaScript 正则语法 + 命名捕获组 `(?<name>...)`。例如提取 Bracket Log：

```regex
^\[(?<timestamp>\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[,.]\d{3}\s*[+-]\d{2,4})\]\[(?<level>\w+)\]\[(?<pid>\d+)\]\[(?<tid>\d+)\]\[(?<tag>[^\]]+)\]\[(?<source>[^\]]+)\]\s*(?<message>.*)$
```

### Q: 我保存的 Pattern 丢失了？

Pattern 保存在浏览器 IndexedDB 中。清除浏览器数据（Cookies 除外）会影响已保存的 Pattern。建议定期导出 Pattern：

1. 打开 Pattern 管理器
2. 点击「导出」按钮
3. 保存为 JSON 文件

### Q: 工具是否会上传我的日志文件？

不会。所有操作完全在浏览器本地执行，数据不会离开你的设备。工具没有任何网络请求。

### Q: 为什么有些列是空的？

这是因为某些解析预设不会提取所有字段（例如 Apache 格式没有 pid 字段）。工具会自动隐藏全空的列，你也可以通过右键菜单手动隐藏。

# 开发指南

## 项目概述

Web Log Viewer 是一个纯前端的日志查看与分析工具。所有代码由原生 JavaScript 编写，无任何框架依赖（React / Vue / Angular 等）。

### 技术栈

| 技术 | 用途 |
|------|------|
| 原生 JavaScript (ES2020+) | 主逻辑语言 |
| CSS Custom Properties | 主题系统 |
| IndexedDB | Pattern 持久化存储 |
| Canvas API | 时间线可视化 |
| Web Workers (fflate) | 压缩包解压 |
| TextDecoder API | 多编码支持 |

### 项目结构

```
web_log_viewer/
├── index.html              # 主页面（所有 UI 定义）
├── css/
│   └── style.css           # 样式表（暗色/亮色双主题）
├── js/
│   ├── app.js              # 主应用控制器（事件绑定、面板管理、书签、Pattern、拖放）
│   ├── archive.js          # 压缩文件解析器（ZIP / tar / gz）
│   ├── db.js               # IndexedDB 数据库操作
│   ├── filter.js           # 过滤与搜索引擎
│   ├── grid.js             # 虚拟滚动日志表格
│   ├── parser.js           # 日志解析引擎（预设 + 智能规则生成器）
│   ├── stats.js            # 统计信息模块
│   ├── timeline.js         # 时间线可视化
│   └── utils.js            # 工具函数
├── lib/
│   ├── fflate/             # ZIP/gzip 解压库
│   └── jszip/              # JSZip 回退解压库
├── scripts/
│   ├── generate_samples.py  # 批量生成测试 ZIP 文件
│   ├── generate_archives.py # 生成多种格式压缩测试文件
│   └── package.sh          # 打包脚本
├── server.py               # 本地 HTTP 服务器
└── example/                # 测试数据目录（gitignore）
```

## 模块架构

### 数据流

```
用户选择文件
     │
     ▼
app.js (ParseWizard.show → 解析向导)
     │
     ▼
parser.js (parseFile / mergeFiles)
     │
     ├── archive.js (如果是压缩包 → 解压)
     │      └── _parseTar() / _extractZip() / _extractSingleGz() / _extractTarGz()
     │
     ├── readFile() (如果是普通文件 → 读取)
     │
     ▼
parser.js (解析每一行 → 生成 entry 对象)
     │
     ├── getParser() (选择预设 / 自定义 / JSON 解析器)
     ├── autoDetect() (自动检测格式)
     └── SmartRuleGenerator (智能规则生成)
     │
     ▼
app.js (onDataLoaded)
     │
     ├── grid.js (setData → 虚拟滚动渲染)
     ├── filter.js (apply → 过滤条件计算)
     ├── stats.js (calculate → 统计数据)
     └── timeline.js (show → 时间线可视化)
```

### Entry 对象结构

```javascript
{
  index: 0,              // 条目序号（从 0 开始）
  lineNumber: 0,         // 原始文件行号
  timestamp: '2026-01-15 08:00:00,000 +0800',  // 原始时间戳
  date: Date,            // 解析后的 Date 对象
  level: 'INFO',         // 日志级别
  pid: '1234',          // 进程 ID
  tid: '567',           // 线程 ID
  tag: 'WEB-API',       // 标签
  source: 'com.example.web.UserController',  // 来源
  message: '用户登录成功',  // 消息内容
  raw: '原始日志行',       // 原始文本
  bookmarked: false,     // 是否已添加书签
  sourceFile: 'app.log',  // 来源文件名
  customFields: {        // 自定义字段（JSON / 自定义正则）
    requestId: 'req-123'
  },
  _searchText: '缓存的搜索文本'  // 过滤缓存
}
```

## 核心模块详解

### app.js — 主应用控制器

- **生命周期**: `App.init()` → 初始化所有子模块 → 绑定事件 → 处理用户操作
- **关键子对象**: `ParseWizard`（解析向导）、`SmartRuleGenerator`（规则生成器）
- **状态管理**: 通过 `LogParser.*` / `LogFilter.state` / `LogGrid.*` 等全局对象的属性管理状态

### parser.js — 日志解析引擎

- **预设系统**: `LogParser.presets` 定义 6 种内置格式
- **解析器生成**: `getParser(preset, config)` 返回一个 `(line, lineNumber) → entry | null` 函数
- **自动检测**: `autoDetect(lines)` 通过采样前 20 行，使用投票机制选择最佳匹配
- **重解析**: `reparse(config)` 不重新读取文件，仅用新规则重新解析已有行

### filter.js — 过滤与搜索引擎

- **状态驱动**: `LogFilter.state` 包含所有过滤条件
- **单次遍历**: `apply(entries)` 在一个 for 循环中完成所有过滤条件的检查
- **搜索缓存**: `_regexCache` 缓存 RegExp 对象，`entry._searchText` 缓存拼接文本
- **安全**: 搜索输入截断 200 字符防 ReDoS

### grid.js — 虚拟滚动表格

- **渲染策略**: 仅渲染可视区域 + 5 行缓冲区
- **安全高度**: CSS 高度超过 `33,000,000px` 时使用比例锚点映射
- **列系统**: 静态列（8 个内置）+ 动态列（JSON/自定义正则展开）

### archive.js — 压缩文件解析器

- **统一接口**: `ArchiveHandler.extract(file)` 返回 `[{name, data, displayName, archiveName}]`
- **格式分发**: 按扩展名路由到不同处理器
- **安全限制**: 解压总量超过 1GB 时终止

## 开发和调试

### 本地开发

```bash
# 克隆项目
git clone https://github.com/yourusername/web_log_viewer.git
cd web_log_viewer

# 启动开发服务器
python3 server.py

# 浏览器打开
open http://localhost:8765
```

项目完全由原生 JavaScript 编写，修改后刷新浏览器即可看到效果，无需构建步骤。

### 生成测试数据

```bash
# 生成大型测试 ZIP（每个 10 万行，约 2MB）
python3 scripts/generate_samples.py

# 生成多种压缩格式测试文件
python3 scripts/generate_archives.py
```

### 调试技巧

1. **查看解析结果**: 在控制台输入 `console.log(LogParser.entries)` 查看所有解析后的条目
2. **查看过滤状态**: `console.log(LogFilter.state)`
3. **查看搜索匹配**: `console.log(LogFilter.searchMatches)`
4. **手动测试正则**: `LogParser.getParser('bracketLog', {})(sampleLine, 0)`

### CSS 主题调试

主题通过 CSS Custom Properties 定义：

```css
/* 暗色主题 */
:root {
  --bg-primary: #1a1b26;
  --text-primary: #c9cddb;
  --accent: #7aa2f7;
  /* ... */
}

/* 亮色主题 */
[data-theme="light"] {
  --bg-primary: #fafafa;
  --text-primary: #1a1a1a;
  --accent: #2563eb;
  /* ... */
}
```

在控制台切换主题：`document.documentElement.dataset.theme = 'light'`

## 常规规范

### 命名约定

- 全局对象：`PascalCase`（`LogParser`、`LogGrid`、`ArchiveHandler`）
- 属性和方法：`camelCase`（`parseFile`、`renderHeader`）
- DOM 元素 ID：`kebab-case`（`search-input`、`btn-open`）
- 常量：`UPPER_SNAKE_CASE`（`SEARCH_MAX_LENGTH`、`ARCHIVE_MAX_UNCOMPRESSED`）

### 代码风格

- 使用 2 空格缩进
- 使用 ES2020+ 语法（`?.`、`??`、`Object.create(null)`）
- 避免使用外部依赖，所有功能原生实现
- 模板字符串使用反引号 `\`\``

### 安全规范

- 用户输入的搜索文本截断 200 字符
- 正则表达式需通过 `Utils.validateUserRegex()` 验证
- 压缩包解压上限 1GB

## 版本管理

版本号的唯一来源是 **Git tag**（格式 `v1.0.0`）。每次发布通过 tag 触发，自动注入到应用代码中。

### 版本号流转

```
Git tag v1.2.3
    │
    ▼
scripts/set-version.sh    ← 提取版本号，写入 js/utils.js
    │                         const APP_VERSION = '1.2.3'
    ▼
js/utils.js               ← About 面板动态读取显示
    │
    ▼
scripts/package.sh        ← 打包前自动调用 set-version.sh
    │
    ▼
output/v1.2.3/weblogviewer.tar.gz
```

### 本地打包

```bash
# 方式一：从当前 git tag 读取版本
bash scripts/package.sh

# 方式二：手动指定版本
bash scripts/package.sh v1.2.3
```

打包脚本会自动：
1. 调用 `set-version.sh` 更新 `js/utils.js` 中的 `APP_VERSION`
2. 生成 `output/v1.2.3/weblogviewer.tar.gz`

### GitHub Release 自动发布

推送 tag 到 GitHub 时，`.github/workflows/release.yml` 自动执行：

```bash
git tag v1.2.3
git push origin v1.2.3
```

GitHub Actions 会自动：
1. 检出代码
2. 运行 `scripts/package.sh` 注入版本号并打包
3. 在 Releases 页面创建 Release 并上传 `.tar.gz` 附件
4. 自动生成 Release Notes

### 单独更新版本号

```bash
# 从最近的 git tag 读取
bash scripts/set-version.sh

# 或手动指定
bash scripts/set-version.sh 1.2.3
```

## 构建与部署

项目为纯静态文件，无需构建。部署只需将整个项目目录复制到 Web 服务器即可。

```bash
# 使用打包脚本
bash scripts/package.sh
```

## 许可证

本项目基于 [MIT License](../LICENSE) 开源。

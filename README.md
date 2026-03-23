# CloudMark Studio

![Tauri](https://img.shields.io/badge/Tauri-2-24C8D8?logo=tauri&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-1.77+-DEA584?logo=rust&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)
![License](https://img.shields.io/badge/License-AGPL--3.0-blue)

基于 Tauri 2 的桌面端图片处理工具，集成阿里云 OSS 上传与 IMM 盲水印服务。

## 功能概览

### 盲水印

- **添加水印** — 上传图片到 OSS，调用阿里云 IMM 服务写入不可见盲水印
- **解码水印** — 上传含水印图片，异步轮询解码结果，支持低/中/高三档强度
- 支持自定义水印文本、强度、JPEG 质量等默认参数
- 解码完成后可自动删除 OSS 临时文件（可在设置中开关）
- 水印输出文件名支持可配置的重命名模板

### 图片压缩

- 支持 JPEG、PNG、WebP 格式互转
- 可调质量、PNG 压缩等级、尺寸缩放
- 压缩结果可复制到剪切板或发送到水印页面继续处理
- 可选自动保存到本地目录

### OSS 文件浏览器

- 浏览 OSS Bucket 中的文件列表
- 直接下载、发送到水印 / 解码页面处理
- 使用预签名 URL 展示图片缩略图

### 通用能力

- **拖放 / 粘贴上传** — DropZone 支持文件拖入和剪切板粘贴图片
- **URL 输入** — 支持通过 URL 导入图片（自动下载到临时目录后上传）
- **图片预览缩略图** — 所有列表项展示图片缩略图，加载失败时回退到图标
- **解码进度条** — 水印解码轮询过程中显示实时进度
- **双击重命名** — 在 ImageCard 上双击文件名即可重命名 OSS 对象
- **复制到剪切板** — 水印图片可直接复制为 PNG 到系统剪切板
- **操作历史** — 水印 / 解码操作自动记录到历史页面（localStorage 持久化）
- **深色模式** — 设置中可切换浅色 / 深色 / 跟随系统三种主题模式

## 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | [Tauri 2](https://tauri.app/) |
| 前端 | React 19 + TypeScript + Vite |
| 样式 | Tailwind CSS 4 + Headless UI |
| 图标 | Lucide React |
| 后端 | Rust (tokio + reqwest + image) |
| 云服务 | 阿里云 OSS + IMM（智能媒体管理） |

## 项目结构

```
cloudmark-studio/
├── src/                          # 前端源码
│   ├── components/
│   │   ├── WatermarkPage.tsx     # 添加水印页
│   │   ├── DecodePage.tsx        # 解码水印页
│   │   ├── ToolsPage.tsx         # 图片压缩工具
│   │   ├── OssBrowserPage.tsx    # OSS 文件浏览器
│   │   ├── HistoryPage.tsx       # 操作历史
│   │   ├── SettingsPanel.tsx     # 设置面板
│   │   ├── ImageCard.tsx         # 图片卡片组件
│   │   └── DropZone.tsx          # 拖放/粘贴区域
│   ├── hooks/
│   │   ├── useConfig.ts          # 配置管理 hook
│   │   └── useDarkMode.ts        # 深色模式 hook
│   ├── lib/
│   │   └── tauri.ts              # Tauri 命令绑定与类型定义
│   └── App.tsx                   # 主布局与路由
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── commands.rs           # Tauri IPC 命令
│   │   ├── config.rs             # 配置持久化
│   │   ├── oss/                  # OSS 客户端（上传/下载/删除/签名/重命名）
│   │   ├── imm/                  # IMM 客户端（盲水印任务管理）
│   │   ├── watermark/            # 水印编码逻辑
│   │   └── imaging/              # 图片压缩（JPEG/PNG/WebP）
│   └── Cargo.toml
└── package.json
```

## 开发

### 环境要求

- Node.js >= 18
- Rust >= 1.77
- Tauri CLI 2.x（`npm install`后自动可用）

### 启动开发

```bash
npm install
npm run tauri dev
```

### 构建

```bash
npm run tauri build
```

### 类型检查

```bash
# 前端
npx tsc --project tsconfig.app.json --noEmit

# 后端
cd src-tauri && cargo check
```

## 配置

首次启动后在 **设置** 页面填写阿里云 OSS 连接信息：

| 字段 | 说明 |
|------|------|
| Access Key ID | 阿里云 RAM 用户 AK |
| Access Key Secret | 对应 SK |
| Endpoint | OSS Endpoint，如 `oss-cn-hangzhou.aliyuncs.com` |
| Bucket | Bucket 名称 |
| Region | 地域，如 `cn-hangzhou` |
| 路径前缀 | 可选，上传文件的 OSS 目录前缀 |
| 自定义域名 | 可选，绑定到 Bucket 的自定义域名 |

### RAM 用户权限要求

使用的 RAM 用户（AccessKey）需要授予以下权限：

**OSS 权限**（建议通过自定义策略授权到指定 Bucket）：

| 权限 | Action | 用途 |
|------|--------|------|
| 上传对象 | `oss:PutObject` | 上传图片到 OSS |
| 下载对象 | `oss:GetObject` | 下载文件、生成预签名 URL |
| 删除对象 | `oss:DeleteObject` | 删除 OSS 文件 |
| 列举对象 | `oss:ListObjects` | OSS 文件浏览器列表 |
| 复制对象 | `oss:GetObject` + `oss:PutObject` | 重命名（复制 + 删除） |

**IMM 权限**（智能媒体管理，用于盲水印）：

| 权限 | Action | 用途 |
|------|--------|------|
| 创建水印任务 | `imm:CreateImageSplicingTask` | 添加 / 解码盲水印 |
| 查询任务结果 | `imm:GetTask` | 轮询水印任务状态 |
| IMM 全部权限 | `imm:*` | 如不想细分，可授予 IMM 全部权限 |

> **最小权限策略示例：**
>
> ```json
> {
>   "Version": "1",
>   "Statement": [
>     {
>       "Effect": "Allow",
>       "Action": [
>         "oss:PutObject",
>         "oss:GetObject",
>         "oss:DeleteObject",
>         "oss:ListObjects"
>       ],
>       "Resource": "acs:oss:*:*:your-bucket-name/*"
>     },
>     {
>       "Effect": "Allow",
>       "Action": "imm:*",
>       "Resource": "*"
>     }
>   ]
> }
> ```

其他可配置项：

- **默认水印设置** — 水印文本、强度、JPEG 质量
- **压缩设置** — 是否自动保存压缩结果到本地
- **解析设置** — 解码后是否自动删除 OSS 临时文件
- **外观** — 主题模式（浅色 / 深色 / 跟随系统）
- **重命名模板** — 水印输出文件的命名规则

## License

[AGPL-3.0](LICENSE)

# Quay

一个可以放在 Docker 里的网页编程代理。用法接近 Codex：左边会话，中间对话，右边文件。工作区不在容器磁盘上，文件读写都走 Cloudflare R2；模型走你自己的 sub2api。

推荐部署方式：把这个目录当作 GitHub 仓库根目录推上去，GitHub Actions 构建镜像并推到 GHCR，Zeabur 只拉取镜像运行。

```text
r2-agent 源码
  |  push 到 GitHub（仓库根目录就是本目录）
  v
GitHub Actions  .github/workflows/ghcr.yml
  |  docker build
  v
ghcr.io/<用户名>/<仓库名>:latest
  |  Zeabur 拉取
  v
容器
  |-- 工具循环 --> sub2api /v1/chat/completions
  \-- 文件读写 --> Cloudflare R2
```

没有命令执行。代理只能列出、读取、写入、修改、移动、删除和搜索 R2 里的项目文件。

## 上传到 GitHub 并构建 GHCR

把下面这些文件作为仓库根目录。不要把外层的 `codex-program` 和其他项目一起传，也不要上传 `node_modules` 和 `.env`。

```text
.github/workflows/ghcr.yml
Dockerfile
package.json
package-lock.json
src/
public/
test/
```

网页上传或 git 推送都可以。默认分支用 `main` 或 `master`，推上去就会跑工作流。

1. GitHub 仓库 → Settings → Actions → General → Workflow permissions，选 Read and write permissions。
2. 推到 `main` 或 `master`。Actions 里的 `Build GHCR image` 会先跑测试，再构建 `linux/amd64` 镜像。
3. 构建完成后，镜像在仓库右侧 Packages，或 `https://github.com/<用户名>?tab=packages`。
4. 镜像地址是 `ghcr.io/<用户名>/<仓库名>:latest`。用户名和仓库名里的大写会被自动改成小写。
5. 打 `v1.2.3` 这样的 tag 时，还会额外推版本号标签。

私有仓库打出来的包默认也是私有的。Zeabur 拉取私有包时，要在镜像设置里填 GitHub 用户名，以及一个有 `read:packages` 权限的 Personal Access Token。公开仓库的包一般可以直接拉。

## 部署到 Zeabur

手动点击部署见 [docs/zeabur.md](docs/zeabur.md)。


不要选 Dockerfile 构建，改成用镜像部署：

1. 镜像填 `ghcr.io/<用户名>/<仓库名>:latest`。
2. 端口填 `8080`。平台如果会注入 `PORT`，程序也会听那个端口。
3. 填上下面的 R2 和 sub2api 环境变量，并设置一个足够长的 `APP_PASSWORD`。
4. HTTPS 上把 `COOKIE_SECURE=true`。
5. 可选挂载磁盘到 `/data`，这样网页里保存的设置和登录密钥在重启后还在。配置全部放在环境变量里时，不挂盘也能跑。

健康检查是 `GET /healthz`。

## 本地运行

```bash
copy .env.example .env
npm install
npm start
```

打开 `http://localhost:8080`。

本地自己构建容器：

```bash
copy .env.example .env
docker compose up --build
```

已经推到 GHCR 之后，也可以不在本地构建，把 `docker-compose.yml` 里的 `build: .` 换成：

```yaml
image: ghcr.io/<用户名>/<仓库名>:latest
```

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `PORT` | 监听端口，默认 `8080` |
| `APP_PASSWORD` | 网页访问密码。留空则不登录，不要这样暴露到公网 |
| `SESSION_SECRET` | 登录 cookie 签名。不填会写到数据目录 |
| `COOKIE_SECURE` | HTTPS 部署时设为 `true` |
| `DATA_DIR` | 设置覆盖和会话密钥目录。容器里是 `/data` |
| `R2_ACCOUNT_ID` | Cloudflare 账号 ID |
| `R2_ACCESS_KEY_ID` | R2 API Token 的 Access Key |
| `R2_SECRET_ACCESS_KEY` | R2 API Token 的 Secret |
| `R2_BUCKET` | 存储桶名称 |
| `R2_ENDPOINT` | 可留空。默认 `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |
| `R2_FORCE_PATH_STYLE` | 连不上时再设为 `true` |
| `SUB2API_BASE_URL` | 例如 `https://your-sub2api.example.com/v1` |
| `SUB2API_API_KEY` | sub2api 后台创建的密钥 |
| `SUB2API_MODEL` | 默认模型名，必须是该密钥允许、且支持工具调用的模型 |
| `AGENT_MAX_ROUNDS` | 单次发言最多几轮工具调用，默认 16 |

页面里的「设置」会把覆盖值写到 `DATA_DIR/settings.json`，优先级高于环境变量。密钥框里出现星号时，留着不动就不会改掉原值。

## Cloudflare R2

1. 创建一个存储桶。
2. 在 R2 的 API Token 里创建「Object Read & Write」，范围限定到这个桶。
3. 把 Account ID、Access Key、Secret、桶名填进环境变量或设置页。
4. 点「测试 R2」。它只会做一次列出对象的请求。

项目在桶里的布局：

```text
projects/<项目 id>/.agent/meta.json
projects/<项目 id>/.agent/chats/<会话 id>.json
projects/<项目 id>/files/<你的文件>
```

`.agent` 是会话和项目信息，文件树里不会显示，模型也不能改它。

## sub2api

Quay 使用 OpenAI 兼容的 Chat Completions，并带上 function tools：

```text
POST {SUB2API_BASE_URL}/chat/completions
Authorization: Bearer {SUB2API_API_KEY}
```

`SUB2API_BASE_URL` 写成 `https://域名/v1` 或 `https://域名` 都可以。模型需要能接受 `tools`。如果网关把某个渠道只暴露成 Anthropic `/v1/messages`，而没有转成带工具的 Chat Completions，这个模型就不能当编程代理用。

「测试模型」请求的是 `{base}/models`。有些网关没有模型列表接口，测试会失败，但对话本身仍可能可用。这时直接在顶部填模型名再发一条消息。

## 代理会做什么

- `list_files` 看一层目录
- `read_file` 读文本，可按行分段
- `search_files` 做不区分大小写的字面量搜索
- `edit_file` 替换唯一一段原文
- `write_file` 新建或整文件覆盖
- `mkdir` / `move_file` / `delete_file`

工具卡片会显示在对话里。写过文件后，右侧文件树会刷新。

## 开发

```bash
npm test
npm run dev
```

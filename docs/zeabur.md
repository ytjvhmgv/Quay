# 在 Zeabur 上手动部署 Quay

这份说明只讲在 Zeabur 网页上点击部署。Zeabur 不构建源码，它只拉取已经推到 GHCR 的镜像。

镜像要先在 GitHub Actions 里构建成功。工作流是仓库根目录的 `.github/workflows/ghcr.yml`，推到 `main` 或 `master` 后会在 Actions 里出现 **Build GHCR image**。那次运行是绿色之后，再做下面的步骤。

镜像地址形如：

```text
ghcr.io/<github用户名>/<仓库名>:latest
```

用户名和仓库名都用小写。例如仓库是 `github.com/Alice/Quay`，镜像就是 `ghcr.io/alice/quay:latest`。

官方对应页面是 [Custom Docker Image](https://zeabur.com/docs/en-US/deploy/methods/custom-docker-image)。控制台语言可以切成中文，下面按中文界面写，第一次出现时附上英文名称。

## 开始前准备好这些值

到 Cloudflare R2 准备一个存储桶，以及只对该桶有 Object Read & Write 权限的 API Token。再到 sub2api 准备一个能调用目标模型的密钥。模型必须支持 OpenAI 兼容的 Chat Completions，并且接受工具调用。

建议先把这些值记在本地，不要提交到 GitHub：

| 名字 | 例子 | 从哪里来 |
| --- | --- | --- |
| R2 Account ID | `ab12cd34...` | Cloudflare 首页右侧 |
| R2 Access Key ID | token 的 Access Key | R2 API Token |
| R2 Secret Access Key | token 的 Secret | 创建 token 时只显示一次 |
| R2 Bucket | `quay` | 你创建的桶名 |
| sub2api 地址 | `https://gateway.example.com/v1` | 你的反代地址 |
| sub2api 密钥 | `sk-...` | sub2api 后台 |
| 默认模型 | 网关里真实存在的模型名 | sub2api 允许该密钥使用的模型 |
| 访问密码 | 一串足够长的随机密码 | 自己生成，用来登录 Quay |

## 1. 确认镜像存在

打开 GitHub 仓库，右侧 **Packages**，或者打开：

```text
https://github.com/<用户名>?tab=packages
```

能看到这个包，并且最近一次 **Build GHCR image** 是成功的。

仓库如果是私有的，包默认也是私有的。两种选一种：

- 继续用私有包。按下一节创建一个只读 token，部署时填给 Zeabur。
- 把包改成公开。打开该 Package → **Package settings** → **Change visibility** → Public。这样 Zeabur 不用填密码。只公开镜像，不要把 R2 密钥或 sub2api 密钥放进仓库。

## 2. 私有镜像才需要的 GitHub Token

1. 打开 GitHub → **Settings** → **Developer settings** → **Personal access tokens**。
2. 用 classic token 时，勾选 `read:packages`，然后生成。
3. 用 fine-grained token 时，资源选中这个仓库，权限里给 Packages 读取。
4. 复制 token。它只显示一次。

这个 token 只给 Zeabur 拉镜像，不是 Quay 的 `APP_PASSWORD`，也不要填进 Quay 的环境变量。

## 3. 创建 Zeabur 项目

1. 打开 [Zeabur](https://zeabur.com) 并登录。
2. 进入控制台，点 **创建项目**（Create Project）。
3. 区域选离你和 sub2api 都比较近的，例如香港或东京。
4. 项目名可以写成 `quay`。

## 4. 用镜像创建服务

1. 进入项目，点 **添加服务**（Add Service / Create Service）。
2. 部署方式选 **自定义 Docker 镜像**（Custom Docker Image）。不要选 Dockerfile，也不要选 GitHub 仓库构建。
3. 镜像填完整地址，例如 `ghcr.io/alice/quay:latest`。
4. 镜像如果是私有的，展开认证：
   - 用户名填 GitHub 用户名，不是邮箱。
   - 密码填上一步的 token。
   - 如果界面还有 Registry / 仓库地址，填 `ghcr.io`。
5. 确认创建，等服务状态变成运行中。

拉镜像失败时，先看服务日志。常见原因是镜像名大小写不对、`:latest` 还没构建出来，或者私有包的 token 没有 `read:packages`。

## 5. 填写环境变量

打开服务的 **环境变量**（Environment Variables）。可以逐条添加，也可以用批量编辑，把下面这一段贴进去后改成你的值：

```text
APP_PASSWORD=换成一套很长的登录密码
SESSION_SECRET=再换成另一串随机字符
COOKIE_SECURE=true
DATA_DIR=/data

R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_FORCE_PATH_STYLE=false

SUB2API_BASE_URL=https://你的域名/v1
SUB2API_API_KEY=
SUB2API_MODEL=
AGENT_MAX_ROUNDS=16
```

不要自己再填 `PORT`，除非你在网络设置里把端口改成了别的数。Zeabur 会按服务端口注入 `PORT`，程序监听这个值；镜像里的默认端口是 `8080`。

`R2_ENDPOINT` 通常留空。程序会用 `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`。只有账号用了特殊的管辖区域名时才填写。

保存后如果服务没有自动重启，手动点一次 **重新部署**（Redeploy）。

这些变量是运行配置，优先级低于你以后在 Quay 网页「设置」里保存的内容。第一次部署建议只在 Zeabur 填，先不要在网页里再存一遍，避免两处不一致。

## 6. 挂载数据盘

打开服务的 **卷**（Volumes），新增一个卷：

- 挂载目录填 `/data`
- 容量用最小档即可，里面只放网页里另存的设置和登录签名

这一步不是必须的。R2 和 sub2api 都写在环境变量里时，不挂盘也能用。挂上之后，你在网页设置里保存的覆盖值，以及没填写 `SESSION_SECRET` 时自动生成的登录密钥，重启后还在。

不要把挂载目录写成别的路径。程序只认 `DATA_DIR`，这里必须和它一致。

## 7. 打开端口和域名

打开服务的 **网络**（Networking / Public Networking）：

1. 服务端口填 `8080`。
2. 点 **生成域名**（Generate Domain）。Zeabur 会给一个 `*.zeabur.app` 域名，并且自带 HTTPS。
3. 如果界面里有健康检查，路径填 `/healthz`，端口同样是 `8080`。

自定义域名可以之后再绑。绑好之后仍然保持 `COOKIE_SECURE=true`。

## 8. 打开网页检查

用浏览器打开刚生成的域名。

1. 应该出现 Quay 的登录页。用 `APP_PASSWORD` 进入。
2. 右上角 **R2** 和 **模型** 两个状态都亮，说明环境变量已经被读到。
3. 点 **设置**，可以再分别点「测试 R2」和「测试模型」。测试只做连通检查，不会改你的文件。
4. 新建一个项目，发一句「列出当前文件」。代理会通过 sub2api 调用工具，并到 R2 里读取这个项目。

如果页面提示还没配好，回 Zeabur 核对变量名是不是完全一致，有没有多余空格，然后重新部署。

## 9. 以后更新

源码推到 GitHub 的默认分支后，Actions 会重新推送 `:latest`。Zeabur 不会自动知道镜像变了。

1. 等 **Build GHCR image** 成功。
2. 回到 Zeabur 这个服务，点 **重新部署**，让它重新拉取 `latest`。
3. 环境变量和 `/data` 卷会保留，不用重填。

如果想锁定某一次构建，可以把镜像标签从 `:latest` 改成 Actions 日志里的短提交号，或者改成你推送的 `v1.2.3`。改标签的入口是 **更新镜像引用**（Update Image Reference）。

## 排查

| 现象 | 怎么处理 |
| --- | --- |
| 创建服务时拉不到镜像 | 核对小写全名和 `:latest`。私有包补上 GitHub 用户名和 `read:packages` token。 |
| 域名一直 502 | 网络端口不是 `8080`，或者服务还在重启。看日志里有没有 `Quay listening`。 |
| 打开是 Zeabur 的错误页，日志里端口不一致 | 不要同时把 `PORT` 设成另一个数。网络端口和环境变量 `PORT` 保持同一个值。 |
| 能打开但登录后立刻又回到登录页 | `COOKIE_SECURE` 在 HTTPS 上应为 `true`。改过 `SESSION_SECRET` 后旧登录会失效，重新登录即可。 |
| R2 测试失败 | 检查 Account ID、Key、Secret、桶名。权限要包含该桶的读写。仍失败时把 `R2_FORCE_PATH_STYLE` 改成 `true` 再部署一次。 |
| 模型测试失败，但你确认密钥正确 | 有的 sub2api 没有 `/models`。直接在页面顶部填模型名发消息。对话报不接受 `tools` 时，换一个支持工具调用的渠道。 |
| 重启后网页里保存的设置没了 | 没有挂 `/data`，或者挂错了目录。环境变量里的配置则不受影响。 |
| 更新代码后网页还是旧的 | Actions 还没成功，或者 Zeabur 没重新拉取。对 `:latest` 再点一次重新部署。 |

部署完成后，文件都在 Cloudflare R2，不在 Zeabur 的磁盘里。删掉 Zeabur 服务不会删除 R2 里的项目文件；删除 R2 桶则会。

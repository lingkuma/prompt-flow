# Docker share deployment

这个部署方式是单容器：

- Vite 前端 build 后由 Node 服务提供静态文件。
- 分享短链 API 也在同一个 Node 服务里。
- 分享数据存在 SQLite 文件中，默认路径是 `/data/shares.sqlite`。

## 本地启动

```powershell
docker compose up -d --build
```

打开：

```text
http://localhost:3000
```

## 创建短链权限

如果只是内网或自己临时用，可以不设置密钥。

公网部署建议设置：

```powershell
$env:SHARE_CREATE_TOKEN="your-secret"
docker compose up -d --build
```

设置后，点击“分享”时第一次会要求输入密钥。朋友打开 `/s/xxxxxx` 链接不需要密钥。

## 反向代理域名

如果容器后面有 Nginx、Caddy、Cloudflare Tunnel 等反代，建议设置公开地址：

```powershell
$env:SHARE_PUBLIC_BASE_URL="https://your-app.com"
docker compose up -d --build
```

否则服务会按请求头自动生成分享地址。

## API

```text
POST /api/shares
GET  /api/shares/:id
GET  /api/health
```

`POST /api/shares` 保存当前 workflow document，返回：

```json
{
  "id": "abc123xx",
  "title": "Workflow title",
  "url": "https://your-app.com/s/abc123xx"
}
```

打开 `/s/abc123xx` 时，前端会读取分享内容，并导入成当前浏览器里的本地副本。

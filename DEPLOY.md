# 🚀 部署上线（Render 免费版）

飞行棋是 **WebSocket 实时联机**应用，必须运行在能跑 Node + WebSocket 的主机上——纯静态托管（GitHub Pages / Vercel 静态 / Netlify 静态）只会加载页面、**联机功能全部失效**，请勿使用。

Render 免费版原生支持 WebSocket、零信用卡，最适合本项目。

---

## 前置条件
- 一个 GitHub 账号（Render 从 Git 仓库拉取代码）
- 本仓库已推送到 GitHub（见下方步骤）

---

## 步骤一：把代码推到 GitHub

> 以下命令已在本地初始化并提交（见仓库内 `.git`）。你只需补上远程仓库并推送。

```bash
# 1. 在 GitHub 新建一个空仓库（如 flying-chess），不要勾选 README/.gitignore
# 2. 把本地仓库关联到你的 GitHub 远程地址（替换成你的用户名/仓库名）
cd flying-chess
git remote add origin https://github.com/<你的用户名>/flying-chess.git
git branch -M main
git push -u origin main
```

如果本地 `main` 分支已存在但远程是 `master`，把 `git branch -M main` 保留即可统一为 `main`。

---

## 步骤二：在 Render 创建 Web Service

1. 打开 https://dashboard.render.com → **New** → **Web Service**。
2. 选择 **Connect a repository** → 授权并选中 `flying-chess` 仓库。
3. Render 会自动读取仓库根目录的 `render.yaml`，无需手填：
   - Runtime: Node
   - Plan: Free
   - Build: `npm install`
   - Start: `npm start`
4. 点击 **Create Web Service**。

首部署约 1–2 分钟；完成后会得到一个形如 `https://flying-chess-xxxx.onrender.com` 的公开链接。

---

## 步骤三：验证

1. 浏览器打开你的 `.onrender.com` 链接。
2. 开两个无痕窗口，一个**创建房间**、一个用房间号**加入房间**，确认 WebSocket 联机、骰子、小游戏、胜负都正常。
3. 把链接发到群里即可让朋友一起玩。

---

## 注意事项

- **免费版休眠**：服务闲置 15 分钟后会休眠，首个玩家访问需 **30–60 秒冷启动**才会响应（期间棋盘可能短暂空白，刷新一次即可）。这是免费档正常现象；如需常驻请升级 paid plan 或改用本机 + 内网穿透方案。
- **PORT**：Render 自动注入 `PORT` 环境变量，服务端已 `process.env.PORT || 3000` 读取并绑定 `0.0.0.0`，无需手动设置。
- **零依赖**：项目不依赖 `npm install` 任何包，构建即空操作，部署稳定。
- **WebSocket 已在服务端同源处理**：与页面同域同端口，不存在跨域 / WS 路径问题。

---

## 备选方案

- **本机 + 内网穿透**（cloudflared / ngrok）：在你自己 Mac/Windows 跑 `node server/index.js`，再穿透暴露公网链接。优点零账号；缺点机器需在线、链接有时限。
- **Railway / Fly.io / 自有服务器**：按对应平台补 `Procfile` / `Dockerfile` 即可，逻辑相同。

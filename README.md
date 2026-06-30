# 《默认联系人》静态阅读站

这是一个只发布小说正文的 GitHub Pages 静态站点方案。当前公开版包含《默认联系人》全文 13 章。

公开发布目录是 `docs/`，里面只包含网页和可公开的章节正文。根目录中的聊天记录、分月素材、大纲、处理脚本和原始章节文件已经通过 `.gitignore` 排除，不应提交到公开仓库。

## 本地预览

在项目根目录运行：

```powershell
python -m http.server 8123 -d docs
```

然后打开：

```text
http://localhost:8123/
```

## 一键同步和发布

正文改完后，在项目根目录运行：

```powershell
python publish.py
```

这会自动把根目录的 `默认联系人_第*章_*.txt` 同步到 `docs/chapters/`，并更新目录文件。

同步、提交、推送 GitHub，并部署到服务器：

```powershell
python publish.py --all
```

服务器密码不会写进仓库。可以临时输入，也可以先设置环境变量：

```powershell
$env:NOVEL_DEPLOY_PASSWORD = "你的服务器密码"
python publish.py --all
```

## 发布到 GitHub Pages

1. 新建一个 GitHub 仓库。
2. 推送本仓库的 `main` 分支。
3. 在仓库设置里打开 `Settings > Pages`。
4. `Build and deployment` 的 `Source` 选择 `GitHub Actions`。
5. 等待 `Deploy GitHub Pages` 工作流完成，站点会自动发布 `docs/` 目录。

提交前建议先确认：

```powershell
git status --short
```

如果看到 `私聊_`、`默认联系人_大纲`、`extract_chat_min.py`、`split_chat_by_month.py` 或根目录原始章节文件出现在待提交列表里，先不要提交。

## 添加新章节

1. 把公开版正文放入 `docs/chapters/`，文件名建议使用 `chapter-03.txt` 这种格式。
2. 编辑 `docs/chapters/manifest.json`，追加章节标题和文件路径。
3. 本地预览确认无误后再提交。

# 澳门旅行地图 · 高德版

## Mac 上使用
1. 建议先在原页面导出收藏。旧版没有导出按钮时，在原网页浏览器控制台执行：`copy(localStorage.getItem('macauPlaces'))`，把复制的内容保存为 JSON 文件。收藏位于浏览器中，不在项目 ZIP 内。
2. 用本包中的 src 文件夹替换原项目的 src；替换 vite.config.js、index.html，并复制 .env.example 和 .gitignore。package.json 与 package-lock.json 沿用原版本，无需增加依赖。
3. 项目根目录（package.json 同级）新建 `.env.local`，填写：

```dotenv
VITE_AMAP_KEY=你的Web端JS_API_Key
VITE_AMAP_SECURITY_CODE=同一个Key对应的安全密钥
```

安全密钥在高德控制台「应用管理 → 我的应用」对应 JS API Key 下查找。两项不同，不能填成同一个值。
4. VS Code 打开项目文件夹，终端执行 `npm install`，然后 `npm run dev`。已有依赖可直接运行 `npm run dev`。修改配置后要停止并重新启动。
5. 打开 http://localhost:5173 。配置固定端口，端口被占用时先停止原来的开发服务。

## 功能
- 高德中文地点搜索，结果选择后自动填地址；营业时间有数据时填入，否则手动填写。
- 地图点击手动添加，三级收藏与地图永久名称标签。
- 收藏列表选择起点 A、终点 B，查询步行或驾车的距离、预计时间和路线步骤，并绘制路线。
- 导出 / 导入收藏 JSON，适合换电脑和分享。
- 保留 macauPlaces 存储键；旧版未标明坐标系的收藏视为 WGS84，使用高德转换服务一次性转换。迁移前原始数据备份在 macauPlacesBeforeAMap 中。转换失败不覆盖旧收藏。

## 限制和排查
- 本程序使用 JS API，不能填写 Web 服务 Key。高德 App 能搜到不等于开放 API 必定返回相同结果；澳门部分路线可能暂无覆盖。查询失败会显示错误，不会伪造时间。
- 公交暂未接入；驾车时间不是出租车报价，也不包含等车或停车。
- 本地收藏与浏览器及网址绑定。不同电脑、不同浏览器、localhost 与 127.0.0.1，以及不同端口都可能显示不同收藏。原数据仍在原浏览器网址下，导出后在新页面导入即可。
- INVALID_USER_KEY：检查 Key 平台和状态；INVALID_USER_SCODE：检查安全密钥；INVALID_USER_DOMAIN：检查高德域名白名单；配额不足请查看控制台。
- .env.local 不应提交 Git。VITE_ 配置会出现在前端构建中，并不构成隐藏密钥；本包是本地开发配置。公开发布前按照高德官方安全密钥指南部署代理，并配置允许的域名：https://lbs.amap.com/api/javascript-api-v2/guide/abc/jscode 。纯 GitHub Pages 无法保密安全密钥。

## 验证记录
ESLint 静态检查通过。开发环境 npm 下载部分依赖被 403 阻止，未完成 Vite 构建；上传的 node_modules 为 Mac 平台，不能用于 Linux 构建。尚未使用真实 Key 测试澳门 POI 和路线返回，需在你的 Mac 填写配置后验证。

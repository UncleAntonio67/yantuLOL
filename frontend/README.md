# Frontend (Vite + React + TS)

包含两部分路由:

- 管理后台: `/admin/*`
- 买家阅读端: `/view/:orderId`

## 启动

在 `D:\Project\Yantu\frontend`:

```powershell
npm.cmd install
npm.cmd run dev
```

说明:

- Vite dev server 已配置代理: `/api/*` -> `http://localhost:8000`
- 后端请先启动 `uvicorn app.main:app --reload --port 8000`

编码注意:

- 本项目源码需使用 UTF-8（建议无 BOM）。如果用 GBK/ANSI 保存，浏览器会出现中文乱码（因为 Vite/浏览器按 UTF-8 解析）。

## 开发账号

使用你后端创建的账号，例如:

- `test_admin / ChangeMe123!`

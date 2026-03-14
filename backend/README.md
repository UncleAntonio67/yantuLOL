# Backend (FastAPI)

范围: PDF-only, 手动创建订单, SMTP 邮件发货, 方案 B 在线阅读 + 动态水印 + 退款即时吊销。

## 1) 安装依赖

在 `D:\\Project\\Yantu\\backend`:

```powershell
python -m pip install -r requirements.txt
```

## 2) 配置环境变量

复制项目根目录的 `.env.example` 为 `.env` 并按需修改，最少需要:

- `JWT_SECRET_KEY`
- `DATABASE_URL` (可选, 不配则用 sqlite)
- SMTP 相关 (只有当 delivery_method=email 时才需要)

## 3) 启动数据库（可选，Postgres）

在项目根目录:

```powershell
docker compose up -d
```

然后把 `.env` 的 `DATABASE_URL` 指向 Postgres。

## 4) 创建超级管理员

在 `D:\\Project\\Yantu\\backend`:

```powershell
python scripts/create_admin.py --username boss --password 'ChangeMe123!' --nickname '创始人' --role super_admin
```

## 5) 启动服务

在 `D:\\Project\\Yantu\\backend`:

```powershell
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

接口前缀:

- 后台: `/api/admin/*`
- 阅读端: `/api/viewer/*`


# 开发规划（方案 B: 在线阅读 + 动态水印 + 退款吊销）

本规划将开发规划书中的 Phase 思路落到可执行的里程碑与任务清单，并补齐方案 B 必要的工程细节。

## 0. 总体技术方案（冻结）

- 前端:
  - 管理后台: React 18 + Vite 或 Next.js + Tailwind + Lucide
  - 阅读端: pdf.js 渲染到 canvas（不使用 iframe 直链）
- 后端: Python 3.10+ + FastAPI
- DB: PostgreSQL + SQLAlchemy
- 存储: 本地或 OSS/COS 私有 Bucket
- 核心机制:
  - `admin/orders/deliver` 只创建订单与密码，不生成离线文件
  - 阅读时 `viewer/document/{token}` 动态打水印并流式返回 PDF bytes
  - 退款后立刻阻断访问（每次请求实时校验订单状态）

范围决策（已确认，2026-03-12）:

- 源文件: 只支持 PDF。
- 订单创建: 纯后台手动创建。
- 邮件发货: SMTP。

## 1. 数据模型（从规划书草案补齐工程化字段）

规划书里的 3 张表可以跑通 MVP，但建议补齐以下字段用于安全、审计、统计:

- `TeamMember`
  - `id`, `username`, `password_hash`, `nickname`, `role`, `created_at`
  - 建议增加: `is_active`, `last_login_at`
- `Product`
  - `id`, `name`, `description`, `price`, `source_file_path`, `cover_image`, `sales_count`, `is_active`
  - 建议增加: `created_at`, `updated_at`
  - 建议明确: `source_file_path` 对应的存储类型（本地路径或对象存储 key）
- `Order`
  - `id`, `product_id`, `buyer_id`, `buyer_email`, `delivery_method`, `status`, `operator_id`, `created_at`
  - 规划书写了 `access_password: String (6位随机独立密码)`，建议改为:
    - `access_password_hash`（存 hash，不存明文）
    - `access_password_last4`（可选，用于人工核对）
    - `password_version`（可选，用于重置）
  - 建议增加:
    - `refunded_at`, `refunded_by`
    - `last_view_at`, `view_count`

额外建议新增表:

- `AuditLog`
  - 记录后台敏感操作: 发货、退款、重置密码、商品变更、团队变更
- `ViewerToken`（可选）
  - 如果需要“单点吊销 token”或更细控制，可以把 token 状态落库，否则可用 JWT + 实时查订单状态实现吊销

## 2. API 设计（在规划书基础上明确输入输出）

### 2.1 后台 API

- `POST /api/admin/login`
  - 输入: `username`, `password`
  - 输出: `access_token`, `role`, `nickname`

- `GET /api/admin/products`
  - 输出: 商品列表 + `is_active` + 销量/营收聚合字段（可在后端计算）

- `POST /api/admin/products`
  - 输入: 商品信息 + 文件上传（MVP 支持 PDF）
  - 输出: 新商品

- `PUT /api/admin/products/{id}`
  - 输入: 可编辑字段（不建议直接允许覆盖源文件，走单独接口）

- `GET /api/admin/team`
- `POST /api/admin/team`（super_admin）

- `GET /api/admin/orders`
  - 支持 query: `buyer_id`, `order_id`, `product_id`, `status`, `date_range`

- `POST /api/admin/orders/deliver`（核心）
  - 输入: `product_id`, `buyer_id`, `buyer_email?`, `delivery_method`
  - 输出:
    - `order_id`
    - `viewer_url`（例如 `/view/{order_id}`）
    - `password`（只返回一次）
    - `copy_text`（发货文案）

- `POST /api/admin/orders/{id}/refund`
  - 行为:
    - 状态置 `refunded`
    - 写 `refunded_at/refunded_by`
    - 写审计日志

- `POST /api/admin/orders/{id}/reset-password`
  - 行为:
    - 生成新密码（只返回一次）
    - 更新 `access_password_hash` 与 `access_password_last4`
    - `password_version + 1`，使旧的 `viewer_token` 立即失效

- `GET /api/admin/dashboard/stats`
  - 输出: 今日/近 7 天/近 30 天聚合

### 2.2 阅读端 API（公开但需密码/token）

- `POST /api/viewer/auth`
  - 输入: `order_id`, `password`
  - 校验:
    - 订单存在
    - `status == active`
    - 密码 hash 匹配
    - 防爆破: 按 IP/订单限流
  - 输出: `viewer_token`（短时有效）

- `GET /api/viewer/document/{viewer_token}`
  - 行为:
    - 解 token 找订单
    - 实时校验 `Order.status == active`
    - 读取源 PDF
    - 动态叠加水印
    - 返回 `application/pdf` 流

## 3. 核心实现细节（方案 B 的成败点）

### 3.1 动态水印服务端实现

- 使用 PyMuPDF(fitz) 读取源 PDF
- 对每页绘制平铺水印:
  - 内容: `buyer_id + order_id + timestamp`
  - 角度: 45 度
  - 透明度: 0.08-0.15
  - 间距: 200-300px（可按页面大小自适应）
- 返回 bytes，不落盘

### 3.2 性能与缓存

- 直接每次动态处理可能 CPU 压力较大。
- MVP 可先做:
  - 仅对访问触发处理
  - 以 `order_id + password_version` 为 key 做内存缓存（例如 1-5 分钟）
  - 退款时清掉缓存 key（或依赖实时状态校验）

### 3.3 访问控制与吊销

- 不能只靠 token 过期来吊销，必须每次请求实时查 `Order.status`。
- 退款接口必须立即生效:
  - 下一次 `viewer/auth` 403
  - 已拿到 token 的 `viewer/document` 也 403

### 3.4 审计与风控

- 对以下事件记录日志:
  - 发货创建订单
  - 退款吊销
  - 重置买家密码
  - 买家登录失败次数过多（可作为安全告警）

## 4. 里程碑与排期（按可交付拆分）

### Milestone 1（基础可跑通，约 3-5 天）

- FastAPI 项目骨架
- SQLAlchemy models + migrations（Alembic）
- 登录与 JWT
- 商品 CRUD（先支持本地存储一个 PDF 文件）
- 发货创建订单（生成密码 hash，返回一次明文密码）
- 订单列表查询

交付标准:

- 管理员能从后台创建订单并拿到链接与密码。

### Milestone 2（阅读端闭环，约 3-6 天）

- 阅读端页面:
  - 输入订单号与密码换 token
  - pdf.js canvas 渲染
- `viewer/auth` + `viewer/document` 打通
- PyMuPDF 动态水印实现
- 退款吊销接口 + 阅读端失效提示

交付标准:

- 订单 `active` 可在线阅读。
- 改为 `refunded` 后立刻无法阅读（必须实时阻断）。

### Milestone 3（可运营，约 3-5 天）

- 邮箱发货（可选）
- 数据看板（今日、近 7 天、商品排行）
- 审计日志与基础限流
- 基础部署脚本（开发/生产配置分离）

交付标准:

- 能稳定用于日常发货与售后，统计可对账。

## 5. 风险与决策记录

- “密码 6 位”安全性不足:
  - 建议采用更长随机口令（例如 10-16 位），或在 UI 上仍展示 6 位但服务端实际用更强 token 方案。
- 防下载只能降低成本:
  - pdf.js canvas + 前端拦截只能减少误操作，不是强安全边界。
- 小红书对接:
  - 默认不做自动同步，先走后台创建或 CSV 导入。

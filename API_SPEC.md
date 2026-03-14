# API 契约 (MVP)

后端: FastAPI

前缀:

- 后台: `/api/admin/*` (JWT Bearer)
- 阅读端: `/api/viewer/*` (订单号 + 密码换 token)

## 1. 后台登录

`POST /api/admin/login`

```json
{
  "username": "test_admin",
  "password": "ChangeMe123!"
}
```

响应:

```json
{
  "access_token": "....",
  "token_type": "bearer",
  "role": "super_admin",
  "nickname": "测试超管"
}
```

后续请求带:

`Authorization: Bearer <access_token>`

## 1.1 当前用户

`GET /api/admin/me`

响应:

```json
{
  "id": "...",
  "username": "test_admin",
  "nickname": "测试超管",
  "role": "super_admin"
}
```

## 2. 商品管理（PDF-only）

`GET /api/admin/products`

说明:

- `sales_count` 按 active 订单数聚合（退款会扣除）。

`POST /api/admin/products` (multipart/form-data)

- `name`: string
- `description`: string
- `price`: number
- `is_active`: boolean
- `cover_image`: string (可选，URL 或站内静态路径，如 `/static/product-images/xxx.png`)
- `cover_image_file`: file (可选，png/jpg/webp；如提供则优先使用文件)
- `source_pdf`: file (必须是 PDF)

`PUT /api/admin/products/{product_id}` (JSON)

可更新字段: `name/description/price/cover_image/is_active`

`POST /api/admin/products/{product_id}/cover-image` (multipart/form-data)

- `cover_image_file`: file (必须是 png/jpg/webp)

`DELETE /api/admin/products/{product_id}`

- 若该商品已存在订单，会返回 400（不允许删除，避免数据断链）。

## 3. 发货创建订单（手动）

`POST /api/admin/orders/deliver`

```json
{
  "product_id": "....",
  "buyer_id": "小红薯_8899",
  "buyer_email": "buyer@example.com",
  "delivery_method": "email"
}
```

响应（密码只返回一次）:

```json
{
  "order_id": "ORD-20260312103045-AB12",
  "viewer_url": "http://localhost:5173/view/ORD-....",
  "password": "a1b2c3d4e5f6",
  "copy_text": "【研途LOL】亲，您的专属资料已生成...（含法律声明）\n",
  "delivery_method": "email",
  "email_subject": "研途LOL 专属资料在线阅读",
  "email_body": "同 copy_text（含法律声明）",
  "qrcode_url": null,
  "qrcode_image_url": "/api/viewer/qrcode/ORD-....png",
  "smtp_configured": true,
  "legal_disclaimer": "【法律声明/版权提示】..."
}
```

`POST /api/admin/orders/{order_id}/send-email` (JSON)

用于在“邮件预览可编辑”后再发送，避免误发。服务端会自动追加法律声明。

```json
{
  "subject": "研途LOL 专属资料在线阅读",
  "body": "邮件正文..."
}
```

## 4. 发货记录与售后

`GET /api/admin/orders?buyer_id=xxx&status_filter=active`

响应示例（字段节选）:

```json
{
  "id": "ORD-...",
  "buyer_id": "小红薯_8899",
  "product_id": "...",
  "product_name": "某某资料",
  "operator_nickname": "管理员A",
  "status": "active",
  "password_last4": "e5f6"
}
```

`POST /api/admin/orders/{order_id}/refund`

退款后:

- `viewer/auth` 立即 403
- 已拿到 token 的 `viewer/document` 也会在下一次请求时 403（服务端实时校验订单状态）

## 4.1 重置订单访问密码（让旧 token 立即失效）

`POST /api/admin/orders/{order_id}/reset-password`

响应（新密码只返回一次）:

```json
{
  "order_id": "ORD-....",
  "password": "new_password_once",
  "password_last4": "e5f6",
  "password_version": 2,
  "copy_text": "【研途LOL】..."
}
```

说明:

- 服务端会把 `password_version` +1，从而使旧 `viewer_token` 在 `viewer/document` 处立即失效。
- 默认不自动发邮件，避免误发泄露；如需要可由管理员复制发送。

## 5. 数据看板

`GET /api/admin/dashboard/stats`

`GET /api/admin/dashboard/analytics`

- 销量排行（按 active 订单数）
- 单品收入排行（按 active 订单金额汇总）
- 退款率（refunded / total）

## 6. 阅读端

### 6.1 订单号 + 密码换 token

`POST /api/viewer/auth`

```json
{
  "order_id": "ORD-....",
  "password": "a1b2c3d4e5f6"
}
```

响应:

```json
{
  "viewer_token": "....",
  "expires_in_minutes": 15
}
```

### 6.2 获取动态水印 PDF（流式返回）

`GET /api/viewer/document/{viewer_token}`

- `Content-Type: application/pdf`
- `Cache-Control: no-store`
- 服务端每次请求会实时校验订单状态为 `active`，保证退款立即失效

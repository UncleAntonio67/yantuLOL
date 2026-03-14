export type AdminMe = {
  id: string;
  username: string;
  nickname: string;
  role: "super_admin" | "normal_admin";
};

export type DashboardStats = {
  today_revenue: string;
  today_orders: number;
  active_products: number;
  total_refunds: number;
};

export type DashboardSalesRankItem = {
  product_id: string;
  product_name: string;
  sales: number;
};

export type DashboardRevenueRankItem = {
  product_id: string;
  product_name: string;
  revenue: string;
};

export type DashboardRefundRateItem = {
  product_id: string;
  product_name: string;
  total_orders: number;
  refunded_orders: number;
  refund_rate: number;
};

export type DashboardAnalytics = {
  sales_ranking: DashboardSalesRankItem[];
  revenue_ranking: DashboardRevenueRankItem[];
  refund_rate_by_product: DashboardRefundRateItem[];
};

export type Product = {
  id: string;
  name: string;
  description: string;
  price: string;
  cover_image: string | null;
  sales_count: number;
  attachment_count: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Order = {
  id: string;
  product_id: string;
  product_name: string;
  buyer_id: string;
  buyer_email: string | null;
  delivery_method: "text" | "email" | "qrcode";
  status: "active" | "refunded";
  unit_price: string;
  is_confirmed: boolean;
  confirmed_at: string | null;
  operator_id: string;
  operator_nickname: string;
  password_last4: string;
  created_at: string;
  refunded_at: string | null;
};

export type TeamMember = {
  id: string;
  username: string;
  nickname: string;
  role: "super_admin" | "normal_admin";
  is_active: boolean;
  created_at: string;
};

export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
};

export type ProductPage = Page<Product>;
export type OrderPage = Page<Order>;

export type ProductAttachment = {
  id: string;
  filename: string;
  sort_index: number;
  created_at: string;
};

export type ProductDetail = {
  id: string;
  name: string;
  description: string;
  price: string;
  cover_image: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  attachments: ProductAttachment[];
};

export type DeliverResponse = {
  order_id: string;
  viewer_url: string;
  password: string;
  copy_text: string;
  delivery_method: "text" | "email" | "qrcode";
  email_subject: string | null;
  email_body: string | null;
  qrcode_url: string | null;
  qrcode_image_url: string | null;
  smtp_configured: boolean;
  legal_disclaimer: string;
};

export type SendEmailResponse = { ok: boolean };

export type ViewerAttachment = { id: string; filename: string };

export type ViewerMeta = {
  order_id: string;
  product_name: string;
  is_confirmed: boolean;
  can_download: boolean;
  download_password: string | null;
  attachments: ViewerAttachment[];
};

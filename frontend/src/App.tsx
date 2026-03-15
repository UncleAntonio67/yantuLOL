import { Navigate, Route, Routes } from "react-router-dom";
import AdminShell from "./pages/admin/AdminShell";
import LoginPage from "./pages/admin/LoginPage";
import DashboardPage from "./pages/admin/DashboardPage";
import ProductsPage from "./pages/admin/ProductsPage";
import ProductCreatePage from "./pages/admin/ProductCreatePage";
import ProductEditPage from "./pages/admin/ProductEditPage";
import OrdersPage from "./pages/admin/OrdersPage";
import TeamPage from "./pages/admin/TeamPage";
import SystemPage from "./pages/admin/SystemPage";
import ViewerPage from "./pages/viewer/ViewerPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/admin" replace />} />
      <Route path="/admin/login" element={<LoginPage />} />
      <Route path="/view/:orderId" element={<ViewerPage />} />

      <Route path="/admin" element={<AdminShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="products/new" element={<ProductCreatePage />} />
        <Route path="products/:productId/edit" element={<ProductEditPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="system" element={<SystemPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}

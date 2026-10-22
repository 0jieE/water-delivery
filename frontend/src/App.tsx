import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import ProtectedRoute from "./routes/ProtectedRoute";
import LoginPage from "./features/auth/LoginPage";
import RegisterPage from "./features/auth/RegisterPage";
import ProfilePage from "./features/auth/ProfilePage";
import ServicesPage from "./features/customer/ServicesPage";
import CheckoutPage from "./features/customer/CheckoutPage";
import MyOrdersPage from "./features/customer/MyOrdersPage";
import OrderPlacedPage from "./features/customer/OrderPlacedPage";
import CustomerOrderDetailPage from "./features/customer/CustomerOrderDetailPage";
import DashboardPage from "./features/staff/DashboardPage";
import OrdersPage from "./features/staff/OrdersPage";
import StaffOrderDetailPage from "./features/staff/StaffOrderDetailPage";
import SchedulePage from "./features/staff/SchedulePage";
import PaymentsPage from "./features/staff/PaymentsPage";
import CashPage from "./features/staff/CashPage";
import UsersPage from "./features/admin/UsersPage";
import RidersPage from "./features/admin/RidersPage";
import ServicesAdminPage from "./features/admin/ServicesAdminPage";
import ReportsPage from "./features/admin/ReportsPage";
import PaymentSettingsPage from "./features/admin/PaymentSettingsPage";
import BackupsPage from "./features/admin/BackupsPage";
import DeliveriesPage, { HistoryPage } from "./features/rider/DeliveriesPage";
import DeliveryDetailPage from "./features/rider/DeliveryDetailPage";
import TripPage from "./features/rider/TripPage";
import RiderCashPage from "./features/rider/CashPage";
import ErrorBoundary from "./components/ErrorBoundary";
import PwaNotices from "./components/PwaNotices";
import { homePathFor, useSession } from "./lib/auth";

function RootRedirect() {
  const { role } = useSession();
  return <Navigate to={homePathFor(role)} replace />;
}

/** Staff pages are shared: mounted under /staff and again under /admin (admins can do everything staff can). */
const staffRoutes = (
  <>
    <Route index element={<DashboardPage />} />
    <Route path="orders" element={<OrdersPage />} />
    <Route path="orders/:id" element={<StaffOrderDetailPage />} />
    <Route path="schedule" element={<SchedulePage />} />
    <Route path="payments" element={<PaymentsPage />} />
    <Route path="cash" element={<CashPage />} />
    <Route path="profile" element={<ProfilePage />} />
  </>
);

export default function App() {
  const location = useLocation();
  return (
    <>
    <PwaNotices />
    <ErrorBoundary resetKey={location.pathname}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route element={<ProtectedRoute roles={["customer"]} />}>
        <Route path="/customer">
          <Route index element={<ServicesPage />} />
          <Route path="checkout" element={<CheckoutPage />} />
          <Route path="order-placed/:id" element={<OrderPlacedPage />} />
          <Route path="orders" element={<MyOrdersPage />} />
          <Route path="orders/:id" element={<CustomerOrderDetailPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="*" element={<Navigate to="/customer" replace />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute roles={["staff", "admin"]} />}>
        <Route path="/staff">
          {staffRoutes}
          <Route path="*" element={<Navigate to="/staff" replace />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute roles={["admin"]} />}>
        <Route path="/admin">
          {staffRoutes}
          <Route path="users" element={<UsersPage />} />
          <Route path="riders" element={<RidersPage />} />
          <Route path="services" element={<ServicesAdminPage />} />
          <Route path="payment-settings" element={<PaymentSettingsPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="backups" element={<BackupsPage />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute roles={["rider"]} />}>
        <Route path="/rider">
          <Route index element={<DeliveriesPage />} />
          <Route path="trip" element={<TripPage />} />
          <Route path="cash" element={<RiderCashPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="deliveries/:id" element={<DeliveryDetailPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="*" element={<Navigate to="/rider" replace />} />
        </Route>
      </Route>

      <Route path="/" element={<RootRedirect />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </ErrorBoundary>
    </>
  );
}

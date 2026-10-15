import { Navigate, useLocation } from "react-router-dom";
import { homePathFor, useSession, type Role } from "../lib/auth";
import Layout from "../components/Layout";
import PhoneShell from "../components/PhoneShell";

/**
 * Guards a section of the app by role and renders the shared layout (which hosts the <Outlet />).
 * - Signed out → /login (remembering where the user was headed).
 * - Signed in with the wrong role → their own home, never /login (which would bounce back and loop).
 */
export default function ProtectedRoute({ roles }: { roles: Role[] }) {
  const { role } = useSession();
  const location = useLocation();

  if (!role) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!roles.includes(role)) return <Navigate to={homePathFor(role)} replace />;
  // Customers and riders always get the phone-style app shell, even on a desktop screen.
  return role === "customer" || role === "rider" ? <PhoneShell role={role} /> : <Layout role={role} />;
}

import { OperationsLogin } from "@/components/OperationsLogin";

export default function AdminLoginPage() {
  return <OperationsLogin consoleName="Admin console" destination="/admin" allowedRoles={["admin"]} />;
}
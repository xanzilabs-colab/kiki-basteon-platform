import { OperationsLogin } from "@/components/OperationsLogin";

export default function ResponderLoginPage() {
  return <OperationsLogin consoleName="Response console" destination="/responder" allowedRoles={["admin", "responder"]} />;
}
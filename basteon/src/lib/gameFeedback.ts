import { toast } from "sonner";

export function showGameError(title: string, description: string, id?: string) {
  toast.error(title, {
    className: "stoep-game-toast",
    description,
    duration: 7000,
    id,
  });
}

export function dismissGameError(id: string) {
  toast.dismiss(id);
}

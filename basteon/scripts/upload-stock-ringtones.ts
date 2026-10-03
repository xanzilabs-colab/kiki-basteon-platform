import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase service role configuration.");

const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
const ringtones = [
  { id: "iphone", name: "iPhone", file: "IPhone.mp3" },
  { id: "iphone-2", name: "iPhone 2", file: "IPhone2.mp3" },
  { id: "oppo", name: "Oppo", file: "Oppo.mp3" },
  { id: "redmi", name: "Redmi", file: "Redmi.mp3" },
  { id: "samsung", name: "Samsung", file: "Samsung.mp3" },
  { id: "samsung-2", name: "Samsung 2", file: "Samsung2.mp3" },
  { id: "huawei", name: "Huawei", file: "Huawei.mp3" },
];

async function main() {
  for (const ringtone of ringtones) {
    const storagePath = `stock/${ringtone.file}`;
    const file = await readFile(path.resolve(process.cwd(), "public", "ringtones", ringtone.file));
    const { error } = await supabase.storage.from("kiki-ringtones").upload(storagePath, file, {
      upsert: true,
      contentType: "audio/mpeg",
      cacheControl: "31536000",
    });
    if (error) throw error;
  }

  const { error } = await supabase.from("ringtones").upsert(
    ringtones.map(({ id, name, file }) => ({ id, name, storage_path: `stock/${file}`, is_stock: true })),
    { onConflict: "id" },
  );
  if (error) throw error;
  console.log(`Uploaded ${ringtones.length} stock ringtones.`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";

const USER_STORAGE_BUCKETS = ["kiki-profile-images", "kiki-ringtones", "journal-media"] as const;
const LIST_PAGE_SIZE = 100;
const REMOVE_BATCH_SIZE = 100;

export async function deleteUserStorage(db: ReturnType<typeof createAdminClient>, userId: string) {
  for (const bucketName of USER_STORAGE_BUCKETS) {
    const bucket = db.storage.from(bucketName);
    const directories = [userId];
    const paths: string[] = [];

    while (directories.length) {
      const directory = directories.pop();
      if (!directory) continue;
      let offset = 0;

      while (true) {
        const { data, error } = await bucket.list(directory, { limit: LIST_PAGE_SIZE, offset });
        if (error) throw new Error(`Could not list ${bucketName} user files.`);
        const entries = data ?? [];
        for (const entry of entries) {
          const path = `${directory}/${entry.name}`;
          if (entry.id) paths.push(path);
          else directories.push(path);
        }
        if (entries.length < LIST_PAGE_SIZE) break;
        offset += LIST_PAGE_SIZE;
      }
    }

    for (let index = 0; index < paths.length; index += REMOVE_BATCH_SIZE) {
      const { error } = await bucket.remove(paths.slice(index, index + REMOVE_BATCH_SIZE));
      if (error) throw new Error(`Could not remove ${bucketName} user files.`);
    }
  }
}

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const BUCKET = "kiki-ringtones";
const PREFIX = "worry-boats/audio";
const BUCKET_FILE_LIMIT_BYTES = 5 * 1024 * 1024;
const sourceFiles = [
  { id: "nature-ambiance", file: "nature ambiance.mp3", roleGain: 0.5 },
  { id: "river-flowing", file: "River flowing.mp3", roleGain: 0.62 },
  { id: "touch-water", file: "touch water.mp3", roleGain: 0.85 },
  { id: "paper-folding", file: "paper boat folding.mp3", roleGain: 0.62 },
  { id: "paper-folding-alternate", file: "paper boat folding 2.mp3", roleGain: 0.56 },
] as const;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase service role configuration.");

const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
const sourceDirectory = path.resolve(process.cwd(), "public", "sound effects");

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}.`)));
  });
}

async function listBucketBytes(prefix = ""): Promise<number> {
  let total = 0;
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: 1000, offset });
    if (error) throw error;
    for (const item of data ?? []) {
      if (item.id === null) {
        const folder = prefix ? `${prefix}/${item.name}` : item.name;
        total += await listBucketBytes(folder);
      } else {
        total += Number(item.metadata?.size ?? 0);
      }
    }
    if (!data || data.length < 1000) return total;
    offset += 1000;
  }
}

async function main() {
  const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();
  if (bucketError) throw bucketError;
  const bucket = buckets.find((item) => item.name === BUCKET);
  if (!bucket) throw new Error(`Required existing storage bucket "${BUCKET}" was not found.`);

  const originalSizes = await Promise.all(sourceFiles.map(async ({ file }) => (await stat(path.join(sourceDirectory, file))).size));
  const originalBytes = originalSizes.reduce((total, size) => total + size, 0);
  const existingBytes = await listBucketBytes();
  const previousAudioBytes = await listBucketBytes(PREFIX);
  console.log(`Storage preflight: ${existingBytes} existing bytes in ${BUCKET}; ${originalBytes} source bytes across ${sourceFiles.length} files.`);
  console.log(`Existing bucket per-file limit: ${bucket.file_size_limit ?? "not specified"} bytes.`);

  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "kiki-worry-boats-"));
  try {
    const mastered = await Promise.all(sourceFiles.map(async ({ id, file, roleGain }) => {
      const output = path.join(temporaryDirectory, `${id}.mp3`);
      await run("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y", "-i", path.join(sourceDirectory, file),
        "-af", `volume=0.5,volume=${roleGain}`,
        "-c:a", "libmp3lame", "-b:a", "128k", "-ar", "44100", output,
      ]);
      const size = (await stat(output)).size;
      if (size > BUCKET_FILE_LIMIT_BYTES || (typeof bucket.file_size_limit === "number" && size > bucket.file_size_limit)) {
        throw new Error(`Mastered ${file} exceeds the existing bucket's per-file upload limit.`);
      }
      return { id, output, size };
    }));

    const masteredBytes = mastered.reduce((total, item) => total + item.size, 0);
    const resultingBucketBytes = existingBytes - previousAudioBytes + masteredBytes;
    console.log(`Mastered upload size: ${masteredBytes} bytes (${(masteredBytes / 1024 / 1024).toFixed(2)} MiB).`);
    console.log(`Estimated ${BUCKET} usage after upsert: ${resultingBucketBytes} bytes (${(resultingBucketBytes / 1024 / 1024).toFixed(2)} MiB).`);
    for (const item of mastered) {
      const body = await readFile(item.output);
      const { error } = await supabase.storage.from(BUCKET).upload(`${PREFIX}/${item.id}.mp3`, body, {
        upsert: true,
        contentType: "audio/mpeg",
        cacheControl: "31536000",
      });
      if (error) throw error;
    }
    const uploadedBytes = await listBucketBytes(PREFIX);
    if (uploadedBytes !== masteredBytes) throw new Error("Supabase upload verification failed: stored audio size does not match the mastered files.");
    console.log(`Uploaded ${mastered.length} mastered Worry Boats sounds to ${BUCKET}/${PREFIX}.`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

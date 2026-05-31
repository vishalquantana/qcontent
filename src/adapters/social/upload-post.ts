export interface UploadPostCreds {
  apiKey: string;
  user: string; // upload-post profile (e.g. "ladya")
}

export interface DeliveryResult {
  delivered: boolean;
  skipped: boolean;
  reason?: string;
  requestId?: string;
}

const UPLOAD_POST_URL = "https://api.upload-post.com/api/upload_photos";

/**
 * Post rendered carousel PNGs to Instagram via Upload-Post.
 * No-ops (skipped:true) when creds are absent; delivered:false when there are no images.
 */
export async function deliverCarousel(
  creds: UploadPostCreds | null | undefined,
  images: Buffer[],
  caption: string,
  hashtags: string[],
): Promise<DeliveryResult> {
  if (!creds || !creds.apiKey || !creds.user) return { delivered: false, skipped: true };
  if (images.length === 0) return { delivered: false, skipped: false, reason: "no images to post" };

  const description = `${caption}\n\n${hashtags.join(" ")}`.trim();
  const form = new FormData();
  images.forEach((buf, i) => {
    form.append("photos[]", new Blob([new Uint8Array(buf)], { type: "image/png" }), `slide-${i + 1}.png`);
  });
  form.append("platform[]", "instagram");
  form.append("user", creds.user);
  form.append("description", description);

  const res = await fetch(UPLOAD_POST_URL, {
    method: "POST",
    headers: { Authorization: `Apikey ${creds.apiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`upload-post failed: ${res.status} ${await res.text().catch(() => "")}`);
  const body = (await res.json().catch(() => ({}))) as { request_id?: string };
  return { delivered: true, skipped: false, requestId: body.request_id };
}

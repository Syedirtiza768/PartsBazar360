import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createServer } from "node:http";
import { pipeline } from "node:stream/promises";

const PORT = Number(process.env.PORT || 3002);
const REGION = process.env.AWS_REGION || "us-east-1";
const BUCKET = "solarrisebackupbucket-530142863136";
const BUCKET_HOST = `${BUCKET}.s3.amazonaws.com`;
const ALLOWED_PREFIX = "mhn/catalog-images/inventory/";
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

const s3 = new S3Client({ region: REGION });

function imageKeyFromRequest(requestUrl) {
  const request = new URL(requestUrl, "http://private-image-proxy");
  const source = request.searchParams.get("url");
  if (!source) throw Object.assign(new Error("Missing image URL"), { statusCode: 400 });

  let url;
  try {
    url = new URL(source);
  } catch {
    throw Object.assign(new Error("Invalid image URL"), { statusCode: 400 });
  }

  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== BUCKET_HOST ||
    (url.port && url.port !== "443") ||
    url.username ||
    url.password
  ) {
    throw Object.assign(new Error("Image source is not allowed"), { statusCode: 400 });
  }

  let key;
  try {
    key = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw Object.assign(new Error("Invalid image path"), { statusCode: 400 });
  }

  if (
    !key.startsWith(ALLOWED_PREFIX) ||
    key.includes("\\") ||
    key.includes("\0") ||
    key.split("/").some((segment) => segment === "..")
  ) {
    throw Object.assign(new Error("Image path is not allowed"), { statusCode: 400 });
  }

  return key;
}

function sendError(response, statusCode, message) {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "text/plain; charset=utf-8",
  });
  response.end(message);
}

const server = createServer(async (request, response) => {
  const path = new URL(request.url || "/", "http://private-image-proxy").pathname;
  if (path === "/healthz" && request.method === "GET") {
    response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": "text/plain" });
    response.end("ok");
    return;
  }

  if (path !== "/image" || !["GET", "HEAD"].includes(request.method || "")) {
    sendError(response, 404, "Not found");
    return;
  }

  let key;
  try {
    key = imageKeyFromRequest(request.url || "/image");
  } catch (error) {
    sendError(response, error.statusCode || 400, error.message || "Invalid image request");
    return;
  }

  try {
    const object = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    if (!object.Body) {
      sendError(response, 502, "Image unavailable");
      return;
    }
    const contentType = object.ContentType || "application/octet-stream";
    if (!contentType.toLowerCase().startsWith("image/")) {
      object.Body?.destroy?.();
      sendError(response, 415, "Object is not an image");
      return;
    }
    if (object.ContentLength && object.ContentLength > MAX_IMAGE_BYTES) {
      object.Body?.destroy?.();
      sendError(response, 413, "Image is too large");
      return;
    }

    const headers = {
      "Cache-Control": "public, max-age=604800, s-maxage=2592000, stale-while-revalidate=86400",
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
    };
    if (object.ContentLength !== undefined) headers["Content-Length"] = String(object.ContentLength);
    if (object.ETag) headers.ETag = object.ETag;
    if (object.LastModified) headers["Last-Modified"] = object.LastModified.toUTCString();

    if (request.headers["if-none-match"] && request.headers["if-none-match"] === object.ETag) {
      object.Body?.destroy?.();
      response.writeHead(304, headers);
      response.end();
      return;
    }

    response.writeHead(200, headers);
    if (request.method === "HEAD") {
      object.Body?.destroy?.();
      response.end();
      return;
    }
    await pipeline(object.Body, response);
  } catch (error) {
    const errorName = error?.name || "S3RequestError";
    if (errorName === "NoSuchKey" || errorName === "NotFound") {
      sendError(response, 404, "Image not found");
      return;
    }
    console.error("Private image read failed", errorName);
    sendError(response, 502, "Image unavailable");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Private image proxy listening on ${PORT}`);
});

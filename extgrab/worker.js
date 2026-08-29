export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      // CORS / OPTIONS
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: { ...corsHeaders(), ...securityHeaders() },
        });
      }

      if (request.method === "GET") {

        // SEO: robots.txt
        if (url.pathname === "/robots.txt") {
          return new Response(getRobotsTxt(url), {
            status: 200,
            headers: {
              "Content-Type": "text/plain; charset=UTF-8",
              "Cache-Control": "public, max-age=3600",
              ...securityHeaders(),
            },
          });
        }

        // SEO: sitemap.xml
        if (url.pathname === "/sitemap.xml") {
          return new Response(getSitemapXml(url), {
            status: 200,
            headers: {
              "Content-Type": "application/xml; charset=UTF-8",
              "Cache-Control": "public, max-age=3600",
              ...securityHeaders(),
            },
          });
        }

        // Terms of use
        if (url.pathname === "/terms" || url.pathname === "/terms/") {
          return new Response(getTermsHtml(url), {
            status: 200,
            headers: {
              "Content-Type": "text/html; charset=UTF-8",
              "Cache-Control": "no-cache",
              ...htmlSecurityHeaders(),
            },
          });
        }

        // Privacy policy
        if (url.pathname === "/privacy" || url.pathname === "/privacy/") {
          return new Response(getPrivacyHtml(url), {
            status: 200,
            headers: {
              "Content-Type": "text/html; charset=UTF-8",
              "Cache-Control": "no-cache",
              ...htmlSecurityHeaders(),
            },
          });
        }

        // GET = UI
        return new Response(getHtml(url), {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=UTF-8",
            "Cache-Control": "no-cache",
            ...htmlSecurityHeaders(),
          },
        });
      }

      // POST = extension download
      if (request.method === "POST") {
        return await handleDownload(request);
      }

      return new Response("Method Not Allowed", {
        status: 405,
        headers: {
          "Allow": "GET, POST, OPTIONS",
          ...securityHeaders(),
        },
      });

    } catch (error) {
      console.error("Worker error:", error);

      return jsonResponse(
        {
          error: "Something went wrong handling that request.",
        },
        500
      );
    }
  },
};


/* =========================================================
   DOWNLOAD HANDLER
========================================================= */

async function handleDownload(request) {
  let body;

  const contentType =
    request.headers.get("content-type") || "";

  try {
    if (
      contentType
        .toLowerCase()
        .includes("application/json")
    ) {
      body = await request.json();
    } else {
      const formData = await request.formData();

      body = {
        extensionId:
          formData.get("extensionId") || "",

        storeType:
          formData.get("storeType") || "edge",

        format:
          formData.get("format") || "native",
      };
    }
  } catch (error) {
    return jsonResponse(
      {
        error: "Invalid request body.",
      },
      400
    );
  }

  const inputString =
    typeof body?.extensionId === "string"
      ? body.extensionId.trim()
      : "";

  if (!inputString) {
    return jsonResponse(
      {
        error:
          "Please enter an extension URL, ID, or Firefox slug.",
      },
      400
    );
  }

  if (inputString.length > 2048) {
    return jsonResponse(
      {
        error:
          "That input is too long to be a valid extension URL, ID, or slug.",
      },
      400
    );
  }

  let storeType =
    typeof body?.storeType === "string"
      ? body.storeType.toLowerCase()
      : "edge";

  let formatType =
    typeof body?.format === "string"
      ? body.format.toLowerCase()
      : "native";

  if (!["native", "zip"].includes(formatType)) {
    formatType = "native";
  }


  /* ---------------------------------------------------------
     Auto-detect store
  --------------------------------------------------------- */

  const lowerInput =
    inputString.toLowerCase();

  if (
    lowerInput.includes(
      "chromewebstore.google.com"
    ) ||
    lowerInput.includes(
      "chrome.google.com/webstore"
    )
  ) {
    storeType = "chrome";
  }

  else if (
    lowerInput.includes(
      "microsoftedge.microsoft.com"
    )
  ) {
    storeType = "edge";
  }

  else if (
    lowerInput.includes(
      "addons.mozilla.org"
    )
  ) {
    storeType = "firefox";
  }


  if (
    !["chrome", "edge", "firefox"].includes(
      storeType
    )
  ) {
    storeType = "edge";
  }


  /* ---------------------------------------------------------
     Build upstream request
  --------------------------------------------------------- */

  let downloadUrl;
  let identifier;
  let filename;
  let extension;


  /* =========================
     FIREFOX
  ========================= */

  if (storeType === "firefox") {

    identifier =
      extractFirefoxSlug(inputString);

    if (!identifier || !isValidFirefoxIdentifier(identifier)) {
      return jsonResponse(
        {
          error:
            "Invalid Firefox add-on URL or slug.",
        },
        400
      );
    }

    extension = "xpi";

    downloadUrl =
      "https://addons.mozilla.org/firefox/downloads/latest/" +
      encodeURIComponent(identifier) +
      "/latest.xpi";
  }


  /* =========================
     CHROME / EDGE
  ========================= */

  else {

    identifier =
      extractChromiumId(inputString);

    if (!identifier) {
      return jsonResponse(
        {
          error:
            "Invalid extension identifier. Chrome and Edge extension IDs must be 32 characters.",
        },
        400
      );
    }

    extension = "crx";


    if (storeType === "chrome") {

      downloadUrl =
        "https://clients2.google.com/service/update2/crx" +
        "?response=redirect" +
        "&os=win" +
        "&arch=x64" +
        "&os_arch=x64" +
        "&nacl_arch=x86-64" +
        "&prod=chromeselfupdate" +
        "&prodchannel=stable" +
        "&prodversion=120.0.0.0" +
        "&lang=en-US" +
        "&id=" +
        encodeURIComponent(identifier);

    }

    else {

      downloadUrl =
        "https://edge.microsoft.com/extensionwebstorebase/v1/crx" +
        "?x=id%3D" +
        encodeURIComponent(identifier) +
        "%26installsource%3Dondemand" +
        "&response=redirect";
    }
  }


  /* ---------------------------------------------------------
     Fetch package from upstream
  --------------------------------------------------------- */

  let upstreamResponse;

  try {

    upstreamResponse =
      await fetch(downloadUrl, {
        method: "GET",

        redirect: "follow",

        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
            "AppleWebKit/537.36 " +
            "(KHTML, like Gecko) " +
            "Chrome/120.0.0.0 Safari/537.36",

          "Accept":
            "*/*",
        },
      });

  } catch (error) {

    console.error(
      "Upstream fetch failed:",
      error
    );

    return jsonResponse(
      {
        error:
          "Unable to connect to the extension store.",
      },
      502
    );
  }


  /* ---------------------------------------------------------
     Handle upstream errors
  --------------------------------------------------------- */

  if (!upstreamResponse.ok) {

    console.error(
      "Upstream status:",
      upstreamResponse.status,
      downloadUrl
    );

    return jsonResponse(
      {
        error:
          "The extension store did not return the requested package.",

        upstreamStatus:
          upstreamResponse.status,

        storeType,
        identifier,
      },
      502
    );
  }


  /* ---------------------------------------------------------
     Inspect + return package
  --------------------------------------------------------- */

  // Safety cap: for very large files, skip in-memory inspection
  // (manifest lookup / zip conversion) and just stream the native
  // file straight through, to avoid excessive Worker memory use.
  const MAX_INSPECT_BYTES = 75 * 1024 * 1024; // 75MB

  const upstreamContentLength =
    upstreamResponse.headers.get("Content-Length");

  const upstreamSize =
    upstreamContentLength ? parseInt(upstreamContentLength, 10) : null;

  const tooLargeToInspect =
    Number.isFinite(upstreamSize) && upstreamSize > MAX_INSPECT_BYTES;

  if (formatType === "zip" && tooLargeToInspect) {
    return jsonResponse(
      {
        error:
          "This package is too large to convert to ZIP. Try the native format instead.",
      },
      400
    );
  }

  const headers =
    new Headers();

  headers.set(
    "Cache-Control",
    "no-store"
  );

  headers.set(
    "X-Extension-Store",
    storeType
  );

  headers.set(
    "X-Extension-Id",
    identifier
  );

  // CORS
  const cors = corsHeaders();

  for (const [key, value] of Object.entries(cors)) {
    headers.set(key, value);
  }

  // Security
  const security = securityHeaders();

  for (const [key, value] of Object.entries(security)) {
    headers.set(key, value);
  }


  /*
   * Large-file fallback: stream the native package straight
   * through without buffering it in memory, using an
   * identifier-only filename since we never inspect the content.
   */

  if (tooLargeToInspect) {

    filename = sanitizeFilename(identifier) + "." + extension;

    headers.set(
      "Content-Type",
      storeType === "firefox"
        ? "application/x-xpinstall"
        : "application/x-chrome-extension"
    );

    headers.set(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );

    if (upstreamContentLength) {
      headers.set("Content-Length", upstreamContentLength);
    }

    return new Response(
      upstreamResponse.body,
      {
        status: 200,
        headers,
      }
    );
  }


  /*
   * Normal path: buffer the file so we can read its manifest.json
   * (for a name/version-based filename) and, if requested,
   * convert it to a plain ZIP.
   */

  let fileBuffer;

  try {
    fileBuffer = await upstreamResponse.arrayBuffer();
  } catch (error) {
    console.error("Failed to read upstream body:", error);
    return jsonResponse(
      {
        error: "The extension store's response could not be read.",
      },
      502
    );
  }

  const zipBuffer =
    storeType === "firefox"
      ? fileBuffer
      : stripCrxHeader(fileBuffer);

  let manifestInfo = null;

  try {
    manifestInfo = await extractManifestInfo(zipBuffer);
  } catch (error) {
    // Metadata extraction is best-effort; never fail the
    // download over a malformed or unreadable manifest.
    manifestInfo = null;
  }

  filename = buildDownloadFilename(
    manifestInfo,
    identifier,
    formatType === "zip" ? "zip" : extension
  );

  const responseBytes =
    formatType === "zip" ? zipBuffer : fileBuffer;

  headers.set(
    "Content-Type",
    formatType === "zip"
      ? "application/zip"
      : storeType === "firefox"
        ? "application/x-xpinstall"
        : "application/x-chrome-extension"
  );

  headers.set(
    "Content-Disposition",
    `attachment; filename="${filename}"`
  );

  headers.set(
    "Content-Length",
    String(responseBytes.byteLength)
  );

  return new Response(
    responseBytes,
    {
      status: 200,
      headers,
    }
  );
}


/* =========================================================
   CHROMIUM ID EXTRACTION
========================================================= */

function extractChromiumId(input) {

  const value =
    input.trim();


  /*
   * Direct 32-character extension ID.
   */

  const direct =
    value.match(
      /^[a-p]{32}$/i
    );

  if (direct) {
    return direct[0].toLowerCase();
  }


  /*
   * Find ID anywhere inside a URL.
   */

  const embedded =
    value.match(
      /\b[a-p]{32}\b/i
    );

  if (embedded) {
    return embedded[0].toLowerCase();
  }


  return null;
}


/* =========================================================
   FIREFOX IDENTIFIER VALIDATION
========================================================= */

function isValidFirefoxIdentifier(value) {

  // Printable ASCII only, no whitespace or control characters.
  // Covers plain slugs, GUID-style ids ({uuid}), and email-style
  // ids (name@author), while rejecting anything that could cause
  // trouble in a URL path segment or an HTTP header value.
  return /^[\x21-\x7E]{1,200}$/.test(value);
}


/* =========================================================
   FIREFOX SLUG EXTRACTION
========================================================= */

function extractFirefoxSlug(input) {

  let value =
    input.trim();


  /*
   * Remove query string / hash.
   */

  try {

    if (
      value.startsWith("http://") ||
      value.startsWith("https://")
    ) {

      const url =
        new URL(value);

      const parts =
        url.pathname
          .split("/")
          .filter(Boolean);

      const addonIndex =
        parts.findIndex(
          part =>
            part.toLowerCase() ===
            "addon"
        );

      if (
        addonIndex >= 0 &&
        parts[addonIndex + 1]
      ) {
        return parts[
          addonIndex + 1
        ].toLowerCase();
      }

      /*
       * Some AMO URLs can contain
       * the slug without /addon/.
       */

      if (parts.length) {

        return parts[
          parts.length - 1
        ].toLowerCase();
      }

    }

  } catch (_) {
    // Fall back to string parsing.
  }


  /*
   * Plain slug.
   */

  value =
    value
      .replace(/^\/+|\/+$/g, "")
      .split("?")[0]
      .split("#")[0];


  /*
   * /addon/example
   */

  const match =
    value.match(
      /\/addon\/([^/?#]+)/i
    );

  if (match) {
    return match[1].toLowerCase();
  }


  return value
    ? value.toLowerCase()
    : null;
}


/* =========================================================
   FILENAME SANITIZER
========================================================= */

function sanitizeFilename(value) {

  return String(value)
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 100);
}


/* =========================================================
   CRX HEADER STRIPPING

   A .crx file is a small binary header followed by a plain
   ZIP archive. This strips that header so the remaining bytes
   are a standard ZIP (used both for "download as ZIP" and for
   reading manifest.json out of the package).
========================================================= */

function stripCrxHeader(buffer) {

  if (buffer.byteLength < 12) {
    return buffer;
  }

  const bytes = new Uint8Array(buffer, 0, 4);
  const magic = new TextDecoder().decode(bytes);

  if (magic !== "Cr24") {
    // Not CRX-wrapped (unexpected); treat as already a plain zip.
    return buffer;
  }

  const view = new DataView(buffer);
  const version = view.getUint32(4, true);

  if (version === 3 && buffer.byteLength >= 12) {
    const headerLength = view.getUint32(8, true);
    const zipStart = 12 + headerLength;
    return zipStart <= buffer.byteLength
      ? buffer.slice(zipStart)
      : buffer;
  }

  if (version === 2 && buffer.byteLength >= 16) {
    const pubKeyLength = view.getUint32(8, true);
    const signatureLength = view.getUint32(12, true);
    const zipStart = 16 + pubKeyLength + signatureLength;
    return zipStart <= buffer.byteLength
      ? buffer.slice(zipStart)
      : buffer;
  }

  // Unknown CRX version; best effort, return unmodified.
  return buffer;
}


/* =========================================================
   MINIMAL ZIP READER

   Just enough to locate a single named entry (manifest.json)
   in a ZIP's central directory and decompress it. Uses the
   Web Compression Streams API for DEFLATE, which covers the
   vast majority of real-world extension packages.
========================================================= */

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIR_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;

function findEndOfCentralDirectory(buffer) {

  const view = new DataView(buffer);
  const maxCommentLength = 65535;
  const minEOCDSize = 22;
  const searchStart = Math.max(0, buffer.byteLength - minEOCDSize - maxCommentLength);

  for (let i = buffer.byteLength - minEOCDSize; i >= searchStart; i--) {
    if (view.getUint32(i, true) === ZIP_EOCD_SIGNATURE) {
      return {
        centralDirOffset: view.getUint32(i + 16, true),
        entryCount: view.getUint16(i + 10, true),
      };
    }
  }

  return null;
}

function findCentralDirectoryEntry(buffer, targetName) {

  const eocd = findEndOfCentralDirectory(buffer);

  if (!eocd) {
    return null;
  }

  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let offset = eocd.centralDirOffset;

  for (let i = 0; i < eocd.entryCount; i++) {

    if (
      offset + 46 > buffer.byteLength ||
      view.getUint32(offset, true) !== ZIP_CENTRAL_DIR_SIGNATURE
    ) {
      break;
    }

    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);

    const nameBytes = bytes.slice(offset + 46, offset + 46 + nameLength);
    const name = new TextDecoder().decode(nameBytes);

    if (name === targetName) {
      return { method, compressedSize, localHeaderOffset };
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return null;
}

async function extractZipEntry(buffer, targetName) {

  const entry = findCentralDirectoryEntry(buffer, targetName);

  if (!entry) {
    return null;
  }

  const view = new DataView(buffer);
  const localOffset = entry.localHeaderOffset;

  if (
    localOffset + 30 > buffer.byteLength ||
    view.getUint32(localOffset, true) !== ZIP_LOCAL_FILE_SIGNATURE
  ) {
    return null;
  }

  const nameLength = view.getUint16(localOffset + 26, true);
  const extraLength = view.getUint16(localOffset + 28, true);
  const dataStart = localOffset + 30 + nameLength + extraLength;

  if (dataStart + entry.compressedSize > buffer.byteLength) {
    return null;
  }

  const compressedBytes = new Uint8Array(buffer, dataStart, entry.compressedSize);

  if (entry.method === 0) {
    return compressedBytes.slice();
  }

  if (entry.method === 8) {
    const stream = new DecompressionStream("deflate-raw");
    const writer = stream.writable.getWriter();
    writer.write(compressedBytes);
    writer.close();
    const result = await new Response(stream.readable).arrayBuffer();
    return new Uint8Array(result);
  }

  // Unsupported compression method.
  return null;
}


/* =========================================================
   MANIFEST INFO EXTRACTION
========================================================= */

async function extractManifestInfo(zipBuffer) {

  const manifestBytes = await extractZipEntry(zipBuffer, "manifest.json");

  if (!manifestBytes) {
    return null;
  }

  const text = new TextDecoder("utf-8").decode(manifestBytes);
  const manifest = JSON.parse(text);

  let name =
    typeof manifest?.name === "string"
      ? manifest.name
      : null;

  if (name && /^__MSG_.+__$/.test(name)) {
    // Localized name placeholder; resolving it would require
    // also reading the extension's _locales message files.
    name = null;
  }

  const version =
    typeof manifest?.version === "string" ||
    typeof manifest?.version === "number"
      ? String(manifest.version)
      : null;

  if (!name && !version) {
    return null;
  }

  return { name, version };
}


/* =========================================================
   DOWNLOAD FILENAME BUILDER
========================================================= */

function slugifyForFilename(value) {

  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .toLowerCase();
}

function buildDownloadFilename(manifestInfo, identifier, ext) {

  const parts = [];

  const nameSlug =
    manifestInfo?.name ? slugifyForFilename(manifestInfo.name) : "";

  if (nameSlug) {
    parts.push(nameSlug);
  }

  const versionSlug =
    manifestInfo?.version
      ? String(manifestInfo.version).replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 30)
      : "";

  if (versionSlug) {
    parts.push(versionSlug);
  }

  parts.push(sanitizeFilename(identifier));

  return parts.join("-") + "." + ext;
}


/* =========================================================
   JSON RESPONSE
========================================================= */

function jsonResponse(
  data,
  status = 200
) {

  const headers =
    new Headers();

  headers.set(
    "Content-Type",
    "application/json; charset=UTF-8"
  );

  headers.set(
    "Cache-Control",
    "no-store"
  );


  const cors =
    corsHeaders();

  for (
    const [key, value]
    of Object.entries(cors)
  ) {
    headers.set(key, value);
  }

  const security =
    securityHeaders();

  for (
    const [key, value]
    of Object.entries(security)
  ) {
    headers.set(key, value);
  }


  return new Response(
    JSON.stringify(data),
    {
      status,
      headers,
    }
  );
}


/* =========================================================
   CORS
========================================================= */

function corsHeaders() {

  return {
    "Access-Control-Allow-Origin": "*",

    "Access-Control-Allow-Methods":
      "GET, POST, OPTIONS",

    "Access-Control-Allow-Headers":
      "Content-Type",
  };
}


/* =========================================================
   SECURITY HEADERS
========================================================= */

function securityHeaders() {

  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy":
      "geolocation=(), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()",
    "Strict-Transport-Security":
      "max-age=31536000; includeSubDomains",
  };
}

function htmlSecurityHeaders() {

  return {
    ...securityHeaders(),
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
      "form-action 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
    ].join("; "),
  };
}


/* =========================================================
   SEO: ROBOTS + SITEMAP
========================================================= */

function getRobotsTxt(url) {
  return `User-agent: *
Allow: /

Sitemap: ${url.origin}/sitemap.xml`;
}

function getSitemapXml(url) {
  const today = new Date().toISOString().slice(0, 10);

  const pages = [
    { path: "/", priority: "1.0" },
    { path: "/terms", priority: "0.3" },
    { path: "/privacy", priority: "0.3" },
  ];

  const urls = pages
    .map(
      (page) => `  <url>
    <loc>${url.origin}${page.path}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>${page.priority}</priority>
  </url>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}


/* =========================================================
   HTML
========================================================= */

function getSharedStyles() {
  return `
/* ========================================================
   THEME TOKENS — flat, no glow, no gradients
======================================================== */

:root {
  --paper: #F6F7F5;
  --surface: #FFFFFF;
  --surface-2: #F0F1EF;

  --ink: #12151A;
  --ink-soft: #545B66;
  --ink-faint: #5F6B78;

  --line: #D6D9D3;
  --line-strong: #AEB3AD;

  --brand: #0F5FDB;
  --brand-ink: #FFFFFF;
  --accent: #B9740E;
  --accent-soft: #FBF0DD;

  --success: #157F4E;
  --success-soft: #E7F5EE;
  --danger: #C4314B;
  --danger-soft: #FBEAEC;

  --shadow: 0 1px 2px rgba(18, 21, 26, .06), 0 12px 28px rgba(18, 21, 26, .09);
  --radius: 10px;
  --radius-lg: 14px;

  --font-display: "Space Grotesk", ui-sans-serif, system-ui, sans-serif;
  --font-body: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}

[data-theme="dark"] {
  --paper: #0B0D10;
  --surface: #14171C;
  --surface-2: #1B1F25;

  --ink: #F2F4F7;
  --ink-soft: #9AA3AF;
  --ink-faint: #7C8794;

  --line: #2E343D;
  --line-strong: #454E5C;

  --brand: #5B8DEF;
  --brand-ink: #0B0D10;
  --accent: #E3A94A;
  --accent-soft: #2B2312;

  --success: #34C58C;
  --success-soft: #12271F;
  --danger: #F0637B;
  --danger-soft: #2B1519;

  --shadow: 0 1px 2px rgba(0, 0, 0, .3), 0 10px 28px rgba(0, 0, 0, .35);
}

/* ========================================================
   RESET
======================================================== */

* { box-sizing: border-box; margin: 0; padding: 0; }

html { min-height: 100%; background: var(--paper); color-scheme: light dark; }

body {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  color: var(--ink);
  font-family: var(--font-body);
  background: var(--paper);
  -webkit-font-smoothing: antialiased;
  transition: background-color .2s ease, color .2s ease;
}

@media (prefers-reduced-motion: reduce) {
  * { animation-duration: .001ms !important; transition-duration: .001ms !important; }
}

a { color: inherit; }

.skip-link {
  position: absolute;
  left: -9999px;
  top: 0;
  z-index: 100;
  padding: 10px 14px;
  background: var(--brand);
  color: var(--brand-ink);
  font-weight: 700;
  font-size: 13px;
  border-radius: 0 0 8px 0;
}

.skip-link:focus {
  left: 0;
}

:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 2px;
}

/* ========================================================
   HEADER
======================================================== */

.header {
  border-bottom: 1px solid var(--line);
  background: var(--surface);
}

.header-inner {
  width: 100%;
  max-width: 1120px;
  margin: auto;
  padding: 16px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -.01em;
  color: var(--ink);
}

.logo {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: 7px;
  background: var(--brand);
}

.logo svg { width: 19px; height: 19px; color: var(--brand-ink); }

.header-right { display: flex; align-items: center; gap: 8px; }

.nav { display: flex; gap: 2px; }

.nav button {
  border: 1px solid transparent;
  background: transparent;
  color: var(--ink-soft);
  padding: 8px 12px;
  border-radius: 7px;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.nav button:hover { color: var(--ink); background: var(--surface-2); }

.nav button.active {
  color: var(--ink);
  border-color: var(--line);
  background: var(--surface-2);
}

.theme-toggle {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border: 1px solid var(--line-strong);
  border-radius: 7px;
  background: transparent;
  color: var(--ink-soft);
  cursor: pointer;
}

.theme-toggle:hover { color: var(--ink); background: var(--surface-2); }

.theme-toggle svg { width: 15px; height: 15px; }

.theme-toggle .icon-moon { display: none; }
[data-theme="dark"] .theme-toggle .icon-sun { display: none; }
[data-theme="dark"] .theme-toggle .icon-moon { display: block; }

/* ========================================================
   MAIN / HERO
======================================================== */

main { padding: 0 24px; flex: 1 0 auto; display: flex; flex-direction: column; }

.downloader { flex: 1; display: flex; flex-direction: column; justify-content: center; min-height: 0; }

.hero {
  max-width: 1120px;
  margin: 0 auto;
  padding: 64px 0 56px;
  display: grid;
  grid-template-columns: 1.05fr .95fr;
  gap: 40px;
  align-items: start;
}

.eyebrow {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: .04em;
  color: var(--ink-faint);
  margin-bottom: 10px;
}

.hero h1 {
  font-family: var(--font-display);
  font-size: clamp(30px, 3.6vw, 42px);
  line-height: 1.08;
  letter-spacing: -.02em;
  font-weight: 600;
  color: var(--ink);
}

.hero h1 em {
  font-style: normal;
  color: var(--brand);
}

.hero-lede {
  max-width: 480px;
  margin-top: 10px;
  color: var(--ink-soft);
  font-size: 15px;
  line-height: 1.6;
}

.trust-row {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 18px;
}

.trust-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--ink-soft);
}

.trust-item svg {
  width: 15px;
  height: 15px;
  color: var(--success);
  flex-shrink: 0;
}

/* ========================================================
   CARD / TOOL
======================================================== */

.card {
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow);
  overflow: hidden;
}

.card-header {
  display: flex;
  align-items: center;
  padding: 13px 18px;
  border-bottom: 1px solid var(--line);
}

.card-title {
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 600;
}

.card-body { padding: 22px; }

.label {
  display: block;
  margin-bottom: 8px;
  color: var(--ink-faint);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .06em;
  text-transform: uppercase;
}

.stores { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 18px; }

.store-radio { display: none; }

.store {
  min-height: 60px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  background: var(--surface);
  color: var(--ink-faint);
  cursor: pointer;
}

.store:hover { color: var(--ink-soft); border-color: var(--line-strong); }

.store-radio:checked + .store {
  color: var(--ink);
  border-color: var(--brand);
  background: var(--surface-2);
  box-shadow: inset 0 0 0 1px var(--brand);
}

.store svg { width: 17px; height: 17px; }

.store span { font-size: 10px; font-weight: 600; }

.formats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 18px; }

.format-radio { display: none; }

.format {
  min-height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  background: var(--surface);
  color: var(--ink-faint);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.format:hover { color: var(--ink-soft); border-color: var(--line-strong); }

.format-radio:checked + .format {
  color: var(--ink);
  border-color: var(--brand);
  background: var(--surface-2);
  box-shadow: inset 0 0 0 1px var(--brand);
}

.input {
  min-height: 54px;
  display: flex;
  align-items: center;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  background: var(--paper);
}

.input:focus-within { border-color: var(--brand); box-shadow: 0 0 0 3px rgba(15, 95, 219, .12); }

.input-icon { width: 42px; display: grid; place-items: center; color: var(--ink-faint); }

.input-icon svg { width: 17px; height: 17px; }

#extensionInput {
  min-width: 0;
  flex: 1;
  height: 52px;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: 12.5px;
}

#extensionInput::placeholder { color: var(--ink-faint); }

.submit {
  height: 42px;
  margin: 0 6px 0 6px;
  padding: 0 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 0;
  border-radius: 6px;
  background: var(--brand);
  color: var(--brand-ink);
  font: inherit;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
}

.submit:hover { filter: brightness(1.08); }

.submit:disabled { opacity: .55; cursor: wait; }

.submit svg { width: 13px; height: 13px; }

.detect-status {
  margin-top: 9px;
  min-height: 15px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--ink-faint);
}

.detect-status b { color: var(--ink-soft); font-weight: 600; }

.hint { display: flex; justify-content: space-between; margin-top: 4px; color: var(--ink-faint); font-size: 10.5px; }

.kbd { padding: 2px 6px; border: 1px solid var(--line); border-radius: 4px; font-family: var(--font-mono); }

#errorBox {
  display: none;
  margin-top: 13px;
  padding: 11px 13px;
  border: 1px solid var(--danger);
  border-radius: 8px;
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 12px;
  line-height: 1.5;
}

.result {
  display: none;
  margin-top: 16px;
  padding: 14px;
  border: 1px solid var(--success);
  border-radius: 8px;
  background: var(--success-soft);
}

.result-header { display: flex; align-items: center; gap: 11px; }

.result-text { flex: 1; min-width: 0; }

.result-icon {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: 7px;
  color: var(--success);
  background: var(--surface);
}

.result-icon svg { width: 17px; height: 17px; }

.result-title { font-size: 12px; font-weight: 700; }

.result-file {
  max-width: 100%;
  overflow: hidden;
  margin-top: 3px;
  color: var(--ink-soft);
  font-family: var(--font-mono);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.download {
  width: 100%;
  min-height: 40px;
  margin-top: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 6px;
  background: var(--ink);
  color: var(--paper);
  text-decoration: none;
  font-size: 12px;
  font-weight: 700;
}

.download:hover { filter: brightness(1.15); }

.download svg { width: 14px; height: 14px; }

/* ========================================================
   SECTIONS
======================================================== */

.section {
  max-width: 1120px;
  margin: 0 auto;
  padding: 32px 0;
  border-top: 1px solid var(--line);
}

.section-head { max-width: 560px; margin-bottom: 16px; }

.section-eyebrow {
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--brand);
  margin-bottom: 6px;
}

.section-head h2 {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -.01em;
}

.section-head p {
  margin-top: 6px;
  color: var(--ink-soft);
  font-size: 13.5px;
  line-height: 1.5;
}

/* ========================================================
   ABOUT TAB
======================================================== */

.about { display: none; }
.about.active { display: flex; flex-direction: column; justify-content: center; flex: 1; min-height: 0; }
.downloader.hidden { display: none; }

.about-card {
  max-width: 640px;
  margin: 0 auto;
  padding: 24px;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--surface);
}

.about-card h2 { font-family: var(--font-display); margin-bottom: 6px; font-size: 19px; letter-spacing: -.01em; }

.about-card > p { color: var(--ink-soft); font-size: 13px; line-height: 1.55; }

.about-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: 14px; }

.about-item { padding: 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); }

.about-item strong { display: block; margin-bottom: 3px; font-size: 11px; }

.about-item span { color: var(--ink-soft); font-size: 11px; line-height: 1.5; }

/* ========================================================
   FOOTER
======================================================== */

.footer { border-top: 1px solid var(--line); color: var(--ink-faint); font-size: 11px; background: var(--surface); }

.footer-inner {
  max-width: 1120px;
  margin: auto;
  padding: 14px 24px;
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 10px;
}

.footer-links { display: flex; gap: 16px; }

.footer-links a { text-decoration: none; color: var(--ink-faint); }
.footer-links a:hover { color: var(--ink-soft); }

/* ========================================================
   LOADING
======================================================== */

.spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, .4);
  border-top-color: var(--brand-ink);
  border-radius: 50%;
  animation: spin .65s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

/* ========================================================
   MOBILE
======================================================== */

@media (max-width: 880px) {
  .hero { grid-template-columns: 1fr; padding: 32px 0 28px; gap: 24px; }
  .about-grid { grid-template-columns: 1fr; }
}

@media (max-width: 560px) {
  .header-inner { padding: 14px 16px; }
  main { padding: 0 16px; }
  .card-body { padding: 16px; }
  .footer-inner { padding: 16px; flex-direction: column; align-items: flex-start; gap: 8px; }
  #extensionInput { font-size: 10.5px; }
}`;
}


function getSiteFooter() {
  return `<footer class="footer">

<div class="footer-inner">
<span>© 2026 ExtGrab. Not affiliated with Google, Microsoft, or Mozilla.</span>
<div class="footer-links">
<a href="/terms">Terms</a>
<a href="/privacy">Privacy</a>
<a href="/sitemap.xml">Sitemap</a>
</div>
</div>

</footer>`;
}

function getThemeScript() {
  return `(function initTheme() {
  const root = document.documentElement;
  const stored = localStorage.getItem("extgrab-theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = stored || (prefersDark ? "dark" : "light");
  root.setAttribute("data-theme", theme);
  document.getElementById("themeToggle") && document.getElementById("themeToggle").setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
})();

document.getElementById("themeToggle").addEventListener("click", function () {
  const root = document.documentElement;
  const current = root.getAttribute("data-theme") === "dark" ? "dark" : "light";
  const next = current === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", next);
  localStorage.setItem("extgrab-theme", next);
  this.setAttribute("aria-pressed", next === "dark" ? "true" : "false");
});`;
}

function getThemeToggleButton() {
  return `<button id="themeToggle" class="theme-toggle" type="button" aria-label="Switch color theme" aria-pressed="false">
<svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
  <circle cx="12" cy="12" r="4.2"/>
  <path d="M12 2.5v2.4M12 19.1v2.4M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7"/>
</svg>
<svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
  <path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a7 7 0 0 0 10.7 10.7Z"/>
</svg>
</button>`;
}

function getBrandLogo() {
  return `<a class="brand" href="/">

<div class="logo">
<svg viewBox="0 0 24 24" fill="none">
  <path d="M2.5,2.5 L8.9,2.5 A3.1,3.1 0 0 1 15.1,2.5 L21.5,2.5 L21.5,21.5 L2.5,21.5 L2.5,15.1 A3.1,3.1 0 0 0 2.5,8.9 Z" fill="currentColor"/>
</svg>
</div>

ExtGrab

</a>`;
}


function getHtml(requestUrl) {

  const origin =
    requestUrl && requestUrl.origin
      ? requestUrl.origin
      : "";

  const pageTitle =
    "ExtGrab — Download Chrome, Edge & Firefox Extension Packages (.crx / .xpi)";

  const pageDescription =
    "Download the .crx or .xpi package for any Chrome, Edge, or Firefox extension, straight from the official store.";

  return `<!DOCTYPE html>
<html lang="en">

<head>

<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="index, follow">
<meta name="author" content="ExtGrab">
<meta name="theme-color" content="#F6F7F5" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0B0D10" media="(prefers-color-scheme: dark)">

<title>${pageTitle}</title>
<meta name="description" content="${pageDescription}">
${origin ? `<link rel="canonical" href="${origin}/">` : ""}

<!-- Open Graph -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="ExtGrab">
<meta property="og:title" content="${pageTitle}">
<meta property="og:description" content="${pageDescription}">
${origin ? `<meta property="og:url" content="${origin}/">` : ""}

<!-- Twitter -->
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${pageTitle}">
<meta name="twitter:description" content="${pageDescription}">

<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#0F5FDB"/><path d="M2.5,2.5 L8.9,2.5 A3.1,3.1 0 0 1 15.1,2.5 L21.5,2.5 L21.5,21.5 L2.5,21.5 L2.5,15.1 A3.1,3.1 0 0 0 2.5,8.9 Z" fill="white"/></svg>'
  )}">

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "DeveloperApplication",
  "name": "ExtGrab",
  "description": ${JSON.stringify(pageDescription)},
  "applicationCategory": "DeveloperApplication",
  "operatingSystem": "Any",
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "USD"
  }
}
</script>

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">

<style>
${getSharedStyles()}
</style>

</head>


<body>

<a class="skip-link" href="#main-content">Skip to content</a>


<!-- ======================================================
     HEADER
====================================================== -->

<header class="header">

<div class="header-inner">

${getBrandLogo()}

<div class="header-right">

<nav class="nav" aria-label="Primary">
<button id="downloadTab" class="active" aria-current="page">Downloader</button>
<button id="aboutTab">About</button>
</nav>

${getThemeToggleButton()}

</div>

</div>

</header>


<!-- ======================================================
     MAIN
====================================================== -->

<main id="main-content">


<!-- ====================================================
     DOWNLOADER
==================================================== -->

<section id="downloader" class="downloader">

<div class="hero-wrap">
<div class="hero">

<div>

<div class="eyebrow">Browser extension downloader</div>

<h1>Download <em>.crx or .xpi</em> from extension stores.</h1>

<p class="hero-lede">
Paste a Chrome, Edge, or Firefox extension's store link — or just its ID — and ExtGrab fetches the installable package file directly, without installing anything in your browser.
</p>

<div class="trust-row">

<div class="trust-item">
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 12 4 4L19 6"/></svg>
Unmodified
</div>

<div class="trust-item">
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 12 4 4L19 6"/></svg>
No account
</div>

<div class="trust-item">
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 12 4 4L19 6"/></svg>
Nothing stored
</div>

</div>

</div>


<div class="card">

<div class="card-header">
<div class="card-title">Download an extension</div>
</div>

<div class="card-body">

<label class="label">Store</label>

<div class="stores">

<input type="radio" class="store-radio" name="storeType" id="storeEdge" value="edge" checked>
<label class="store" for="storeEdge">
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
  <path d="M21 12a9 9 0 0 1-16.9 4.1A8 8 0 0 0 20 11"/>
  <path d="M3.1 15.8A9 9 0 0 1 20.8 8"/>
  <path d="M20 11c-1.8-3.3-6.8-4.4-10.1-2.5"/>
</svg>
<span>Edge</span>
</label>

<input type="radio" class="store-radio" name="storeType" id="storeChrome" value="chrome">
<label class="store" for="storeChrome">
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
  <circle cx="12" cy="12" r="8.5"/>
  <circle cx="12" cy="12" r="3.2"/>
  <path d="M12 8.8h8.2"/>
</svg>
<span>Chrome</span>
</label>

<input type="radio" class="store-radio" name="storeType" id="storeFirefox" value="firefox">
<label class="store" for="storeFirefox">
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
  <path d="M18.5 5.5c-2.5-2.3-6.7-2.5-9.4-.5"/>
  <path d="M6.4 5.7C3.9 8 3.4 12 5 15.1"/>
  <path d="M5 15.1c1.7 3.3 5.5 5 9.1 4.1"/>
  <path d="M14.1 19.2c4-.8 6.4-4.7 5.2-8.5"/>
</svg>
<span>Firefox</span>
</label>

</div>


<label class="label">Format</label>

<div class="formats">

<input type="radio" class="format-radio" name="formatType" id="formatNative" value="native" checked>
<label class="format" for="formatNative">
<span>Native (.crx / .xpi)</span>
</label>

<input type="radio" class="format-radio" name="formatType" id="formatZip" value="zip">
<label class="format" for="formatZip">
<span>ZIP archive</span>
</label>

</div>


<form id="exportForm">

<label class="label" for="extensionInput">URL or identifier</label>

<div class="input">

<div class="input-icon">
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
  <path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/>
  <path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"/>
</svg>
</div>

<input id="extensionInput" type="text" placeholder="Paste a store URL or extension ID..." autocomplete="off" spellcheck="false" required aria-describedby="detectStatus">

<button id="submitBtn" class="submit" type="submit">
<span class="submit-label">Fetch</span>
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M12 3v13"/>
  <path d="m7 11 5 5 5-5"/>
  <path d="M5 21h14"/>
</svg>
</button>

</div>

<div id="detectStatus" class="detect-status" aria-live="polite"></div>

<div class="hint">
<span>Chrome / Edge ID · Firefox slug · full store URL</span>
<span><span class="kbd">Enter</span> to fetch</span>
</div>

</form>


<div id="errorBox" role="alert"></div>


<div id="result" class="result">

<div class="result-header">

<div class="result-icon">
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
  <path d="m5 12 4 4L19 6"/>
</svg>
</div>

<div class="result-text">
<div class="result-title">Package ready</div>
<div id="resultFile" class="result-file">extension.crx</div>
</div>

</div>

<a id="downloadLink" class="download">
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M12 3v13"/>
  <path d="m7 11 5 5 5-5"/>
  <path d="M5 21h14"/>
</svg>
Download package
</a>

</div>

</div>

</div>

</div>
</div>

</section>


<!-- ====================================================
     ABOUT
==================================================== -->

<section id="about" class="about section">

<div class="about-card">

<h2>Extension packages, fetched directly.</h2>

<p>
ExtGrab pulls extension packages from each vendor's own distribution endpoint.
</p>

<div class="about-grid">

<div class="about-item">
<strong>Google Chrome</strong>
<span>CRX via the Chrome Web Store.</span>
</div>

<div class="about-item">
<strong>Microsoft Edge</strong>
<span>CRX via Edge Add-ons.</span>
</div>

<div class="about-item">
<strong>Mozilla Firefox</strong>
<span>XPI via Mozilla AMO.</span>
</div>

<div class="about-item">
<strong>Cloudflare Workers</strong>
<span>Runs entirely at the edge.</span>
</div>

</div>

</div>

</section>


</main>


<footer class="footer">

<div class="footer-inner">
<span>© 2026 ExtGrab. Not affiliated with Google, Microsoft, or Mozilla.</span>
<div class="footer-links">
<a href="/terms">Terms</a>
<a href="/privacy">Privacy</a>
<a href="/sitemap.xml">Sitemap</a>
</div>
</div>

</footer>


<script>

/* ========================================================
   THEME
======================================================== */

${getThemeScript()}

/* ========================================================
   TAB SWITCHING
======================================================== */

const downloader = document.getElementById("downloader");
const about = document.getElementById("about");
const downloadTab = document.getElementById("downloadTab");
const aboutTab = document.getElementById("aboutTab");

downloadTab.addEventListener("click", function () {
  downloader.classList.remove("hidden");
  about.classList.remove("active");
  downloadTab.classList.add("active");
  downloadTab.setAttribute("aria-current", "page");
  aboutTab.classList.remove("active");
  aboutTab.removeAttribute("aria-current");
});

aboutTab.addEventListener("click", function () {
  downloader.classList.add("hidden");
  about.classList.add("active");
  downloadTab.classList.remove("active");
  downloadTab.removeAttribute("aria-current");
  aboutTab.classList.add("active");
  aboutTab.setAttribute("aria-current", "page");
});

/* ========================================================
   INPUT + LIVE STORE DETECTION
======================================================== */

const input = document.getElementById("extensionInput");
const detectStatus = document.getElementById("detectStatus");

function detectFromValue(value) {
  const lower = value.toLowerCase();

  if (lower.includes("chromewebstore.google.com") || lower.includes("chrome.google.com/webstore")) {
    return "chrome";
  }
  if (lower.includes("microsoftedge.microsoft.com")) {
    return "edge";
  }
  if (lower.includes("addons.mozilla.org")) {
    return "firefox";
  }
  if (/^[a-p]{32}$/i.test(value.trim()) || /\\b[a-p]{32}\\b/i.test(value.trim())) {
    return document.querySelector('input[name="storeType"]:checked').value;
  }
  return null;
}

const storeLabels = { chrome: "Chrome (.crx)", edge: "Edge (.crx)", firefox: "Firefox (.xpi)" };

input.addEventListener("input", function () {
  const value = input.value.trim();

  if (!value) {
    detectStatus.innerHTML = "";
    return;
  }

  const detected = detectFromValue(value);

  if (detected && (detected === "chrome" || detected === "edge" || detected === "firefox")) {
    const el = document.getElementById(detected === "chrome" ? "storeChrome" : detected === "edge" ? "storeEdge" : "storeFirefox");
    if (el) el.checked = true;
  }

  const active = document.querySelector('input[name="storeType"]:checked').value;
  detectStatus.innerHTML = "target: <b>" + (storeLabels[active] || active) + "</b>";
});

/* ========================================================
   DOWNLOAD FORM
======================================================== */

document.getElementById("exportForm").addEventListener("submit", async function (event) {
  event.preventDefault();

  const value = input.value.trim();
  if (!value) return;

  const btn = document.getElementById("submitBtn");
  const errorBox = document.getElementById("errorBox");
  const result = document.getElementById("result");
  const downloadLink = document.getElementById("downloadLink");
  const resultFile = document.getElementById("resultFile");

  let storeType = document.querySelector('input[name="storeType"]:checked').value;
  const detected = detectFromValue(value);
  if (detected) storeType = detected;

  const formatType = document.querySelector('input[name="formatType"]:checked').value;

  errorBox.style.display = "none";
  result.style.display = "none";
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span><span class="submit-label">Fetching...</span>';

  try {
    const response = await fetch(window.location.href, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extensionId: value, storeType: storeType, format: formatType })
    });

    if (!response.ok) {
      let message = "Download failed.";
      try {
        const data = await response.json();
        if (data.error) message = data.error;
        if (data.upstreamStatus) message += " Upstream status: " + data.upstreamStatus;
      } catch (_) {}
      throw new Error(message);
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);

    let filename =
      formatType === "zip"
        ? "extension.zip"
        : storeType === "firefox" ? "extension.xpi" : "extension.crx";
    const disposition = response.headers.get("Content-Disposition") || "";
    const filenameMatch = disposition.match(/filename="([^"]+)"/i);
    if (filenameMatch && filenameMatch[1]) filename = filenameMatch[1];

    resultFile.textContent = filename;
    downloadLink.href = objectUrl;
    downloadLink.download = filename;
    result.style.display = "block";

    downloadLink.onclick = function () {
      setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 60000);
    };

  } catch (error) {
    errorBox.textContent = error instanceof Error ? error.message : String(error);
    errorBox.style.display = "block";
  } finally {
    btn.disabled = false;
    btn.innerHTML =
      '<span class="submit-label">Fetch</span>' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
      '<path d="M12 3v13"/>' +
      '<path d="m7 11 5 5 5-5"/>' +
      '<path d="M5 21h14"/>' +
      '</svg>';
  }
});

/* ========================================================
   ENTER KEY
======================================================== */

input.addEventListener("keydown", function (event) {
  if (event.key === "Enter") {
    event.preventDefault();
    document.getElementById("exportForm").requestSubmit();
  }
});

</script>

</body>

</html>`;
}


/* =========================================================
   LEGAL PAGE SHELL (shared by Terms and Privacy)
========================================================= */

function getLegalPageStyles() {
  return `
.legal-page { max-width: 720px; margin: 0 auto; padding: 40px 24px 60px; }
.legal-page h1 { font-family: var(--font-display); font-size: 26px; letter-spacing: -.01em; margin-bottom: 6px; }
.legal-page .updated { font-family: var(--font-mono); font-size: 11px; color: var(--ink-faint); margin-bottom: 24px; }
.legal-page h2 { font-family: var(--font-display); font-size: 15px; margin: 24px 0 8px; }
.legal-page p { color: var(--ink-soft); font-size: 13.5px; line-height: 1.65; margin-bottom: 8px; }
.legal-page a.inline-link { color: var(--brand); text-decoration: underline; }
.back-link { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ink-faint); text-decoration: none; margin-bottom: 20px; }
.back-link:hover { color: var(--ink-soft); }`;
}

function getLegalPageShell(requestUrl, path, pageTitle, pageDescription, contentHtml) {

  const origin =
    requestUrl && requestUrl.origin
      ? requestUrl.origin
      : "";

  return `<!DOCTYPE html>
<html lang="en">

<head>

<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="index, follow">
<meta name="author" content="ExtGrab">
<meta name="theme-color" content="#F6F7F5" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0B0D10" media="(prefers-color-scheme: dark)">

<title>${pageTitle}</title>
<meta name="description" content="${pageDescription}">
${origin ? `<link rel="canonical" href="${origin}${path}">` : ""}

<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#0F5FDB"/><path d="M2.5,2.5 L8.9,2.5 A3.1,3.1 0 0 1 15.1,2.5 L21.5,2.5 L21.5,21.5 L2.5,21.5 L2.5,15.1 A3.1,3.1 0 0 0 2.5,8.9 Z" fill="white"/></svg>'
  )}">

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">

<style>
${getSharedStyles()}
${getLegalPageStyles()}
</style>

</head>


<body>

<a class="skip-link" href="#main-content">Skip to content</a>

<header class="header">
<div class="header-inner">
${getBrandLogo()}
<div class="header-right">
${getThemeToggleButton()}
</div>
</div>
</header>

<main id="main-content">
<div class="legal-page">

<a class="back-link" href="/">&larr; Back to ExtGrab</a>

${contentHtml}

</div>
</main>

${getSiteFooter()}

<script>
${getThemeScript()}
</script>

</body>

</html>`;
}


/* =========================================================
   TERMS OF USE
========================================================= */

function getTermsHtml(requestUrl) {

  const contentHtml = `<h1>Terms of Use</h1>
<div class="updated">Last updated August 2026</div>

<p>By using ExtGrab, you agree to these terms. If you don't agree, don't use the tool.</p>

<h2>What ExtGrab does</h2>
<p>ExtGrab retrieves .crx and .xpi extension packages from the Chrome Web Store, Microsoft Edge Add-ons, and Mozilla Add-ons (AMO) update endpoints and streams them to you unmodified. It doesn't build, repackage, or alter any file.</p>

<h2>Trademarks</h2>
<p>ExtGrab is an independent project and is not affiliated with, endorsed by, or sponsored by Google, Microsoft, or Mozilla. Chrome, the Chrome Web Store, Microsoft Edge, Firefox, and related logos are trademarks of their respective owners, used here only to identify which store a package comes from.</p>

<h2>Your responsibilities</h2>
<p>You're responsible for complying with the relevant store's own terms of service and with the license of the extension you download. Only download packages you have the right to access, install, inspect, or redistribute.</p>

<h2>No warranty</h2>
<p>ExtGrab is provided as-is, without warranty of any kind. Store endpoints can change or become unavailable without notice, and we don't guarantee uninterrupted access.</p>

<h2>Changes</h2>
<p>These terms may be updated from time to time. Continued use after a change means you accept the update.</p>

<p>See also our <a class="inline-link" href="/privacy">Privacy policy</a>.</p>`;

  return getLegalPageShell(
    requestUrl,
    "/terms",
    "Terms of Use — ExtGrab",
    "Terms for using ExtGrab to retrieve Chrome, Edge, and Firefox extension packages.",
    contentHtml
  );
}


/* =========================================================
   PRIVACY POLICY
========================================================= */

function getPrivacyHtml(requestUrl) {

  const contentHtml = `<h1>Privacy Policy</h1>
<div class="updated">Last updated August 2026</div>

<p>ExtGrab is built to need as little data about you as possible.</p>

<h2>What we don't do</h2>
<p>ExtGrab doesn't require an account or sign-in. It doesn't set tracking or analytics cookies, doesn't store the extension packages you download, and doesn't build a profile of your requests.</p>

<h2>What passes through the request</h2>
<p>When you submit a URL or extension ID, it's sent to the matching store's own update or download endpoint (Google, Microsoft, or Mozilla) to fetch the package, and streamed straight back to your browser. That request is not logged beyond what's needed to serve it and diagnose errors, and is not linked to an identity.</p>

<h2>Local storage</h2>
<p>Your light/dark theme preference is saved in your browser's local storage so the site remembers it on your next visit. Nothing is sent to a server for this.</p>

<h2>Third parties</h2>
<p>Requests are proxied to the official Chrome Web Store, Microsoft Edge Add-ons, and Mozilla Add-ons (AMO) endpoints, which are subject to their own respective privacy policies.</p>

<h2>Changes</h2>
<p>This policy may be updated from time to time. Material changes will be reflected on this page.</p>

<p>See also our <a class="inline-link" href="/terms">Terms of use</a>.</p>`;

  return getLegalPageShell(
    requestUrl,
    "/privacy",
    "Privacy Policy — ExtGrab",
    "How ExtGrab handles data when you use it to retrieve extension packages.",
    contentHtml
  );
}

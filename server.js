import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuid } from "uuid";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ====== 基本環境設定 ======
const PORT = process.env.PORT || 3000;

// 檔案儲存位置：預設為 ./public/uploads
const UPLOAD_DIR =
  process.env.UPLOAD_DIR || path.join(__dirname, "public", "uploads");

// 上傳 & 刪除時用的 Bearer Token
const TOKEN = process.env.UPLOAD_TOKEN || "";

// 檔案自動刪除時間（分鐘）：可用環境變數 MAX_AGE_MINUTES 控制
const MAX_AGE_MINUTES = parseInt(process.env.MAX_AGE_MINUTES || "10", 10);

// 清理檔案的檢查頻率（毫秒）──預設每 5 分鐘掃一次
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

// 對外網址（產出檔案 URL 用），可用 PUBLIC_BASE 覆寫
// 例如：https://zeabur-file-server.zeabur.app
const PUBLIC_BASE = process.env.PUBLIC_BASE || "";

// 確保上傳目錄存在
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ====== 驗證 Bearer Token Middleware ======
function requireBearer(req, res, next) {
  if (!TOKEN) {
    return res.status(500).json({ error: "UPLOAD_TOKEN not set" });
  }
  const h = req.headers.authorization || "";
  const ok = h.startsWith("Bearer ") && h.slice(7) === TOKEN;
  if (!ok) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// ====== 檔案型態設定：允許影片 + 圖片 ======
const ALLOWED_MIMES = {
  "video/mp4": ".mp4",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const orig = file.originalname || "file";
    let ext = path.extname(orig);

    // 如果原始檔名沒有副檔名，就依 mimetype 補上
    if (!ext && ALLOWED_MIMES[file.mimetype]) {
      ext = ALLOWED_MIMES[file.mimetype];
    }

    // 可由 body.name 指定檔名（不含奇怪字元）
    const wanted = (req.body?.name || "").trim();

    let safe;
    if (wanted && /^[\w\-\.]+$/.test(wanted)) {
      // 如果使用者有給自訂檔名，但沒附副檔名，就自動補上
      safe = ext ? wanted : `${wanted}${ext || ""}`;
    } else {
      safe = `${uuid()}${ext || ""}`;
    }

    cb(null, safe);
  },
});

const upload = multer({
  storage,
  limits: {
    // 影片 / 圖片都共用 500MB 上限
    fileSize: 500 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMES[file.mimetype]) cb(null, true);
    else cb(new Error("Only video/mp4 or image files (jpeg/png/webp) are allowed"));
  },
});

// ====== 靜態檔案服務：對外網址 /files/xxx 會對應到 UPLOAD_DIR 內的檔案 ======
app.use("/files", express.static(UPLOAD_DIR, { maxAge: "1h", etag: false }));

// ====== Health Check ======
app.get("/health", (_req, res) => res.json({ ok: true }));

// ====== 上傳 API ======
// n8n：影片 & 封面都呼叫這支 /upload
// - Form-Data Name: file
// - Parameter Type: n8n Binary File
// - Input Data Field Name: videoFile 或 thumb（後端不在乎）
app.post("/upload", requireBearer, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const filename = req.file.filename;

  // 若有 PUBLIC_BASE 就用環境變數；否則用實際請求的 host
  const base = PUBLIC_BASE || `${req.protocol}://${req.get("host")}`;
  const url = `${base}/files/${encodeURIComponent(filename)}`;

  res.json({
    url,
    filename,
    size: req.file.size,
    mimetype: req.file.mimetype,
  });
});

// ====== 手動刪除 API（保留給你不時之需） ======
app.delete("/files/:name", requireBearer, (req, res) => {
  const name = path.basename(req.params.name);
  const f = path.join(UPLOAD_DIR, name);

  fs.unlink(f, err => {
    if (err && err.code !== "ENOENT") {
      return res.status(500).json({ error: err.message });
    }
    res.json({ deleted: true, name });
  });
});

// ====== 自動清理舊檔案機制 ======
if (MAX_AGE_MINUTES > 0) {
  console.log(
    `🧹 Auto clean enabled. Files older than ${MAX_AGE_MINUTES} minutes will be removed every ${(CHECK_INTERVAL_MS / 60000).toFixed(
      1
    )} minutes.`
  );

  setInterval(() => {
    const now = Date.now();

    fs.readdir(UPLOAD_DIR, (err, files) => {
      if (err) {
        console.error("Failed to read UPLOAD_DIR:", err.message);
        return;
      }

      files.forEach(file => {
        const full = path.join(UPLOAD_DIR, file);

        fs.stat(full, (err, stats) => {
          if (err) return;

          // 只處理檔案
          if (!stats.isFile()) return;

          const ageMinutes = (now - stats.mtimeMs) / 1000 / 60;

          if (ageMinutes > MAX_AGE_MINUTES) {
            fs.unlink(full, err => {
              if (err && err.code !== "ENOENT") {
                console.error("Failed to delete:", full, err.message);
              } else {
                console.log(
                  `🗑 Deleted ${file} (age: ${ageMinutes.toFixed(1)} mins)`
                );
              }
            });
          }
        });
      });
    });
  }, CHECK_INTERVAL_MS);
} else {
  console.log("⚠️ Auto clean disabled (MAX_AGE_MINUTES <= 0).");
}

// ====== 啟動服務 ======
app.listen(PORT, () => {
  console.log(`🚀 File server listening on port ${PORT}`);
});

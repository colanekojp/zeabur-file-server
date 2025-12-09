import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuid } from "uuid";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "public", "uploads");
const TOKEN = process.env.UPLOAD_TOKEN || "";

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function requireBearer(req, res, next) {
  if (!TOKEN) return res.status(500).json({ error: "UPLOAD_TOKEN not set" });
  const h = req.headers.authorization || "";
  const ok = h.startsWith("Bearer ") && h.slice(7) === TOKEN;
  if (!ok) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// 可接受的檔案類型（影片 + 圖片）
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
    // 盡量用上傳檔案自己的副檔名
    let ext = path.extname(orig);

    // 如果原檔名沒副檔名，就用 mimetype 補一個
    if (!ext && ALLOWED_MIMES[file.mimetype]) {
      ext = ALLOWED_MIMES[file.mimetype];
    }

    const wanted = (req.body.name || "").trim();

    // 允許你從外部指定檔名（不含奇怪字元）
    const safe =
      wanted && /^[\w\-\.]+$/.test(wanted)
        ? (ext ? wanted : `${wanted}${ext}`)
        : `${uuid()}${ext || ""}`;

    cb(null, safe);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 影片限制 500MB，圖片也一起用這個上限
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMES[file.mimetype]) {
      cb(null, true);
    } else {
      cb(new Error("Only video/mp4 or image files (jpeg/png/webp) are allowed"));
    }
  },
});

app.use("/files", express.static(UPLOAD_DIR, { maxAge: "1h", etag: false }));

app.get("/health", (_req, res) => res.json({ ok: true }));

// 這裡不用改，影片 / 封面都走同一支 /upload
app.post("/upload", requireBearer, upload.single("file"), (req, res) => {
  const filename = req.file.filename;
  const host = process.env.PUBLIC_BASE || `${req.protocol}://${req.get("host")}`;
  const url = `${host}/files/${encodeURIComponent(filename)}`;
  res.json({ url, filename, size: req.file.size, mimetype: req.file.mimetype });
});

app.delete("/files/:name", requireBearer, (req, res) => {
  const f = path.join(UPLOAD_DIR, path.basename(req.params.name));
  fs.unlink(f, err => {
    if (err && err.code !== "ENOENT") return res.status(500).json({ error: err.message });
    res.json({ deleted: true, name: path.basename(req.params.name) });
  });
});

app.listen(PORT, () => console.log(`File server on :${PORT}`));

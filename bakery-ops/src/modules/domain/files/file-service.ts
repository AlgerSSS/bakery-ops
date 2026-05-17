import { v4 as uuidv4 } from "uuid";
import type { OutputFile } from "../../shared/types";
import { logger } from "../../shared/logger";
import * as fs from "fs";
import * as path from "path";

const UPLOAD_DIR = process.env.FILE_UPLOAD_DIR || "./uploads";

export class FileService {
  constructor() {
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }
  }

  async saveFile(buffer: Buffer, fileName: string, mimeType: string): Promise<OutputFile> {
    const fileId = uuidv4();
    const ext = path.extname(fileName);
    const storedName = `${fileId}${ext}`;
    const filePath = path.join(UPLOAD_DIR, storedName);

    fs.writeFileSync(filePath, buffer);

    const file: OutputFile = {
      fileId,
      fileName,
      mimeType,
      url: `/api/files/${fileId}`,
      size: buffer.length,
    };

    logger.info("File saved", { fileId, fileName, size: buffer.length });
    return file;
  }

  getFilePath(fileId: string): string | null {
    const files = fs.readdirSync(UPLOAD_DIR);
    const match = files.find((f) => f.startsWith(fileId));
    if (!match) return null;
    return path.join(UPLOAD_DIR, match);
  }

  getAbsoluteUrl(fileId: string): string {
    const baseUrl = process.env.STORAGE_PUBLIC_BASE_URL || "http://localhost:3000";
    return `${baseUrl}/api/files/${fileId}`;
  }
}

export const fileService = new FileService();

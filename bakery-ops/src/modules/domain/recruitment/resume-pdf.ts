import PDFDocument from "pdfkit";
import type { ParsedJD, ScoredCandidate } from "./types";
import { fileService } from "../files/file-service";
import type { OutputFile } from "../../shared/types";
import { logger } from "../../shared/logger";

/**
 * 生成候选人 PDF 报告
 */
export async function generateCandidatePdf(
  jd: ParsedJD,
  candidates: ScoredCandidate[],
): Promise<OutputFile> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", async () => {
      try {
        const buffer = Buffer.concat(chunks);
        const fileName = `candidates_${jd.jobTitle.replace(/\s+/g, "_")}_${Date.now()}.pdf`;
        const file = await fileService.saveFile(buffer, fileName, "application/pdf");
        logger.info("Candidate PDF generated", { fileName, size: buffer.length });
        resolve(file);
      } catch (err) {
        reject(err);
      }
    });
    doc.on("error", reject);

    // --- PDF 内容 ---

    // 标题
    doc.fontSize(18).text("候选人匹配报告", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor("#666")
      .text(`生成时间: ${new Date().toLocaleString("zh-CN")}`, { align: "center" });
    doc.moveDown(1);

    // 岗位信息
    doc.fontSize(14).fillColor("#000").text("岗位信息");
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor("#333");
    doc.text(`岗位: ${jd.jobTitle}`);
    doc.text(`地点: ${jd.location}`);
    doc.text(`要求: ${jd.requirements.join(", ") || "无"}`);
    doc.text(`语言: ${jd.languageRequirements.join(", ") || "无"}`);
    doc.text(`经验: ${jd.experienceYears} 年`);
    doc.moveDown(1);

    // 分隔线
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke("#ccc");
    doc.moveDown(0.5);

    // 候选人列表
    doc.fontSize(14).fillColor("#000").text(`Top ${candidates.length} 候选人`);
    doc.moveDown(0.5);

    candidates.forEach((c, i) => {
      // 检查是否需要新页
      if (doc.y > 680) {
        doc.addPage();
      }

      // 候选人编号和分数
      doc.fontSize(12).fillColor("#000")
        .text(`#${i + 1}  ${c.name}`, { continued: true });
      doc.fillColor(getScoreColor(c.matchScore))
        .text(`  匹配度: ${c.matchScore}/100`, { align: "right" });
      doc.moveDown(0.2);

      // 详细信息
      doc.fontSize(9).fillColor("#555");
      if (c.currentTitle) doc.text(`职位: ${c.currentTitle}`);
      if (c.location) doc.text(`地点: ${c.location}`);
      if (c.skills.length > 0) doc.text(`技能: ${c.skills.join(", ")}`);
      if (c.scoreReason) doc.text(`匹配原因: ${c.scoreReason}`);

      // 分数明细
      doc.fontSize(8).fillColor("#888");
      const bd = c.scoreBreakdown;
      doc.text(
        `技能:${bd.skillMatch} | 经验:${bd.experienceMatch} | 地点:${bd.locationMatch} | 语言:${bd.languageMatch}`,
      );

      if (c.sourceUrl) {
        doc.fontSize(8).fillColor("#0066cc").text(`来源: ${c.source} - ${c.sourceUrl}`);
      }

      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke("#eee");
      doc.moveDown(0.3);
    });

    doc.end();
  });
}

function getScoreColor(score: number): string {
  if (score >= 80) return "#22c55e";
  if (score >= 60) return "#f59e0b";
  return "#ef4444";
}

/**
 * 为单个候选人生成简历 PDF（从 Talent Search profile 数据）
 */
export async function generateCandidateResumePdf(
  candidate: ScoredCandidate,
): Promise<OutputFile> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", async () => {
      try {
        const buffer = Buffer.concat(chunks);
        const safeName = candidate.name.replace(/\s+/g, "_").replace(/[^\w-]/g, "");
        const fileName = `resume_${safeName}_${Date.now()}.pdf`;
        const file = await fileService.saveFile(buffer, fileName, "application/pdf");
        logger.info("Candidate resume PDF generated", { name: candidate.name, fileName });
        resolve(file);
      } catch (err) {
        reject(err);
      }
    });
    doc.on("error", reject);

    // --- 简历 PDF 内容 ---

    // 姓名
    doc.fontSize(22).fillColor("#000").text(candidate.name, { align: "center" });
    doc.moveDown(0.3);

    // 基本信息行
    const infoParts: string[] = [];
    if (candidate.currentTitle) infoParts.push(candidate.currentTitle);
    if (candidate.location) infoParts.push(candidate.location);
    if (infoParts.length > 0) {
      doc.fontSize(11).fillColor("#555").text(infoParts.join("  |  "), { align: "center" });
    }
    doc.moveDown(0.3);

    // 匹配度
    doc.fontSize(10).fillColor(getScoreColor(candidate.matchScore))
      .text(`Match Score: ${candidate.matchScore}/100`, { align: "center" });
    if (candidate.scoreReason) {
      doc.fontSize(9).fillColor("#888").text(candidate.scoreReason, { align: "center" });
    }
    doc.moveDown(0.5);

    // 来源链接
    if (candidate.sourceUrl) {
      doc.fontSize(8).fillColor("#0066cc").text(`Profile: ${candidate.sourceUrl}`, { align: "center" });
      doc.moveDown(0.5);
    }

    // 分隔线
    drawLine(doc);
    doc.moveDown(0.5);

    // 个人简介
    if (candidate.summary) {
      sectionTitle(doc, "Summary");
      doc.fontSize(10).fillColor("#333").text(candidate.summary);
      doc.moveDown(0.5);
    }

    // 技能
    if (candidate.skills.length > 0) {
      sectionTitle(doc, "Skills");
      doc.fontSize(10).fillColor("#333").text(candidate.skills.join("  •  "));
      doc.moveDown(0.5);
    }

    // 语言
    if (candidate.languages.length > 0) {
      sectionTitle(doc, "Languages");
      doc.fontSize(10).fillColor("#333").text(candidate.languages.join("  •  "));
      doc.moveDown(0.5);
    }

    // 工作经历
    if (candidate.experience) {
      sectionTitle(doc, "Work Experience");
      const entries = candidate.experience.split("; ");
      for (const entry of entries) {
        if (doc.y > 720) doc.addPage();
        doc.fontSize(10).fillColor("#333").text(`•  ${entry}`);
        doc.moveDown(0.2);
      }
      doc.moveDown(0.3);
    }

    // 教育
    if (candidate.education) {
      sectionTitle(doc, "Education");
      const entries = candidate.education.split("; ");
      for (const entry of entries) {
        doc.fontSize(10).fillColor("#333").text(`•  ${entry}`);
        doc.moveDown(0.2);
      }
      doc.moveDown(0.3);
    }

    // 页脚
    doc.moveDown(1);
    drawLine(doc);
    doc.moveDown(0.3);
    doc.fontSize(8).fillColor("#aaa")
      .text(`Generated: ${new Date().toLocaleString("zh-CN")}  |  Source: ${candidate.source}`, { align: "center" });

    doc.end();
  });
}

function sectionTitle(doc: PDFKit.PDFDocument, title: string) {
  doc.fontSize(13).fillColor("#1a1a1a").text(title);
  doc.moveDown(0.2);
}

function drawLine(doc: PDFKit.PDFDocument) {
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke("#ddd");
}

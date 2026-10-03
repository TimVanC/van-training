import type { ChatAttachment } from '../types/onboarding';

/** Longest image edge sent to the coach; larger images gain nothing but bytes. */
const MAX_IMAGE_EDGE = 1568;
const MAX_PDF_BYTES = 3 * 1024 * 1024;
const MAX_TEXT_CHARS = 150_000;

/** What the file picker offers. Anything else is still tried as plain text. */
export const ATTACHMENT_ACCEPT =
  'image/*,application/pdf,.pdf,.csv,.tsv,.txt,.md,.json,.xlsx,text/plain,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export class AttachmentError extends Error {}

function extension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function base64Of(dataUrl: string): string {
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

/** Downscale to a JPEG the API accepts; also normalizes HEIC where the browser can decode it. */
async function imageAttachment(file: File): Promise<ChatAttachment> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new AttachmentError(`Couldn't open ${file.name}. Try a screenshot instead.`);
  }
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new AttachmentError(`Couldn't open ${file.name}.`);
  // White backing so transparent PNG screenshots don't turn black as JPEG.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return {
    kind: 'image',
    name: file.name,
    mediaType: 'image/jpeg',
    data: base64Of(canvas.toDataURL('image/jpeg', 0.85)),
  };
}

function cellText(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).replace(/[\t\r\n]+/g, ' ').trim();
}

/** Every sheet of a workbook as tab-separated text, blank rows dropped. */
async function workbookAttachment(file: File): Promise<ChatAttachment> {
  const { default: readXlsxFile } = await import('read-excel-file/browser');
  let sheets: Awaited<ReturnType<typeof readXlsxFile>>;
  try {
    sheets = await readXlsxFile(file);
  } catch {
    throw new AttachmentError(`Couldn't read ${file.name}. Export it as CSV or send a screenshot.`);
  }
  const text = sheets
    .map(({ sheet, data }) => {
      const rows = data
        .map((row) => row.map(cellText).join('\t').replace(/\t+$/, ''))
        .filter((line) => line.trim().length > 0);
      return `## Sheet: ${sheet}\n${rows.join('\n')}`;
    })
    .join('\n\n');
  return textAttachment(file.name, text);
}

function textAttachment(name: string, text: string): ChatAttachment {
  if (text.trim().length === 0) throw new AttachmentError(`${name} looks empty.`);
  if (text.length > MAX_TEXT_CHARS) {
    throw new AttachmentError(`${name} is too long to read in one go. Send just the part with your program.`);
  }
  return { kind: 'text', name, text };
}

/** Turn a picked file into something the coach can read, or explain why not. */
export async function fileToAttachment(file: File): Promise<ChatAttachment> {
  const ext = extension(file.name);

  if (file.type.startsWith('image/') || ['heic', 'heif'].includes(ext)) return imageAttachment(file);

  if (file.type === 'application/pdf' || ext === 'pdf') {
    if (file.size > MAX_PDF_BYTES) {
      throw new AttachmentError(`${file.name} is too large. Send the pages with your program, or a screenshot.`);
    }
    return { kind: 'pdf', name: file.name, data: base64Of(await readAsDataUrl(file)) };
  }

  if (ext === 'xlsx') return workbookAttachment(file);

  if (['xls', 'numbers', 'doc', 'docx', 'pages'].includes(ext)) {
    throw new AttachmentError(`Can't read .${ext} files yet. Export as PDF or CSV, or send a screenshot.`);
  }

  const text = await file.text();
  // Binary files decode with NUL/replacement characters; don't pass that off as text.
  const head = text.slice(0, 2000);
  if (head.includes('\0') || head.includes('�')) {
    throw new AttachmentError(`Can't read ${file.name}. Send a screenshot, PDF, spreadsheet or text file.`);
  }
  return textAttachment(file.name, text);
}

import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const WINDOWS_CLIPBOARD_MAX_IMAGE_BYTES = 50 * 1024 * 1024;

export function isPngBuffer(value) {
  return Buffer.isBuffer(value) && value.length >= pngSignature.length && value.subarray(0, pngSignature.length).equals(pngSignature);
}

function runPowerShell(script, imagePath) {
  const encodedCommand = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-STA',
      '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', encodedCommand,
    ], {
      env: { ...process.env, ECHO_AI_CLIPBOARD_IMAGE: imagePath },
      timeout: 15_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (!error) return resolve();
      const detail = String(stderr || stdout || error.message || '').trim();
      reject(new Error(detail ? `Windows 剪贴板写入失败：${detail}` : 'Windows 剪贴板写入失败'));
    });
  });
}

const clipboardScript = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bytes = [System.IO.File]::ReadAllBytes($env:ECHO_AI_CLIPBOARD_IMAGE)
$sourceStream = [System.IO.MemoryStream]::new($bytes)
$pngStream = [System.IO.MemoryStream]::new($bytes)
$mimePngStream = [System.IO.MemoryStream]::new($bytes)
try {
  $source = [System.Drawing.Image]::FromStream($sourceStream, $true, $true)
  try {
    # Keep an explicit 32-bit ARGB compatibility bitmap for applications that
    # only understand the legacy Bitmap clipboard format.
    $bitmap = [System.Drawing.Bitmap]::new(
      $source.Width,
      $source.Height,
      [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.DrawImageUnscaled($source, 0, 0)
      } finally {
        $graphics.Dispose()
      }

      # Clipboard.SetImage only publishes a legacy DIB and can flatten PNG
      # transparency in consuming applications. Publish the untouched PNG
      # bytes as well; PNG-aware applications then receive the original RGBA.
      $data = [System.Windows.Forms.DataObject]::new()
      $data.SetData('PNG', $false, $pngStream)
      $data.SetData('image/png', $false, $mimePngStream)
      $data.SetData([System.Windows.Forms.DataFormats]::Bitmap, $true, $bitmap)
      [System.Windows.Forms.Clipboard]::SetDataObject($data, $true, 5, 120)
    } finally { $bitmap.Dispose() }
  } finally { $source.Dispose() }
} finally {
  $mimePngStream.Dispose()
  $pngStream.Dispose()
  $sourceStream.Dispose()
}
`;

export async function writePngToWindowsClipboard(buffer, options = {}) {
  if ((options.platform || process.platform) !== 'win32') throw Object.assign(new Error('本机剪贴板兜底仅支持 Windows'), { status: 501 });
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw Object.assign(new Error('没有收到可复制的图片'), { status: 400 });
  if (buffer.length > WINDOWS_CLIPBOARD_MAX_IMAGE_BYTES) throw Object.assign(new Error('复制到剪贴板的图片不能超过 50MB'), { status: 413 });
  if (!isPngBuffer(buffer)) throw Object.assign(new Error('系统剪贴板只接受有效的 PNG 图片'), { status: 415 });

  const imagePath = path.join(os.tmpdir(), `echo-ai-clipboard-${crypto.randomUUID()}.png`);
  await fs.promises.writeFile(imagePath, buffer, { flag: 'wx' });
  try {
    await (options.runner || runPowerShell)(clipboardScript, imagePath);
  } finally {
    await fs.promises.unlink(imagePath).catch(() => {});
  }
}

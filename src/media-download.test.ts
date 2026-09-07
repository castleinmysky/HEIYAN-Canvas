import { describe, expect, it } from 'vitest';
import { nodeResourceDownloadFileName, videoDownloadFileName } from './media-download';

describe('node resource download names', () => {
  it('numbers multi-output downloads using the renamed node, not the provider filename', () => {
    expect(nodeResourceDownloadFileName('海报定稿', 'openai-1.webp', 'blob:fixture', 'image', { index: 1, count: 4 })).toBe('海报定稿_02.webp');
    expect(nodeResourceDownloadFileName('镜头一', 'remote-task.mp4', 'blob:fixture', 'video')).toBe('镜头一.mp4');
  });
  it('uses the current node title while preserving the real file extension', () => {
    expect(nodeResourceDownloadFileName('角色海报', 'output_001.webp', '/api/files/asset', 'image')).toBe('角色海报.webp');
    expect(nodeResourceDownloadFileName('成片 A', 'render.mov', '/api/files/asset', 'video')).toBe('成片 A.mov');
    expect(nodeResourceDownloadFileName('角色模型', 'mesh.fbx', '/api/files/asset', 'model')).toBe('角色模型.fbx');
  });

  it('does not duplicate an extension typed into the node title', () => {
    expect(nodeResourceDownloadFileName('片段 A.mp4', 'original.mp4', undefined, 'video')).toBe('片段 A.mp4');
  });

  it('sanitizes platform-invalid characters and keeps version dots', () => {
    expect(nodeResourceDownloadFileName('章节 1.2 / 终稿:*?', 'voice.wav', undefined, 'audio')).toBe('章节 1.2 - 终稿---.wav');
  });

  it('keeps the source name when a node title is unavailable', () => {
    expect(nodeResourceDownloadFileName(undefined, 'source image.png', undefined, 'image')).toBe('source image.png');
    expect(videoDownloadFileName(undefined, undefined, 'https://example.com/render.webm?token=1')).toBe('render.webm');
  });
});

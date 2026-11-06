import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ArtifactStorageService } from '../../src/backend/storage/artifactStorage.js';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

describe('ArtifactStorageService', () => {
  const testRoot = path.join(process.cwd(), 'tests', 'fixtures', 'storage-test');
  let storage: ArtifactStorageService;

  beforeEach(async () => {
    await fs.mkdir(testRoot, { recursive: true });
    storage = new ArtifactStorageService(testRoot);
  });

  afterEach(async () => {
    await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {});
  });

  it('calculates SHA-256 correctly', () => {
    const data = 'Hello, Time Machine!';
    const sha = storage.computeSha256(data);
    expect(sha).toBe('845732a02691f9c21938241b328df9852529f3721a64df42afcf816cbb72e504');
  });

  it('detects and blocks path traversal attempts', () => {
    expect(() => {
      storage.assertSafePath('../../../etc/passwd');
    }).toThrow(/Path traversal attempt detected/);

    expect(() => {
      storage.assertSafePath('pages/../../secret.txt');
    }).toThrow(/Path traversal attempt detected/);
  });

  it('saves and verifies run artifacts atomically', async () => {
    const pageId = uuidv4();
    const runId = uuidv4();
    const markdownContent = '# Pricing Page\n\nPlan A: $10';
    const screenshotBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG signature
    const originalResponse = { status: 'success', raw: 'data' };

    const manifest = await storage.saveRunArtifacts({
      pageId,
      runId,
      content: markdownContent,
      screenshot: screenshotBuffer,
      originalResponse,
    });

    expect(manifest.pageId).toBe(pageId);
    expect(manifest.runId).toBe(runId);
    expect(manifest.files.content).toBeDefined();
    expect(manifest.files.screenshot).toBeDefined();
    expect(manifest.files.originalResponse).toBeDefined();

    // Verify content artifact
    const contentVer = await storage.verifyArtifact(manifest.files.content!.path, manifest.files.content!.sha256);
    expect(contentVer.exists).toBe(true);
    expect(contentVer.valid).toBe(true);
    expect(contentVer.size).toBe(Buffer.byteLength(markdownContent));

    // Verify screenshot artifact
    const shotVer = await storage.verifyArtifact(manifest.files.screenshot!.path, manifest.files.screenshot!.sha256);
    expect(shotVer.exists).toBe(true);
    expect(shotVer.valid).toBe(true);
    expect(shotVer.size).toBe(screenshotBuffer.length);
  });

  it('saves and verifies version artifacts', async () => {
    const pageId = uuidv4();
    const runId = uuidv4();
    const snapshot = '# Terms of Service\n\nVersion 1';
    const screenshot = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const manifest = await storage.saveVersionArtifacts({
      pageId,
      versionNumber: 1,
      snapshot,
      screenshot,
      sourceRunId: runId,
      diffJson: { added: [], removed: [], modified: [] },
    });

    expect(manifest.versionNumber).toBe(1);
    expect(manifest.sourceRunId).toBe(runId);
    expect(manifest.files.snapshot).toBeDefined();
    expect(manifest.files.screenshot).toBeDefined();
    expect(manifest.files.diff).toBeDefined();

    // Verify read
    const readSnapshot = await storage.readArtifact(manifest.files.snapshot.path);
    expect(readSnapshot.toString('utf-8')).toBe(snapshot);
  });

  it('reports invalid on checksum mismatch', async () => {
    const pageId = uuidv4();
    const runId = uuidv4();
    const manifest = await storage.saveRunArtifacts({
      pageId,
      runId,
      content: 'Sample content',
    });

    const verification = await storage.verifyArtifact(manifest.files.content!.path, 'invalidchecksum0000000000000000000000000000000000000000000000000000');
    expect(verification.exists).toBe(true);
    expect(verification.valid).toBe(false);
    expect(verification.error).toContain('Checksum mismatch');
  });

  it('reports non-existent artifact properly', async () => {
    const verification = await storage.verifyArtifact('pages/nonexistent/run.json');
    expect(verification.exists).toBe(false);
    expect(verification.valid).toBe(false);
  });
});

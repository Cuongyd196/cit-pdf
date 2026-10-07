import { describe, it, expect, vi } from 'vitest';

interface MockMsgData {
  subject?: string;
  senderName?: string;
  senderEmail?: string;
  body?: string;
  bodyHtml?: string;
  messageDeliveryTime?: string;
  clientSubmitTime?: string;
  recipients?: Array<{
    name?: string;
    email?: string;
    recipType?: string | number;
  }>;
  attachments?: Array<{
    fileName?: string;
    name?: string;
    content?: Uint8Array;
    mimeType?: string;
    pidContentId?: string;
  }>;
}

const { mockState } = vi.hoisted(() => ({
  mockState: { data: {} as MockMsgData },
}));

vi.mock('@kenjiuno/msgreader', () => {
  class MockMsgReader {
    constructor(_buffer: ArrayBuffer) {}
    getFileData() {
      return mockState.data;
    }
  }
  // Simulate the wrapped CJS interop shape that caused the original bug
  // (`MsgReader is not a constructor`). The fix in email-to-pdf.ts unwraps it.
  return { default: { default: MockMsgReader } };
});

import { parseEmlFile, parseMsgFile } from '@/js/logic/email-to-pdf';

function setMockMsgData(data: MockMsgData) {
  mockState.data = data;
}

function makeEmlFile(content: string, name = 'test.eml'): File {
  return new File([content], name, { type: 'message/rfc822' });
}

function makeMsgFile(name = 'test.msg'): File {
  return new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])], name, {
    type: 'application/vnd.ms-outlook',
  });
}

describe('parseEmlFile', () => {
  it('parses subject, from and to', async () => {
    const eml = [
      'From: Alice <alice@example.com>',
      'To: Bob <bob@example.com>',
      'Subject: Hello world',
      'Date: Mon, 5 May 2025 10:00:00 +0000',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Body content',
      '',
    ].join('\r\n');

    const result = await parseEmlFile(makeEmlFile(eml));

    expect(result.subject).toBe('Hello world');
    expect(result.from).toContain('alice@example.com');
    expect(result.from).toContain('Alice');
    expect(result.to).toEqual(
      expect.arrayContaining([expect.stringContaining('bob@example.com')])
    );
  });

  it('categorises CC and BCC recipients separately from To', async () => {
    const eml = [
      'From: Alice <alice@example.com>',
      'To: Bob <bob@example.com>',
      'Cc: Carol <carol@example.com>',
      'Bcc: Dave <dave@example.com>',
      'Subject: Categorised',
      'Content-Type: text/plain',
      '',
      'Body',
      '',
    ].join('\r\n');

    const result = await parseEmlFile(makeEmlFile(eml));

    expect(result.to.some((r) => r.includes('bob@example.com'))).toBe(true);
    expect(result.cc.some((r) => r.includes('carol@example.com'))).toBe(true);
    expect(result.bcc.some((r) => r.includes('dave@example.com'))).toBe(true);
    expect(result.to.some((r) => r.includes('carol@'))).toBe(false);
    expect(result.cc.some((r) => r.includes('bob@'))).toBe(false);
  });

  it('falls back to "(No Subject)" when subject header is missing', async () => {
    const eml = [
      'From: alice@example.com',
      'To: bob@example.com',
      'Content-Type: text/plain',
      '',
      'No subject here',
      '',
    ].join('\r\n');

    const result = await parseEmlFile(makeEmlFile(eml));
    expect(result.subject).toBe('(No Subject)');
  });

  it('preserves raw date string from header and parses it into a Date', async () => {
    const eml = [
      'From: alice@example.com',
      'To: bob@example.com',
      'Subject: Dated',
      'Date: Tue, 6 May 2025 14:30:00 +0000',
      'Content-Type: text/plain',
      '',
      'Body',
      '',
    ].join('\r\n');

    const result = await parseEmlFile(makeEmlFile(eml));
    expect(result.rawDateString).toBe('Tue, 6 May 2025 14:30:00 +0000');
    expect(result.date).toBeInstanceOf(Date);
    expect(result.date?.getUTCFullYear()).toBe(2025);
    expect(result.date?.getUTCMonth()).toBe(4);
    expect(result.date?.getUTCDate()).toBe(6);
  });

  it('returns null date when Date header is absent', async () => {
    const eml = [
      'From: alice@example.com',
      'To: bob@example.com',
      'Subject: No date',
      'Content-Type: text/plain',
      '',
      'Body',
      '',
    ].join('\r\n');

    const result = await parseEmlFile(makeEmlFile(eml));
    expect(result.date).toBeNull();
    expect(result.rawDateString).toBe('');
  });

  it('extracts plain text body and html body separately', async () => {
    const boundary = 'BOUNDARY123';
    const eml = [
      'From: alice@example.com',
      'To: bob@example.com',
      'Subject: Multipart',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      'plain text body',
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>html body</p>',
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const result = await parseEmlFile(makeEmlFile(eml));
    expect(result.textBody).toContain('plain text body');
    expect(result.htmlBody).toContain('<p>html body</p>');
  });

  it('returns "Unknown Sender" when From header is missing', async () => {
    const eml = [
      'To: bob@example.com',
      'Subject: Anonymous',
      'Content-Type: text/plain',
      '',
      'Body',
      '',
    ].join('\r\n');

    const result = await parseEmlFile(makeEmlFile(eml));
    expect(result.from).toBe('Unknown Sender');
  });
});

describe('parseMsgFile', () => {
  it('does not throw "MsgReader is not a constructor" — interop unwrap regression test', async () => {
    setMockMsgData({
      subject: 'Hi',
      senderName: 'Alice',
      senderEmail: 'alice@example.com',
      body: 'hello',
      recipients: [],
    });
    await expect(parseMsgFile(makeMsgFile())).resolves.toBeDefined();
  });

  it('extracts subject, sender, and body from msg data', async () => {
    setMockMsgData({
      subject: 'Test Subject',
      senderName: 'Alice Sender',
      senderEmail: 'alice@example.com',
      body: 'plain body',
      bodyHtml: '<p>html body</p>',
      recipients: [{ name: 'Bob', email: 'bob@example.com', recipType: 'to' }],
    });

    const result = await parseMsgFile(makeMsgFile());

    expect(result.subject).toBe('Test Subject');
    expect(result.from).toContain('Alice Sender');
    expect(result.from).toContain('alice@example.com');
    expect(result.textBody).toBe('plain body');
    expect(result.htmlBody).toBe('<p>html body</p>');
    expect(result.to[0]).toContain('bob@example.com');
  });

  it('categorises recipients by recipType string and numeric codes', async () => {
    setMockMsgData({
      subject: 'Routing test',
      senderName: 'Alice',
      senderEmail: 'alice@example.com',
      recipients: [
        { name: 'To1', email: 'to1@example.com', recipType: 'to' },
        { name: 'To2', email: 'to2@example.com', recipType: '1' },
        { name: 'Cc1', email: 'cc1@example.com', recipType: 'cc' },
        { name: 'Cc2', email: 'cc2@example.com', recipType: 2 },
        { name: 'Bcc1', email: 'bcc1@example.com', recipType: 'bcc' },
        { name: 'Bcc2', email: 'bcc2@example.com', recipType: 3 },
      ],
    });

    const result = await parseMsgFile(makeMsgFile());

    expect(result.to.some((r) => r.includes('to1@'))).toBe(true);
    expect(result.to.some((r) => r.includes('to2@'))).toBe(true);
    expect(result.cc.some((r) => r.includes('cc1@'))).toBe(true);
    expect(result.cc.some((r) => r.includes('cc2@'))).toBe(true);
    expect(result.bcc.some((r) => r.includes('bcc1@'))).toBe(true);
    expect(result.bcc.some((r) => r.includes('bcc2@'))).toBe(true);
    expect(result.to.some((r) => r.includes('cc1@'))).toBe(false);
    expect(result.cc.some((r) => r.includes('bcc1@'))).toBe(false);
  });

  it('extracts attachments with filename, content and contentId', async () => {
    const attachmentBytes = new Uint8Array([1, 2, 3, 4, 5]);
    setMockMsgData({
      subject: 'With attachment',
      senderName: 'Alice',
      senderEmail: 'alice@example.com',
      attachments: [
        {
          fileName: 'doc.pdf',
          content: attachmentBytes,
          mimeType: 'application/pdf',
          pidContentId: '<embedded@example.com>',
        },
      ],
    });

    const result = await parseMsgFile(makeMsgFile());

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].filename).toBe('doc.pdf');
    expect(result.attachments[0].size).toBe(5);
    expect(result.attachments[0].contentType).toBe('application/pdf');
    expect(result.attachments[0].contentId).toBe('embedded@example.com');
    expect(result.attachments[0].content).toBeInstanceOf(Uint8Array);
  });

  it('falls back to clientSubmitTime when messageDeliveryTime is missing', async () => {
    setMockMsgData({
      subject: 'Date fallback',
      senderName: 'Alice',
      senderEmail: 'alice@example.com',
      clientSubmitTime: '2025-05-06T10:00:00.000Z',
    });

    const result = await parseMsgFile(makeMsgFile());

    expect(result.rawDateString).toBe('2025-05-06T10:00:00.000Z');
    expect(result.date).toBeInstanceOf(Date);
    expect(result.date?.getUTCFullYear()).toBe(2025);
  });

  it('prefers messageDeliveryTime over clientSubmitTime when both present', async () => {
    setMockMsgData({
      subject: 'Date priority',
      senderName: 'Alice',
      senderEmail: 'alice@example.com',
      messageDeliveryTime: '2025-05-06T10:00:00.000Z',
      clientSubmitTime: '2020-01-01T00:00:00.000Z',
    });

    const result = await parseMsgFile(makeMsgFile());
    expect(result.rawDateString).toBe('2025-05-06T10:00:00.000Z');
  });

  it('returns "Unknown Sender" when sender fields are missing', async () => {
    setMockMsgData({
      subject: 'Anonymous',
    });
    const result = await parseMsgFile(makeMsgFile());
    expect(result.from).toBe('Unknown Sender');
  });

  it('falls back to "(No Subject)" when subject is missing', async () => {
    setMockMsgData({
      senderName: 'Alice',
      senderEmail: 'alice@example.com',
    });
    const result = await parseMsgFile(makeMsgFile());
    expect(result.subject).toBe('(No Subject)');
  });
});

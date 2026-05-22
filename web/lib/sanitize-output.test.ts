import { stripAnsi, normalizeOutput, sanitizeOutput } from './sanitize-output';

describe('sanitize-output', () => {
  describe('stripAnsi', () => {
    it('should remove CSI sequences', () => {
      expect(stripAnsi('\x1b[31mRed text\x1b[0m')).toBe('Red text');
    });

    it('should remove OSC sequences', () => {
      expect(stripAnsi('\x1b]0;Window Title\x07Text')).toBe('Text');
    });

    it('should remove DCS sequences', () => {
      expect(stripAnsi('\x1bP...data...\x1b\\Text')).toBe('Text');
    });

    it('should handle mixed ANSI codes', () => {
      const input = '\x1b[1m\x1b[31mBold red\x1b[0m normal';
      expect(stripAnsi(input)).toBe('Bold red normal');
    });
  });

  describe('normalizeOutput', () => {
    it('should normalize CRLF to LF', () => {
      expect(normalizeOutput('line1\r\nline2')).toBe('line1\nline2');
    });

    it('should normalize CR to LF', () => {
      expect(normalizeOutput('line1\rline2')).toBe('line1\nline2');
    });

    it('should strip zero-width characters', () => {
      expect(normalizeOutput('text\u200B\u200C\u200Dmore')).toBe('textmore');
    });

    it('should convert tabs to spaces', () => {
      expect(normalizeOutput('col1\tcol2')).toBe('col1  col2');
    });
  });

  describe('sanitizeOutput', () => {
    it('should strip ANSI and redact credentials', () => {
      const input = 'export API_KEY=sk-ant-1234567890abcdef';
      const output = sanitizeOutput(input);
      expect(output).toContain('[REDACTED]');
      expect(output).not.toContain('sk-ant-');
    });

    it('should handle empty string', () => {
      expect(sanitizeOutput('')).toBe('');
    });

    it('should redact tenant AI gateway tokens and env vars', () => {
      const token = 'mtk_ai_abcdefghijklmnopqrstuvwxyz1234567890';
      const input = `MENTIKO_AI_GATEWAY_TOKEN=${token}\nAuthorization: Bearer ${token}`;
      const output = sanitizeOutput(input);

      expect(output).toContain('[REDACTED]');
      expect(output).not.toContain(token);
    });

    it('should redact local gateway proxy and job callback secrets', () => {
      const input = [
        'MENTIKO_AI_GATEWAY_LOCAL_TOKEN=local-secret-value',
        'JOB_CALLBACK_SECRET=job-callback-secret',
        'OPENAI_API_KEY=local-openai-proxy-token',
      ].join('\n');
      const output = sanitizeOutput(input);

      expect(output).not.toContain('local-secret-value');
      expect(output).not.toContain('job-callback-secret');
      expect(output).not.toContain('local-openai-proxy-token');
    });
  });
});

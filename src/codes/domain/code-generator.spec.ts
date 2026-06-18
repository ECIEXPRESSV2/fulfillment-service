import {
  generateShortCode,
  generateToken,
  looksLikeShortCode,
  normalizeShortCode,
} from './code-generator';

describe('code-generator', () => {
  it('genera tokens opacos únicos y de alta entropía', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toEqual(b);
    // 32 bytes en base64url ≈ 43 chars; sin caracteres no url-safe.
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('genera códigos cortos con formato XXXX-XXXX y sin caracteres ambiguos', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateShortCode();
      expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      expect(code).not.toMatch(/[01OIL]/);
    }
  });

  it('normaliza códigos cortos tecleados (mayúsculas, con/sin guion)', () => {
    expect(normalizeShortCode('a7k9p2mx')).toBe('A7K9-P2MX');
    expect(normalizeShortCode('a7k9-p2mx')).toBe('A7K9-P2MX');
    expect(normalizeShortCode(' A7K9-P2MX ')).toBe('A7K9-P2MX');
  });

  it('reconoce la forma de código corto vs token', () => {
    expect(looksLikeShortCode('A7K9-P2MX')).toBe(true);
    expect(looksLikeShortCode('a7k9p2mx')).toBe(true);
    expect(looksLikeShortCode('mO9c2Xb7longopaquetoken')).toBe(false);
  });
});

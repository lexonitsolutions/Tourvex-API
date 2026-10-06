import { EventEmitter } from 'node:events';
import { CSV_MAX_ROWS, csvCell, csvRow, streamCsv } from './csv';

describe('csvCell', () => {
  it.each(['=SUM(A1)', '+1+1', '-2+3', '@cmd', '\tx', '\rx'])(
    'prefixes a formula-like string %j with an apostrophe',
    (input) => {
      expect(csvCell(input).replace(/^"|"$/g, '')).toBe(`'${input}`.replace(/"/g, '""'));
      expect(csvCell(input).startsWith("'") || csvCell(input).startsWith('"\'')).toBe(true);
    },
  );

  it('leaves real numbers, booleans and ordinary text alone', () => {
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(12.5)).toBe('12.5');
    expect(csvCell(true)).toBe('true');
    expect(csvCell('hello')).toBe('hello');
    expect(csvCell('a-b')).toBe('a-b');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('quotes cells with commas, quotes and line breaks, doubling quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('combines protection and quoting', () => {
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe('"\'=HYPERLINK(""http://x"",""y"")"');
  });

  it('serialises dates and objects', () => {
    expect(csvCell(new Date('2026-01-02T03:04:05.000Z'))).toBe('2026-01-02T03:04:05.000Z');
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
  });

  it('joins a row with CRLF', () => {
    expect(csvRow(['a', 1, '=x'])).toBe("a,1,'=x\r\n");
  });
});

function fakeResponse() {
  const chunks: string[] = [];
  const headers: Record<string, string> = {};
  const res = Object.assign(new EventEmitter(), {
    setHeader: (k: string, v: string) => void (headers[k] = v),
    write: (chunk: string) => {
      chunks.push(chunk);
      return true;
    },
    end: jest.fn(),
  });
  return { res: res as any, chunks, headers };
}

describe('streamCsv', () => {
  const columns = [
    { header: 'name', value: (r: { name: string }) => r.name },
    { header: 'n', value: (r: { n: number }) => r.n },
  ] as any;

  it('streams a header and rows with download headers and escaping', async () => {
    const { res, chunks, headers } = fakeResponse();
    const result = await streamCsv(res, 'my file?.csv', columns, [
      { name: '=evil', n: 1 },
      { name: 'ok', n: 2 },
    ]);
    expect(headers['Content-Type']).toContain('text/csv');
    expect(headers['Content-Disposition']).toBe('attachment; filename="my_file_.csv"');
    const bom = String.fromCharCode(0xfeff);
    expect(chunks.join('')).toBe(`${bom}name,n\r\n'=evil,1\r\nok,2\r\n`);
    expect(result).toEqual({ written: 2, truncated: false });
    expect(res.end).toHaveBeenCalled();
  });

  it('caps the export at 10,000 rows by default and reports truncation', async () => {
    expect(CSV_MAX_ROWS).toBe(10_000);
    const { res, chunks, headers } = fakeResponse();
    function* rows() {
      for (let i = 0; i < CSV_MAX_ROWS + 5; i++) yield { name: `r${i}`, n: i };
    }
    const result = await streamCsv(res, 'big.csv', columns, rows());
    expect(result).toEqual({ written: CSV_MAX_ROWS, truncated: true });
    expect(chunks).toHaveLength(CSV_MAX_ROWS + 1);
    expect(headers['X-Export-Row-Cap']).toBe('10000');
  });

  it('waits for drain when the socket applies back-pressure', async () => {
    const { res, chunks } = fakeResponse();
    let calls = 0;
    res.write = (chunk: string) => {
      chunks.push(chunk);
      calls++;
      if (calls === 1) setImmediate(() => (res as EventEmitter).emit('drain'));
      return calls !== 1;
    };
    const result = await streamCsv(res, 'x.csv', columns, [{ name: 'a', n: 1 }]);
    expect(result.written).toBe(1);
  });
});

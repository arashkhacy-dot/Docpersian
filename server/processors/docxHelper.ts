import JSZip from 'jszip';
import fs from 'fs';

export async function createDocxFile(
  title: string,
  pages: Array<{ pageNumber: number; translatedText: string }>,
  outputPath: string,
  unitLabel: string = 'صفحه'
): Promise<void> {
  const zip = new JSZip();

  // [Content_Types].xml
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );

  // _rels/.rels
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );

  // word/_rels/document.xml.rels
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`
  );

  const escapeXml = (unsafe: string) =>
    unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

  // Build document.xml with proper RTL paragraphs (<w:bidi/>, <w:rtl/>)
  let bodyXml = '';

  // Document Title Header
  bodyXml += `<w:p>
    <w:pPr>
      <w:bidi/>
      <w:jc w:val="center"/>
      <w:pBdr><w:bottom w:val="single" w:sz="18" w:space="8" w:color="1E3A8A"/></w:pBdr>
    </w:pPr>
    <w:r>
      <w:rPr><w:b/><w:rtl/><w:sz w:val="40"/><w:color w:val="1E3A8A"/></w:rPr>
      <w:t>${escapeXml(`ترجمه اختصاصی فارسی: ${title}`)}</w:t>
    </w:r>
  </w:p>`;

  for (const p of pages) {
    // Page ribbon header
    bodyXml += `<w:p>
      <w:pPr>
        <w:bidi/>
        <w:jc w:val="right"/>
        <w:pBdr><w:bottom w:val="single" w:sz="8" w:space="4" w:color="3B82F6"/></w:pBdr>
      </w:pPr>
      <w:r>
        <w:rPr><w:b/><w:rtl/><w:sz w:val="28"/><w:color w:val="1D4ED8"/></w:rPr>
        <w:t>${escapeXml(`${unitLabel} ${p.pageNumber}`)}</w:t>
      </w:r>
    </w:p>`;

    const lines = (p.translatedText || '').split('\n').filter((l) => l.trim().length > 0);
    for (const line of lines) {
      bodyXml += `<w:p>
        <w:pPr>
          <w:bidi/>
          <w:jc w:val="right"/>
          <w:spacing w:line="360" w:lineRule="auto"/>
        </w:pPr>
        <w:r>
          <w:rPr><w:rtl/><w:sz w:val="24"/><w:color w:val="1E293B"/></w:rPr>
          <w:t>${escapeXml(line)}</w:t>
        </w:r>
      </w:p>`;
    }

    // Page Break
    bodyXml += `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
  }

  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${bodyXml}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:bidi/>
    </w:sectPr>
  </w:body>
</w:document>`;

  zip.file('word/document.xml', docXml);
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  await fs.promises.writeFile(outputPath, buffer);
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { zipStore, type ZipEntry } from './qti-zip.js';

// Exports a published paper as an IMS QTI 2.1 content package — the standard
// interchange format for assessment items, so a future custom-built LMS (or
// any existing one) can import NACOLM's questions without a bespoke
// adapter. Deliberately scoped to what QTI actually represents well:
// stem, options, and the correct answer for objective items; stem and a
// free-text response area for theory items. NACOLM's keyword marking scheme
// (ConceptGroup) has no standard QTI equivalent and is NOT exported — a
// receiving system gets the question, not the rubric. See
// docs/standards/interoperability.md for the full picture and what LTI
// integration would need on top of this.
@Injectable()
export class QtiService {
  constructor(private readonly prisma: PrismaService) {}

  async exportPaperVersion(paperVersionId: string): Promise<{ filename: string; data: Buffer }> {
    const version = await this.prisma.paperVersion.findUnique({
      where: { id: paperVersionId },
      include: {
        paper: true,
        items: { orderBy: { position: 'asc' }, include: { question: true } },
      },
    });
    if (!version) throw new NotFoundException('Paper version not found.');
    if (version.items.length === 0) throw new BadRequestException('This paper version has no questions.');

    const testId = `TEST-${version.id}`;
    const files: ZipEntry[] = [];
    const itemRefs: { id: string; path: string }[] = [];

    for (const item of version.items) {
      const q = item.question;
      const itemId = `ITEM-${q.id}`;
      const path = `items/${itemId}.xml`;
      files.push({ name: path, data: Buffer.from(itemXml(itemId, q), 'utf8') });
      itemRefs.push({ id: itemId, path });
    }

    files.push({ name: 'test.xml', data: Buffer.from(testXml(testId, version.paper.title, itemRefs), 'utf8') });
    files.push({ name: 'imsmanifest.xml', data: Buffer.from(manifestXml(testId, itemRefs), 'utf8') });

    const safeName = version.paper.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'paper';
    return { filename: `${safeName}-v${version.versionNumber}-qti.zip`, data: zipStore(files) };
  }
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const CHOICE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

function itemXml(itemId: string, q: { type: string; body: string; options: unknown; correctIndex: number | null }): string {
  if (q.type === 'OBJECTIVE') {
    const options = (q.options as string[] | null) ?? [];
    const correctId = q.correctIndex != null ? `Choice${CHOICE_LETTERS[q.correctIndex] ?? q.correctIndex}` : null;
    const choices = options
      .map((opt, i) => `      <simpleChoice identifier="Choice${CHOICE_LETTERS[i] ?? i}">${xmlEscape(opt)}</simpleChoice>`)
      .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<assessmentItem xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imsqti_v2p1 http://www.imsglobal.org/xsd/qti/qtiv2p1/imsqti_v2p1.xsd"
  identifier="${itemId}" title="${itemId}" adaptive="false" timeDependent="false">
  <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="identifier">
    ${correctId ? `<correctResponse><value>${correctId}</value></correctResponse>` : ''}
  </responseDeclaration>
  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float">
    <defaultValue><value>0</value></defaultValue>
  </outcomeDeclaration>
  <itemBody>
    <choiceInteraction responseIdentifier="RESPONSE" shuffle="false" maxChoices="1">
      <prompt>${xmlEscape(q.body)}</prompt>
${choices}
    </choiceInteraction>
  </itemBody>
  <responseProcessing template="http://www.imsglobal.org/question/qti_v2p1/rptemplates/match_correct"/>
</assessmentItem>
`;
  }

  // Theory: free response, manually marked — no automatic responseProcessing.
  return `<?xml version="1.0" encoding="UTF-8"?>
<assessmentItem xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imsqti_v2p1 http://www.imsglobal.org/xsd/qti/qtiv2p1/imsqti_v2p1.xsd"
  identifier="${itemId}" title="${itemId}" adaptive="false" timeDependent="false">
  <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="string"/>
  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float">
    <defaultValue><value>0</value></defaultValue>
  </outcomeDeclaration>
  <itemBody>
    <extendedTextInteraction responseIdentifier="RESPONSE" expectedLength="1000">
      <prompt>${xmlEscape(q.body)}</prompt>
    </extendedTextInteraction>
  </itemBody>
</assessmentItem>
`;
}

function testXml(testId: string, title: string, items: { id: string; path: string }[]): string {
  const refs = items.map((it) => `      <assessmentItemRef identifier="${it.id}" href="${it.path}"/>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<assessmentTest xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imsqti_v2p1 http://www.imsglobal.org/xsd/qti/qtiv2p1/imsqti_v2p1.xsd"
  identifier="${testId}" title="${xmlEscape(title)}">
  <testPart identifier="PART-1" navigationMode="linear" submissionMode="individual">
    <assessmentSection identifier="SECTION-1" title="Questions" visible="true">
${refs}
    </assessmentSection>
  </testPart>
</assessmentTest>
`;
}

function manifestXml(testId: string, items: { id: string; path: string }[]): string {
  const itemResources = items
    .map(
      (it) => `    <resource identifier="${it.id}" type="imsqti_item_xmlv2p1" href="${it.path}">
      <file href="${it.path}"/>
    </resource>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  identifier="MANIFEST-${testId}">
  <organizations/>
  <resources>
    <resource identifier="${testId}" type="imsqti_test_xmlv2p1" href="test.xml">
      <file href="test.xml"/>
${items.map((it) => `      <dependency identifierref="${it.id}"/>`).join('\n')}
    </resource>
${itemResources}
  </resources>
</manifest>
`;
}

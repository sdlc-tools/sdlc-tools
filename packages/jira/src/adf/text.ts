import type { AdfNode } from './types.js';

/**
 * Renders an ADF document as readable Markdown-flavoured text, so that what
 * `issue view` prints can be pasted back into `--description` unchanged in
 * meaning. Unknown nodes render their children instead of being dropped.
 */
export function adfToText(document: unknown): string {
  if (!isNode(document)) return '';
  return renderBlocks(document.content ?? [], 0).trim();
}

function isNode(value: unknown): value is AdfNode {
  return typeof value === 'object' && value !== null && typeof (value as AdfNode).type === 'string';
}

function renderBlocks(nodes: readonly AdfNode[], depth: number): string {
  return nodes
    .map((node) => renderBlock(node, depth))
    .filter((text) => text !== '')
    .join('\n\n');
}

function indent(text: string, prefix: string, hanging = prefix): string {
  return text
    .split('\n')
    .map((line, position) => (line === '' ? '' : `${position === 0 ? prefix : hanging}${line}`))
    .join('\n');
}

function renderList(node: AdfNode, depth: number): string {
  const start = typeof node.attrs?.order === 'number' ? node.attrs.order : 1;
  return (node.content ?? [])
    .map((item, position) => {
      const marker = node.type === 'orderedList' ? `${start + position}. ` : '- ';
      const body = (item.content ?? [])
        .map((child) =>
          child.type === 'bulletList' || child.type === 'orderedList'
            ? renderBlock(child, depth + 1)
            : renderBlock(child, depth),
        )
        .join('\n');
      return indent(body, marker, ' '.repeat(marker.length));
    })
    .join('\n');
}

function renderTask(node: AdfNode): string {
  return (node.content ?? [])
    .map((item) => {
      if (item.type === 'taskList') return indent(renderTask(item), '  ');
      return `- [${item.attrs?.state === 'DONE' ? 'x' : ' '}] ${renderInline(item.content ?? [])}`;
    })
    .join('\n');
}

function renderTable(node: AdfNode): string {
  const rows = (node.content ?? []).map((row) =>
    (row.content ?? []).map((cell) =>
      renderBlocks(cell.content ?? [], 0)
        .replace(/\n+/g, ' ')
        .replace(/\|/g, '\\|'),
    ),
  );
  if (rows.length === 0) return '';
  const header = rows[0] ?? [];
  const lines = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`];
  for (const row of rows.slice(1)) lines.push(`| ${row.join(' | ')} |`);
  return lines.join('\n');
}

function renderBlock(node: AdfNode, depth: number): string {
  switch (node.type) {
    case 'paragraph':
      return renderInline(node.content ?? []);
    case 'heading': {
      const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 1;
      return `${'#'.repeat(level)} ${renderInline(node.content ?? [])}`;
    }
    case 'bulletList':
    case 'orderedList':
      return renderList(node, depth);
    case 'taskList':
      return renderTask(node);
    case 'decisionList':
      return (node.content ?? []).map((item) => `- ${renderInline(item.content ?? [])}`).join('\n');
    case 'codeBlock': {
      const language = typeof node.attrs?.language === 'string' ? node.attrs.language : '';
      const code = (node.content ?? []).map((child) => child.text ?? '').join('');
      return `\`\`\`${language}\n${code}\n\`\`\``;
    }
    case 'blockquote':
      return indent(renderBlocks(node.content ?? [], depth), '> ', '> ');
    case 'panel': {
      const kind = typeof node.attrs?.panelType === 'string' ? node.attrs.panelType : 'info';
      return indent(renderBlocks(node.content ?? [], depth), `> [${kind}] `, '> ');
    }
    case 'rule':
      return '---';
    case 'table':
      return renderTable(node);
    case 'expand':
    case 'nestedExpand': {
      const title = typeof node.attrs?.title === 'string' ? node.attrs.title : '';
      const body = renderBlocks(node.content ?? [], depth);
      return title === '' ? body : `${title}\n\n${body}`;
    }
    case 'mediaSingle':
    case 'mediaGroup':
      return (node.content ?? []).map(renderMedia).join('\n');
    default:
      return node.content === undefined ? renderInline([node]) : renderBlocks(node.content, depth);
  }
}

function renderMedia(node: AdfNode): string {
  const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : '';
  return alt === '' ? '[attachment]' : `[attachment: ${alt}]`;
}

function renderInline(nodes: readonly AdfNode[]): string {
  return nodes.map(renderInlineNode).join('');
}

function stringAttr(node: AdfNode, name: string): string | undefined {
  const value = node.attrs?.[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function renderInlineNode(node: AdfNode): string {
  switch (node.type) {
    case 'text':
      return applyMarks(node);
    case 'hardBreak':
      return '\n';
    case 'mention':
      return stringAttr(node, 'text') ?? `@${stringAttr(node, 'id') ?? 'user'}`;
    case 'emoji':
      return stringAttr(node, 'text') ?? stringAttr(node, 'shortName') ?? '';
    case 'inlineCard':
    case 'blockCard':
      return stringAttr(node, 'url') ?? '';
    case 'status':
      return `[${stringAttr(node, 'text') ?? ''}]`;
    case 'date': {
      const stamp = Number(stringAttr(node, 'timestamp'));
      return Number.isFinite(stamp) && stamp > 0 ? new Date(stamp).toISOString().slice(0, 10) : '';
    }
    case 'media':
    case 'mediaInline':
      return renderMedia(node);
    default:
      return node.content === undefined ? (node.text ?? '') : renderInline(node.content);
  }
}

function applyMarks(node: AdfNode): string {
  let text = node.text ?? '';
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case 'code':
        text = `\`${text}\``;
        break;
      case 'strong':
        text = `**${text}**`;
        break;
      case 'em':
        text = `*${text}*`;
        break;
      case 'strike':
        text = `~~${text}~~`;
        break;
      case 'link': {
        const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : '';
        text = href === '' || href === text ? text : `[${text}](${href})`;
        break;
      }
      default:
        break;
    }
  }
  return text;
}

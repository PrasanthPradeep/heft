import React, { useMemo } from 'react';
import {
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/theme';

import {
  parseMarkdown,
  type BlockNode,
  type InlineNode,
  type ListBlock,
  type TableBlock,
} from './markdown';

const MONOSPACE = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

const HEADING_STYLES: Record<number, TextStyle> = {
  1: { fontSize: 20, lineHeight: 26 },
  2: { fontSize: 18, lineHeight: 24 },
  3: { fontSize: 16, lineHeight: 22 },
  4: { fontSize: 15, lineHeight: 21 },
  5: { fontSize: 15, lineHeight: 21 },
  6: { fontSize: 15, lineHeight: 21 },
};

type Props = {
  /** Raw Markdown from the model. */
  source: string;
  /** Base style for body copy (colour and default line height). */
  style?: StyleProp<TextStyle>;
};

function openLink(href: string): void {
  if (!/^https?:\/\//i.test(href)) return;
  Linking.openURL(href).catch(() => undefined);
}

function renderInline(nodes: InlineNode[], keyPrefix: string): React.ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-i${index}`;

    switch (node.type) {
      case 'text':
        return node.value;
      case 'bold':
        return (
          <Text key={key} style={styles.bold}>
            {renderInline(node.children, key)}
          </Text>
        );
      case 'italic':
        return (
          <Text key={key} style={styles.italic}>
            {renderInline(node.children, key)}
          </Text>
        );
      case 'boldItalic':
        return (
          <Text key={key} style={styles.boldItalic}>
            {renderInline(node.children, key)}
          </Text>
        );
      case 'strike':
        return (
          <Text key={key} style={styles.strike}>
            {renderInline(node.children, key)}
          </Text>
        );
      case 'code':
        return (
          <Text key={key} style={styles.inlineCode}>
            {node.value}
          </Text>
        );
      case 'link':
        return (
          <Text
            key={key}
            accessibilityRole="link"
            style={styles.link}
            onPress={() => openLink(node.href)}>
            {renderInline(node.children, key)}
          </Text>
        );
      default:
        return null;
    }
  });
}

function renderList(
  list: ListBlock,
  key: string,
  base: StyleProp<TextStyle> | undefined,
  depth: number
): React.ReactElement {
  return (
    <View key={key} style={styles.list}>
      {list.items.map((item, index) => (
        <View key={`${key}-${index}`} style={styles.listItem}>
          <Text style={[styles.marker, base]}>
            {item.task !== null
              ? item.task
                ? '☑'
                : '☐'
              : list.ordered
                ? `${list.start + index}.`
                : depth % 2 === 0
                  ? '•'
                  : '◦'}
          </Text>
          <View style={styles.listBody}>
            <Text style={[styles.paragraph, base]}>
              {renderInline(item.content, `${key}-${index}`)}
            </Text>
            {item.children.map((child, childIndex) =>
              renderBlock(child, `${key}-${index}-c${childIndex}`, base, depth + 1)
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

function renderTable(
  table: TableBlock,
  key: string,
  base: StyleProp<TextStyle> | undefined
): React.ReactElement {
  // Flex cells instead of a horizontal scroll view: the bubble shrinks to fit
  // its content, so a nested scroller has no dependable width to measure
  // against. Sharing the width evenly keeps the grid inside the bubble.
  const columns = Math.max(table.header.length, 1);

  return (
    <View key={key} style={styles.table}>
      <View style={[styles.tableRow, styles.tableHeaderRow]}>
        {Array.from({ length: columns }, (_, index) => (
          <View
            key={`h${index}`}
            style={[styles.tableCell, index === 0 && styles.tableCellFirst]}>
            <Text style={[styles.tableHeaderText, base]}>
              {renderInline(table.header[index] ?? [], `${key}-h${index}`)}
            </Text>
          </View>
        ))}
      </View>
      {table.rows.map((row, rowIndex) => (
        <View key={`r${rowIndex}`} style={styles.tableRow}>
          {Array.from({ length: columns }, (_, cellIndex) => (
            <View
              key={`c${cellIndex}`}
              style={[
                styles.tableCell,
                styles.tableBodyCell,
                cellIndex === 0 && styles.tableCellFirst,
              ]}>
              <Text style={[styles.paragraph, base]}>
                {renderInline(
                  row[cellIndex] ?? [],
                  `${key}-r${rowIndex}c${cellIndex}`
                )}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function renderBlock(
  block: BlockNode,
  key: string,
  base: StyleProp<TextStyle> | undefined,
  depth = 0
): React.ReactElement {
  switch (block.type) {
    case 'heading':
      return (
        <Text
          key={key}
          style={[styles.paragraph, base, styles.heading, HEADING_STYLES[block.level] ?? HEADING_STYLES[6]]}>
          {renderInline(block.content, key)}
        </Text>
      );
    case 'paragraph':
      return (
        <Text key={key} style={[styles.paragraph, base]}>
          {renderInline(block.content, key)}
        </Text>
      );
    case 'rule':
      return <View key={key} style={styles.rule} />;
    case 'quote':
      return (
        <View key={key} style={styles.quote}>
          <Text style={[styles.paragraph, styles.quoteText, base]}>
            {renderInline(block.content, key)}
          </Text>
        </View>
      );
    case 'code':
      return (
        <View key={key} style={styles.codeBlock}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Text style={styles.codeText}>{block.value}</Text>
          </ScrollView>
        </View>
      );
    case 'list':
      return renderList(block, key, base, depth);
    case 'table':
      return renderTable(block, key, base);
    default:
      return <View key={key} />;
  }
}

/**
 * Renders an assistant reply as formatted text: real bullets, bold/italic runs,
 * inline and fenced code, quotes, rules and tables — instead of raw Markdown
 * punctuation.
 */
export function MarkdownText({ source, style }: Props) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);

  if (blocks.length === 0) return null;

  return (
    <View style={styles.container}>
      {blocks.map((block, index) => renderBlock(block, `b${index}`, style))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.two },
  paragraph: { lineHeight: 21 },
  heading: { fontWeight: '700' },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  boldItalic: { fontWeight: '700', fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  inlineCode: {
    fontFamily: MONOSPACE,
    fontSize: 14,
    backgroundColor: Colors.brandTint,
    color: Colors.text,
  },
  link: { color: Colors.brand, textDecorationLine: 'underline' },
  rule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
    marginVertical: Spacing.one,
  },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: Colors.brand,
    paddingLeft: Spacing.two,
  },
  quoteText: { color: Colors.textSecondary },
  codeBlock: {
    backgroundColor: Colors.background,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  codeText: {
    fontFamily: MONOSPACE,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.text,
  },
  list: { gap: Spacing.one },
  listItem: { flexDirection: 'row', gap: Spacing.two },
  listBody: { flex: 1, gap: Spacing.one },
  marker: { minWidth: 22, color: Colors.textSecondary },
  table: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    overflow: 'hidden',
  },
  tableRow: { flexDirection: 'row' },
  tableHeaderRow: { backgroundColor: Colors.brandTint },
  tableCell: {
    flex: 1,
    minWidth: 0,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  tableCellFirst: { borderLeftWidth: 0 },
  tableBodyCell: { borderTopWidth: StyleSheet.hairlineWidth },
  tableHeaderText: { fontWeight: '700' },
});

import React, { useMemo, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView, Decoration, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { RangeSetBuilder } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { java } from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';
import { rust } from '@codemirror/lang-rust';
import { go } from '@codemirror/lang-go';
import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import { markdown } from '@codemirror/lang-markdown';
import { css } from '@codemirror/lang-css';
import { sql } from '@codemirror/lang-sql';
import { html } from '@codemirror/lang-html';
import { showMinimap } from '@replit/codemirror-minimap';

const LANG_MAP = {
  js: javascript,
  jsx: javascript,
  ts: javascript,
  tsx: javascript,
  mjs: javascript,
  cjs: javascript,
  py: python,
  pyw: python,
  java: java,
  c: cpp,
  cpp: cpp,
  cc: cpp,
  cxx: cpp,
  h: cpp,
  hpp: cpp,
  go: go,
  rs: rust,
  json: json,
  yml: yaml,
  yaml: yaml,
  md: markdown,
  markdown: markdown,
  css: css,
  scss: css,
  sass: css,
  less: css,
  sql: sql,
  html: html,
  htm: html,
  svg: html,
  xml: html,
};

function getLanguageExtension(filePath) {
  const ext = filePath?.split('.').pop()?.toLowerCase();
  return LANG_MAP[ext] ? [LANG_MAP[ext]()] : [];
}

const addedLineDecoration = Decoration.line({
  class: 'cm-diff-added-line',
  attributes: { 'data-diff-type': 'added' }
});

const removedLineDecoration = Decoration.line({
  class: 'cm-diff-removed-line',
  attributes: { 'data-diff-type': 'removed' }
});

const addedMarkDecoration = Decoration.mark({
  class: 'cm-diff-added-mark'
});

const removedMarkDecoration = Decoration.mark({
  class: 'cm-diff-removed-mark'
});

function createDiffHighlightPlugin(diffData) {
  return ViewPlugin.fromClass(class {
    decorations;

    constructor(view) {
      this.decorations = this.buildDecorations(view, diffData);
    }

    update(update) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = this.buildDecorations(update.view, diffData);
      }
    }

    buildDecorations(view, diff) {
      if (!diff || diff.length === 0) {
        return Decoration.none;
      }

      const builder = new RangeSetBuilder();
      const doc = view.state.doc;

      for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);
        const diffLine = diff[i - 1];

        if (diffLine) {
          if (diffLine.added) {
            builder.add(line.from, line.from, addedLineDecoration);
            if (line.length > 0) {
              builder.add(line.from, line.from + 1, addedMarkDecoration);
            }
          } else if (diffLine.removed) {
            builder.add(line.from, line.from, removedLineDecoration);
            if (line.length > 0) {
              builder.add(line.from, line.from + 1, removedMarkDecoration);
            }
          }
        }
      }

      return builder.finish();
    }
  }, {
    decorations: v => v.decorations
  });
}

const darkTheme = EditorView.theme({
  '&': {
    backgroundColor: '#000000',
    color: '#e0e0e0',
    height: '100%',
  },
  '.cm-gutters': {
    backgroundColor: '#0a0a0a',
    color: '#6b7280',
    border: 'none',
    borderRight: '1px solid #1f1f1f',
  },
  '.cm-activeLineGutter': {
    backgroundColor: '#1a1a1a',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  '.cm-cursor': {
    borderLeftColor: '#22c55e',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
  },
  '.cm-scroller': {
    fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Consolas, monospace",
    fontSize: '13px',
    lineHeight: '1.6',
    overflow: 'auto',
  },
  '.cm-content': {
    minHeight: '100%',
  },
  '.cm-minimap-gutter': {
    background: '#0a0a0a',
    borderLeft: '1px solid #1f1f1f',
  },
  '.cm-minimap-overlay-container': {
    cursor: 'pointer',
  },
  '.cm-minimap-overlay': {
    border: '1px solid rgba(34, 197, 94, 0.6)',
    background: 'rgba(34, 197, 94, 0.2)',
    borderRadius: '2px',
    cursor: 'grab',
    transition: 'background 0.15s ease',
  },
  '.cm-minimap-overlay:hover': {
    border: '1px solid rgba(34, 197, 94, 0.9)',
    background: 'rgba(34, 197, 94, 0.35)',
  },
  '.cm-minimap-overlay-container.cm-minimap-overlay-active .cm-minimap-overlay': {
    border: '1px solid rgba(34, 197, 94, 1)',
    background: 'rgba(34, 197, 94, 0.4)',
    cursor: 'grabbing',
  },
  '.cm-diff-added-line': {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
  },
  '.cm-diff-added-mark': {
    color: '#4ade80',
    fontWeight: 'bold',
  },
  '.cm-diff-removed-line': {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
  },
  '.cm-diff-removed-mark': {
    color: '#f87171',
    fontWeight: 'bold',
  },
}, { dark: true });

const darkHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: '#ff7b72' },
  { tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName], color: '#ffa657' },
  { tag: [t.function(t.variableName), t.labelName], color: '#d2a8ff' },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: '#79c0ff' },
  { tag: [t.definition(t.name), t.separator], color: '#e0e0e0' },
  { tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace], color: '#ffa657' },
  { tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.link, t.special(t.string)], color: '#79c0ff' },
  { tag: [t.meta, t.comment], color: '#6b7280', fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.link, color: '#79c0ff', textDecoration: 'underline' },
  { tag: t.heading, fontWeight: 'bold', color: '#ffa657' },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: '#79c0ff' },
  { tag: [t.processingInstruction, t.string, t.inserted], color: '#a5d6ff' },
  { tag: t.invalid, color: '#f85149' },
]);

const syntaxTheme = syntaxHighlighting(darkHighlightStyle);

export function CodeViewer({ content, diff, isDiff, filePath, onChange }) {
  const editorRef = useRef(null);

  const extensions = useMemo(() => {
    const exts = [
      ...getLanguageExtension(filePath),
      syntaxTheme,
      EditorView.lineWrapping,
      showMinimap.compute(['doc'], (state) => ({
        create: (view) => {
          const dom = document.createElement('div');
          return { dom };
        },
        displayText: 'characters',
        showOverlay: 'always',
      })),
    ];

    if (isDiff && diff && diff.length > 0) {
      exts.push(createDiffHighlightPlugin(diff));
    }

    return exts;
  }, [filePath, isDiff, diff]);

  const code = useMemo(() => {
    if (isDiff && diff) {
      return diff.map(line => {
        if (line.added) {
          return '+' + line.content;
        } else if (line.removed) {
          return '-' + line.content;
        }
        return ' ' + line.content;
      }).join('\n');
    }
    return content || '';
  }, [content, diff, isDiff]);

  const editable = !isDiff;

  function handleChange(value) {
    if (onChange && editable) {
      onChange(value);
    }
  }

  return (
    <div className="code-viewer-codemirror">
      <CodeMirror
        value={code}
        height="100%"
        theme={darkTheme}
        extensions={extensions}
        editable={editable}
        onChange={handleChange}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLine: true,
          highlightSelectionMatches: false,
          bracketMatching: true,
        }}
        onCreateEditor={(view) => {
          editorRef.current = view;
        }}
      />
    </div>
  );
}

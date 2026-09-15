"use client";

import { useEffect, useState } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { Node, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import { Bold, Italic, Underline, Strikethrough, Code, CodeXml, Quote, List, ListOrdered, ListTodo, Undo2, Redo2, Highlighter, AlignLeft, AlignCenter, AlignRight, AlignJustify, Subscript as SubIcon, Superscript as SupIcon, Table, Link, Unlink, ImagePlus } from 'lucide-react';
import type { LessonNode } from '@/contracts/lesson-content';
import { lessonMessages, type LessonLocale } from '@/messages/lesson-authoring';
import { LessonModal, MediaUpload, safeMediaUrl, sanitiseLessonHtml } from './CourseMediaPreview';
import './lesson-authoring.css';

const InstanceLink = Node.create({
  name: 'lessonInstance', group: 'inline', inline: true, atom: true, selectable: true,
  addAttributes() { return { nodeId: { default: '', parseHTML: el => el.getAttribute('data-node-id'), renderHTML: attrs => ({ 'data-node-id': attrs.nodeId }) }, label: { default: '', parseHTML: el => el.textContent, rendered: false } }; },
  parseHTML() { return [{ tag: 'span[data-node-id]' }, { tag: 'a[data-node-id]' }]; },
  renderHTML({ node, HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes, { class: 'la-instance', contenteditable: 'false' }), node.attrs.label]; },
});

const CaptionImage = Image.extend({
  parseHTML() { return [{ tag: 'span[data-image-align]', priority: 60 }, { tag: 'img[src]' }]; },
  addAttributes() {
    const image = (el: HTMLElement) => el.localName === 'img' ? el : el.querySelector('img');
    return { ...this.parent?.(), ...Object.fromEntries(['src','alt','title','width','height'].map(name => [name, { default: null, parseHTML: (el: HTMLElement) => image(el)?.getAttribute(name) || null }])), caption: { default: '', parseHTML: el => image(el)?.getAttribute('data-caption') || '', renderHTML: attrs => ({ 'data-caption': attrs.caption }) }, imageAlign: { default: 'left', parseHTML: el => image(el)?.getAttribute('data-image-align') || el.getAttribute('data-image-align') || 'left', renderHTML: attrs => ({ 'data-image-align': attrs.imageAlign }) }, inlineDisplay: { default: false, parseHTML: el => (image(el)?.getAttribute('data-image-inline') || el.getAttribute('data-image-inline')) === 'true', renderHTML: attrs => ({ 'data-image-inline': String(attrs.inlineDisplay) }) } };
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', { 'data-image-align': HTMLAttributes['data-image-align'], 'data-image-inline': HTMLAttributes['data-image-inline'] }, ['img', HTMLAttributes], ['span', { 'data-caption': HTMLAttributes['data-caption'] }, HTMLAttributes['data-caption'] || '']];
  },
  addNodeView() {
    const parent = this.parent?.(); if (!parent) return null;
    return props => {
      const view = parent(props), wrapper = document.createElement('span'), caption = document.createElement('span');
      const sync = (attrs: Record<string, unknown>) => { wrapper.dataset.imageAlign = String(attrs.imageAlign || 'left'); wrapper.dataset.imageInline = String(!!attrs.inlineDisplay); caption.dataset.caption = String(attrs.caption || ''); caption.textContent = String(attrs.caption || ''); };
      sync(props.node.attrs); wrapper.append(view.dom, caption);
      return { ...view, dom: wrapper, update(node, decorations, innerDecorations) { const result = view.update?.(node, decorations, innerDecorations) ?? false; if (result) sync(node.attrs); return result; } };
    };
  },
});

export type RichLessonEditorProps = { courseId: string; value: string; onChange: (html: string) => void; locale: LessonLocale; nodes?: LessonNode[] };
export function RichLessonEditor({ courseId, value, onChange, locale, nodes = [] }: RichLessonEditorProps) {
  const t = lessonMessages(locale);
  const [modal, setModal] = useState<'image' | 'link' | null>(null), [url, setUrl] = useState(''), [caption, setCaption] = useState(''), [alt, setAlt] = useState(''), [inline, setInline] = useState(false), [width, setWidth] = useState(480), [align, setAlign] = useState('left');
  const editor = useEditor({ immediatelyRender: false, extensions: [StarterKit.configure({ link: { openOnClick: false, protocols: ['https'], isAllowedUri: url => !!safeMediaUrl(url) } }), Highlight.configure({ multicolor: true }), TextAlign.configure({ types: ['heading', 'paragraph'] }), Subscript, Superscript, TaskList, TaskItem.configure({ nested: true }), CaptionImage.configure({ inline: true, allowBase64: false, resize: { enabled: true, directions: ['bottom-left', 'bottom-right'], minWidth: 48, minHeight: 32, alwaysPreserveAspectRatio: true } }), TableKit.configure({ table: { resizable: true } }), InstanceLink], content: '', editorProps: { attributes: { 'aria-label': t.editor, class: 'la-prose' }, transformPastedHTML: html => sanitiseLessonHtml(html) }, onUpdate: ({ editor }) => onChange(editor.getHTML()) });
  useEditorState({ editor, selector: ({ editor }) => editor?.state });
  useEffect(() => { if (editor && editor.getHTML() !== value) { const safe = sanitiseLessonHtml(value); if (editor.getHTML() !== safe) editor.commands.setContent(safe, { emitUpdate: false }); } }, [editor, value]);
  if (!editor) return <p role="status">{t.loading}</p>;
  const button = (label: string, Icon: typeof Bold, action: () => void, active = false, disabled = false) => <button key={label} type="button" className="la-icon" title={label} aria-label={label} aria-pressed={active} disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={action}><Icon size={17}/></button>;
  const chain = () => editor.chain().focus();
  function imageDialog() { const attrs = editor!.isActive('image') ? editor!.getAttributes('image') : {}; setUrl(attrs.src || ''); setCaption(attrs.caption || ''); setAlt(attrs.alt || ''); setInline(!!attrs.inlineDisplay); setWidth(attrs.width || 480); setAlign(attrs.imageAlign || 'left'); setModal('image'); }
  function apply() {
    if (!safeMediaUrl(url)) return;
    if (modal === 'link') chain().extendMarkRange('link').setLink({ href: safeMediaUrl(url) }).run();
    else { const attrs = { src: safeMediaUrl(url), alt, caption, inlineDisplay: inline, width, height: null, imageAlign: align }; if (editor!.isActive('image')) chain().updateAttributes('image', attrs).run(); else chain().insertContent({ type: 'image', attrs }).run(); }
    setModal(null);
  }
  return <div className="la la-rich">
    <div className="la-toolbar" role="toolbar" aria-label={t.editor}>
      <select aria-label={t.heading} value={editor.isActive('heading') ? String(editor.getAttributes('heading').level) : '0'} onChange={e => { const level = Number(e.target.value) as 1 | 2 | 3 | 4 | 5 | 6; if (level) chain().setHeading({ level }).run(); else chain().setParagraph().run(); }}><option value="0">{t.paragraph}</option>{[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{t.heading} {n}</option>)}</select>
      {button(t.bold, Bold, () => { chain().toggleBold().run(); }, editor.isActive('bold'))}
      {button(t.italic, Italic, () => { chain().toggleItalic().run(); }, editor.isActive('italic'))}
      {button(t.underline, Underline, () => { chain().toggleUnderline().run(); }, editor.isActive('underline'))}
      {button(t.strike, Strikethrough, () => { chain().toggleStrike().run(); }, editor.isActive('strike'))}
      {button(t.code, Code, () => { chain().toggleCode().run(); }, editor.isActive('code'))}
      {button(t.codeBlock, CodeXml, () => { chain().toggleCodeBlock().run(); }, editor.isActive('codeBlock'))}
      {button(t.quote, Quote, () => { chain().toggleBlockquote().run(); }, editor.isActive('blockquote'))}
      {button(t.bulletList, List, () => { chain().toggleBulletList().run(); }, editor.isActive('bulletList'))}
      {button(t.orderedList, ListOrdered, () => { chain().toggleOrderedList().run(); }, editor.isActive('orderedList'))}
      {button(t.taskList, ListTodo, () => { chain().toggleTaskList().run(); }, editor.isActive('taskList'))}
      {button(t.highlight, Highlighter, () => { chain().toggleHighlight({ color: '#fef08a' }).run(); }, editor.isActive('highlight'))}
      <input className="la-colour" type="color" title={t.highlight} aria-label={t.highlight} defaultValue="#fef08a" onChange={e => { chain().setHighlight({ color: e.target.value }).run(); }}/>
      {(['left', 'center', 'right', 'justify'] as const).map((alignment, i) => button(t[alignment], [AlignLeft, AlignCenter, AlignRight, AlignJustify][i], () => { chain().setTextAlign(alignment).run(); }, editor.isActive({ textAlign: alignment })))}
      {button(t.subscript, SubIcon, () => { chain().toggleSubscript().run(); }, editor.isActive('subscript'))}
      {button(t.superscript, SupIcon, () => { chain().toggleSuperscript().run(); }, editor.isActive('superscript'))}
      {button(t.table, Table, () => { chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); })}
      <select aria-label={t.tableActions} value="" disabled={!editor.isActive('table')} onChange={e => { const c = chain(); switch (e.target.value) { case 'rowBefore': c.addRowBefore().run(); break; case 'rowAfter': c.addRowAfter().run(); break; case 'columnBefore': c.addColumnBefore().run(); break; case 'columnAfter': c.addColumnAfter().run(); break; case 'deleteRow': c.deleteRow().run(); break; case 'deleteColumn': c.deleteColumn().run(); break; case 'merge': c.mergeCells().run(); break; case 'split': c.splitCell().run(); break; case 'deleteTable': c.deleteTable().run(); } }}><option value="">{t.tableActions}</option>{(['rowBefore','rowAfter','columnBefore','columnAfter','deleteRow','deleteColumn','merge','split','deleteTable'] as const).map(key => <option key={key} value={key} disabled={key === 'merge' ? !editor.can().mergeCells() : key === 'split' ? !editor.can().splitCell() : false}>{t[key]}</option>)}</select>
      {button(t.link, Link, () => { setUrl(editor.getAttributes('link').href || ''); setModal('link'); }, editor.isActive('link'))}
      {button(t.unlink, Unlink, () => { chain().unsetLink().run(); }, false, !editor.isActive('link'))}
      {button(t.insertImage, ImagePlus, imageDialog, editor.isActive('image'))}
      <select aria-label={t.insertInstance} value="" disabled={!nodes.length} onChange={e => { const node = nodes.find(n => n.id === e.target.value); if (node) chain().insertContent({ type: 'lessonInstance', attrs: { nodeId: node.id, label: node.title || t.newNode } }).run(); }}><option value="">{t.insertInstance}</option>{nodes.map(node => <option key={node.id} value={node.id}>{node.title || t.newNode}</option>)}</select>
      {button(t.undo, Undo2, () => { chain().undo().run(); }, false, !editor.can().undo())}
      {button(t.redo, Redo2, () => { chain().redo().run(); }, false, !editor.can().redo())}
    </div>
    <EditorContent editor={editor}/>
    {modal && <LessonModal title={modal === 'image' ? t.insertImage : t.link} locale={locale} onClose={() => setModal(null)}><div className="la-fields">
      {modal === 'image' ? <><MediaUpload courseId={courseId} value={url} onChange={setUrl} accept="image/png,image/jpeg,image/webp,image/gif,image/avif" locale={locale}/><label>{t.alt}<input value={alt} onChange={e => setAlt(e.target.value)}/></label><label>{t.caption}<input value={caption} onChange={e => setCaption(e.target.value)}/></label><label>{t.width}<input type="number" min={48} max={2400} value={width} onChange={e => setWidth(Math.max(48, Math.min(2400, Number(e.target.value))))}/></label><label>{t.left}<select value={align} onChange={e => setAlign(e.target.value)}>{(['left','center','right'] as const).map(key => <option key={key} value={key}>{t[key]}</option>)}</select></label><label className="la-check"><input type="checkbox" checked={inline} onChange={e => setInline(e.target.checked)}/>{t.inline}</label></> : <label>{t.url}<input value={url} onChange={e => setUrl(e.target.value)}/></label>}
      {url && !safeMediaUrl(url) && <p role="alert">{t.invalidUrl}</p>}<div className="la-actions"><button type="button" onClick={() => setModal(null)}>{t.cancel}</button><button type="button" disabled={!safeMediaUrl(url)} onClick={apply}>{t.apply}</button></div>
    </div></LessonModal>}
  </div>;
}

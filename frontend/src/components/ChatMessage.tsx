import type { Message } from '../types';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { defaultSchema, type Schema } from 'hast-util-sanitize';
import '../styles/ChatMessage.css';

const SANITIZE_SCHEMA: Schema = {
  ...defaultSchema,
  attributes: {
    ...(defaultSchema.attributes ?? {}),
    a: [
      ...((defaultSchema.attributes?.a as string[] | undefined) ?? []),
      'href',
      'title',
      'target',
      'rel',
    ],
    code: [...((defaultSchema.attributes?.code as string[] | undefined) ?? []), 'className'],
    span: [...((defaultSchema.attributes?.span as string[] | undefined) ?? []), 'className'],
    p:    [...((defaultSchema.attributes?.p    as string[] | undefined) ?? []), 'className'],
    pre:  [...((defaultSchema.attributes?.pre  as string[] | undefined) ?? []), 'className'],
    table:[...((defaultSchema.attributes?.table as string[] | undefined) ?? []), 'className'],
  },
  tagNames: (defaultSchema.tagNames ?? []).filter((t) => t !== 'img'),
};

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS: Parameters<typeof ReactMarkdown>[0]['rehypePlugins'] = [
  [rehypeSanitize, SANITIZE_SCHEMA],
];

function isSafeHref(href: string): boolean {
  const h = href.trim();
  const lower = h.toLowerCase();

  if (lower.startsWith('javascript:')) return false;
  if (lower.startsWith('vbscript:')) return false;
  if (lower.startsWith('//')) return false;
  if (lower.startsWith('#') || lower.startsWith('/')) return true;
  return lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('mailto:');
}

const markdownComponents: Components = {
  a: ({ href, children, ...props }) => {
    const isSafe = isSafeHref(href ?? '');
    if (!isSafe) return <span>{children}</span>;
    return (
      <a href={href ?? ''} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    );
  },
};

interface ChatMessageProps {
  message: Message;
  isStreaming?: boolean;
}

export function ChatMessage({ message, isStreaming = false }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const hasSteps = message.steps && message.steps.length > 0;
  const showTyping = !isUser && message.content === '' && isStreaming;

  return (
    <div className={`chat-message ${isUser ? 'user' : 'assistant'} ${hasSteps ? 'has-steps' : ''}`}>
      <div className="message-avatar">
        {isUser ? 'Y' : 'A'}
      </div>
      <div className="message-content">
        <div className="message-header">
          <span className="message-role">
            {isUser ? 'You' : hasSteps ? 'Agent' : 'Assistant'}
          </span>
          <span className="message-time">
            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        <div className="message-text">
          {message.content ? (
            <ReactMarkdown
              remarkPlugins={REMARK_PLUGINS}
              rehypePlugins={REHYPE_PLUGINS}
              components={markdownComponents}
            >
              {message.content}
            </ReactMarkdown>
          ) : showTyping ? (
            <div className="typing-indicator">
              <span /><span /><span />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

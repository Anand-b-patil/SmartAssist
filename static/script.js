const STORAGE_KEY = 'smartassist.chat.sessions';
const ACTIVE_KEY = 'smartassist.chat.activeSession';
const THEME_KEY = 'smartassist.chat.theme';

const elements = {
  chatForm: document.getElementById('chatForm'),
  messageInput: document.getElementById('messageInput'),
  messages: document.getElementById('messages'),
  typingIndicator: document.getElementById('typingIndicator'),
  sendBtn: document.getElementById('sendBtn'),
  newChatBtn: document.getElementById('newChatBtn'),
  clearChatBtn: document.getElementById('clearChatBtn'),
  exportChatBtn: document.getElementById('exportChatBtn'),
  copyPromptBtn: document.getElementById('copyPromptBtn'),
  voiceBtn: document.getElementById('voiceBtn'),
  ttsBtn: document.getElementById('ttsBtn'),
  themeToggleBtn: document.getElementById('themeToggleBtn'),
  chatSessions: document.getElementById('chatSessions'),
  activeChatTitle: document.getElementById('activeChatTitle'),
  apiStatus: document.getElementById('apiStatus'),
  sidebar: document.getElementById('sidebar'),
  sidebarToggleBtn: document.getElementById('sidebarToggleBtn'),
  mobileSidebarOpenBtn: document.getElementById('mobileSidebarOpenBtn'),
  sidebarBackdrop: document.getElementById('sidebarBackdrop'),
};

const speechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

let chatSessions = loadSessions();
let activeSessionId = localStorage.getItem(ACTIVE_KEY) || null;
let isSending = false;
let latestAssistantReply = '';
let recognition = null;
let voicePromptBuffer = '';

function nowLabel(timestamp = Date.now()) {
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function makeId() {
  if (window.crypto && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadSessions() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistSessions() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(chatSessions));
  if (activeSessionId) {
    localStorage.setItem(ACTIVE_KEY, activeSessionId);
  }
}

function getActiveSession() {
  return chatSessions.find((session) => session.id === activeSessionId) || null;
}

function createSession() {
  const session = {
    id: makeId(),
    title: 'New conversation',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
  chatSessions.unshift(session);
  activeSessionId = session.id;
  persistSessions();
  return session;
}

function ensureActiveSession() {
  let session = getActiveSession();
  if (!session) {
    session = chatSessions[0] || createSession();
    activeSessionId = session.id;
    persistSessions();
  }
  return session;
}

function escapeText(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatMessageContent(message) {
  if (message.role === 'assistant' && window.marked) {
    marked.setOptions({ breaks: true, gfm: true, headerIds: false });
    const rendered = marked.parse(message.content || '');
    return `<div class="message-content">${rendered}</div>`;
  }

  return `<div class="message-content">${escapeText(message.content || '')}</div>`;
}

function renderMessage(message) {
  const wrapper = document.createElement('article');
  wrapper.className = `message ${message.role}`;
  wrapper.dataset.messageId = message.id;

  wrapper.innerHTML = `
    ${formatMessageContent(message)}
    <div class="message-meta">
      <span>${message.role === 'user' ? 'You' : 'SmartAssist'} • ${nowLabel(message.timestamp)}</span>
      ${message.role === 'assistant' ? '<button type="button" class="copy-btn">Copy</button>' : ''}
    </div>
  `;

  const copyButton = wrapper.querySelector('.copy-btn');
  if (copyButton) {
    copyButton.addEventListener('click', () => copyToClipboard(message.content));
  }

  return wrapper;
}

function renderSessions() {
  const sorted = [...chatSessions].sort((a, b) => b.updatedAt - a.updatedAt);
  elements.chatSessions.innerHTML = '';

  sorted.forEach((session) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `session-item ${session.id === activeSessionId ? 'active' : ''}`;
    const preview = session.messages.find((entry) => entry.role === 'user')?.content || 'Empty chat';
    button.innerHTML = `
      <strong>${escapeText(session.title || 'Conversation')}</strong>
      <span>${escapeText(preview.slice(0, 48))}${preview.length > 48 ? '...' : ''}</span>
    `;
    button.addEventListener('click', () => {
      activeSessionId = session.id;
      persistSessions();
      renderApp();
      if (window.innerWidth <= 1024) {
        closeSidebar();
      }
    });
    elements.chatSessions.appendChild(button);
  });
}

function renderChat() {
  const session = ensureActiveSession();
  elements.messages.innerHTML = '';
  elements.activeChatTitle.textContent = session.title || 'New conversation';

  session.messages.forEach((message) => {
    elements.messages.appendChild(renderMessage(message));
  });

  scrollToLatest();
  latestAssistantReply = [...session.messages].reverse().find((entry) => entry.role === 'assistant')?.content || '';
}

function renderApp() {
  renderSessions();
  renderChat();
}

function scrollToLatest() {
  requestAnimationFrame(() => {
    elements.messages.scrollTop = elements.messages.scrollHeight;
  });
}

function saveMessage(role, content) {
  const session = ensureActiveSession();
  const message = {
    id: makeId(),
    role,
    content,
    timestamp: Date.now(),
  };
  session.messages.push(message);
  session.updatedAt = message.timestamp;
  if (role === 'user' && session.messages.filter((entry) => entry.role === 'user').length === 1) {
    session.title = content.slice(0, 28) || 'Conversation';
  }
  if (role === 'assistant' && session.title === 'New conversation') {
    session.title = 'Conversation';
  }
  persistSessions();
  return message;
}

function updateLastAssistantMessage(content) {
  const session = ensureActiveSession();
  const assistantMessages = session.messages.filter((entry) => entry.role === 'assistant');
  if (assistantMessages.length > 0) {
    assistantMessages[assistantMessages.length - 1].content = content;
    assistantMessages[assistantMessages.length - 1].timestamp = Date.now();
    session.updatedAt = Date.now();
    latestAssistantReply = content;
    persistSessions();
  }
}

function setSendingState(loading) {
  isSending = loading;
  elements.sendBtn.disabled = loading;
  elements.messageInput.disabled = loading;
  elements.typingIndicator.classList.toggle('hidden', !loading);
  if (loading) {
    scrollToLatest();
  }
}

async function copyToClipboard(text) {
  if (!text) {
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    elements.copyPromptBtn.textContent = 'Copied';
    setTimeout(() => {
      elements.copyPromptBtn.textContent = 'Copy Last AI Reply';
    }, 1200);
  } catch {
    alert('Copy failed. Your browser may block clipboard access.');
  }
}

function exportChat() {
  const session = ensureActiveSession();
  const lines = [
    `SmartAssist export - ${session.title || 'Conversation'}`,
    `Created: ${nowLabel(session.createdAt)}`,
    '',
  ];

  session.messages.forEach((message) => {
    lines.push(`${message.role.toUpperCase()} [${nowLabel(message.timestamp)}]:`);
    lines.push(message.content);
    lines.push('');
  });

  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `smartassist-${session.id}.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function newChat() {
  const session = createSession();
  activeSessionId = session.id;
  persistSessions();
  renderApp();
  elements.messageInput.value = '';
  elements.messageInput.focus();
}

function clearChat() {
  const session = ensureActiveSession();
  if (!session.messages.length) {
    return;
  }
  const confirmed = window.confirm('Clear the current chat conversation?');
  if (!confirmed) {
    return;
  }
  session.messages = [];
  session.title = 'New conversation';
  session.updatedAt = Date.now();
  latestAssistantReply = '';
  persistSessions();
  renderApp();
}

function autoResizeTextarea() {
  elements.messageInput.style.height = 'auto';
  elements.messageInput.style.height = `${Math.min(elements.messageInput.scrollHeight, 220)}px`;
}

function setTheme(theme) {
  document.body.classList.toggle('light-mode', theme === 'light');
  localStorage.setItem(THEME_KEY, theme);
}

function toggleTheme() {
  const nextTheme = document.body.classList.contains('light-mode') ? 'dark' : 'light';
  setTheme(nextTheme);
}

function initTheme() {
  const savedTheme = localStorage.getItem(THEME_KEY) || 'dark';
  setTheme(savedTheme);
}

function updateApiStatus() {
  if (elements.apiStatus.textContent.includes('missing')) {
    elements.apiStatus.textContent = 'API key missing';
  }
}

async function sendMessage(text) {
  const session = ensureActiveSession();
  const userMessage = saveMessage('user', text);
  elements.messages.appendChild(renderMessage(userMessage));
  scrollToLatest();
  renderSessions();
  elements.messageInput.value = '';
  autoResizeTextarea();

  const pendingId = makeId();
  const placeholderNode = renderMessage({
    id: pendingId,
    role: 'assistant',
    content: 'Thinking...',
    timestamp: Date.now(),
  });
  placeholderNode.classList.add('pending');
  elements.messages.appendChild(placeholderNode);
  scrollToLatest();
  setSendingState(true);

  const historyPayload = session.messages.slice(0, -1).map((entry) => ({
    role: entry.role,
    content: entry.content,
  }));

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        history: historyPayload,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'The chat request failed.');
    }

    const answer = data.reply || 'No response was returned.';
    const assistantMessage = saveMessage('assistant', answer);
    placeholderNode.replaceWith(renderMessage(assistantMessage));
    latestAssistantReply = answer;
    elements.activeChatTitle.textContent = session.title || 'Conversation';
  } catch (error) {
    const fallback = `Sorry, I could not reach Gemini. ${error.message}`;
    const assistantMessage = saveMessage('assistant', fallback);
    placeholderNode.replaceWith(renderMessage(assistantMessage));
    latestAssistantReply = fallback;
  } finally {
    setSendingState(false);
    renderSessions();
    scrollToLatest();
  }
}

function handleVoiceInput() {
  if (!speechRecognition) {
    alert('Speech recognition is not supported in this browser.');
    return;
  }

  if (!recognition) {
    recognition = new speechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onresult = (event) => {
      let transcript = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        transcript += event.results[index][0].transcript;
      }
      elements.messageInput.value = `${voicePromptBuffer}${transcript}`.trim();
      autoResizeTextarea();
    };

    recognition.onend = () => {
      voicePromptBuffer = '';
      elements.voiceBtn.textContent = 'Voice Input';
    };
  }

  voicePromptBuffer = elements.messageInput.value.trim() ? `${elements.messageInput.value.trim()} ` : '';
  elements.voiceBtn.textContent = 'Listening...';
  recognition.start();
}

function speakLatestReply() {
  if (!latestAssistantReply) {
    alert('There is no AI response to read yet.');
    return;
  }

  if (!('speechSynthesis' in window)) {
    alert('Text-to-speech is not supported in this browser.');
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(latestAssistantReply);
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.lang = 'en-US';
  window.speechSynthesis.speak(utterance);
}

function syncSidebarState(isOpen) {
  elements.sidebar.classList.toggle('visible-mobile', isOpen);
  elements.sidebarBackdrop.classList.toggle('hidden', !isOpen);
  document.body.classList.toggle('sidebar-open', isOpen);
}

function openSidebar() {
  if (window.innerWidth > 1024) {
    return;
  }
  syncSidebarState(true);
}

function closeSidebar() {
  syncSidebarState(false);
}

function toggleSidebar() {
  const isOpen = elements.sidebar.classList.contains('visible-mobile');
  syncSidebarState(!isOpen);
}

function setupShortcuts() {
  elements.messageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      elements.chatForm.requestSubmit();
    }
  });
}

function bootstrap() {
  initTheme();
  updateApiStatus();
  chatSessions = loadSessions();

  if (!chatSessions.length) {
    createSession();
  } else if (!activeSessionId || !chatSessions.some((session) => session.id === activeSessionId)) {
    activeSessionId = chatSessions[0].id;
  }

  persistSessions();
  renderApp();
  setupShortcuts();
  autoResizeTextarea();

  elements.chatForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = elements.messageInput.value.trim();
    if (!text || isSending) {
      return;
    }
    await sendMessage(text);
  });

  elements.messageInput.addEventListener('input', autoResizeTextarea);
  elements.newChatBtn.addEventListener('click', newChat);
  elements.clearChatBtn.addEventListener('click', clearChat);
  elements.exportChatBtn.addEventListener('click', exportChat);
  elements.copyPromptBtn.addEventListener('click', () => copyToClipboard(latestAssistantReply));
  elements.voiceBtn.addEventListener('click', handleVoiceInput);
  elements.ttsBtn.addEventListener('click', speakLatestReply);
  elements.themeToggleBtn.addEventListener('click', toggleTheme);
  elements.sidebarToggleBtn.addEventListener('click', toggleSidebar);
  elements.mobileSidebarOpenBtn.addEventListener('click', openSidebar);
  elements.sidebarBackdrop.addEventListener('click', closeSidebar);

  window.addEventListener('resize', () => {
    if (window.innerWidth > 1024) {
      closeSidebar();
    }
  });
}

bootstrap();

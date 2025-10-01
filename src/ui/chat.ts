import { Notice } from 'obsidian';
import { ConversationMessage } from '../types';
import { transcript_assistant_script } from '../prompts';

interface IChatViewDependencies {
    getCombinedTranscript(): Promise<string>;
    getOpenAIKey(): string;
}

export class ChatUI {
    private view: IChatViewDependencies;
    private chatContentEl: HTMLElement | null = null;
    private conversationHistory: ConversationMessage[] = [
        {
            role: 'user',
            content: 'What are the key points discussed in the meeting?'
        }
    ];

    constructor(view: IChatViewDependencies) {
        this.view = view;
    }

    setup(container: HTMLElement): HTMLElement {
        const chatContent = container.createEl('div', { cls: 'lecture-copilot-chat-content' });
        chatContent.style.marginTop = '12px';
        chatContent.style.borderTop = '1px solid var(--background-modifier-border)';
        chatContent.style.paddingTop = '12px';
        chatContent.style.flex = '1';
        chatContent.style.minHeight = '200px';
        chatContent.style.overflowY = 'auto';
        chatContent.style.display = 'flex';
        chatContent.style.flexDirection = 'column';
        chatContent.style.gap = '8px';
        chatContent.style.padding = '12px';
        
        this.chatContentEl = chatContent;

        const chatBox = container.createEl('div', { cls: 'lecture-copilot-chat-box' });
        chatBox.style.marginTop = 'auto';
        chatBox.style.display = 'flex';
        chatBox.style.flexDirection = 'row';

        const chatInput = this.createChatInput(chatBox);
        this.createChatButtons(chatBox, chatInput);

        return chatContent;
    }

    private createChatInput(chatBox: HTMLElement): HTMLTextAreaElement {
        const chatInput = chatBox.createEl('textarea', { 
            cls: 'lecture-copilot-chat-input', 
            placeholder: 'Type your question here...' 
        });
        chatInput.style.width = '100%';
        chatInput.style.height = '2rem';
        chatInput.addEventListener('input', () => {
            if (chatInput.scrollHeight > chatInput.clientHeight) {
                chatInput.style.height = chatInput.scrollHeight + 'px';
            } else {
                chatInput.style.height = '2rem';
            }
        });
        chatInput.style.resize = 'none';
        chatInput.style.padding = '8px';
        chatInput.style.border = '1px solid var(--background-modifier-border)';
        chatInput.style.borderRadius = '4px';
        chatInput.style.backgroundColor = 'var(--background-secondary)';
        
        chatInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const message = chatInput.value.trim();
                if (message) {
                    chatInput.value = '';
                    chatInput.style.height = '2rem';
                    await this.sendMessage(message);
                }
            }
        });

        return chatInput;
    }

    private createChatButtons(chatBox: HTMLElement, chatInput: HTMLTextAreaElement): void {
        const chatSendBox = chatBox.createEl('div', { cls: 'lecture-copilot-chat-send-box' });
        chatSendBox.style.display = 'flex';
        chatSendBox.style.justifyContent = 'flex-end';
        chatSendBox.style.alignItems = 'center';
        chatSendBox.style.gap = '4px';

        const clearButton = chatSendBox.createEl('button', { text: 'Clear' });
        clearButton.style.padding = '6px 12px';
        clearButton.style.borderRadius = '4px';
        clearButton.style.border = '1px solid var(--background-modifier-border)';
        clearButton.style.backgroundColor = 'var(--background-primary)';
        clearButton.style.cursor = 'pointer';
        clearButton.style.fontSize = '0.85em';
        clearButton.style.color = 'var(--text-muted)';

        const sendButton = chatSendBox.createEl('button', { text: '>' });
        sendButton.style.padding = '6px 16px';
        sendButton.style.borderRadius = '4px';
        sendButton.style.border = '1px solid var(--background-modifier-border)';
        sendButton.style.backgroundColor = 'var(--background-primary)';
        sendButton.style.cursor = 'pointer';
        sendButton.style.fontWeight = 'bold';

        clearButton.addEventListener('click', () => {
            this.clearChat();
        });

        sendButton.addEventListener('click', async () => {
            const message = chatInput.value.trim();
            if (message) {
                chatInput.value = '';
                chatInput.style.height = '2rem';
                await this.sendMessage(message);
            }
        });
    }

    async sendMessage(message: string): Promise<void> {
        try {
            const combinedTranscript = await this.view.getCombinedTranscript();

            const forcedIntroPrompts = [
                {
                    role: 'developer' as const,
                    content: transcript_assistant_script
                },
                {
                    role: 'user' as const,
                    content: "The following is the transcript: " + combinedTranscript
                },
            ];
            
            this.conversationHistory.push({
                role: 'user',
                content: message
            });
            
            this.displayUserMessage(message);

            const openAIKey = this.view.getOpenAIKey();
            const resp = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${openAIKey}`
                },
                body: JSON.stringify({
                    model: 'gpt-4',
                    messages: [...forcedIntroPrompts, ...this.conversationHistory],
                })
            });

            if (!resp.ok) {
                throw new Error(`OpenAI API error: ${resp.status} ${resp.statusText}`);
            }

            const data = await resp.json();
            const assistantResponse = data.choices?.[0]?.message?.content;
            
            if (assistantResponse) {
                this.conversationHistory.push({
                    role: 'assistant',
                    content: assistantResponse
                });
                this.displayAssistantMessage(assistantResponse);
            }
        } catch (error) {
            console.error('Error sending message:', error);
            new Notice('Failed to send message: ' + (error instanceof Error ? error.message : String(error)));
        }
    }

    private displayUserMessage(message: string): void {
        if (!this.chatContentEl) return;

        const messageContainer = this.chatContentEl.createEl('div', { cls: 'chat-message user-message' });
        messageContainer.style.display = 'flex';
        messageContainer.style.justifyContent = 'flex-end';
        messageContainer.style.marginBottom = '8px';

        const messageBubble = messageContainer.createEl('div', { cls: 'message-bubble user-bubble' });
        messageBubble.style.maxWidth = '70%';
        messageBubble.style.padding = '8px 12px';
        messageBubble.style.borderRadius = '12px';
        messageBubble.style.backgroundColor = 'var(--text-muted)';
        messageBubble.style.color = 'var(--text-on-accent)';
        messageBubble.style.wordWrap = 'break-word';
        messageBubble.textContent = message;

        this.chatContentEl.scrollTop = this.chatContentEl.scrollHeight;
    }

    private displayAssistantMessage(message: string): void {
        if (!this.chatContentEl) return;

        const messageContainer = this.chatContentEl.createEl('div', { cls: 'chat-message assistant-message' });
        messageContainer.style.display = 'flex';
        messageContainer.style.justifyContent = 'flex-start';
        messageContainer.style.marginBottom = '8px';

        const messageBubble = messageContainer.createEl('div', { cls: 'message-bubble assistant-bubble' });
        messageBubble.style.maxWidth = '70%';
        messageBubble.style.padding = '8px 12px';
        messageBubble.style.borderRadius = '12px';
        messageBubble.style.backgroundColor = 'var(--interactive-accent)';
        messageBubble.style.color = 'var(--text-on-accent)';
        messageBubble.style.wordWrap = 'break-word';
        messageBubble.textContent = message;

        this.chatContentEl.scrollTop = this.chatContentEl.scrollHeight;
    }

    clearChat(): void {
        if (!this.chatContentEl) return;

        this.chatContentEl.empty();
        this.conversationHistory = [
            {
                role: 'user',
                content: 'What are the key points discussed in the meeting?'
            }
        ];

        new Notice('Chat cleared');
    }
}
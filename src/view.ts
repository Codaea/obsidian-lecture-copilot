import { ItemView, MarkdownView, WorkspaceLeaf, Notice, normalizePath, IconName } from 'obsidian';
import { dump } from 'js-yaml';
import LectureCopilot, { LECTURE_COPILOT_VIEW_TYPE } from './main';
import { AudioRecorder } from './audiorecorder';
import { transcript_assistant_script } from './prompts';

export class LectureCopilotView extends ItemView {
    private recorder: AudioRecorder;
    private plugin: LectureCopilot;
    private transcriptionEl: HTMLElement | null = null;
    private chatContentEl: HTMLElement | null = null;
    private userHasScrolled = false;
    private openAIKey: string = '';
    private conversationHistory: {
        role: 'developer' | 'user' | 'assistant';
        content: string;
    }[] = [
            {
                role: 'user',
                content: 'What are the key points discussed in the meeting?'
            }
        ];

    constructor(leaf: WorkspaceLeaf, plugin: LectureCopilot) {
        super(leaf);
        this.plugin = plugin;
        // initialize recorder with the current saved API key
        this.recorder = new AudioRecorder(this.plugin.settings?.AssemblyAPIKey ?? '');
        // initialize OpenAI key from settings
        this.openAIKey = this.plugin.settings?.OpenAIAPIKey ?? '';
    }

    // allow updating the AssemblyAI key at runtime when the user changes settings
    public updateAssemblyApiKey(apiKey: string) {
        if (this.recorder && typeof this.recorder.setAssemblyAPIKey === 'function') {
            this.recorder.setAssemblyAPIKey(apiKey);
        }
    }


    public updateOpenAIApiKey(apiKey: string) {
        // Placeholder for any future OpenAI key updates
        this.openAIKey = apiKey;
    }

    getViewType() {
        return LECTURE_COPILOT_VIEW_TYPE;
    }

    getDisplayText(): string {
        return 'Lecture Copilot';
    }

    getIcon(): IconName {
        return 'notebook';
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();

        // Set up flex layout for the main container
        (container as HTMLElement).style.display = 'flex';
        (container as HTMLElement).style.flexDirection = 'column';
        (container as HTMLElement).style.height = '100%';

        container.createEl("h4", { text: "Lecture Copilot" });
        // Create Start and Stop buttons
        const startButton = container.createEl("button", { text: "Start Recording" });
        const stopButton = container.createEl("button", { text: "Stop Recording" });
        stopButton.hide();

        container.createEl('h5', { text: 'Transcription', });
        this.transcriptionEl = container.createEl('div', {
            text: '',
            cls: 'lecture-copilot-transcript'
        });

        // Set fixed height and scrollable behavior
        this.transcriptionEl.style.height = '6lh'; // 6 line-height units
        this.transcriptionEl.style.overflowY = 'auto';
        this.transcriptionEl.style.border = '1px solid var(--background-modifier-border)';
        this.transcriptionEl.style.padding = '8px';
        this.transcriptionEl.style.borderRadius = '4px';
        this.transcriptionEl.style.backgroundColor = 'var(--background-secondary)';

        // Track user scroll behavior
        this.transcriptionEl.addEventListener('scroll', () => {
            if (this.transcriptionEl) {
                const { scrollTop, scrollHeight, clientHeight } = this.transcriptionEl;
                // Check if user has scrolled away from the bottom
                this.userHasScrolled = scrollTop + clientHeight < scrollHeight - 5; // 5px tolerance
            }
        });

        // tiny stats bar underneath transcript scroller
        const statsBar = container.createEl('div', { cls: 'lecture-copilot-stats-bar' });
        statsBar.style.display = 'flex';
        statsBar.style.justifyContent = 'space-between';
        statsBar.style.fontSize = '0.85em';
        statsBar.style.color = 'var(--text-muted)';
        statsBar.style.marginTop = '4px';

        const durationEl = statsBar.createEl('div', { text: 'Duration: 0:00:00' });
        const wordCountEl = statsBar.createEl('div', { text: 'Words: 0' });

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
        
        // Store reference to chat content for adding messages
        this.chatContentEl = chatContent;

        const chatBox = container.createEl('div', { cls: 'lecture-copilot-chat-box' });
        chatBox.style.marginTop = 'auto';
        chatBox.style.display = 'flex';
        chatBox.style.flexDirection = 'row';

        const chatInput = chatBox.createEl('textarea', { cls: 'lecture-copilot-chat-input', placeholder: 'Type your question here...' });
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
        
        // Handle Enter key to send message
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
        // Chat send box (button) on the right side of the chat input
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
        // Set up the live update callback
        this.recorder.onTranscriptUpdate = (transcript: string) => {
            if (this.transcriptionEl) {
                // Split into paragraphs for better readability
                const paragraphs = transcript.split('\n\n').filter(p => p.trim());
                this.transcriptionEl.empty();

                paragraphs.forEach((paragraph, index) => {
                    const p = this.transcriptionEl!.createEl('p');
                    p.textContent = paragraph;
                    p.style.margin = '0 0 8px 0'; // Add some spacing between paragraphs

                    // Highlight the current (incomplete) turn
                    if (index === paragraphs.length - 1 && this.recorder.getCurrentTurn().trim()) {
                        p.addClass('current-turn');
                    }
                });

                // Auto-scroll to bottom only if user hasn't manually scrolled up
                if (!this.userHasScrolled) {
                    this.transcriptionEl.scrollTop = this.transcriptionEl.scrollHeight;
                }
            }
            if (wordCountEl) {
                transcript = transcript.replace(/\n/g, ' '); // Replace newlines with spaces for word count
                const words = transcript.trim().split(/\s+/).filter(Boolean);
                wordCountEl.setText(`Words: ${words.length}`);
            }
        };
        let durationInterval: number;
        startButton.addEventListener("click", async () => {
            try {
                this.recorder.clearTranscript(); // Clear previous transcript
                this.userHasScrolled = false; // Reset scroll tracking when starting new recording
                await this.recorder.startRecording();
                new Notice("Recording started!");
                startButton.hide();
                stopButton.show();
                // start a timer to update duration every second
                let duration = 0;
                durationInterval = this.registerInterval(window.setInterval(() => {
                    duration++;
                    if (durationEl) {
                        const hours = Math.floor(duration / 3600);
                        const minutes = Math.floor((duration % 3600) / 60);
                        const seconds = Math.floor(duration % 60);
                        durationEl.setText(`Duration: ${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
                    }
                }, 1000));
            } catch (error) {
                new Notice("Failed to start recording: " + error.message);
                console.log(error.message);
            }
        });

        stopButton.addEventListener("click", async () => {
            try {
                await this.transcriptToFile();

            } catch (error) {
                new Notice("Failed to stop recording: " + (error instanceof Error ? error.message : String(error)));
                console.log(error);
            }
            stopButton.hide();
            startButton.show();
            if (durationInterval) {
                clearInterval(durationInterval);
            }

        });


    }

    async onClose() {

    }

    // Save the current transcript to a file in the vault and update active note's frontmatter
    async transcriptToFile() {
        // Capture the current active leaf/view/file BEFORE doing anything that may steal focus
        const prevActiveLeaf = this.app.workspace.activeLeaf;
        const mostRecentLeaf = this.app.workspace.getMostRecentLeaf();
        const prevMarkdownView = mostRecentLeaf?.view instanceof MarkdownView ? (mostRecentLeaf.view as MarkdownView) : null;
        const activeFileAtStart = prevMarkdownView?.file ?? this.app.workspace.getActiveFile();

        try {
            const transcript = await this.recorder.stopRecording();
            new Notice("Recording stopped!");

            // If no file to attach to, still save transcript to vault root
            if (!activeFileAtStart) {
                new Notice("No active note to attach transcript to. Saving transcript to vault root.");
            }

            // Build transcript filename in transcripts/ folder at vault root
            const now = new Date();
            const month = (now.getMonth() + 1).toString().padStart(2, '0'); // 01-12
            const day = now.getDate().toString().padStart(2, '0'); // 01-31
            const timestamp = `${month}-${day}`;
            const transcriptBasename = activeFileAtStart ? `${activeFileAtStart.basename}-transcript-${timestamp}.md` : `transcript-${timestamp}.md`;

            // Always place transcripts in the transcripts/ folder at vault root
            const transcriptsFolder = 'transcripts';
            const filePath = `${transcriptsFolder}/${transcriptBasename}`;
            const normalized = normalizePath(filePath);
            const fileContent = `# Transcript\n\n${transcript}`;

            // Ensure the transcripts folder exists
            const transcriptsFolderPath = normalizePath(transcriptsFolder);
            if (!await this.app.vault.adapter.exists(transcriptsFolderPath)) {
                await this.app.vault.createFolder(transcriptsFolderPath);
            }

            // If there is an active note file, update its frontmatter with a transcript link
            if (activeFileAtStart) {
                try {
                    const cache = this.app.metadataCache.getFileCache(activeFileAtStart);
                    const oldContent = await this.app.vault.read(activeFileAtStart);
                    const newProps = Object.assign({}, cache?.frontmatter, { transcript: `[[${transcriptBasename.replace(/\.md$/, '')}]]` });

                    // Use js-yaml to serialize the frontmatter, then unquote wiki-links like [[Page]]
                    let yaml = dump(newProps, { lineWidth: -1 });

                    // Remove unnecessary quotes around wiki-links that js-yaml may have added
                    yaml = yaml.replace(/"(\[\[[^\]]+\]\])"/g, '$1');

                    const fmMatch = oldContent.match(/^---\n([\s\S]*?)\n---\n?/);
                    let newContent: string;
                    if (fmMatch) {
                        newContent = `---\n${yaml}\n---\n` + oldContent.slice(fmMatch[0].length);
                    } else {
                        newContent = `---\n${yaml}\n---\n\n` + oldContent;
                    }

                    await this.app.vault.modify(activeFileAtStart, newContent);
                } catch (err) {
                    console.error("Failed to update active file frontmatter:", err);
                    new Notice("Failed to update active note with transcript link.");
                }
            }

            // Create or append to the transcript file
            const fileExists = await this.app.vault.adapter.exists(normalized);
            if (fileExists) {
                // File exists - append new content with timestamp
                const existingContent = await this.app.vault.adapter.read(normalized);
                const appendTime = new Date().toLocaleString();
                const appendedContent = `${existingContent}\n\n---\n**Transcript appended at ${appendTime}**\n\n${transcript}`;
                await this.app.vault.adapter.write(normalized, appendedContent);
                new Notice(`Transcript appended to existing ${transcriptBasename}`);
            } else {
                // File doesn't exist - create new file
                await this.app.vault.create(normalized, fileContent);
                new Notice(`Transcript saved to ${transcriptBasename}`);
            }

            // Open the transcript in a split leaf (may steal focus)...
            const newLeaf = this.app.workspace.getLeaf('split');
            const fileObj = this.app.vault.getAbstractFileByPath(normalized);
            if (fileObj) {
                await newLeaf.openFile(fileObj as any);
            }

            // ...then restore the previously active leaf and editor focus so the editor remains active
            if (prevActiveLeaf) {
                try {
                } catch (e) {
                    // Fallback: reveal the previous leaf
                    this.app.workspace.revealLeaf(prevActiveLeaf);
                }
            }
            if (prevMarkdownView?.editor?.focus) {
                try { prevMarkdownView.editor.focus(); } catch (e) { /* ignore */ }
            }
        } catch (error) {
            console.error("Error during transcript to file:", error);
            new Notice("Error saving transcript: " + (error instanceof Error ? error.message : String(error)));
        }
    }

    async sendMessage(message: string) {
        try {
            // Get the most recent editor view
            const mostRecentEditorView = this.getMostRecentEditorView();
            let savedTranscript = '';
            
            if (mostRecentEditorView && mostRecentEditorView.file) {
                // Get frontmatter from the active file
                const cache = this.app.metadataCache.getFileCache(mostRecentEditorView.file);
                const transcriptWikilink = cache?.frontmatter?.transcript;
                
                if (transcriptWikilink) {
                    // Extract the page name from wikilink format [[PageName]]
                    const pageName = transcriptWikilink.replace(/\[\[([^\]]+)\]\]/, '$1');
                    const transcriptPath = `transcripts/${pageName}.md`;
                    const transcriptFile = this.app.vault.getAbstractFileByPath(normalizePath(transcriptPath));
                    
                    if (transcriptFile) {
                        savedTranscript = await this.app.vault.read(transcriptFile as any);
                    }
                }
            }
            
            // Get the live transcript from the recorder
            const liveTranscript = this.recorder.getFullTranscript();
            
            // Combine saved and live transcripts
            let combinedTranscript = '';
            if (savedTranscript) {
                combinedTranscript = savedTranscript;
                if (liveTranscript) {
                    combinedTranscript += '\n\n---\n**Live Recording in Progress**\n\n' + liveTranscript;
                }
            } else {
                combinedTranscript = liveTranscript || 'No Existing transcript available';
            }

            const forcedIntroPrompts = [
                {
                    role: 'developer' as const,
                    content: transcript_assistant_script
                },
                {
                    role: 'user' as const,
                    content: "The following is the transcript: " + combinedTranscript
                },
            ]
            
            this.conversationHistory.push({
                role: 'user',
                content: message
            })
            
            // Display user message in chat UI
            this.displayUserMessage(message);

            console.log('openAIKey:', this.openAIKey);
            const resp = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.openAIKey}`
                },
                body: JSON.stringify({
                    model: 'gpt-4',
                    messages: [...forcedIntroPrompts, ...this.conversationHistory],
                })
            })

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

    getMostRecentEditorView(): MarkdownView | null {
        const mostRecentLeaf = this.app.workspace.getMostRecentLeaf();
        return mostRecentLeaf?.view instanceof MarkdownView ? mostRecentLeaf.view : null;
    }

    private displayUserMessage(message: string) {
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

        // Auto-scroll to bottom
        this.chatContentEl.scrollTop = this.chatContentEl.scrollHeight;
    }

    private displayAssistantMessage(message: string) {
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

        // Auto-scroll to bottom
        this.chatContentEl.scrollTop = this.chatContentEl.scrollHeight;
    }

    private clearChat() {
        if (!this.chatContentEl) return;

        // Clear all chat messages from the UI
        this.chatContentEl.empty();

        // Reset conversation history but keep the initial message
        this.conversationHistory = [
            {
                role: 'user',
                content: 'What are the key points discussed in the meeting?'
            }
        ];

        new Notice('Chat cleared');
    }
}

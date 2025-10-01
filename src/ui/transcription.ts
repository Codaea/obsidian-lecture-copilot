import { MarkdownView, Notice, normalizePath, App } from 'obsidian';
import { dump } from 'js-yaml';

interface ITranscriptionViewDependencies {
    app: App;
}

export class TranscriptionUI {
    private view: ITranscriptionViewDependencies;
    private transcriptionEl: HTMLElement | null = null;
    private wordCountEl: HTMLElement | null = null;
    private userHasScrolled = false;

    constructor(view: ITranscriptionViewDependencies) {
        this.view = view;
    }

    setup(container: HTMLElement): { transcriptionEl: HTMLElement, durationEl: HTMLElement } {
        container.createEl('h5', { text: 'Transcription' });
        
        this.transcriptionEl = container.createEl('div', {
            text: '',
            cls: 'lecture-copilot-transcript'
        });

        this.setupTranscriptionStyles();
        this.setupScrollTracking();
        
        const { statsBar, durationEl } = this.createStatsBar(container);
        
        return { transcriptionEl: this.transcriptionEl, durationEl };
    }

    private setupTranscriptionStyles(): void {
        if (!this.transcriptionEl) return;

        this.transcriptionEl.style.height = '6lh';
        this.transcriptionEl.style.overflowY = 'auto';
        this.transcriptionEl.style.border = '1px solid var(--background-modifier-border)';
        this.transcriptionEl.style.padding = '8px';
        this.transcriptionEl.style.borderRadius = '4px';
        this.transcriptionEl.style.backgroundColor = 'var(--background-secondary)';
    }

    private setupScrollTracking(): void {
        if (!this.transcriptionEl) return;

        this.transcriptionEl.addEventListener('scroll', () => {
            if (this.transcriptionEl) {
                const { scrollTop, scrollHeight, clientHeight } = this.transcriptionEl;
                this.userHasScrolled = scrollTop + clientHeight < scrollHeight - 5;
            }
        });
    }

    private createStatsBar(container: HTMLElement): { statsBar: HTMLElement, durationEl: HTMLElement } {
        const statsBar = container.createEl('div', { cls: 'lecture-copilot-stats-bar' });
        statsBar.style.display = 'flex';
        statsBar.style.justifyContent = 'space-between';
        statsBar.style.fontSize = '0.85em';
        statsBar.style.color = 'var(--text-muted)';
        statsBar.style.marginTop = '4px';

        const durationEl = statsBar.createEl('div', { text: 'Duration: 0:00:00' });
        this.wordCountEl = statsBar.createEl('div', { text: 'Words: 0' });

        return { statsBar, durationEl };
    }

    updateTranscript(transcript: string, getCurrentTurn: () => string): void {
        if (!this.transcriptionEl) return;

        const paragraphs = transcript.split('\n\n').filter(p => p.trim());
        this.transcriptionEl.empty();

        paragraphs.forEach((paragraph, index) => {
            const p = this.transcriptionEl!.createEl('p');
            p.textContent = paragraph;
            p.style.margin = '0 0 8px 0';

            if (index === paragraphs.length - 1 && getCurrentTurn().trim()) {
                p.addClass('current-turn');
            }
        });

        if (!this.userHasScrolled) {
            this.transcriptionEl.scrollTop = this.transcriptionEl.scrollHeight;
        }

        this.updateWordCount(transcript);
    }

    private updateWordCount(transcript: string): void {
        if (!this.wordCountEl) return;

        const cleanTranscript = transcript.replace(/\n/g, ' ');
        const words = cleanTranscript.trim().split(/\s+/).filter(Boolean);
        this.wordCountEl.setText(`Words: ${words.length}`);
    }

    resetScrollTracking(): void {
        this.userHasScrolled = false;
    }

    async saveTranscriptToFile(transcript: string): Promise<void> {
        const prevActiveLeaf = this.view.app.workspace.activeLeaf;
        const mostRecentLeaf = this.view.app.workspace.getMostRecentLeaf();
        const prevMarkdownView = mostRecentLeaf?.view instanceof MarkdownView ? (mostRecentLeaf.view as MarkdownView) : null;
        const activeFileAtStart = prevMarkdownView?.file ?? this.view.app.workspace.getActiveFile();

        try {
            if (!activeFileAtStart) {
                new Notice("No active note to attach transcript to. Saving transcript to vault root.");
            }

            const now = new Date();
            const month = (now.getMonth() + 1).toString().padStart(2, '0');
            const day = now.getDate().toString().padStart(2, '0');
            const timestamp = `${month}-${day}`;
            const transcriptBasename = activeFileAtStart ? 
                `${activeFileAtStart.basename}-transcript-${timestamp}.md` : 
                `transcript-${timestamp}.md`;

            const transcriptsFolder = 'transcripts';
            const filePath = `${transcriptsFolder}/${transcriptBasename}`;
            const normalized = normalizePath(filePath);
            const fileContent = `# Transcript\n\n${transcript}`;

            const transcriptsFolderPath = normalizePath(transcriptsFolder);
            if (!await this.view.app.vault.adapter.exists(transcriptsFolderPath)) {
                await this.view.app.vault.createFolder(transcriptsFolderPath);
            }

            if (activeFileAtStart) {
                await this.updateFileFrontmatter(activeFileAtStart, transcriptBasename);
            }

            await this.createOrAppendTranscriptFile(normalized, fileContent, transcript, transcriptBasename);
            await this.openTranscriptFile(normalized);
            
            this.restorePreviousView(prevActiveLeaf, prevMarkdownView);

        } catch (error) {
            console.error("Error during transcript to file:", error);
            new Notice("Error saving transcript: " + (error instanceof Error ? error.message : String(error)));
        }
    }

    private async updateFileFrontmatter(activeFile: any, transcriptBasename: string): Promise<void> {
        try {
            const cache = this.view.app.metadataCache.getFileCache(activeFile);
            const oldContent = await this.view.app.vault.read(activeFile);
            const newProps = Object.assign({}, cache?.frontmatter, { 
                transcript: `[[${transcriptBasename.replace(/\.md$/, '')}]]` 
            });

            let yaml = dump(newProps, { lineWidth: -1 });
            yaml = yaml.replace(/"(\[\[[^\]]+\]\])"/g, '$1');

            const fmMatch = oldContent.match(/^---\n([\s\S]*?)\n---\n?/);
            let newContent: string;
            if (fmMatch) {
                newContent = `---\n${yaml}\n---\n` + oldContent.slice(fmMatch[0].length);
            } else {
                newContent = `---\n${yaml}\n---\n\n` + oldContent;
            }

            await this.view.app.vault.modify(activeFile, newContent);
        } catch (err) {
            console.error("Failed to update active file frontmatter:", err);
            new Notice("Failed to update active note with transcript link.");
        }
    }

    private async createOrAppendTranscriptFile(normalized: string, fileContent: string, transcript: string, transcriptBasename: string): Promise<void> {
        const fileExists = await this.view.app.vault.adapter.exists(normalized);
        if (fileExists) {
            const existingContent = await this.view.app.vault.adapter.read(normalized);
            const appendTime = new Date().toLocaleString();
            const appendedContent = `${existingContent}\n\n---\n**Transcript appended at ${appendTime}**\n\n${transcript}`;
            await this.view.app.vault.adapter.write(normalized, appendedContent);
            new Notice(`Transcript appended to existing ${transcriptBasename}`);
        } else {
            await this.view.app.vault.create(normalized, fileContent);
            new Notice(`Transcript saved to ${transcriptBasename}`);
        }
    }

    private async openTranscriptFile(normalized: string): Promise<void> {
        const newLeaf = this.view.app.workspace.getLeaf('split');
        const fileObj = this.view.app.vault.getAbstractFileByPath(normalized);
        if (fileObj) {
            await newLeaf.openFile(fileObj as any);
        }
    }

    private restorePreviousView(prevActiveLeaf: any, prevMarkdownView: MarkdownView | null): void {
        if (prevActiveLeaf) {
            try {
                this.view.app.workspace.revealLeaf(prevActiveLeaf);
            } catch (e) {
                // Ignore errors
            }
        }
        if (prevMarkdownView?.editor?.focus) {
            try { 
                prevMarkdownView.editor.focus(); 
            } catch (e) { 
                // Ignore errors
            }
        }
    }
}
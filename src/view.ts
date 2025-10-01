import { ItemView, MarkdownView, WorkspaceLeaf, Notice, normalizePath, IconName } from 'obsidian';
import { dump } from 'js-yaml';
import LectureCopilot, { LECTURE_COPILOT_VIEW_TYPE } from './main';
import { AudioRecorder } from './audiorecorder';

export class LectureCopilotView extends ItemView {
    private recorder: AudioRecorder;
    private plugin: LectureCopilot;
    private transcriptionEl: HTMLElement | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: LectureCopilot) {
        super(leaf);
        this.plugin = plugin;
        // initialize recorder with the current saved API key
        this.recorder = new AudioRecorder(this.plugin.settings?.AssemblyAPIKey ?? '');
    }

    // allow updating the AssemblyAI key at runtime when the user changes settings
    public updateAssemblyApiKey(apiKey: string) {
        if (this.recorder && typeof this.recorder.setAssemblyAPIKey === 'function') {
            this.recorder.setAssemblyAPIKey(apiKey);
        }
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
        container.createEl("h4", { text: "Lecture Copilot" });
        container.createEl('br');
        // Create Start and Stop buttons
        const startButton = container.createEl("button", { text: "Start Recording" });
        const stopButton = container.createEl("button", { text: "Stop Recording" });
        stopButton.hide();

        container.createEl('h5', { text: 'Transcription:', });
        this.transcriptionEl = container.createEl('div', {
            text: '',
            cls: 'lecture-copilot-transcript'
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

                    // Highlight the current (incomplete) turn
                    if (index === paragraphs.length - 1 && this.recorder.getCurrentTurn().trim()) {
                        p.addClass('current-turn');
                    }
                });

                // Auto-scroll to bottom
                this.transcriptionEl.scrollTop = this.transcriptionEl.scrollHeight;
            }
        };

        startButton.addEventListener("click", async () => {
            try {
                this.recorder.clearTranscript(); // Clear previous transcript
                await this.recorder.startRecording();
                new Notice("Recording started!");
                startButton.hide();
                stopButton.show();
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

            // Build transcript filename next to the active file (or root)
            const now = new Date();
            const timestamp = `${now.getDay()}-${now.getMonth() + 1}`
            const transcriptBasename = activeFileAtStart ? `${activeFileAtStart.basename}-transcript-${timestamp}.md` : `transcript-${timestamp}.md`;
            const folder = activeFileAtStart ? activeFileAtStart.path.replace(/\/[^/]+$/, '') : '';
            const filePath = folder ? `${folder}/${transcriptBasename}` : transcriptBasename;
            const normalized = normalizePath(filePath);
            const fileContent = `# Transcript\n\n${transcript}`;

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

            // Create the transcript file
            await this.app.vault.create(normalized, fileContent);
            new Notice(`Transcript saved to ${transcriptBasename}`);

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

}
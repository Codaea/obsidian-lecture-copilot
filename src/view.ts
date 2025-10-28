import { ItemView, MarkdownView, WorkspaceLeaf, Notice, normalizePath, IconName } from 'obsidian';
import LectureCopilot, { LECTURE_COPILOT_VIEW_TYPE } from './main';
import { AudioRecorder } from './audiorecorder';
import { ChatUI } from './ui/chat';
import { ControlsUI } from './ui/controls';
import { TranscriptionUI } from './ui/transcription';

export class LectureCopilotView extends ItemView {
    private recorder: AudioRecorder;
    private plugin: LectureCopilot;
    private openAIKey = '';
    private chatUI: ChatUI;
    private controlsUI: ControlsUI;
    private transcriptionUI: TranscriptionUI;

    constructor(leaf: WorkspaceLeaf, plugin: LectureCopilot) {
        super(leaf);
        this.plugin = plugin;
        // initialize recorder with the current saved API key
        this.recorder = new AudioRecorder(this.plugin.settings?.AssemblyAPIKey ?? '');
        // initialize OpenAI key from settings
        this.openAIKey = this.plugin.settings?.OpenAIAPIKey ?? '';
        
        // Initialize UI modules
        this.chatUI = new ChatUI(this);
        this.controlsUI = new ControlsUI(this);
        this.transcriptionUI = new TranscriptionUI(this);
    }

    // allow updating the AssemblyAI key at runtime when the user changes settings
    public updateAssemblyApiKey(apiKey: string) {
        if (this.recorder && typeof this.recorder.setAssemblyAPIKey === 'function') {
            this.recorder.setAssemblyAPIKey(apiKey);
        }
    }

    public updateOpenAIKey(apiKey: string) {
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
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();

        // Set up flex layout for the main container
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.height = '100%';

        container.createEl("h4", { text: "Lecture Copilot" });

        // Setup UI modules
        this.controlsUI.setup(container);
        const { durationEl } = this.transcriptionUI.setup(container);
        this.controlsUI.setDurationElement(durationEl);
        this.chatUI.setup(container);

        // Set up the live update callback
        this.recorder.onTranscriptUpdate = (transcript: string) => {
            this.transcriptionUI.updateTranscript(transcript, () => this.recorder.getCurrentTurn());
        };
    }

    async onClose() {

    }

    // Methods expected by UI modules
    public clearTranscript(): void {
        this.recorder.clearTranscript();
    }

    public resetScrollTracking(): void {
        this.transcriptionUI.resetScrollTracking();
    }

    public async startRecording(): Promise<void> {
        await this.recorder.startRecording();
    }

    public async transcriptToFile(): Promise<void> {
        const transcript = await this.recorder.stopRecording();
        new Notice("Recording stopped!");
        
        const transcriptionManager = this.plugin.transcriptmanager;
        console.log("Saving transcript to file...");
        await transcriptionManager.saveTranscript(transcript);
        
    }


    public async getCombinedTranscript(): Promise<string> {
        const mostRecentEditorView = this.getMostRecentEditorView();
        let savedTranscript = '';
        
        if (mostRecentEditorView && mostRecentEditorView.file) {
            const cache = this.app.metadataCache.getFileCache(mostRecentEditorView.file);
            const transcriptWikilink = cache?.frontmatter?.transcript;
            
            if (transcriptWikilink) {
                const pageName = transcriptWikilink.replace(/\[\[([^\]]+)\]\]/, '$1');
                const transcriptPath = `transcripts/${pageName}.md`;
                const transcriptFile = this.app.vault.getAbstractFileByPath(normalizePath(transcriptPath));
                
                if (transcriptFile) {
                    savedTranscript = await this.app.vault.read(transcriptFile as any);
                }
            }
        }
        
        const liveTranscript = this.recorder.getFullTranscript();
        
        let combinedTranscript = '';
        if (savedTranscript) {
            combinedTranscript = savedTranscript;
            if (liveTranscript) {
                combinedTranscript += '\n\n---\n**Live Recording in Progress**\n\n' + liveTranscript;
            }
        } else {
            combinedTranscript = liveTranscript || 'No Existing transcript available';
        }

        return combinedTranscript;
    }

    public getOpenAIKey(): string {
        return this.openAIKey;
    }

    private getMostRecentEditorView(): MarkdownView | null {
        const mostRecentLeaf = this.app.workspace.getMostRecentLeaf();
        return mostRecentLeaf?.view instanceof MarkdownView ? mostRecentLeaf.view : null;
    }
}

import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, ItemView, Vault, normalizePath } from 'obsidian';
import { registerCommands } from './commands';
import { LectureCopilotSettings, DEFAULT_SETTINGS, LectureCopilotSettingTab } from './settings';
import { LectureCopilotView } from './view';
import { AIClient } from './aiclient';
import { TranscriptManager } from './transcriptmanager';

export const LECTURE_COPILOT_VIEW_TYPE = "lecture-copilot-view";

export default class LectureCopilot extends Plugin {
	settings: LectureCopilotSettings;
	aiclient: AIClient;
	transcriptmanager: TranscriptManager;

	async onload() {
		await this.loadSettings();
		// register AI class handler
		this.aiclient = new AIClient({openAIKey: this.settings.OpenAIAPIKey, endpoint: 'https://api.openai.com'});
		this.transcriptmanager = new TranscriptManager(this.app, this.aiclient);

		// Register the view
		this.registerView(
			LECTURE_COPILOT_VIEW_TYPE,
			(leaf) => new LectureCopilotView(leaf, this)
		);

		// Register transcript update and other commands
		registerCommands(this);

		// general view commands are easier to keep here than in commands/index.ts
		// sometimes ribon icon dissapears
		this.addCommand({
			id: 'open-lecture-copilot-view',
			name: 'Open Side Panel',
			callback: () => {
				this.activateView();
			}
		});

		this.addCommand({
			id: 'index-transcript',
			name: 'Index Current Transcript',
			callback: async () => {
				const mostRecentLeaf = this.app.workspace.getMostRecentLeaf();
				if (!mostRecentLeaf) {
					new Notice("No active leaf found to index the transcript.");
					return;
				}
				const view = mostRecentLeaf.view as MarkdownView | null;
				const activeFile = view?.file;
				if (!activeFile) {
					new Notice("No active file found to index the transcript.");
					return;
				}
				try {
					await this.transcriptmanager.indexTranscript(activeFile.path);
				} catch (error) {
					console.error("Error indexing transcript:", error);
					new Notice("Failed to index transcript: " + (error instanceof Error ? error.message : String(error)));
				}
			}
		})

		// Add ribbon icon that opens the side panel
		this.addRibbonIcon('notebook', 'Open Lecture Copilot', () => {
			this.activateView();
		});

		this.addSettingTab(new LectureCopilotSettingTab(this.app, this));

		this.activateView();
	}

	onunload() {
		// Clean up - detach the view
		this.app.workspace.detachLeavesOfType(LECTURE_COPILOT_VIEW_TYPE);
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(LECTURE_COPILOT_VIEW_TYPE);

		if (leaves.length > 0) {
			// A leaf with our view already exists, use that
			leaf = leaves[0];
		} else {
			// Our view could not be found in the workspace, create a new leaf
			// in the right sidebar for it
			leaf = workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({ type: LECTURE_COPILOT_VIEW_TYPE, active: true });
			}
		}

		// "Reveal" the leaf in case it is in a collapsed sidebar
		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

import { App, PluginSettingTab, Setting } from 'obsidian';

export interface LectureCopilotSettings {
    AssemblyAPIKey: string;
    OpenAIAPIKey: string;
}

export const DEFAULT_SETTINGS: LectureCopilotSettings = {
    AssemblyAPIKey: 'KEYHERE',
    OpenAIAPIKey: 'KEYHERE'
}

// Import the plugin type and view constant
import type LectureCopilot from './main';
import { LECTURE_COPILOT_VIEW_TYPE } from './main';

export class LectureCopilotSettingTab extends PluginSettingTab {
    plugin: LectureCopilot;

    constructor(app: App, plugin: LectureCopilot) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        new Setting(containerEl)
            .setName('AssemblyAI API Key')
            .setDesc('Your AssemblyAI API Key for transcription services.')
            .addText(text => text
                .setPlaceholder('Enter your AssemblyAI API Key')
                .setValue(this.plugin.settings.AssemblyAPIKey)
                .onChange(async (value) => {
                    this.plugin.settings.AssemblyAPIKey = value;
                    await this.plugin.saveSettings();

                    // Update any open LectureCopilotView instances so their recorder uses the new key
                    const leaves = this.app.workspace.getLeavesOfType(LECTURE_COPILOT_VIEW_TYPE);
                    for (const leaf of leaves) {
                        // view might be our LectureCopilotView; use a safe cast
                        const viewAny = leaf.view as any;
                        if (viewAny && typeof viewAny.updateAssemblyApiKey === 'function') {
                            try { viewAny.updateAssemblyApiKey(value); } catch (e) { console.error('Failed to update view API key', e); }
                        }
                    }
                }));
        new Setting(containerEl)
            .setName('OpenAI API Key')
            .setDesc('Your OpenAI API Key for AI services.')
            .addText(text => text
                .setPlaceholder('Enter your OpenAI API Key')
                .setValue(this.plugin.settings.OpenAIAPIKey)
                .onChange(async (value) => {
                    this.plugin.settings.OpenAIAPIKey = value;
                    await this.plugin.saveSettings();

                    // Update any open LectureCopilotView instances so their AI client uses the new key
                    const leaves = this.app.workspace.getLeavesOfType(LECTURE_COPILOT_VIEW_TYPE);
                    for (const leaf of leaves) {
                        // view might be our LectureCopilotView; use a safe cast
                        const viewAny = leaf.view as any;
                        if (viewAny && typeof viewAny.updateOpenAIKey === 'function') {
                            try { viewAny.updateOpenAIKey(value); } catch (e) { console.error('Failed to update view API key', e); }
                        }
                    }
                }));
    }
}